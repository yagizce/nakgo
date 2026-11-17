# Yedek çekirdeği (B7-A2)

Araçlar: `tools/backup/{dump,restore-verify,encrypt,manifest,store,deletion,pipeline}.cjs`. Testler: `tests/backup/a2-core.test.cjs`.

## Aşamalar

Aşamalar sırayla ve ayrı ayrı raporlanır. Biri bile "ok" değilse yedek **doğrulanmış sayılmaz**; sonraki aşamalar "skipped" olur.

| Aşama | Anlamı | Başarısızsa |
|---|---|---|
| `preflight` | A1 yetki denetimi ve muafiyet kararı (A4'te bağlanır). Tanımlı değilse başarısız sayılır. | Hiçbir şey dökülmez |
| `dump` | Tek anlık görüntüden döküm, kapsam korumaları | Şifreleme ve yükleme yok |
| `restore_test` | **S1**: düz PostgreSQL'e geri yükleme + bütünlük | Şifreleme ve yükleme yok |
| `legal` | A3 yasal kanıtı; yasal tablolar yoksa `n/a` | Şifreleme ve yükleme yok |
| `encryption` | age, alıcı sabitlemesi, başlık denetimi | Yükleme yok |
| `upload` | Koşullu yazma ("yoksa yaz") + geri okunan hash eşitliği | Doğrulanmamış |
| `manifest_signature`, `manifest_upload` | K1 imzalı manifesto; başarısız çalışmalar da manifesto bırakır | Bir sonraki kontrol noktası kaydeder |
| `plaintext_cleanup` | Şifresiz çalışma klasörü her koşulda silinir | Alarm |

## Tutarlı anlık görüntü

- **S1** (yedek rolü): `REPEATABLE READ, READ ONLY` işlemi açılır, ilk komut `pg_export_snapshot()` olur. Aynı işlem içinde satır sayıları, korumalar, Auth sürümü, şema parmak izi ve geri yükleme bilgisi okunur.
- **S2**: iki `pg_dump --snapshot=<id>`: tam şemalar (`public`, `private`) ve kapsamdaki tekil tablolar (`auth.users`, `auth.identities`, …).
- S1, iki döküm bitene kadar açık kalır (`idle_in_transaction_session_timeout` rolde 20 dk), sonra geri alınır. Açık kaldığı süre `s1_open_ms` olarak manifestoya yazılır.
- **Kanıt:** Geri yüklenen kopyadaki sayılar S1 ile birebir eşit olmalı. Test, döküm sürerken sürekli satır ekleyen bir yazıcıyla bunu gösterir: canlı sayı büyür, döküm S1'le aynı kalır. `--snapshot` kaldırılınca (kasıtlı bozma) doğrulama düşer.

## Bağlantı kuralları (muaf tutulamaz)

- **Uzak sunucu:**
  - `sslmode=verify-full` ve kök sertifika dosyası zorunlu;
  - sunucu adı `*.pooler.supabase.com`;
  - port 5432 (Supavisor oturum modu).
- Port 6543 (işlem modu) reddedilir: açık işlem ve oturum ayarları korunmaz, dışa aktarılan görüntüye güvenilemez.
- Yerel sunucuya yalnız testlerde (`allowLocal`) bağlanılır.
- `pg_dump`/`pg_restore` sürümü sunucudan eskiyse döküm başlamaz.

## Kapsam korumaları (`ops/backup/scope.json`)

- Zorunlu tablo (`auth.users`, `auth.identities`) yoksa döküm başlamaz.
- `storage.objects` boş değilse döküm başlamaz: dosya yedeği tasarlanmadı.
- Kapsam dışı ama kalıcı veri içeren Auth özellikleri ve Vault: satır görünürse döküm başlamaz. Yedek rolü bu tabloları okuyamadığı için sayım `pg_stat_all_tables.n_live_tup` ile yapılır; bu yaklaşık bir değerdir (V).
- Bilerek kaybedilenler (`known_loss`: MFA kurtarma kodları, Auth denetim günlüğü): sayıları şifreli pakete yazılır.
- **Bilinçli kırılma:** Yedek rolünün okuyamadığı yeni bir tablo ya da dizi varsa döküm `permissions` aşamasında tablo adıyla durur.

## S1 geri yükleme ve doğrulama

Yalnız yerel ve geçici bir veritabanına (db-lib). Production'a ya da herhangi bir Supabase projesine geri yükleme yolu kodda yoktur.

**Sıra:**
1. ACL'lerde geçen roller (yoksa NOLOGIN; `service_role` BYPASSRLS).
2. `bootstrap.sql`: kapsamdaki tabloların şemaları, enum/domain tipleri, tam şemaların başvurduğu kapsam dışı fonksiyonlar (ör. `auth.uid()`). Bu bilgiler S1'de katalogdan üretilir.
3. B ön-veri ve veri.
4. A: "SCHEMA - public" kaydı atlanır; şemanın varsayılan ACL'si korunur.
5. B son-veri: politikalar, yabancı anahtarlar ve yalnız kendi şemalarımızdaki fonksiyonları çağıran tetikleyiciler. Supabase'in iç tetikleyicileri düz PostgreSQL'de bulunmaz.

**Kontroller:**
- satır sayıları = S1;
- her yabancı anahtar için yetim satır = 0 (NOT VALID olanlar dahil);
- rolden bağımsız şema parmak izi = S1;
- Auth sürümü = S1;
- API sözleşmesi v0;
- isteğe bağlı kancalar (A3).

**B1 bulgusu:** B1'in `SNAPSHOT_SQL` sorgusundaki `grant`/`colgrant` satırları `information_schema`'dan gelir ve yalnız çağıranın görebildiği yetkileri listeler. Yedek rolüyle anon/authenticated yetkileri görünmez. Bu yüzden yedek doğrulamasında o satırlar çıkarılır, yerine doğrudan katalogdaki ACL'ler (`relacl`, `attacl`, `nspacl`, `proacl`) kullanılır. B1'in production karşılaştırması `postgres` rolüyle yapıldığı için geçerliliğini korur.

**S1 ne değildir:** "Auth kurtarması başarılı" anlamına gelmez. O yalnız gerçek bir Supabase projesinde, e-posta+parola ve Google girişiyle (S2b) kanıtlanır.

## Şifreleme

- Yalnız açık anahtarlarla (iki çevrim dışı alıcı) şifrelenir.
- Alıcı listesinin hash'i iş akışında sabittir; dosya ile sabit değer yalnız birlikte, incelemeli PR ile değişir.
- Başlıkta alıcı sayısı kadar X25519 bölümü olmalı, parola ya da scrypt türü bölüm olmamalı.
- **"Şifreleme ok" çözülebilirliği kanıtlamaz.** Çözülebilirlik testlerde geçici anahtarlarla, gerçekte aylık çevrim dışı tatbikatla kanıtlanır.
- Değiştirilmiş bir şifreli dosyanın çözülemediği testte gösterilir.

## Depo ve silme

- `S3Store`: R2'nin S3 uyumlu API'si için SigV4 imzalı en küçük istemci.
- Testlerdeki `MemoryStore` ve `tests/backup/s3-mock.cjs` kilit ve koşullu yazmayı **simüle eder**. Bu, gerçek R2 davranışının kanıtı değildir.
- `deletion.plan` varsayılan olarak kapalıdır. Silme için şunların hepsi gerekir:
  - açıkça etkinleştirilmiş olması;
  - K3'te kanıtlanmış depo davranışı;
  - zincirde açık olay olmaması (A3);
  - dış çapanın yazılmış olması.
- Kova kilidi koddan bağımsız ayrı bir sınırdır.

## Test edilemeyenler

- PGlite'ta uçtan uca boru hattı (pg_dump/pg_restore ve çoklu bağlantı yok).
- Yerel PG17'de uçtan uca boru hattı: yerelde 17 sürümlü `pg_dump` yok. CI, PGDG'den PostgreSQL 17 istemcisini kurup bu testleri zorunlu çalıştırır (`NAKGO_REQUIRE_DUMP=1`).
- Supavisor üzerinden bağlantı, gerçek Supabase rol kısıtları ve gerçek R2 davranışı: B7-B (T1–T3, K3).

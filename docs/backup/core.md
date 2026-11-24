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

## Kipler ve salt okunurluk

- **functions** (B7): yedek rolü, Auth/Storage/meta satırları yalnız dışa aktarma fonksiyonlarından.
- **Elle yedek imzası (bootstrap, K6b):** çevrim içi makine imzalamaz; manifest gövdesi ve izin listeli kayıt çevrim
  dışı K9 ile, imza makinesinin kendi L2 doğrulamasından sonra imzalanır ([runbooks/offline-signing.md](runbooks/offline-signing.md)).
- **bootstrap** (ilk yedek, [runbooks/bootstrap-first-backup.md](runbooks/bootstrap-first-backup.md)): yedek rolü ve
  fonksiyonlar yokken, fonksiyonların sahibi olacak rolle aynı sorgular doğrudan (`scope-export.cjs → DIRECT_SQL`; test,
  sorguların fonksiyon gövdeleriyle birebir aynı olduğunu ve aynı veritabanında iki kipin aynı satırları verdiğini
  denetler). Ek ön denetim: okunacak her tablo ve dizi okunabilir, RLS bu rol için etkin değil (`rls` aşaması).
- **Her bağlantı salt okunur:** başlangıç parametresine (`options`/`PGOPTIONS`) dayanılmaz; havuzlayıcı onu iletmeyebilir.
  S1 bağlantısında ilk iş `SET default_transaction_read_only = on` ve değerin `on` olduğunun doğrulanmasıdır; S1 ayrıca
  `READ ONLY` işlemdir; ikisi de "on" değilse `read_only` aşamasında durur. `pg_dump` kendi işlemini
  `REPEATABLE READ, READ ONLY` açar; ortamdan devralınan `PGOPTIONS` silinir. Sonuç `source.json → read_only`'ye yazılır.

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
- Kapsam dışı ama kalıcı veri içeren Auth özellikleri ve Vault: satır varsa döküm başlamaz. Sayım kesindir: rol bu tabloları okuyamaz, yalnız `private.nakgo_backup_guard_counts()` fonksiyonundan tablo başına **sayı** alır (liste fonksiyonda sabit; test `scope.json` ile eşitliğini denetler).
- Bilerek kaybedilenler (`known_loss`: MFA kurtarma kodları, Auth denetim günlüğü): sayıları şifreli pakete yazılır.
- **Yetki:** Yedek rolü `public`/`private`'ı doğrudan SELECT ile okur. Rolü oluşturan rolün ileride açacağı tablolar
  varsayılan yetkiyle okunur ve tam şema dökümüne girer. Başka bir rolün oluşturduğu ya da yetkisi geri alınmış bir
  tablo, veya çağrılamayan bir dışa aktarma fonksiyonu varsa döküm, korumalardan ve sayımlardan ÖNCE `permissions`
  aşamasında adıyla durur (sessiz eksik yok).
- **Büyük nesneler:** ne pg_dump `-n` ne dışa aktarma kapsamındadır; `pg_largeobject_metadata` boş değilse döküm `guards`
  aşamasında durur. Bu, PUBLIC `lo_create` yan yolunun tek kalıcı izini de yakalar ([side-channels.md](side-channels.md)).
- **Oturum/belirteç tabloları:** rol bunları okuyamaz (42501) ve onlar için dışa aktarma fonksiyonu yoktur. Test, şifreli
  paketteki B dosyalarında oturum kimliği ve yenileme belirteci değerlerinin bulunmadığını doğrular.

- **Kapsam denetimi (`coverage`):** `scope.json → coverage_schemas` (`auth`, `storage`, `vault`) içindeki her tablo
  bir sınıfta olmalı (`tables`, `excluded.transient`, `known_loss`, `guard_stop_if_rows`, `managed`, `meta`). Değilse
  korumalardan ÖNCE durur; yalnız katalog okunur. Supabase yeni bir tablo eklediğinde sessiz kayıp olmaz.
- **Envanter denetimi (`coverage`, yalnız bootstrap):** aynı şemalardaki gerçek tablo kümesi
  `scope.json → coverage_inventory.tables` ile birebir aynı olmalı. Eksik tablo, fazla tablo (sınıflandırılmış olsa bile),
  listede yinelenen ya da sınıflandırılmamış satır veya listenin yokluğu dökümü veri okunmadan durdurur. Liste,
  Production'da salt okunur katalog sorgusuyla gözlenen kümedir (24.11.2026: 38 tablo; auth 27, storage 10, vault 1) ve
  testteki Supabase taklidi (`tests/backup/prod-fixture.cjs → PROD_AUX_TABLES`) ile eşit olduğu testte denetlenir.
  Güncelleme: [bootstrap-first-backup.md](runbooks/bootstrap-first-backup.md) → "Kapsam envanteri". **B7 (K6b) kipi bu
  denetimi uygulamaz**; yalnız sınıflandırma denetimini yapar. Bu açık kapanmadan K6b/B7 etkinleştirilmez.
- **Sayılamayan koruma tablosu:** listede olup veritabanında bulunan bir tablo sayım sonucunda yoksa döküm `guards`
  aşamasında durur. `auth.instances` (eski GoTrue tablosu, yapılandırma tutabilir) ve Storage'ın dosyaya bağlı yardımcı
  tabloları (önekler, analitik/vektör kovaları, kova yaşam döngüsü tabloları) `guard_stop_if_rows_pending` listesindedir: bootstrap bunları doğrudan
  sayar; B7'nin sayım fonksiyonu henüz saymaz, bu yüzden B7 bu tablolar varsa durur (ayrı iş). Yarım kalmış çok parçalı
  yüklemeler geçici sınıftadır.

## Yönetim verisi (`scope.json → meta`)

- `cron.job` (ad, zaman, komut, veritabanı, kullanıcı, etkinlik) ve `supabase_migrations.schema_migrations` (yalnız
  sürüm ve ad; SQL metni repodadır) S1 içinde `meta/<ad>.jsonl` olarak alınır; tablo yoksa `present: false`. Yalnız
  bootstrap kipinde: B7'de dışa aktarma fonksiyonu yoktur, tablo varsa döküm `meta` aşamasında durur (ayrı iş).
- Düz PostgreSQL doğrulamasında tablo olarak geri yüklenmez: dosya hash'i ve satır sayısı denetlenir (`meta` kontrolü).
  Repo ile tutarlılık (`restore-meta.cjs`) doğrulamayı düşürmez, **not** olarak kaydedilir; kurtarmada durdurma koşuludur.
- Kapsam dışı Auth/Storage tablolarındaki kendi tetikleyicilerimiz (ör. `auth.sessions → nakgo_access_log`)
  `source.json → external_triggers`'a, o tabloların yapısı (veri yok) `X.pre.sql`'e yazılır. Hedefte kurtarma SQL'i
  tetikleyicileri kurar; prova yerel kopyada aynısını yapar.
- Kaynak repodan gerideyse (migration geçmişinde bekleyen var) API sözleşmesi S1'de değil provada denetlenir; S1 bunu not
  olarak yazar.

## B: Auth/Storage kapsamı (`tools/backup/scope-export.cjs`)

pg_dump `-t auth.users` kullanılmaz: rolün `auth`/`storage` şemalarında USAGE'ı yoktur ve pg_dump tabloyu kilitleyemez.
- **Yapı:** S1 içinde katalogdan (`format_type`, `pg_get_constraintdef`, `pg_get_expr`, `pg_get_triggerdef`, `pg_policy`,
  `relacl`/`attacl`). `B.pre.sql`: tablolar, sütunlar (varsayılan, kimlik, üretilen), birincil/tekil/denetim kısıtları.
  `B.post.sql`: kapsam içi yabancı anahtarlar, RLS bayrağı, politikalar, izinli tetikleyiciler, ACL. Kapsam dışına giden
  yabancı anahtarlar ve tetikleyiciler `source.json`'da `b_skipped` olarak listelenir. Tekil olmayan dizinler alınmaz.
- **Veri:** S1 işlemi içinde `declare … cursor for select j::text from private.nakgo_backup_<tablo>() j`, 1000'lik
  parçalarla `B/<şema>.<tablo>.jsonl`. Satır sayısı ve dosya sha256'sı `source.json`'a yazılır.
- **Bu DDL yalnız doğrulama geri yüklemesi içindir.** Gerçek kurtarmada Auth/Storage şemasını Supabase kurar; yalnız
  veri yüklenir ([runbooks/restore-dr.md](runbooks/restore-dr.md)).

## S1 geri yükleme ve doğrulama

Yalnız yerel ve geçici bir veritabanına (db-lib). Production'a ya da herhangi bir Supabase projesine geri yükleme yolu kodda yoktur.

**Sıra:**
1. ACL'lerde geçen roller (yoksa NOLOGIN; `service_role` BYPASSRLS).
2. `bootstrap.sql`: kapsamdaki tabloların şemaları, enum/domain tipleri, tam şemaların başvurduğu kapsam dışı fonksiyonlar (ör. `auth.uid()`). Bu bilgiler S1'de katalogdan üretilir.
3. `B.pre.sql`, ardından `B/*.jsonl` (sha256 ve satır sayısı denetlenir; `jsonb_populate_recordset`, üretilen sütunlar atlanır, kimlik değerleri korunur).
4. A: "SCHEMA - public" kaydı atlanır; şemanın varsayılan ACL'si korunur.
5. `B.post.sql`: yabancı anahtarlar, RLS, politikalar, ACL ve yalnız kendi şemalarımızdaki fonksiyonları çağıran tetikleyiciler. Supabase'in iç tetikleyicileri düz PostgreSQL'de bulunmaz.

**Kontroller:**
- satır sayıları = S1;
- B içeriği (`b_content`): geri yüklenen Auth/Storage satırlarının aynı oturum ayarlarıyla (`UTC`, `ISO`) yeniden
  `to_jsonb` çıktısı, dosyadaki satırlarla çoklu küme olarak birebir aynı (tür dönüşümünde kayıp yakalanır; `json` türü
  sütunlar dışa aktarmada zaten `jsonb` biçimine normalleşir ve bu fark görünmez);
- her yabancı anahtar için yetim satır = 0 (NOT VALID olanlar dahil);
- rolden bağımsız şema parmak izi = S1 (nesne sahibinin kendi örtük yetkileri hariç: geri yükleme `--no-owner`'dır ve
  Supabase'te Auth tablolarının sahibi `supabase_auth_admin`'dir);
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
  - dış çapanın yazılmış olması;
  - silmeden sonra yeterli doğrulanmış yedek kalması: en az 4 doğrulanmış yedek ve en yenisi 24 saatten yeni (A3,
    `coverage`). Kapsama bilinmiyorsa silme yok.
- Kova kilidi koddan bağımsız ayrı bir sınırdır.

## Test edilemeyenler

- PGlite'ta uçtan uca boru hattı (pg_dump/pg_restore ve çoklu bağlantı yok).
- Yerel PG17'de uçtan uca boru hattı: yerelde 17 sürümlü `pg_dump` yok. CI, PGDG'den PostgreSQL 17 istemcisini kurup bu testleri zorunlu çalıştırır (`NAKGO_REQUIRE_DUMP=1`).
- Supavisor üzerinden bağlantı, gerçek Supabase rol kısıtları ve gerçek R2 davranışı: B7-B (T1–T3, K3).

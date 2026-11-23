# Runbook: ilk Production yedeği (K6b-0, "bootstrap")

> Tek seferlik, elle ve **her adımı ayrı yazılı onaylı** bir işlemdir. Yalnız proje sahibi başlatır; parola, bağlantı
> bilgisi ve anahtar sahibin makinesinden çıkmaz, sohbete, PR'a ya da kayda yazılmaz. Bu belge, kod ve testler hazır
> olduğunda neyin nasıl yapılacağını anlatır.

## Neden gerekli

- Production Supabase Free planda: platform yedeği, PITR ve yeni projeye geri yükleme yok (22.11.2026 incelemesi).
- B7 yedeği `nakgo_backup` rolüne ve `private.nakgo_backup_*` dışa aktarma fonksiyonlarına dayanır. Bunlar bekleyen
  migration'larda (`20261118000000_backup_export.sql`). Production'da yoklar.
- Bekleyen migration'lar (bir kısmı "Riskli" sınıfta) taze ve doğrulanmış bir yedek olmadan uygulanmamalı
  ([migration-safety.md](../../migration-safety.md)). İlk yedek bu döngüyü kırar.

## Yöntem

`tools/backup/bootstrap.cjs`, B7 boru hattının aynısını "bootstrap" kipinde çalıştırır. Yedek **üç aşamada** tamamlanır:
`run` (çevrim içi) → `offline-sign` (çevrim dışı, K9) → `finalize` (çevrim içi). Ayrıntı: [offline-signing.md](offline-signing.md).

| Adım | Ne yapar |
|---|---|
| Ön koşul | Onay kaydı, yapılandırma (alıcı hash'i, tam iki alıcı A/B, `trusted_k9`/`active_k9`, `trusted_anchors`/`active_anchor_sha256`, K1/K2/K9 ayrık), yerel PostgreSQL hedefi, araç sürümleri; veritabanında yedek rolünün fonksiyonları varsa **çalışmaz** (o zaman K6b). Yapılandırma bağlantıdan önce denetlenir. |
| Bağlantı güvenliği | Production'a **hiçbir bağlantı açılmadan önce** bağlantı kuralları denetlenir: `sslmode=verify-full`, var olan kök sertifika dosyası, `*.pooler.supabase.com` sunucu adı, port 5432 (6543 reddedilir). Uzak sunucu için TLS doğrulaması (sertifika zinciri ve sunucu adı) olmayan bir bağlantı yapılandırması hiç üretilmez. Kural ihlalinde parola hiçbir yere gönderilmez; ön kontrol ve döküm `connection`/`bağlantı kuralları` ile durur. |
| Salt okunurluk | Başlangıç parametresi (`options`/`PGOPTIONS`) kullanılmaz; Supavisor onu iletmeyebilir, ortamdan devralınan `PGOPTIONS` da silinir. Ön kontrol ve S1 bağlantısında, bağlantı kurulur kurulmaz ve başka hiçbir sorgudan önce `SET default_transaction_read_only = on` çalıştırılır ve değer sorgulanarak `on` olduğu doğrulanır. Değer `on` değilse hiçbir şey okunmadan durur (`read_only` / `salt okunurluk`). S1 ayrıca `READ ONLY` işlemdir; `pg_dump` kendi işlemini salt okunur açar. |
| Tutarlılık | `REPEATABLE READ` S1 işlemi, ilk komut `pg_export_snapshot()`; aynı görüntüden sayımlar, Auth/Storage satırları, yönetim verisi ve `pg_dump --snapshot`. |
| Kapsam | `auth`, `storage`, `vault` şemalarındaki her tablo `ops/backup/scope.json`'da bir sınıfta olmalı; değilse **coverage** aşamasında durur. Kapsam dışı tablolar (Vault, SSO, WebAuthn, OAuth, `auth.instances`, Storage yardımcıları) ve `storage.objects` satır içerirse **guards** aşamasında durur. |
| Okuma | Auth/Storage/meta satırları dışa aktarma fonksiyonlarının gövdeleriyle birebir aynı sorgularla (`scope-export.cjs → DIRECT_SQL`, testle sabit) doğrudan okunur. Tek kullanımlık belirteçler boş yazılır; oturum, yenileme belirteci, tek kullanımlık belirteç ve giriş akışı tabloları okunmaz. |
| Yetki ve RLS | Kapsam, meta ve sayım tabloları ile tam şemalardaki tablo ve diziler okunabilir olmalı; RLS bağlanan rol için etkinse (**rls**) durur. Süper kullanıcı gerekmez. |
| Doğrulama (çevrim içi) | Yerel PostgreSQL'e geri yükleme (S1): sayılar, Auth/Storage içerik eşitliği, yabancı anahtar yetimleri, şema parmak izi, Auth sürümü, meta dosyaları. Ayrıca **zorunlu** `migration_history` (R1–R3: tam sürüm + ad eşleşmesi ya da PR'lı takma ad, `ops/backup/migration-aliases.json`) ve `cron_jobs` (yalnız uygulanmış migration'ların işleri) kontrolleri. Biri başarısızsa yedek doğrulanmış sayılmaz, şifrelenmez ve yazılmaz; çıkış kodu 1. Kaynak repodan geride olduğu için API sözleşmesi bu kopyada denetlenmez: istekte `claims.contract: "skipped"`. Bu sonuçlar **beyandır**; kanıt çevrim dışı L2'dir. |
| T8 ölçümü | Dökümden önce ve sonra salt okunur sayım + txid + migration hash'i ([reference-measurement.md](reference-measurement.md)). Kaynak ya da sıra kanıtı değil, tutarlılık. |
| Şifreleme | `age`, iki çevrim dışı alıcı (A, B); alıcı listesi hash'i sabitlenir. |
| Depo | Yerel klasör (`FileStore`), `manual/` öneki; dosyalar 0600, üzerine yazma yok. R2'ye yüklenmez. |
| İmza | `run` imzalamaz: imzasız manifest gövdesini ve imza isteğini yazar (kısa kodla). Manifest ve izin listeli kayıt çevrim dışı **K9** ile imzalanır ([offline-signing.md](offline-signing.md)); `finalize` zinciri main'deki yapılandırmayla doğrulayıp yayımlar. `dr-fetch` bu yedeği yalnız `--manifest` ile ve K9 zinciriyle (kayıt zorunlu) kabul eder; `--latest` ve K1 yolu elle alınmış yedeği seçmez. |

## Ön koşullar (her biri ayrı onay)

1. **Kod:** bu değişiklik incelenip `nakgo/altyapi`'ye alınmış; testler (yerel PG17 ve CI) yeşil.
2. **Anahtar töreni** ([key-ceremony.md](key-ceremony.md)): en az A, B, K9 ve güven çapası. `ops/backup/recipients.txt`,
   `config.json → recipients_sha256`, `trusted_k9`, `active_k9`, `trusted_anchors`, `active_anchor_sha256` PR ile repoda;
   çapa hash'i kâğıtta. İmza makinesi hazır ([offline-signing.md](offline-signing.md) → Hazırlık).
3. **Production'da salt okunur yetki doğrulaması** (yalnız evet/hayır döner, kişisel veri yok):
   - bağlanacak rolün (`postgres`) `rolbypassrls` değeri ve `row_security_active()` sonucu: `auth.users`,
     `auth.identities`, `cron.job`, `supabase_migrations.schema_migrations`;
   - `has_table_privilege` / `has_schema_privilege` / `has_sequence_privilege`: kapsam ve meta tabloları ile `public`,
     `private` tablo ve dizileri;
   - `auth`, `storage` ve `vault` şemalarındaki tablo adları (kapsam denetimi bunlarla karşılaştırır; bilinmeyen tablo
     varsa önce `scope.json` PR'ı).
4. **Makine:** tam disk şifreli, güncel; PostgreSQL 17 istemcisi (`pg_dump`, `pg_restore`) ve yerel PostgreSQL 17
   sunucusu (doğrulama için), `age` 1.1+, Node 24. node-pg yalnız sabit sürümle (8.23.1, `ops/backup/ci` lockfile'ı):
   `npm ci --prefix ops/backup/ci --ignore-scripts --no-audit --no-fund` ve `NODE_PATH=ops/backup/ci/node_modules`.
   Başka bir node-pg sürümüyle araçlar bağlanmadan durur.
5. **Bağlantı:** Supavisor oturum modu (5432), `sslmode=verify-full`, Supabase kök sertifikası. 6543 reddedilir.

## Adımlar

```sh
# Kimlik bilgileri yalnız ortamda; kabuk geçmişine yazılmaz (HISTCONTROL=ignorespace, satır başında boşluk).
 export PGHOST=<pooler adı> PGPORT=5432 PGUSER=<rol> PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT=<kök sertifika>
 read -s PGPASSWORD; export PGPASSWORD
export NAKGO_PG_HOST=localhost NAKGO_PG_PORT=<yerel port> NAKGO_PG_BIN=<PostgreSQL 17 bin>
export NODE_PATH="$PWD/ops/backup/ci/node_modules"   # npm ci --prefix ops/backup/ci --ignore-scripts ile kuruldu
node tools/backup/bootstrap.cjs run --out <boş klasör> --recipients ops/backup/recipients.txt \
  --recipients-sha256 <config.json'daki değer> --approval "<onay kaydı kimliği>"
unset PGPASSWORD
```

Çıktı yalnız aşama durumlarını, nesne anahtarlarını, sözleşme durumunu ve kısa kodu yazar. Başarı: `state:
"signature_pending"`, çıkış kodu **2** ve "İMZA BEKLİYOR: kısa kod …". Yedek henüz **tamamlanmamıştır**.

Klasörde: `manual/db/…tar.age` (şifreli paket), `manual/pending/<run>/request.json` (imza isteği: imzasız manifest gövdesi,
onay kimliği, çevrim içi beyanlar; yalnız kodlar ve sayılar) ve `manual/pending/<run>/reference.json` (T8 ölçümü).
Başarısızlıkta yalnız `manual/pending/<run>/failed.json` (sabit kodlar; ham hata metni terminalde kalır).
Özel anahtar bu makinede kullanılmaz (`--sign-key` reddedilir).

Sonra: kısa kod kâğıda; istek, ölçüm ve paket USB ile imza makinesine → `offline-sign` → yanıt USB ile geri →
`node tools/backup/bootstrap.cjs finalize --out <klasör> --response <USB>/response-<run>.json` (çıkış 0 = tamamlandı).

## Sonra

1. **Saklama:** `finalize` 0 ile bittikten sonra klasör iki ayrı çevrim dışı ortama kopyalanır (şifreli). SHA-256'lar
   ve kayıttaki `offline` özeti (seviye, A/B, rol, `reference`) `ops/backup/drills.md`'ye yazılır.
2. **Notlar:** `migration_history` (bekleyen migration'lar), `cron_jobs`, `contract` (provada), `external_triggers`
   (hedefte kurtarma SQL'i, yalnız referans derlemesinden: `restore-meta.cjs --pg-install`). `migration_history` ya da
   `cron_jobs` tutarsızsa yedek zaten tamamlanmaz (çıkış 1); neden terminalde ve `failed.json` kodlarında görülür.
3. **Sözleşme kapısı:** kayıtta `offline.contract.status: "exception"` (`no_contract_at_applied_ref`; ilk yedekte her
   zaman) ise 4. adımdaki prova başarılı olmadan Production'a migration uygulanmaz.
4. **Kurtarma provası** (çevrim dışı makinede, kişisel veri içerir): `dr-fetch.cjs --dir <klasör> --manifest manual/manifests/… --require-request`
   → `age -d` → `migration-rehearsal.cjs --bundle … --report … --pg-install …` ([migration-rehearsal.md](migration-rehearsal.md)).
5. Ancak prova başarılıysa, ayrı onayla bekleyen 19 migration Production'a uygulanır. Ardından `nakgo_backup` rolü
   kurulur ve B7'nin normal yoluna geçilir ([../b7b-acceptance.md](../b7b-acceptance.md)).

## DURDURMA koşulları

- `coverage`, `guards`, `rls`, `permissions`, `read_only` aşamalarından biri: kapsam ya da yetki incelenmeden tekrar
  denenmez; muafiyet yoktur.
- Ön kontrol `bağlantı kuralları` ya da `salt okunurluk` ile durdu: ortam değişkenleri (`PGSSLMODE=verify-full`,
  `PGSSLROOTCERT`, `PGHOST`, `PGPORT=5432`) düzeltilmeden tekrar denenmez. Kurala aykırı bağlantı denenmez.
- `restore_test` başarısız: yedek doğrulanmamıştır, kullanılmaz.
- `migration_history` ya da `cron_jobs` kontrolü başarısız (kodda zorunlu: yedek doğrulanmaz, çıkış 1): geçmişte
  `unknown` ya da `gaps`, repoda olmayan/farklı iş, uygulanmış migration'ın işi eksik ya da yönetim verisi yok/okunamadı.
- İstekte `claims.contract` `failed` ya da `not_run` (imzalanamaz), ya da `offline-sign`/`finalize` bir red kodu verdi
  ([offline-signing.md](offline-signing.md) → DURDURMA).
- Bağlantı ya da sertifika doğrulanamıyor.

## B7'ye geçmeden önce ayrı iş

Bootstrap kipi `auth.instances`'ı, Storage yardımcı tablolarını (`scope.json → guard_stop_if_rows_pending`), zamanlanmış
işleri ve migration geçmişini doğrudan okur. B7'nin yedek rolü bunları okuyamaz: sayım fonksiyonu bu tabloları saymaz
ve yönetim verisi için dışa aktarma fonksiyonu yoktur. B7 kipi bu yüzden Production'da güvenli tarafta durur
(`guards: sayılamadı` / `meta`). B7'ye geçmeden önce: sayım fonksiyonunu genişleten ve `cron.job` ile migration geçmişi
için dışa aktarma fonksiyonları ekleyen bir migration, `export-functions.json` ve rol betiğinin yeniden üretilmesi ve
korumalı `tests/backup/a1-privilege.test.cjs`'in (fonksiyon sayısı) incelemeli bakımı. Ayrı onay ister.

## Bilinen sınırlar

- Storage dosyalarının **içeriği** yedeklenmez; bugün `storage.objects` 0 satır ve dolarsa yedek durur.
- Oturumlar, yenileme belirteçleri, tek kullanımlık belirteçler ve Auth denetim günlüğü bilerek alınmaz (herkes yeniden
  giriş yapar).
- Supabase'in gerçek rol ve RLS ayarları yerelde taklit edildi (`tests/backup/b8-bootstrap.test.cjs`); Production'da
  ön koşul 3'teki sorgularla doğrulanmadan çalıştırılmaz ([../real-infra-gaps.md](../real-infra-gaps.md) G16–G20).

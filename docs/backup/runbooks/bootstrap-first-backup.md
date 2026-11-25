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
| Kapsam | `auth`, `storage`, `vault` şemalarındaki her tablo `ops/backup/scope.json`'da bir sınıfta olmalı ve tablo kümesi `coverage_inventory` ile birebir aynı olmalı (eksik ya da fazla tablo); değilse **coverage** aşamasında, veri okunmadan durur. Kapsam dışı tablolar (Vault, SSO, WebAuthn, OAuth, `auth.instances`, Storage yardımcıları) ve `storage.objects` satır içerirse **guards** aşamasında durur. |
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
3. **Bootstrap rolü** ([aşağıda](#bootstrap-rolü)): önerilen tasarım `nakgo_bootstrap_reader`. **Henüz Production'da
   kullanılması onaylanmadı ve denenmedi**; oluşturma, parola ve Production'daki ilk denemeler ayrı yazılı onay ister.
   Onaylanır ve aşağıdaki doğrulanmamış noktalar kapatılırsa döküm bu rolle alınır, `postgres` ile alınmaz.
   **Production'da salt okunur yetki doğrulaması** (yalnız evet/hayır döner, kişisel veri yok):
   - bağlanacak rolün (`nakgo_bootstrap_reader`) `rolbypassrls` değeri ve `row_security_active()` sonucu: `auth.users`,
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

## Bootstrap rolü

> **Durum: tasarım ve yerel test aşamasında.** Rol Production'da oluşturulmadı; Supabase üzerinde hiçbir adımı
> denenmedi. Aşağıdaki "Production'da doğrulanmamış" maddeleri kapatılmadan ve ayrı yazılı onay alınmadan kullanılmaz.

Önerilen tasarımda ilk yedek, yalnız bu iş için açılan ve iş bitince kaldırılan `nakgo_bootstrap_reader` rolüyle
alınır. Betikler: `ops/backup/bootstrap-role.sql` (oluşturma) ve `ops/backup/bootstrap-role-drop.sql` (kaldırma).
Testler: `tests/backup/b9-bootstrap-role.test.cjs` (gerçek PostgreSQL 17, Production biçiminde kaynak, Supabase
`postgres`'ini taklit eden süper kullanıcı olmayan rolle; bu rolle alınan döküm geri yüklenip 7 kontrolden geçirilir).

**Neden `nakgo_backup` değil?** O rol Auth/Storage'ı yalnız `private.nakgo_backup_*` dışa aktarma fonksiyonlarıyla
okur. Fonksiyonlar bekleyen migration'larda; ilk yedek de tam bu migration'lardan önce alınmalı. `nakgo_backup`'ı
şimdi kurmak bekleyen migration'ın bir kısmını yedeksiz uygulamak olur. Bootstrap aracı da fonksiyonlar varsa çalışmaz.

**Neden `postgres` ya da `supabase_read_only_user` değil?** `postgres` 20 tam şema tablosunun hepsine yazabilir;
salt okunurluk yalnız araca kalır. `supabase_read_only_user` Supabase'in yönettiği roldür (salt okunur bağlayıcı da
onu kullanır); parolası verilmez, parola atamak desteklenmeyebilir ya da bağlayıcıyı etkileyebilir.

| Konu | Tasarım | Gerekçe |
|---|---|---|
| Öznitelikler | `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 3 VALID UNTIL <en fazla 14 gün>` | Kısa ömürlü; S1 + `pg_dump` + bir yedek oturum. |
| Üyelik | Yalnız `pg_read_all_data`, `INHERIT TRUE, SET FALSE, ADMIN FALSE` | Auth/Storage'ın yeni tablolarında (oauth, scim, webauthn, Storage yaşam döngüsü/analitik/vektör) `postgres`'in yetki devretme hakkı yok (24.11.2026 ölçümü); "satır var mı" korumaları doğrudan GRANT ile sayılamaz. |
| Role üye olanlar | Yalnız oluşturucu (`postgres`), yalnız ADMIN (INHERIT ve SET yok) | PostgreSQL 16+ süper kullanıcı olmayan oluşturucuya bu üyeliği kendiliğinden verir; oluşturucu rolün yetkilerini almaz, `SET ROLE` yapamaz, yalnız rolü yönetir. Betik başka bir üye ya da seçenek görürse (ör. `createrole_self_grant`) her şeyi geri alır. Production'da `createrole_self_grant` boş (25.11.2026 ölçümü). |
| Tablo, dizi, şema | `pg_read_all_data` üzerinden: tüm tablo, görünüm ve dizilerde SELECT, tüm şemalarda USAGE. Doğrudan GRANT yok. | Tek kaynak; rol hiçbir nesnenin sahibi değil, hiçbir nesnede doğrudan yetkisi yok. |
| Fonksiyon | Ek EXECUTE yok (yalnız PUBLIC'e açık olanlar). Production'da PUBLIC'e açık tek SECURITY DEFINER fonksiyon `public.rls_auto_enable` (olay tetikleyicisi; doğrudan çağrılamaz). | Yazma yan yolu açılmaz. |
| Yazma | Hiçbir tabloda INSERT/UPDATE/DELETE/TRUNCATE, şemada CREATE, dizide `nextval`, rol oluşturma, `SET ROLE` yok. | Salt okunurluk **yetkiye** dayanır; test, `default_transaction_read_only` kapatılmışken bile 60+ tabloda yazmanın reddedildiğini gösterir. |
| RLS | `BYPASSRLS` | Tam şemalardaki 20 tablonun tamamında, `auth.users`, `cron.job` ve diğer kapsam tablolarında RLS açık. Olmadan `cron.job` yalnız rolün kendi işlerini gösterir (sessiz eksik) ve `pg_dump` (`row_security=off`) hata verir. Rol düzeyindedir, tablo bazında daraltılamaz; etkisi rolün okuyabildiği tablolarla sınırlıdır. |
| Ek katman | `default_transaction_read_only=on`, `statement_timeout=15min`, `lock_timeout=30s`, `idle_in_transaction_session_timeout=20min` | Güvenlik sınırı değil (oturum kapatabilir); araç ayrıca oturumu ve işlemi salt okunur açar. |
| Bilinen yan yollar | Varsayılan salt okunurluk oturumda kapatılırsa: oturuma özel geçici tablo (PUBLIC `TEMP`) ve büyük nesne oluşturma. | Kalıcı veriye dokunmaz; oturum kapanınca geçici tablo silinir. Araç bu ayarı kapatmaz. |

`pg_dump` gereksinimleri: tam şemalardaki tüm tablo ve dizilerde SELECT (`LOCK TABLE … ACCESS SHARE` de SELECT ister),
şema USAGE, katalog okuma, `SET TRANSACTION SNAPSHOT` (her rol), RLS'li tablolar için BYPASSRLS. Büyük nesne yok
(Production'da 0).

### Riskler (kabul edilmeden önce okunmalı)

- **Geniş okuma yetkisi.** `pg_read_all_data` + `BYPASSRLS`, rolün bağlanabildiği veritabanlarındaki (Production'da
  PUBLIC bağlantısı olan `postgres` ve `template1`) **bütün** tabloların **bütün** satırlarını RLS'siz okuyabilmesi
  demektir; yalnız yedek kapsamı değil: `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors` (gizli anahtar
  sütunu dahil), `storage.objects` meta verisi, `vault.secrets` (şifreli hâli), `realtime` ve `net` şemaları. Denetim
  sorgu anında yapıldığı için **sonradan açılan tablolar da** kendiliğinden okunur. Yetki düzeyi
  `supabase_read_only_user` ile aynıdır. Şifresi çözülmüş Vault sırları okunamaz: `vault._crypto_aead_det_decrypt`
  PUBLIC'e kapalı (25.11.2026 yetki kataloğu; gerçek okuma denemesiyle sınanmadı). Sınırlayanlar: en fazla 14 gün,
  en fazla 3 bağlantı, parola yalnız sahipte, iş bitince kaldırma.
- **Süre dolunca açık oturumlar kapanmaz.** `VALID UNTIL` yalnız parolalı girişte denetlenir: süre dolunca yeni giriş
  reddedilir, açık oturum çalışmaya devam eder (yerel PostgreSQL 17'de ölçüldü). Rolü silmez. Oturumları kapatan ve
  rolü silen tek adım kaldırma betiğidir; mutlaka çalıştırılmalıdır.
- **Supavisor ve süre.** Supavisor istemciyi `pgbouncer.get_auth` ile kendisi doğrular; süre dolduğunda nasıl
  davrandığı doğrulanmadı.
- **Rol kendi varsayılanlarını değiştirebilir.** `default_transaction_read_only` ve zaman aşımları güvenlik sınırı
  değildir; rol oturumda ya da kendi rol ayarında kapatabilir. Yazma yetkisinin olmaması bundan etkilenmez.
- **`postgres` rolü yönetebilir.** Oluşturucu ADMIN üyeliğiyle süreyi uzatabilir, parolayı değiştirebilir ya da rolü
  başka role verebilir; kaldırma bunu da sonlandırır.

### Oluşturma ve parola (yalnız sahip, ayrı yazılı onayla)

1. Sahip, kendi makinesinden `postgres` ile bağlanır (Supavisor oturum modu, `verify-full`) ve çalıştırır:
   `psql --single-transaction -v ON_ERROR_STOP=1 -v valid_until='<en fazla 14 gün sonrası>' -f ops/backup/bootstrap-role.sql`.
   Betik rol varsa, B7 fonksiyonları varsa, tarih geçersizse, sonuç öznitelikleri ya da üyelikleri (rolün üye olduğu
   ve role üye olan roller) beklenenden farklıysa her şeyi geri alır. Betik `postgres` gibi süper kullanıcı olmayan
   bir rolle çalıştırılmalıdır; süper kullanıcıyla oluşturucu üyeliği oluşmaz ve betik durur.
2. Rol parolasız oluşur ve giriş yapamaz. Parola sahibin makinesinde, parola yöneticisiyle (en az 32 rastgele karakter)
   üretilir ve aynı oturumda `\password nakgo_bootstrap_reader` ile verilir: psql parolayı istemci tarafında SCRAM
   özetine çevirir; düz parola sunucuya, betiğe, Git'e, CI'a, sohbete ya da kabuk geçmişine gitmez. Parola yalnız
   parola yöneticisinde tutulur ve yedek sırasında `read -s PGPASSWORD` ile girilir.
3. Döküm bu rolle alınır: `PGUSER=nakgo_bootstrap_reader.<proje-ref>` (Supavisor biçimi).

### Kaldırma

İlk yedek `finalize` ile tamamlanınca (ya da iş iptal edilince) sahip çalıştırır:
`psql -X -v ON_ERROR_STOP=1 -f ops/backup/bootstrap-role-drop.sql` (**`--single-transaction` olmadan**). İki adım:

1. `NOLOGIN` kendi işleminde hemen commit edilir. Commit edilmeyen bir değişikliği diğer bağlantılar görmez; bu ayrım,
   oturumlar sonlandırılırken araya yeni giriş girmesini önler.
2. Tek işlemde: betik tek işlem içinde çalışıyorsa (`--single-transaction`) durur ve hiçbir şeyi değiştirmez; rol hâlâ
   LOGIN ise durur; sahiplik, yetki ya da politika bağı varsa durur (oturumlara dokunmadan); üyelikler beklenen iki
   satırdan farklıysa durur (rol → `pg_read_all_data` yalnız INHERIT; betiği çalıştıran oluşturucu → rol yalnız ADMIN;
   oturumlara ve üyeliklere dokunmadan, üyelik silinmez ya da değiştirilmez); yalnız oturum kullanıcısı bu rol olan
   bağlantıları sonlandırır (`pg_signal_backend`); üyeliği geri alır ve rolü siler. Betik, rolü oluşturan rolle
   (`postgres`) çalıştırılmalıdır; başka bir rolle çalıştırılırsa oluşturucu üyeliği beklenenle eşleşmez ve durur.

Başarısızlıkta: 2. adım durursa rol NOLOGIN kalır (yeni giriş yapılamaz) ve açık oturumlar sonlandırılmamış olur;
sorun giderilip betik yeniden çalıştırılır. Rol yoksa iki adım da hiçbir şey yapmaz. Bu davranışların hepsi testte
sınanır (tek işlem, bağ varken, beklenmeyen üyelik varken (iki yönde), `pg_signal_backend` yokken, başarılı
kaldırma, tekrar çalıştırma).

Etkiler: başka rollerin bağlantıları, uygulama, Supabase servisleri ve salt okunur bağlayıcı etkilenmez (rol hiçbir
nesnenin sahibi değil; ona yalnız oluşturucu ADMIN olarak üye). Test, başka bir rolün açık oturumunun kaldırmadan
sonra çalışmaya devam ettiğini gösterir. Supavisor'da bu rolle açık havuz bağlantısı varsa kapanır. Kaldırma
unutulursa `VALID UNTIL` tarihinden sonra parolayla giriş yapılamaz, ancak açık oturumlar sürer; rol mutlaka
kaldırılmalıdır.

### Production'da doğrulanmamış (G6/G19; her biri kontrollü test ve ayrı onay ister)

- Supabase'in `supautils` kısıtları altında `postgres`'in bu rolü `BYPASSRLS` ile oluşturabilmesi.
- `postgres`'in `pg_read_all_data` üyeliğini `WITH INHERIT TRUE, SET FALSE` seçenekleriyle verebilmesi (katalogda
  ADMIN yetkisi görünüyor; komut çalıştırılmadı).
- `ALTER ROLE … SET` ayarlarının ve bağlantı sınırının kabul edilmesi; oluşturucu üyeliğinin beklenen biçimde
  (yalnız ADMIN) oluşması.
- Kaldırma için `postgres`'in `pg_signal_backend` yetkisinin gerçekten etkin olması (üyelik görünüyor, miras ayarı
  ölçülmedi). Etkin değilse kaldırma güvenli biçimde durur.
- Rolün Supavisor'dan `<rol>.<proje-ref>` ile giriş yapabilmesi ve süre dolduğunda Supavisor'un davranışı.
- Bu rolle Production'da döküm alınabilmesi (yerelde alındı, geri yüklendi ve doğrulandı).

## Adımlar

```sh
# Kimlik bilgileri yalnız ortamda; kabuk geçmişine yazılmaz (HISTCONTROL=ignorespace, satır başında boşluk).
 export PGHOST=<pooler adı> PGPORT=5432 PGUSER=<rol> PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT=<kök sertifika>
 read -s PGPASSWORD; export PGPASSWORD
export NAKGO_PG_HOST=localhost NAKGO_PG_PORT=<yerel port> NAKGO_PG_BIN=<PostgreSQL 17 bin>
export NODE_PATH="$PWD/ops/backup/ci/node_modules"   # npm ci --prefix ops/backup/ci --ignore-scripts ile kuruldu
# G19 (ayrı onay): döküm almadan önce aynı ortamla bağlantı denetimi. Tablo okumaz, yazmaz; yalnız evet/hayır raporlar.
node tools/backup/g19-check.cjs        # çıkış 0 değilse durulur; run çalıştırılmaz
node tools/backup/bootstrap.cjs run --out <boş klasör> --recipients ops/backup/recipients.txt \
  --recipients-sha256 <config.json'daki değer> --approval "<onay kaydı kimliği>"
unset PGPASSWORD
```

**G19 denetimi** (`tools/backup/g19-check.cjs`, test: `tests/backup/b9-g19-check.test.cjs`). `PGUSER`
`nakgo_bootstrap_reader.<proje-ref>` olmalı; `NAKGO_PG_PASSWORD` yerel geri yükleme sunucusunun parolasıdır.
Kontroller ve başarısızlıkta yapılacak:

| Kod | Kanıtladığı | Düşerse |
|---|---|---|
| `rules` | 5432, `verify-full`, kök sertifika dosyası, `*.pooler.supabase.com`, kullanıcı bootstrap rolü | Ortamı düzelt; bağlantı kurulmadı. |
| `tls_wrong_ca` | Başka bir kökle (`ops/backup/g19-wrong-ca.pem`, yalnız açık sertifika) bağlantı TLS'de reddedilir | Dur: doğrulama etkisiz. `sslmode` asla gevşetilmez. |
| `tls_hostname` | Sunucu adı yerine IP ile bağlantı sertifika adı uyuşmazlığıyla reddedilir | Dur: sunucu adı doğrulanmıyor. |
| `connect` | Doğru kök sertifikayla node-pg bağlanır | Kök sertifika yanlış ya da zincir farklı: dur, sertifikayı panelden yeniden indir; kod değişikliği gerekebilir. |
| `role` | Rol beklenen; süper kullanıcı değil; yalnız `pg_read_all_data`; BYPASSRLS; yazma ve şemada CREATE yok; rol düzeyinde salt okunur; süre ≤ 14 gün | Dur: rolü kaldırıp betikle yeniden oluştur. |
| `read_only` | Aracın oturumu salt okunur yapabilmesi | Dur. |
| `session_mode` | Ayrı işlemler arasında aynı sunucu süreci ve oturum ayarı (işlem modu değil) | Dur: 5432 oturum modu değil; döküm bu yolla alınmaz. |
| `snapshot` | Dışa aktarılan anlık görüntü ikinci bağlantıda içe alınır | Dur: iki bağlantı aynı oturum havuzuna gitmiyor. |
| `tools` | `pg_dump`/`pg_restore` sürümü sunucudan eski değil | PostgreSQL 17 istemcisini kur. |
| `pg_dump` | libpq `verify-full` ile, aynı anlık görüntüden yalnız şema dökümü alınır ve `pg_restore -l` okur (veri yok; dosya silinir) | Dur: hata kaydını incele. |
| `local_pg` | Yerel geri yükleme sunucusu ayakta, sürümü sunucudan eski değil | Yerel PostgreSQL 17'yi başlat. |

Yerelde kanıtlanan: gerçek TLS'li (yalnız `hostssl` + scram) geçici PostgreSQL 17 kümesinde bütün kontroller geçer;
yanlış kök, IP ile bağlantı, `verify-full` olmayan ayar, yanlış kullanıcı ve fazla yetkili rol yakalanır; sertifika IP
adresini de kapsarsa `tls_hostname` düşer. Supavisor taklit edilmez: `session_mode` ve `snapshot` yerelde doğrudan
bağlantıda geçer; havuzlayıcıdaki davranış ilk gerçek çalıştırmada ölçülür.

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

## Kapsam envanteri

Bootstrap, `auth`, `storage` ve `vault` şemalarındaki gerçek tablo kümesini `ops/backup/scope.json → coverage_inventory`
ile birebir karşılaştırır. Liste Production'da gözlenen kümedir; 24.11.2026 ölçümü 38 tablodur (auth 27, storage 10,
vault 1; `public`/`private` bu denetimde değil, tam şema olarak dökülür).

**Neden bilinmeyen tabloda durur:** Supabase platformu Auth/Storage'a sessizce tablo ekler (ör. Kasım 2026'da Storage'ın
kova yaşam döngüsü tabloları; tarih dış raporlardan, Production'da doğrulanmadı). Sınıflandırılmamış bir tablo ya veri kaybı (yedeklenmesi gereken veri) ya da yedeklenmemesi
gereken iç durumdur; hangisi olduğu incelenmeden karar verilemez. Bu yüzden araç tahmin etmez, durur. Eksik tablo da durur:
beklenen bir tablonun kaybolması sürüm değişikliği ya da yanlış hedef demektir.

**Envanter nasıl güncellenir (incelemeli PR, ayrı onay):**
1. Production'da salt okunur katalog sorgusu (yalnız tablo adı ve `relrowsecurity`; satır ve sütun içeriği alınmaz):
   `select n.nspname||'.'||c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and n.nspname in ('auth','storage','vault') order by 1`.
2. Yeni tablonun Supabase kaynağındaki tanımı ve kullanımı incelenir; bir sınıfa (`tables`, `excluded.*`,
   `guard_exact_zero`, `meta`) gerekçesiyle konur. Gerekçe doğrulanamazsa sınıflandırılmaz, yedek durmaya devam eder.
3. Aynı PR'da `scope.json → coverage_inventory.tables` (ve `observed_at`) ile `tests/backup/prod-fixture.cjs →
   PROD_AUX_TABLES` birlikte güncellenir; `tests/backup/b9-coverage-inventory.test.cjs` ikisinin eşitliğini denetler.
4. `scope.json` araç paketi özetine girer: değişiklik güven çapasının yeniden üretilmesini gerektirir.

**Kova yaşam döngüsü tabloları (özel durum):** `storage.bucket_lifecycle_states` (kova başına yaşam döngüsü çalıştırma durumu: zamanlama, işçi kilidi, imleç; kovaya bir yaşam döngüsü kuralı yazılınca `storage.reconcile_lifecycle_state` oluşturur, kural kalkıp işçi boştayken siler, kova silinince `on delete cascade` ile gider) ve `storage.lifecycle_abandoned_artifacts` (süresi dolan nesnelerin meta verisi silindikten sonra fiziksel dosyası silinmeyi bekleyen anahtarlar; işçi dosyayı silince satırı siler). Kaynak: supabase/storage `migrations/tenant/0076-noncurrent-lifecycle.sql`, `0079-lifecycle-writer-coordination.sql`, `0080-revoke-extra-lifecycle-postgres-grants.sql`, `src/storage/database/pg.ts` (`SaveLifecycleMetadataDeletions`, `resolveLifecycleAbandonedArtifacts`). İkisi de Storage servisinin türetilmiş iç durumudur; NakGo yaşam döngüsü kuralı kullanmaz ve dosya yedeklenmez, bu yüzden yedeklenmez. Satır görünürse kural açılmış ya da dosya silme bekliyor demektir: yedek `guards` aşamasında durur.
Test taklidinde iki tablo Supabase kaynağındaki sütunlarla kurulur; gerçek PostgreSQL 17 testleri (`b8-bootstrap`) her
birinde ayrı ayrı ve birlikte satır varken yedeğin `guards` aşamasında, tablo yokken `coverage` aşamasında durduğunu sınar.

## DURDURMA koşulları

- `coverage`, `guards`, `rls`, `permissions`, `read_only` aşamalarından biri: kapsam ya da yetki incelenmeden tekrar
  denenmez; muafiyet yoktur. `coverage` nedeni `envanterde olmayan tablo` ya da `envanterdeki tablo veritabanında yok`
  ise yukarıdaki "Kapsam envanteri" adımları izlenir; liste elle "geçsin diye" düzenlenmez.
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

**Geçiş engeli (açık):** K6b/B7 kipi kapsam envanteri denetimini (`coverage_inventory`) uygulamaz; yalnız
sınıflandırma denetimini yapar. Ayrıca B7'nin sayım fonksiyonu kova yaşam döngüsü tablolarını saymaz; Production'da
var oldukları için K6b `guards: sayılamadı` ile durur. Envanter denetimi K6b yoluna eklenip test edilmeden ve sayım
fonksiyonu genişletilmeden K6b/B7 etkinleştirilmez (zamanlanmış yedek ve [k6b-manual-dump.md](k6b-manual-dump.md) dahil).

## Bilinen sınırlar

- Storage dosyalarının **içeriği** yedeklenmez; bugün `storage.objects` 0 satır ve dolarsa yedek durur.
- Oturumlar, yenileme belirteçleri, tek kullanımlık belirteçler ve Auth denetim günlüğü bilerek alınmaz (herkes yeniden
  giriş yapar).
- Supabase'in gerçek rol ve RLS ayarları yerelde taklit edildi (`tests/backup/b8-bootstrap.test.cjs`); Production'da
  ön koşul 3'teki sorgularla doğrulanmadan çalıştırılmaz ([../real-infra-gaps.md](../real-infra-gaps.md) G16–G20).

# Yedek rolü yetki denetimi (B7-A1)

Araç: `tools/backup/privilege-audit.cjs`. Yalnız katalog okur, hiçbir şey yazmaz. Her yedek çalışmasından önce yedek rolüyle çalışır (A4) ve CI'da migration şemasına karşı çalışır (`npm run test:backup`).

## Ne denetlenir

| Alan | Beklenen | Sapma sınıfı |
|---|---|---|
| Rol özellikleri | LOGIN, BYPASSRLS, süper kullanıcı değil, CREATEROLE/CREATEDB/REPLICATION yok, bağlantı sınırı 1–2 | Muaf tutulamaz |
| Rol üyelikleri (dolaylı dahil) | **Hiçbiri** (`pg_read_all_data` dahil) | Muaf tutulamaz |
| Tam şemalar dışında okuma | `public`/`private` dışında, şema USAGE + SELECT ile gerçekten okunabilen tablo yok (ör. `auth.sessions`) | Muaf tutulamaz (`read_outside_scope`) |
| Dışa aktarma fonksiyonları | `ops/backup/export-functions.json` sabitiyle aynı gövde/ayar/dil/oynaklık/sonuç; sahibi şemanın sahibi; EXECUTE yalnız yedek rolünde (PUBLIC, API rolleri, üyelik yolu yok) | Muaf tutulamaz (`export_function_changed`); uyarsa bilgi |
| Ağ fonksiyonları | `net.*` (pg_net), `http*`, `dblink*` çağrılamaz | Muaf tutulamaz (`network_function`) |
| PUBLIC `pg_catalog` yazma yolları | `lo_create`, `lo_from_bytea`, `lowrite`, `pg_logical_emit_message`, TEMP | Bilgi (`accepted_residual`); süper kullanıcı olmadan kapatılamaz, bkz. [side-channels.md](side-channels.md) |
| Veritabanında CREATE | Yok | Muaf tutulamaz |
| Şemada CREATE | Hiçbir şemada | Muaf tutulamaz |
| Tablo/kolon yetkileri | Yalnız SELECT | INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER muaf tutulamaz |
| Dizi yetkileri | Yalnız SELECT | USAGE/UPDATE muaf tutulamaz |
| Çağrılabilir SECURITY DEFINER | İzin listesinde ve parmak izi aynı | Muaf tutulabilir (K6), varsayılan olarak döküm başlamaz |

"Çağrılabilir": rolün şemada USAGE ve fonksiyonda EXECUTE yetkisi var (PUBLIC, doğrudan ya da üyelik yoluyla), fonksiyon tetikleyici değil. Rolün USAGE yetkisi olan bütün şemalar taranır: `public`, `private` ve PUBLIC'e USAGE verilmiş her şema. Dar rolün `auth`, `storage`, `vault`, `extensions` vb. şemalarda USAGE'ı yoktur; oradaki fonksiyonlar çağrılamaz (testle gösterildi). Supabase'te PUBLIC'e USAGE verilmiş şema varsa oradaki PUBLIC SECURITY DEFINER fonksiyonlar denetime girer (V6).

## Fonksiyon parmak izi

Her çağrılabilir SECURITY DEFINER fonksiyon için:
- kimlik ve imza, dönüş tipi, dil, tür;
- gövde hash'i (yorum ve boşluklar ayıklanmış);
- sahip ve sahibin süper kullanıcı/BYPASSRLS durumu;
- ham EXECUTE ACL ve yetkinin yolu (PUBLIC / doğrudan / üyelik);
- şema USAGE;
- tüm fonksiyon ayarları, `search_path` kuralının sonucu;
- oynaklık, LEAKPROOF, paralellik;
- risk işaretleri: dinamik SQL, ağ (`net.*`, http), dblink, `pg_notify`, güvenlikle ilgili ayar değişikliği, danışma kilidi, `pg_sleep`, COPY, büyük nesne, veri yazma, DDL;
- gövdede şema-nitelikli olarak geçen tabloların sahibi, ACL'si, RLS ve zorunlu RLS durumu, politikalarının hash'i;
- çağırdığı fonksiyonların parmak izleri (en fazla 3 seviye, aşılırsa işaretlenir).

Bunlardan biri değişirse, gövde aynı kalsa bile parmak izi değişir. Testler gövde, bağımlı tablo ACL'si, RLS, politika, sahip, EXECUTE yolu ve ayar değişikliklerinin her birinin fark ürettiğini doğrular.

## `search_path` kuralı

PostgreSQL, geçici şema (`pg_temp`) `search_path` içinde açıkça yazılmadığında onu tablo ve tip adlarında **ilk sırada** arar (fonksiyon ve operatör adlarında hiç aramaz). Yedek rolü veritabanında TEMP yetkisini PUBLIC üzerinden alır ve bu yetki yalnız bir rol için geri alınamaz. Bu yüzden `search_path=''` tek başına koruma sağlamaz.

İzin listesine alınabilmek için: `search_path` sabit ve `pg_temp` açıkça en sonda; ya da kayıtta, gövdenin şema belirtilmemiş hiçbir tablo ve tip adı kullanmadığını açıklayan `search_path_exception` gerekçesi.

Doğrulanmamış (V): geçici şemada oluşturulan bir tipin yerleşik bir tip adını gerçekten gölgeleyip gölgeleyemeyeceği. Kural bu yüzden en kötü durumu varsayar.

## İzin listesi

`ops/backup/definer-allowlist.json`. Kayıt alanları: `id`, `fingerprint_sha256`, `reviewed_by`, `reviewed_at`, `reason`, `data_scope` (döndürdüğü veri), gerekirse `search_path_exception` ve `risk_exception`. Araç hiçbir zaman kendiliğinden kayıt eklemez. Kayıt yalnız incelemeli bir PR ile eklenir. C/internal gövdeli ve çağrı grafiği derinlik sınırını aşan fonksiyonlar listeye alınamaz.

Bilinen sınır: PL/pgSQL ve metin gövdeli SQL fonksiyonlarının bağımlılıklarını PostgreSQL izlemez. Tablolar gövdedeki şema-nitelikli adlardan statik olarak çıkarılır. Şemasız adlar ve dinamik SQL bu yolla bulunamaz. Bu yüzden dinamik SQL içeren fonksiyonlar gerekçesiz listeye giremez.

## Değişmezler (`--invariants`)

Migration'lardan kurulan şemada:
1. `public` ve `private`'ta PUBLIC'e açık, tetikleyici olmayan SECURITY DEFINER fonksiyon yok.
2. `service_role`'e verilen açık yetkiler `supabase/contract/service-role.json` ile birebir aynı (bugün yalnız Storage temizleme kuyruğu için iki EXECUTE).

## K6 muafiyeti (`tools/backup/waiver.cjs`)

- **Varsayılan kapalı.** Yalnız `enabled=true` ve belge ile çalışma ortamı aynıysa değerlendirilir; production iş akışı kapalı çalışır.
- Proje sahibinin çevrim dışı K2 anahtarıyla imzaladığı belge; alan adı `nakgo-backup-waiver/v1`.
- Belge, o anki farkın hash'ine ve kapsadığı fonksiyonların tam listesine bağlıdır; en fazla 48 saat geçerlidir; rastgele `waiver_id` ve `event_id` taşır.
- Muaf tutulamayan bir bulgu varken hiçbir belge geçmez.
- Tek kullanımlılık ve "aynı fark için en fazla 7 gün" kuralı imzalı kontrol noktası zincirinde sağlanır (A3).
- K6 elle döküm ya da `postgres` ile kontrol atlama yolu değildir. TLS, alıcı anahtarı, imza/zincir ve geri yükleme testi hataları muafiyete hiç bakmaz.

## Yedek rolü betiği

`ops/backup/backup-role.sql`, `tools/backup/backup-role.cjs` tarafından `ops/backup/scope.json`'dan üretilir; test, dosyanın üreticiyle birebir aynı olduğunu doğrular. Testler betiği yerel veritabanında uygular ve rolün beklenen profilde olduğunu, `auth.sessions`, `auth.refresh_tokens` ve `auth.users`'ı doğrudan okuyamadığını (42501), Auth satırlarını yalnız dışa aktarma fonksiyonuyla aldığını doğrular. `verifyRole` olumsuz denetim de yapar: kapsam dışı Auth tabloları ve `auth`/`storage`/`vault` şemaları erişilebilir olmamalı. Production'da uygulanması B7-D'de, ayrı onayla yapılır.

`default_transaction_read_only=on` bir güvenlik sınırı değildir; oturum onu kapatabilir. Sınırlar yukarıdaki yetki kontrolleridir.

## Test edilemeyenler

- PGlite: veritabanı düzeyinde CREATE testi atlanır. Geri alınmış bir işlemden sonra `pg_database` güncellemesi PGlite'ta hata veriyor; test PG16 ve PG17'de çalışır.
- Supabase'in kendi `auth` ve `storage` fonksiyonları yerelde yok. Gerçek kapsam B7-B'deki T2 geçidinde denetlenir.

## Yedek rolü yöntemi (B7-A5): dar rol + dışa aktarma fonksiyonları

B7-A'da (A1) Supabase bilgi bankasındaki yöntem (BYPASSRLS + `pg_read_all_data`, 4 Kasım 2026) uygulanmıştı. Bu yöntem
oturum ve yenileme belirteci tabloları dahil **her şemayı** okutur ve tek tek daraltılamaz. B7-A5'te yerine aşağıdaki
yöntem geçti; aynı kaynak sayfanın ikinci önerisine (postgres'in sahibi olduğu, yalnız özel role açık SECURITY DEFINER
fonksiyon) dayanır.

### Alternatiflerin karşılaştırması
| Yöntem | Oturum/belirteç tablolarını okur mu | Supabase'te uygulanabilir mi | Karar |
|---|---|---|---|
| A. `pg_read_all_data` (B7-A ilk hali) | **Evet**, her şema | Evet (belgeli) | Bırakıldı |
| B. Auth/Storage'da tablo tablo `GRANT SELECT` | Hayır | **Hayır**: `postgres` bu şemalarda grant option'a sahip değil; GRANT uyarıyla hiçbir şey vermez (yerel taklitte gösterildi) | Uygulanamaz |
| C. `pg_read_all_data` + kapsam dışı tablolarda `REVOKE` | Evet: rol üyeliği yetkisi tablo REVOKE'u ile geri alınamaz | — | Etkisiz |
| D. `supabase_auth_admin` gibi sistem rolüne üyelik | Evet, ve yazma yetkisi de gelir | Hayır (rol yönetimi supautils ile kısıtlı) | Reddedildi |
| E. Ayrı Auth yönetim API'si (GoTrue admin) | Hayır | Parola özetini vermez; geri yükleme eksik kalır | Kapsam dışı |
| **F. Dar rol + dışa aktarma fonksiyonları** | **Hayır** (şema USAGE yok) | Fonksiyon sahibi `postgres`; `postgres`'in Auth/Storage'da SELECT'i var (Supabase SQL düzenleyicisinde okunabiliyor). **V4–V5'te doğrulanacak** | **Seçildi** |

### F yönteminin bileşenleri
- **Rol** (`ops/backup/backup-role.sql`): `login bypassrls noinherit connection limit 2`, üyelik yok;
  `public`/`private`'ta USAGE + bütün tablo/dizilerde SELECT; bu şemalarda çalıştıran rolün ileride oluşturacağı
  tablolar için varsayılan SELECT; yalnız 7 fonksiyonda EXECUTE. Betik tek işlem olarak çalıştırılır.
- **Fonksiyonlar** (`supabase/migrations/20261118000000_backup_export.sql`): `private` şemasında, sahibi migration'ı
  uygulayan rol (Supabase: `postgres`), `security definer`, `stable`, PL/pgSQL, `search_path = pg_catalog, pg_temp`,
  parametresiz, dinamik SQL yok, yazma yok, PUBLIC/anon/authenticated/service_role'e kapalı. Kapsam tablosu başına bir
  fonksiyon (`setof jsonb`) ve yalnız **sayı** döndüren bir koruma fonksiyonu. Oturum, yenileme belirteci ve diğer
  geçici tablolar için fonksiyon **yoktur**.
- **Belirteç sütunları:** `auth.users`'taki tek kullanımlık belirteçler (`confirmation_token`, `recovery_token`,
  `email_change_token_*`, `reauthentication_token`, `phone_change_token`) boş metin olarak verilir. Geri yüklemeden sonra
  bekleyen e-posta onayı/parola sıfırlama bağlantıları geçersizdir; kullanıcı yeniden ister.
- **RLS koruması:** Fonksiyon sahibi için RLS etkinse (`row_security_active`) fonksiyon hata verir; sessizce eksik satır
  döndürmez. `postgres`'in BYPASSRLS'i varsayılır (V4).
- **Sabitleme:** `ops/backup/export-functions.json` gövde (prosrc, normalize) ve ayarları sabitler; PGlite, PG16 ve PG17'de
  aynı (CI'da test). Sahip ve EXECUTE kuralları ortam bağımsız kural olarak denetlenir.
- **Döküm:** `public`/`private` için pg_dump (değişmedi). Auth/Storage için yapı katalogdan, veri fonksiyonlardan, S1
  işlemi içinde (aynı anlık görüntü). Bkz. [core.md](core.md).

### Neyi garanti eder, neyi etmez
- Garanti (yerelde test edildi): rol, bu veritabanında doğrudan ya da üyelik yoluyla `auth.sessions`,
  `auth.refresh_tokens` ve kapsam dışı hiçbir Auth/Storage/Vault tablosunu okuyamaz; okuyabilir hale gelirse A1 muaf
  tutulamaz biçimde durdurur.
- Garanti değil: yedek rolünün parolası sızarsa saldırgan, kapsamdaki Auth verisini (parola özetleri, MFA sırları dahil)
  ve bütün `public`/`private` verisini okuyabilir. Bu, yedeğin kendisiyle aynı içeriktir; önlemler: parola yalnız GitHub
  ortam gizlisinde, kısa `valid until`, bağlantı sınırı 2, şüphede hemen yenileme.
- Garanti değil: Supabase'in gerçek ayrıcalık modeli (V4–V8). Yerel test bir taklittir.
- `default_transaction_read_only` güvenlik sınırı değildir. Açık kaldığı sürece `lo_create` ve geçici tabloyu da engeller
  (yerelde gösterildi) ama oturum kapatabilir. Kalan PUBLIC yollar: [side-channels.md](side-channels.md).

### Auth kapsamı (`ops/backup/scope.json`)
| Tablo | Karar | Neden |
|---|---|---|
| `auth.users` | Dışa aktarılır (zorunlu); tek kullanımlık belirteçler boş | Hesaplar, parola özetleri, doğrulama durumu |
| `auth.identities` | Dışa aktarılır (zorunlu) | E-posta/Google bağları; yoksa sosyal giriş yeni hesap açar |
| `auth.mfa_factors` | Dışa aktarılır | Yönetici AAL2 girişi için gerekli; TOTP sırları yedekte (şifreli) bulunur |
| `auth.schema_migrations` | Dışa aktarılır | Auth sürüm denetimi |
| `auth.sessions`, `auth.refresh_tokens`, `mfa_amr_claims`, `mfa_challenges`, `one_time_tokens`, `flow_state`, `saml_relay_states`, OAuth durumları, `webauthn_challenges` | **Okunamaz, dökülmez** | Taşıyıcı kimlik bilgisi. Geri yüklemeden sonra herkes yeniden giriş yapar |
| `mfa_recovery_code*`, `audit_log_entries` | Dökülmez (bilinen kayıp); yalnız sayı | Kurtarma kodları yeniden üretilir |
| `webauthn_credentials`, `oauth_*`, `saml_*`, `sso_*`, `scim_*`, `vault.secrets` | Dökülmez; **kesin sayı > 0 ise yedek durur** | Kullanılmıyorlar |

### Storage kapsamı
- Meta veri (`storage.buckets`, `storage.objects`) fonksiyonlarla dışa aktarılır.
- Dosyalar veritabanında değildir. `storage.objects` > 0 ise yedek durur. Dosya yedeği tasarımı:
  [storage-files.md](storage-files.md).

### B7-B kabul ölçütleri
V4–V8 ve R2 V1–V3: [b7b-acceptance.md](b7b-acceptance.md).

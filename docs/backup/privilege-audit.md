# Yedek rolü yetki denetimi (B7-A1)

Araç: `tools/backup/privilege-audit.cjs`. Yalnız katalog okur, hiçbir şey yazmaz. Her yedek çalışmasından önce yedek rolüyle çalışır (A4) ve CI'da migration şemasına karşı çalışır (`npm run test:backup`).

## Ne denetlenir

| Alan | Beklenen | Sapma sınıfı |
|---|---|---|
| Rol özellikleri | LOGIN, BYPASSRLS, süper kullanıcı değil, CREATEROLE/CREATEDB/REPLICATION yok, bağlantı sınırı 1–2 | Muaf tutulamaz |
| Rol üyelikleri (dolaylı dahil) | Yalnız `pg_read_all_data`: INHERIT açık, ADMIN ve SET kapalı (PG16+ her veren satırı ayrı denetlenir); başka hiçbiri; üyelik yoksa da durur | Muaf tutulamaz |
| Veritabanında CREATE | Yok | Muaf tutulamaz |
| Şemada CREATE | Hiçbir şemada | Muaf tutulamaz |
| Tablo/kolon yetkileri | Yalnız SELECT | INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER muaf tutulamaz |
| Dizi yetkileri | Yalnız SELECT | USAGE/UPDATE muaf tutulamaz |
| Çağrılabilir SECURITY DEFINER | İzin listesinde ve parmak izi aynı | Muaf tutulabilir (K6), varsayılan olarak döküm başlamaz |

"Çağrılabilir": rolün şemada USAGE ve fonksiyonda EXECUTE yetkisi var (PUBLIC, doğrudan ya da üyelik yoluyla), fonksiyon tetikleyici değil. Rolün USAGE yetkisi olan bütün şemalar taranır; `pg_read_all_data` her şemada USAGE verdiği için bu, veritabanındaki bütün şemalardır.

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

`ops/backup/backup-role.sql`, `tools/backup/backup-role.cjs` tarafından `ops/backup/scope.json`'dan üretilir; test, dosyanın üreticiyle birebir aynı olduğunu doğrular. Testler betiği yerel veritabanında uygular ve rolün beklenen profilde olduğunu, `auth.sessions` ve `auth.refresh_tokens`'ı okuyamadığını doğrular. Production'da uygulanması B7-D'de, ayrı onayla yapılır.

`default_transaction_read_only=on` bir güvenlik sınırı değildir; oturum onu kapatabilir. Sınırlar yukarıdaki yetki kontrolleridir.

## Test edilemeyenler

- PGlite: veritabanı düzeyinde CREATE testi atlanır. Geri alınmış bir işlemden sonra `pg_database` güncellemesi PGlite'ta hata veriyor; test PG16 ve PG17'de çalışır.
- Supabase'in kendi `auth` ve `storage` fonksiyonları yerelde yok. Gerçek kapsam B7-B'deki T2 geçidinde denetlenir.

## Yedek rolü yöntemi: BYPASSRLS + pg_read_all_data (Supabase resmi yöntemi)

Esas alınan kaynak: Supabase bilgi bankası, "pg_dump fails with 'query would be affected by row-level security
policy'" (son güncelleme 4 Kasım 2026). Önerilen rol: `bypassrls` + `grant pg_read_all_data` +
`default_transaction_read_only = on`; döküm Supavisor oturum modu (5432) ya da doğrudan bağlantıyla, `supabase db dump`
olmadan.

### Karşılaştırma
| Konu | Önceki A1 (tablo tablo SELECT) | Şimdiki (Supabase yöntemi) |
|---|---|---|
| Supabase'te uygulanabilirlik | `auth`/`storage` için **etkisiz**: `postgres` bu şemalarda grant option'a sahip değil; GRANT hata vermeden hiçbir şey vermez (yerelde aynı sahiplik modeliyle gösterildi) | Supabase'in belgelediği yol; `pg_read_all_data` auth ve storage dahil her şemayı okur |
| Okuma kapsamı | Yalnız kapsam tabloları | **Her şema**: `auth.sessions`, `auth.refresh_tokens`, `vault` (şifreli), storage meta verisi dahil. Tek tek geri alınamaz |
| Şema USAGE | public, private, auth, storage | Her şema → PUBLIC'e açık SECURITY DEFINER fonksiyonları her şemada çağrılabilir olur; A1 hepsini denetler, incelenmemiş olan yedeği durdurur |
| Yeni tablo | Yetki yok → yedek durur (bilinçli kırılma) | Otomatik okunur; public/private dökümüne girer. Auth/Storage tarafında yalnız `scope.json`'daki tablolar dökülür |
| Üyelik denetimi | Her üyelik muaf tutulamaz | Yalnız `pg_read_all_data`, INHERIT açık, ADMIN ve SET kapalı; başka her üyelik (dolaylı dahil) ve her ek satır (PG16+ veren başına) muaf tutulamaz |
| Yazma | Yok | Yok (A1 her şemada yazma yetkisini denetler). PUBLIC'ten gelen kalan yollar aşağıda |

### Güvenlik değerlendirmesi
- **Bilinçli değişen özellik:** rol oturum ve yenileme belirteci tablolarını OKUYABİLİR. Yenileme belirteci bir taşıyıcı
  kimlik bilgisidir; yedek rolünün parolası ele geçirilirse kullanıcı oturumları çalınabilir. Önlemler: parola yalnız
  GitHub ortam gizlisinde, ortam onaylı; `valid until` ile kısa ömür ve düzenli yenileme; bağlantı sınırı 2; Supabase ağ
  kısıtları (varsa) yalnız CI çıkışlarına; şüphede `alter role … password` ile hemen yenileme.
- **Döküm** oturum/belirteç tablolarını içermez (aşağıda). Bu, okuma riskini değil yalnız yedek içeriğini sınırlar.
- **default_transaction_read_only güvenlik sınırı DEĞİLDİR:** oturum `set default_transaction_read_only = off` diyebilir.
  Gerçek sınır yazma yetkisi olmamasıdır.
- **PUBLIC'ten gelen kalan yazma yolları (kaynak sayfa):** pg_net etkinse `net.http_request_queue`'ya ekleme (dışarıya
  HTTP isteği) ve `lo_create` ile büyük nesne oluşturma. A1, pg_net tablosuna yazma yetkisini görürse yedeği muaf
  tutulamaz biçimde durdurur. `lo_create` A1'in tablo denetiminin dışındadır; açık risk.
- **Büyük nesneler** `pg_read_all_data` kapsamında değildir ve şema/tablo seçimli dökümler onları içermez. A2,
  `pg_largeobject_metadata` boş değilse yedeği durdurur (sessiz eksik yedek yok).

### Auth kapsamı (B dökümü, `ops/backup/scope.json`)
| Tablo | Karar | Neden |
|---|---|---|
| `auth.users` | Dökülür (zorunlu) | Hesaplar, parola özetleri, doğrulama durumu; geri yüklemenin özü |
| `auth.identities` | Dökülür (zorunlu) | E-posta/Google bağları; yoksa sosyal giriş yeni hesap açar |
| `auth.mfa_factors` | Dökülür | Yönetici AAL2 girişi için gerekli; TOTP sırları yedekte (şifreli) bulunur |
| `auth.schema_migrations` | Dökülür | Auth sürüm denetimi (geri yüklenen hedefle uyum) |
| `auth.sessions`, `auth.refresh_tokens`, `mfa_amr_claims`, `mfa_challenges`, `one_time_tokens`, `flow_state`, `saml_relay_states`, OAuth durumları, `webauthn_challenges` | **Dökülmez** | Geçici ve taşıyıcı kimlik bilgisi; yedekte bulunmaları sızıntıda oturum çalınmasına yol açar. **Geri yüklemeden sonra herkes yeniden giriş yapar** (önerilen yaklaşım) |
| `mfa_recovery_code*`, `audit_log_entries` | Dökülmez (bilinen kayıp) | Kurtarma kodları yeniden üretilir; denetim günlüğü yedek kapsamında değil |
| `webauthn_credentials`, `oauth_*`, `saml_*`, `sso_*`, `scim_*`, `vault.secrets` | Dökülmez; **satır varsa yedek durur** | Kullanılmıyorlar; kullanılmaya başlanırsa kapsam ayrıca kararlaştırılır |

### Storage kapsamı
- **Storage meta verisi** (`storage.buckets`, `storage.objects` satırları) veritabanındadır ve B dökümüne girer.
- **Gerçek dosyalar** veritabanında DEĞİLDİR; pg_dump onları içermez. Kaynak sayfa da dosyaların dahil olduğunu söylemez.
  Dosyalar ayrı bir yedek kapsamı ister: Storage S3 uyumlu API'siyle ayrı, şifreli ve doğrulanan bir kopya (B7-C/D, ayrı
  onay).
- Bugün `storage.objects` satır sayısı 0 olmalıdır; değilse yedek durur. Uygulama dosya saklamaya başlamadan önce dosya
  yedeği kurulmalıdır.

### B7-B'de geçici bir Supabase projesinde (production/DEV DEĞİL, ayrı onayla) doğrulanacaklar
- V4: `postgres` ile şablon hatasız çalışıyor mu: `create role … bypassrls` ve
  `grant pg_read_all_data … with inherit true, set false` (PG16+ seçenek sözdizimi; supautils davranışı).
- V5: `verifyRole` boş liste döndürüyor mu (auth/storage gerçekten okunuyor mu)?
- V6: A1 denetimi: Supabase şemalarındaki PUBLIC'e açık SECURITY DEFINER fonksiyonlarının listesi; her biri incelenip
  izin listesine gerekçesiyle girmeli ya da yedek durur. pg_net etkin mi (etkinse yazma yolu A1'de durdurur)?
- V7: PUBLIC'ten gelen dizi USAGE ya da başka yazma yetkisi var mı?
- V8: S1 uçtan uca: Supavisor oturum modu, `sslmode=verify-full`, pg_dump 17, `pg_largeobject_metadata` boş.
- S2a: iki geçici proje arasında Auth geri yükleme yöntemi (yeniden giriş zorunlu).

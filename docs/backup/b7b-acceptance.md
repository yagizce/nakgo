# B7-B kabul ölçütleri: R2 V1–V3 ve Supabase V4–V8

Bu belge B7-B canlı testlerinin **ne zaman geçmiş sayılacağını** tanımlar. Testlerin kendisi bu aşamada yapılmadı.

Ortak kurallar:
- Supabase testleri yalnız **geçici, ayrı bir Supabase projesinde** yapılır; production ve DEV'e dokunulmaz. R2 testleri
  yalnız **test kovasında** (K3) yapılır. Her ikisi ayrı onay ister.
- Test verisi sentetiktir; gerçek kullanıcı verisi ya da gerçek yedek kullanılmaz.
- Her test için kanıt, tarih ve komut çıktısıyla `docs/backup/evidence/` altına (gizli değer ve parola OLMADAN) yazılır.
- "Geçti" yalnız bütün ölçütler sağlanınca. Tek bir başarısızlık koşulu bile varsa test **kaldı**. "Dur" koşulunda test
  dizisi durur ve insan incelemesi beklenir; sonraki teste geçilmez.
- Bir test kalırsa ilgili özellik açılmaz (ör. V1 kalırsa tek kullanımlık muafiyet garantisi `false` kalır; V3 kalırsa
  kapılı silme kapalı kalır).

## R2 (test kovası)

### V1: koşullu yazma
| | |
|---|---|
| Adım | Rastgele anahtara `PUT` (`If-None-Match: *`) → aynı anahtara farklı içerikle tekrar `PUT` (`If-None-Match: *`). 20 kez, ayrıca 2 eşzamanlı istemciyle 20 kez. |
| Geçer | İlk yazma 200; ikincisi her denemede **412**; `GET` her zaman ilk içeriği döndürür; eşzamanlı denemelerde tam olarak bir yazma kazanır. |
| Kalır | İkinci yazma 200 döner ya da içerik değişir; eşzamanlıda iki yazma da başarılı görünür. |
| Dur | 412 dışında 4xx/5xx (ör. 501: başlık desteklenmiyor). |
| Kanıt | İstek/yanıt durum kodları, içerik sha256'ları. |
| Sonuç | Geçerse `config.store_capabilities.conditional_put = "verified"`. |

### V2: yazdıktan sonra tutarlı okuma ve listeleme
| | |
|---|---|
| Adım | 50 kez: `PUT` → hemen `GET` ve `HEAD` → hemen `LIST` (önek). |
| Geçer | Her denemede `GET` aynı baytları, `HEAD` aynı boyutu döndürür; `LIST` anahtarı içerir. |
| Kalır | Tek bir denemede eski/boş içerik, 404 ya da listede eksik anahtar. |
| Dur | Kimlik doğrulama/imza hatası (SigV4). |
| Kanıt | Deneme sayısı, gecikme dağılımı, hata sayısı (0 olmalı). |
| Sonuç | Geçerse `consistent_read = "verified"`. V1 ve V2 birlikte geçmeden `single_use_guaranteed` açılmaz. |

### V3: kova kilidi
| | |
|---|---|
| Adım | `db/` (kilitli önek) altına nesne yaz → `DELETE` → aynı anahtara üzerine yaz (koşulsuz `PUT`). Kilitsiz önekte aynısı. Kilit süresi kısa (test kovasında 1 gün) ayarlanır; süre dolunca `DELETE` tekrarlanır. |
| Geçer | Kilitli önekte `DELETE` ve üzerine yazma **reddedilir** ve nesne değişmez; kilitsiz önekte izin verilir; süre dolunca silme başarılı. Yedek yazma anahtarıyla kilit kuralı değiştirilemez. |
| Kalır | Kilitli nesne silinir ya da değişir; yazma anahtarı kilidi kaldırabilir. |
| Dur | Kilit kuralı kovada uygulanamıyor. |
| Kanıt | Kilit kuralının dışa aktarılmış tanımı, yanıt kodları, nesne sha256'ları. |
| Sonuç | Geçerse kapılı silme için K3 kanıtı; kapı yine varsayılan kapalı kalır. |

## Supabase (geçici proje)

### V4: rol ve fonksiyonlar `postgres` ile kurulabiliyor
| | |
|---|---|
| Adım | Repo migration'ları (dahil `20261118000000_backup_export.sql`) uygulanır. `psql --single-transaction -v backup_password=… -v valid_until=… -f ops/backup/backup-role.sql`, `postgres` ile. |
| Geçer | Betik hatasız biter. `nakgo_backup`: `rolbypassrls=true`, `rolsuper=false`, üyelik yok. 7 dışa aktarma fonksiyonunun sahibi `private` şemasının sahibi (`postgres`). `postgres`'in `rolbypassrls=true` olduğu kaydedilir. |
| Kalır | 42501 ya da başka hata; rol yarım oluşur; fonksiyon sahibi farklı. |
| Dur | `postgres` BYPASSRLS veremiyor (supautils politikası) → yöntem yeniden değerlendirilir. |
| Kanıt | Betik çıktısı, `pg_roles` ve `pg_proc` sorgu sonuçları. |

### V5: erişim tam ve dar
| | |
|---|---|
| Adım | Sentetik veri: kullanıcılar (e-posta ve Google kimliği), oturumlar, yenileme belirteçleri, RLS'li `storage.buckets`. `nakgo_backup` ile bağlanılır. `verifyRole` çalıştırılır. |
| Geçer | `verifyRole` boş liste. `select … from auth.sessions`, `auth.refresh_tokens`, `auth.users`, `storage.objects` → **42501**. Her dışa aktarma fonksiyonunun satır sayısı `postgres` ile `count(*)` sayısına **eşit** (RLS'li tablolar dahil). `auth.users` çıktısında tek kullanımlık belirteç sütunları boş. |
| Kalır | Herhangi bir doğrudan okuma başarılı; sayı farkı; fonksiyon "RLS etkin" hatası verir (postgres RLS'ye tabi); belirteç değeri görünür. |
| Dur | Fonksiyonlar `postgres` ile bile Auth tablolarını okuyamıyor → F yöntemi Supabase'te uygulanamaz; yöntem yeniden değerlendirilir. |
| Kanıt | `verifyRole` çıktısı, sayı tablosu, 42501 hata metinleri. |

### V6: yetki denetimi Supabase kataloğunda
| | |
|---|---|
| Adım | `privilege-audit` yedek rolüyle (`audit` + `evaluate`). Rolün USAGE'ı olan şemalar ve çağırabildiği bütün SECURITY DEFINER fonksiyonlar listelenir; [side-channels.md](side-channels.md) bölüm 3 ile karşılaştırılır. Kurulu uzantılar ve şemaları listelenir. |
| Geçer | Karar `ok`. USAGE yalnız `public`, `private` (ve `pg_catalog`, `information_schema`). `network_function`, `read_outside_scope`, `export_function_changed`, `membership` yok. 7 fonksiyon `export_function_pinned`. |
| Kalır | Muaf tutulamaz herhangi bir bulgu. |
| Dur | `stop_waivable`: listelenen her fonksiyon tek tek incelenir; izin listesine yalnız incelemeli PR ile girer. K6 muafiyeti bu testte kullanılmaz. |
| Kanıt | `evaluate` çıktısı (`audit_sha256` dahil), uzantı listesi. |

### V7: yan yollar
| | |
|---|---|
| Adım | Yedek rolüyle: (a) varsayılan oturumda `select lo_create(0)`; (b) `create temp table`; (c) `set default_transaction_read_only=off` sonrası `lo_create`, yedek korumasının okuduğu `pg_largeobject_metadata` sayısı, ardından `lo_unlink`; (d) `net.*`, `http*`, `dblink*` fonksiyonlarında yetki (çağrı yapılmaz); (e) `pg_logical_emit_message`, `pg_replication_slots` ve yayınlar; (f) A1 `accepted_residual` listesi; (g) danışma kilidi: yedek oturumu `pg_advisory_lock(7291)` (yönetici hesap işlemlerinin anahtarı) tutar, `postgres` oturumu aynı anahtarı `lock_timeout=2s` ile `pg_advisory_xact_lock` ile ister (uygulama RPC'sinin yaptığının aynısı), sonra `pg_terminate_backend` ile yedek oturumunu kapatır ve tekrar ister. |
| Geçer | (a), (b) salt okunur işlem hatasıyla (25006) reddedilir; (c) başarılı, sayı > 0 (yedek bu durumda **durur**; A2 testi) ve temizlenir; (d) çağrılabilir fonksiyon yok; (e) çağrı başarılı ve yuvalar/yayınlar kaydedilir (yuva varsa sonuç "review": mesaj işleyip işlemediğine insan bakar); (f) liste [side-channels.md](side-channels.md) bölüm 2 ile aynı; (g) ilk istek 55P03 ile zaman aşımına uğrar, sonlandırma başarılı, ikinci istek hemen alınır. |
| Kalır | (d) çağrılabilir fonksiyon var (dur); (c) sonrasında koruma sayıyı görmüyor; belgede olmayan bir yan yol; (g) istek beklemiyor ya da `postgres` yedek oturumunu sonlandıramıyor. |
| Dur | Kullanıcı verisini değiştiren ya da dışarı veri taşıyan herhangi bir yol. |
| Kanıt | Komut çıktıları; (c) sonrasındaki yedek çalışmasının `guards` sonucu. |

### V8: uçtan uca S1
| | |
|---|---|
| Adım | GitHub Actions'tan değil, geçici projeye karşı elle: `run.cjs` yedek rolüyle, Supavisor **oturum modu** (5432), `sslmode=verify-full` ve Supabase kök sertifikası, pg_dump 17, test alıcıları, test kovası. Çalışma sırasında eşzamanlı yazıcı açık. |
| Geçer | Ön kontrol `ok`; `dump`, `restore_test` (sayılar, FK yetimleri, parmak izi, Auth sürümü, sözleşme), şifreleme, yükleme, manifest imzası `ok`; `verified=true`. 6543 portu ve `sslmode=require` denemeleri bağlantı aşamasında reddedilir. `pg_largeobject_metadata` boş. S1 açık kalma süresi kaydedilir. |
| Kalır | Herhangi bir aşama `failed`; geri yükleme sayıları S1'den farklı. |
| Dur | `--snapshot` içe alınamıyor (Supavisor oturum modu dışa aktarılan görüntüyü desteklemiyor) ya da sertifika doğrulanamıyor. |
| Kanıt | İmzalı manifest, `restore_checks`, süre ölçümleri (şifreli paket saklanmaz; test sonunda silinir). |

## Çalıştırma (K-5) ve #125 senaryosu (K-6)

- **Tetikleme:** `.github/workflows/b7b-test.yml` yalnız `nakgo/b7b-test` dalına push ile çalışır. `workflow_dispatch`
  kullanılmaz: GitHub onu yalnız varsayılan dalda (`main`) bulunan iş akışları için garanti eder.
- **Takım seçimi:** o dalda commitlenen `ops/backup/b7b-suite.json` (`none`, `r2`, `supabase-base`,
  `supabase-legal125`). Varsayılan `none`: hiçbir test işi başlamaz. Seçimi gizlisiz ve ortamsız bir `select` işi okur ve
  doğrular.
- **Onay:** test işleri `backup-test` ortamını kullanır. Ortamın zorunlu onaylayıcısı onay vermeden iş başlamaz ve ortam
  gizlilerine erişemez. Onaylayan kişi onaydan önce o push'un `nakgo/altyapi`'ye göre farkını (iş akışı, `tools/backup/`,
  `ops/backup/`) inceler: dala push yetkisi olan biri iş akışını değiştirebilir; koruma onaydır.
- **Takıma göre gizliler:** `r2` işi yalnız R2 gizlilerini, `supabase` işi veritabanı gizlilerini ve V8'in şifreli yedeği
  yazdığı test kovası için R2 gizlilerini alır. Çalıştırıcı R2 takımında veritabanı gizlisi görürse durur.
- **Alt süreçler:** çalıştırıcı başlarken bütün `NAKGO_TEST_*` gizlilerini ortamdan alıp **siler**; `pg_dump`,
  `pg_restore`, `age`, `tar` bunları devralmaz. `postgres` parolası yalnız yönetici istemcisine verilir.
- **Maskeleme:** çalışma anında üretilen yedek rolü parolası kullanılmadan önce `::add-mask::` ile maskelenir (depo ve
  Actions günlükleri herkese açıktır). Sonuç özeti yalnız durum kodları, sayılar ve adlar içerir.
- **Bağımlılıklar:** `ops/backup/ci/package-lock.json` (her paket için `sha512` bütünlük özeti) ve
  `npm ci --ignore-scripts`. `age` sha256, PostgreSQL deposu anahtar parmak iziyle doğrulanır.
- **Temizlik:** `nakgo_backup` rolü V4'ten sonra ne olursa olsun (başarı, kalma, istisna) `finally` içinde silinir: oturumları
  kapatılır, `DROP OWNED` sahip olduğu her şeyi (büyük nesneler dahil) kaldırır, sonra yokluğu doğrulanır; sonuç `cleanup`
  satırı olarak raporlanır ve başarısızsa çalışma kalır. V7(c) büyük nesnesi ölçüm hata verse de silinir (yedek oturumu
  silemezse yönetici oturumu). Geçici anahtar/age klasörü (şifresiz döküm dahil) `finally` ile silinir.
- **R2 belirteç kapsamı (R2-scope):** V1'den önce hesap düzeyinde kova listeleme denenir; 401/403 beklenir. 200 dönerse
  belirteç fazla yetkilidir ve R2 testlerine geçilmez. Uç nokta varsayılan ya da AB yargı bölgesi
  (`<hesap>.eu.r2.cloudflarestorage.com`) olabilir.
- Takımlar sırayla: `r2` (R2-scope, V1–V3) → `supabase-base` (V4–V8, #125 yok) → `supabase-legal125` (V4, V5, V6, V8).
- **#125 yalıtımı:** #125 PR'ı hiçbir yerde kullanılmaz. Yalnız depodaki sabitlenmiş kopyası
  `tests/backup/fixtures/legal_archive.b25013e.sql` (sha256 `a32d8e90…d099`; #125'in son commiti `b25013e`'deki dosyayla
  aynı) ve yalnız `supabase-legal125` takımında, bütün depo migration'larından sonra uygulanır. Uygulanan her dosya test
  projesinde `b7b_test.applied` tablosunda adı ve sha256'sıyla tutulur; değişmiş dosya durdurur. Geri dönüş yoktur: proje
  #125'e geçtikten sonra `supabase-base` o projede "dur" verir.
- Anahtarlar her çalışmada bellekte ya da geçici klasörde üretilir (K1, K2, K7, iki age alıcısı) ve iş bitince silinir.

### Test gizlileri (yalnız `backup-test` ortamında)

| Gizli | İş | Erişim sınırı |
|---|---|---|
| `NAKGO_TEST_R2_ENDPOINT`, `NAKGO_TEST_R2_BUCKET` | r2, supabase | Kova adında "test" zorunlu |
| `NAKGO_TEST_R2_ACCESS_KEY_ID`, `NAKGO_TEST_R2_SECRET_ACCESS_KEY` | r2, supabase | "Object Read & Write", yalnız test kovası; kova listeleme reddedilmeli (R2-scope); kilit yönetimi YOK |
| `NAKGO_TEST_DB_PROJECT_REF`, `NAKGO_TEST_DB_HOST`, `NAKGO_TEST_DB_ADMIN_USER` | supabase | Production/DEV kimliği reddedilir; adres ve kullanıcı kimlikle tutarlı |
| `NAKGO_TEST_DB_ADMIN_PASSWORD` | supabase | Yalnız geçici proje; yalnız yönetici istemcisi; alt süreçlere geçmez |
| `NAKGO_TEST_DB_ROOT_CERT` | supabase | Supabase kök sertifikası |

Ortam ayarı (ayrı onay; önce kurallar, sonra gizliler): zorunlu onaylayıcı = proje sahibi; dağıtım dalı yalnız
`nakgo/b7b-test`; yöneticinin kuralları atlaması kapalı. Test bitince ortamın gizlileri silinir ve dal kaldırılır.

**Bilinen sınır:** Bu oturum depoda proje sahibinin GitHub kimliğiyle çalışır. Ortam onayı başka katkıcılara ve fork'lara
karşı teknik bir sınırdır; bu oturuma karşı değil. Onay yalnız proje sahibi tarafından GitHub arayüzünden verilir.

## B7-B'den önce gereken kararlar
Bkz. [../backup-design.md](../backup-design.md) "B7-B'ye geçiş ENGELLERİ". Özet: geçici Supabase projesi ve R2 test kovası
için onay, test anahtarlarının (K1, K7, test age alıcıları) üretimi, kalan PUBLIC yan yollarının kabulü.

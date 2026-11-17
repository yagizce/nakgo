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

- İş akışı: `.github/workflows/b7b-test.yml`. Yalnız `workflow_dispatch`, yalnız `nakgo/b7b-test` dalı, yalnız `backup-test`
  ortamı, izin yalnız `contents: read`. Çalıştırıcı (`tools/backup/b7b/run.cjs`) aynı kuralları bağlantıdan önce yeniden
  denetler ve production/DEV proje kimliklerini (AGENTS.md) adıyla reddeder.
- Takımlar sırayla: `r2` (V1–V3) → `supabase-base` (V4–V8, #125 yok) → `supabase-legal125` (V4, V5, V6, V8; #125 ile).
- **#125 yalıtımı:** #125 PR'ının kendisi hiçbir yerde kullanılmaz. Yalnız depodaki sabitlenmiş kopyası
  `tests/backup/fixtures/legal_archive.b25013e.sql` (sha256 `a32d8e90…d099`) ve yalnız `supabase-legal125` takımında,
  bütün depo migration'larından sonra uygulanır. Uygulanan her dosya test projesinde `b7b_test.applied` tablosunda adı ve
  sha256'sıyla tutulur; değişmiş dosya durdurur. Geri dönüş yoktur: proje #125'e geçtikten sonra `supabase-base` o projede
  "dur" verir; temel senaryo yeniden gerekiyorsa yeni geçici proje açılır.
- Anahtarlar her çalışmada bellekte ya da geçici klasörde üretilir (K1, K2, K7, iki age alıcısı) ve iş bitince silinir;
  gizli değişken olarak saklanmaz. Yedek rolünün parolası her çalışmada rastgele, rol bir günlük `valid until` ile.

### Test gizlileri (yalnız `backup-test` ortamında)

| Gizli | İçerik | Erişim sınırı |
|---|---|---|
| `NAKGO_TEST_R2_ENDPOINT`, `NAKGO_TEST_R2_BUCKET` | Test hesabı uç noktası, test kovası adı (adında "test" zorunlu) | — |
| `NAKGO_TEST_R2_ACCESS_KEY_ID`, `NAKGO_TEST_R2_SECRET_ACCESS_KEY` | R2 nesne okuma/yazma belirteci | Yalnız test kovası; kilit kuralı yönetimi YOK (o belirteç CI'a verilmez) |
| `NAKGO_TEST_DB_PROJECT_REF`, `NAKGO_TEST_DB_HOST`, `NAKGO_TEST_DB_ADMIN_USER` | Geçici projenin kimliği, Supavisor adresi, `postgres.<kimlik>` | Production/DEV kimliği reddedilir; adres ve kullanıcı kimlikle tutarlı olmalı |
| `NAKGO_TEST_DB_ADMIN_PASSWORD` | Geçici projenin `postgres` parolası | Yalnız geçici proje; proje silinince geçersiz |
| `NAKGO_TEST_DB_ROOT_CERT` | Supabase kök sertifikası (gizli değil, tutarlılık için ortamda) | — |

Ortam ayarı (ayrı onay): zorunlu onaylayıcı = proje sahibi; dağıtım dalı yalnız `nakgo/b7b-test`; production
gizlileri bu ortamda bulunmaz. Test bitince ortamın gizlileri silinir.

**Bilinen sınır:** GitHub belgeleri `workflow_dispatch`'in iş akışı dosyası varsayılan dalda (`main`) bulunmadıkça
tetiklenmeyeceğini söyler. Dosya bilerek `main`'e konmadı. `gh workflow run b7b-test.yml --ref nakgo/b7b-test` ile API
üzerinden tetikleme denenecek; reddedilirse seçenekler (ayrı onay): `main`'e yalnız tetikleyici iskeleti eklemek ya da
tetikleyiciyi `nakgo/b7b-test` dalına push + zorunlu ortam onayı yapmak.

## B7-B'den önce gereken kararlar
Bkz. [../backup-design.md](../backup-design.md) "B7-B'ye geçiş ENGELLERİ". Özet: geçici Supabase projesi ve R2 test kovası
için onay, test anahtarlarının (K1, K7, test age alıcıları) üretimi, kalan PUBLIC yan yollarının kabulü.

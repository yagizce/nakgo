# Gerçek altyapı gerektiren, henüz kanıtlanmamış doğrulamalar

Bu liste, yerel simülasyonla **kanıtlanamayan** ve bu yüzden hâlâ açık olan B7 doğrulamalarını tutar. Buradaki hiçbir
madde, yerel S3 taklidinde ya da yerel PostgreSQL'de geçen bir testle "tamam" sayılmaz. Bir madde ancak gerçek ortamda
(ayrı onayla) çalıştırılıp sonucu bu dosyaya tarih ve kanıtla yazılınca kapanır.

Canlı yedek (`backup.yml`) bu maddeler kapanmadan **etkinleştirilmez**. O zamana kadar ilgili korumalar fail-closed
çalışır: `capabilities.verified=false` olduğu için yedek silme ve tek kullanımlılık garantisi kapalıdır.

## Durum özeti (17 Kasım 2026)

| # | Doğrulama | Neden yerelde kanıtlanamaz | Yerelde ne sınandı | Kanıtlanana kadar etkisi | Gereken ortam |
|---|---|---|---|---|---|
| G1 | **V1** R2 koşullu yazma (`If-None-Match: *` → 412) | Davranış R2 sunucusuna ait; taklit yalnız bizim beklentimizi uygular | Taklitte 412, yeniden denemede belirsiz 412 ve hash ile çözümü | Kontrol noktası tek kullanımlılığı "garantisiz" sayılır; silme kapalı | R2 test kovası |
| G2 | **V2** yazdıktan sonra tutarlı okuma ve listeleme | Tutarlılık modeli gerçek depoya ait | Taklitte anında tutarlı | Silme kapalı | R2 test kovası |
| G3 | **V3** kova kilidi silmeyi ve üzerine yazmayı engelliyor | Kilit kuralı R2 kova ayarıdır | `MemoryStore` kilit simülasyonu | Silme kapalı; 14 günlük saklama yalnız kilit kanıtlanınca güvenilir | R2 test kovası + kilit kuralı |
| G4 | R2 belirtecinin yalnız tek kovaya bağlı olduğu (ListBuckets reddi) | Yetki kapsamı Cloudflare hesabına ait | Taklitte 403/200 ayrımı | Belirteç kapsamı varsayılmaz | R2 test kovası + kovaya bağlı belirteç |
| G5 | R2'nin gerçek ağ hataları, 5xx ve zaman aşımı oranları | Gerçek ağ ve servis davranışı | Taklitte 503/429/kopma/asılma/yarım gövde/bozuk gövde ve yeniden deneme | Yeniden deneme sayısı (3) ve bekleme (0,5–2 sn) tahmindir | R2 test kovası, birkaç gün |
| G6 | **V4** rol ve fonksiyonların Supabase'de `postgres` ile kurulabilmesi | Supabase'in rol modeli (sahiplik, `supabase_admin`) yerelde yok | Düz PG16/PG17'de kurulum | Production'da rol kurulumu denenmez | Geçici Supabase projesi |
| G7 | **V5** erişimin tam ve dar olduğu (Supabase kataloğunda) | Supabase'in kendi rolleri ve şemaları | Yerel taklit kataloğunda | — | Geçici Supabase projesi |
| G8 | **V6** yetki denetiminin Supabase kataloğunda temiz geçmesi | Aynı | Yerelde 152 test | Ön kontrol production'da ilk kez çalışırsa durabilir (güvenli yön) | Geçici Supabase projesi |
| G9 | **V7** yan yollar: `lo_create`, `pg_logical_emit_message`, danışma kilidi ölçümü | Supabase'in izinleri ve havuzlayıcı (pooler) davranışı | Yerelde ölçüm kodu ve yorumu | Üç risk "ölçüldü" sayılmaz; kalıcı kabul değil (K-4) | Geçici Supabase projesi |
| G10 | **V8** uçtan uca S1 (Supabase'ten döküm → yerel geri yükleme) | Gerçek Supabase Auth/Storage şeması ve havuzlayıcı üzerinden `pg_dump` | Yerelde tam döngü ve kurtarma tatbikatı | Gerçek şemada döküm hiç alınmadı | Geçici Supabase projesi |
| G11 | #125 yasal arşiv şemasıyla V8 (`legal125` senaryosu) | Aynı | Yerelde sabitlenmiş #125 kopyasıyla | — | Geçici Supabase projesi |
| G12 | **S2a** yöntemin Supabase'e geri taşınabildiği | İki gerçek Supabase projesi gerekir | — | Kurtarma "düz PostgreSQL'e" kanıtlı, Supabase'e değil | İki geçici Supabase projesi |
| G13 | **S2b** gerçek yedekten kurtarma ve Auth girişi | Gerçek yedek ve yalıtılmış proje | — | Auth kurtarması "başarılı" sayılmaz | Yalıtılmış geçici proje, gerçek yedek |
| G14 | Bağlantı: `verify-full` ile Supabase havuzlayıcısı ve kök sertifika | Gerçek sertifika zinciri | Kural denetimi (`validateConn`) | — | Geçici Supabase projesi |
| G15 | İzleme Worker'ının gerçek R2 ve GitHub API'siyle çalışması | Gerçek servisler | Taklitlerle `a4-monitor` testleri | Yedek kaçarsa uyarı gelmeyebilir | Cloudflare Worker (son aşama) |
| G16 | İlk yedekte (bootstrap) bağlanan rolün (`postgres`) Supabase'deki gerçek yetkileri: `auth`/`storage`/`vault`/`cron`/`supabase_migrations` okuma, `public`/`private` dizileri, BYPASSRLS ya da RLS'in etkin olmaması | Supabase rol modeli yerelde yok | Taklit: Auth tabloları `supabase_auth_admin`'e ait ve RLS'li, rol süper kullanıcı değil (`b8-bootstrap`) | Bootstrap ön koşulu karşılanmadan çalıştırılmaz; araç eksik yetkide `permissions`/`rls` aşamasında durur | Production'da salt okunur katalog sorgusu (ayrı onay) |
| G17 | `cron.job` RLS politikası: `postgres` BYPASSRLS değilse yalnız kendi işlerini görür | pg_cron'un Supabase kurulumu | Taklit politika ve `rls` durdurması | İşler eksik okunacaksa döküm durur (sessiz eksik yok) | G16 ile aynı sorgu |
| G18 | Production'daki `auth`, `storage`, `vault` tablo listesi `scope.json` sınıflarıyla örtüşüyor | Supabase sürümüne bağlı | 24.11.2026 salt okunur katalog sorgusu: 38 tablo (auth 27, storage 10, vault 1); 2'si (`storage.bucket_lifecycle_states`, `storage.lifecycle_abandoned_artifacts`) sınıflandırılmamıştı → `guard_stop_if_rows_pending`. Liste `coverage_inventory` olarak sabitlendi; taklit (`PROD_AUX_TABLES`) aynı 38 tabloyu kurar; `coverage`/`guards` durdurmaları gerçek PG17'de sınandı | Bilinmeyen ya da eksik tablo varsa bootstrap durur; önce `scope.json` + taklit PR'ı. K6b/B7 envanteri denetlemez (geçiş engeli) | Yeni Supabase sürümünde aynı sorgu (ayrı onay) |
| G19 | Bootstrap'ın Supavisor + `verify-full` ile gerçek bağlantısı ve operatör makinesinde PostgreSQL 17 istemcisi | Gerçek sertifika zinciri ve makine | Kural denetimi (`validateConn`), yerel PG17 | — | İlk yedek (ayrı onay) |
| G20 | Kurtarma SQL'inin (`restore-meta.cjs`) gerçek Supabase hedefinde çalışması: migration geçmişi, `cron.schedule`, `auth.sessions` tetikleyicisi | Hedefte pg_cron ve Supabase'in Auth tabloları gerekir | SQL geri yüklenmiş kopyada pg_cron API taklidiyle çalıştırıldı: işler (etkinlik dahil), geçmiş ve tetikleyici geri geldi; ikinci çalıştırma aynı sonuç; pg_cron yokken hiçbir şey yazılmadı | Zamanlanmış işler ve giriş günlüğü tetikleyicisi kurtarmada elle kurulur | S2a/S2b (yalıtılmış proje) |

## Bu çalışmada yerelde eklenenler (simülasyon, gerçek kanıt değil)

- Depo istemcisi: her istekte zaman aşımı; ağ hatası, zaman aşımı, yarım gövde, 5xx ve 429'da sınırlı ve artan beklemeli
  yeniden deneme; 403 ve 412 asla yeniden denenmez; hata mesajlarında uç nokta ve gizli değer yok.
- Yanıtı kaybolan koşullu yazma: yeniden denemede gelen 412 "belirsiz" işaretlenir; yedek ancak geri okunan içerik
  hash'iyle birebir aynıysa kabul edilir. Kontrol noktası zinciri ve silme günlüğü de aynı kuralla çalışır: belirsiz 412
  sahte "eşzamanlı yazıcı" alarmı açmaz; geri okunan içerik farklıysa gerçek çakışma sayılır.
- Döküm sırasında kopan veritabanı bağlantısı ya da ulaşılamayan veritabanı artık süreci çökertmez: döküm aşaması
  başarısız raporlanır, imzalı başarısız manifest yazılır, şifresiz dosya kalmaz.
- Kurtarma indirmesi (`tools/backup/dr-fetch.cjs`): manifest imzası, `verified`, alıcı listesi hash'i, nesne-manifest
  bağı, boyut ve SHA-256 denetlenir; dosya 0600 ve var olanın üzerine yazmadan kaydedilir; şifre çözmez. "En yeni"
  seçiminde daha yeni bir manifestte bütünlük sorunu varsa durur.
- Kurtarma tatbikatı testi: yedek → indir ve doğrula → age ile çöz → yalıtılmış PostgreSQL'e geri yükle → bütün S1
  denetimleri.

## B8'de yerelde eklenenler (simülasyon, gerçek kanıt değil)

- Bootstrap kipi, her bağlantıda salt okunur oturum, kapsam denetimi, yönetim verisi ve dış tetikleyiciler; yerel
  PostgreSQL 17.11 ve `pg_dump` 17 ile uçtan uca: yedek → (K9 akışı, aşağıda) imzalı manifest → indirme ve doğrulama → çözme → boş
  veritabanına geri yükleme → bekleyen migration'ların sırayla provası (şema 0 fark, sözleşme, fixture'lar).
- Taklit Supabase sahiplik modelinde bulunan ve düzeltilen iki hata: (1) şema parmak izi Auth tablolarının sahibinin
  (`supabase_auth_admin`) örtük yetkilerini içeriyordu; geri yüklenen kopyada sahip değiştiği için S1 her zaman düşerdi.
  (2) Kapsam dışı Auth tablosundaki tetikleyicimiz (`auth.sessions → nakgo_access_log`) yedekte ve kurtarmada yoktu.

## K9 elle yedek akışında yerelde eklenenler (simülasyon, gerçek kanıt değil)

- `run` → `offline-sign` → `finalize` üç aşaması ve `dr-fetch` elle yedek yolu, yerel PG17 ve test anahtarlarıyla uçtan
  uca (`tests/backup/b9-offline-e2e.test.cjs`): A ile ve ayrıca B ile L2 (çözme, ağsız atılabilir kümede süper kullanıcı
  OLMAYAN rolle geri yükleme, R1–R6, O5, T8), K9 imzaları, finalize, zincirin geri okunması; sinyal ve red yolları.
  Ağ denetimi testte enjeksiyonla geçilir (sanal makinede ağ arayüzü var); gerçek imza makinesinde fiziksel ayrım gerekir.
- Açık: gerçek anahtar töreni (K9, çapa, kâğıt), gerçek imza makinesinin araç paketi özeti, gerçek Production yedeğinin
  L2'si (süper kullanıcı olmayan rolün gerçek Production paketini geri yükleyebildiğinin gösterilmesi; süper kullanıcı
  yolu kaldırıldı) (ayrı onaylar).
- Production'daki `schema_migrations` değerleri (23.11.2026, salt okunur sorgu; iş akışı değil, bu yüzden kapanmadı):
  32 sürümün 32'si repodaki dosya sürümleriyle aynı (takma ad gerekmez). Ad alanı varsayıldığı gibi DEĞİL: 17 satır
  yalın ad, 15 satır `<14 hane>_<ad>.sql`; bunların 8'inde addaki zaman damgası sürümden farklı. Eski eşleştirici bu
  geçmişi reddederdi (offline-sign `migration_history`'de dururdu). Eşleştirici artık yalnız bu iki biçimi normalize
  eder (anahtar sürüm; başka dosyayı gösteren damga belirsiz → ret; bozuk biçim → ret). Damga farkı yalnız
  `ops/backup/migration-aliases.json → timestamp_exceptions` sabit izin listesindeki 8 satırla (sürüm + slug +
  Production adı birebir) kabul edilir; imzalı kayda (sürüm 2) kabul edilen her istisnanın tam kimliği ve izin
  listesinin kanonik hash'i yazılır. Yeni fark, değişmiş ya da eksik istisna run ve offline-sign'da (geçmişten), finalize'da
  (imzalı kimlikler ↔ main'deki liste, birebir küme + hash) reddedilir. Ölçülen 32 satır testte sabit veridir (`tests/backup/prod-fixture.cjs`).
  Açık: gerçek yedek paketindeki geçmişin aynı sonucu verdiği ilk gerçek çalıştırmada görülür.

## Kapanış kuralı

Bir madde kapatılırken: tarih, çalıştırılan iş akışı kimliği, sonuç ve varsa sapma bu tabloya eklenir. Sonuç
beklenenden farklıysa kod değil önce bu belge ve ilgili tasarım güncellenir; madde açık kalır.

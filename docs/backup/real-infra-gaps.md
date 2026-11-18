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

## Kapanış kuralı

Bir madde kapatılırken: tarih, çalıştırılan iş akışı kimliği, sonuç ve varsa sapma bu tabloya eklenir. Sonuç
beklenenden farklıysa kod değil önce bu belge ve ilgili tasarım güncellenir; madde açık kalır.

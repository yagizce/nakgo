# Mimari

NakGo bağımlılıksız HTML/CSS/JavaScript uygulamasıdır; React Native değildir. Betikler klasik tek kapsamda çalışır. `tools/project.js` yükleme sırasının tek kaynağıdır: yapılandırma, durum, çekirdek, özellikler, UI, ekranlar, başlatma.

`src/js/features/` ilan/filtre/karşılaştırma, taşıma talebi/mesaj/yükleme onayı, hesap/belge ve Premium kurallarını içerir. `src/js/screens/` ilanlar, oluşturma, işler, profil, mesaj geçmişi, yol haritası ve detayları içerir; main.js yönlendirir. Profil işaretlemesi kimlik, günlük araçlar ve iletişim gruplarına ayrılır. `src/js/ui/` tema/paylaşma/mazot hesabı, ortak SVG simgeleri ve pencere/gezintiyi yönetir. Pencere odağı ve arka plan etkileşimleri dialog.js tarafından yönetilir; pencere açıkken ana içerik ve menü `inert` olur. `src/css/profile.css` profil stillerinin tek kaynağıdır.

`yy2` mevcut ilan, teklif, sohbet, belge, favori ve üyelik durumunu saklar. `yy-role`, `yy-onb`, `yy-theme`, `yy-seen` korunmuştur. Yeni `ng-post-drafts` ilan formunu ayrı saklar; yayınlanınca ilgili taslak temizlenir. `ng-post-mode` son form türünü korur. `ng-splash` oturum içindir. Mevcut veriyi sıfırlayan şema geçişi yoktur.

Host ortamında `window.claude.use("db")` ve `use("user")` varsa mevcut ortak veri akışı kullanılır. Koleksiyonlar: loads, trucks, offers, msgs, carriers, approvals, ratings, reports. Normal Vercel/PWA bu servisleri sağlamaz; yerel demo çalışır. Ön yüzdeki kurallar sunucu güvenliği yerine geçmez.

Üretilen çıktılar ve kaynak ayrımı kök README'deki dosya tablosunda açıklanır.

Harita sorumlulukları dört dosyaya ayrılır: `features/road-map-data.js` sağlayıcı, nokta doğrulama ve DOM'dan bağımsız Web Mercator hesaplarını; `ui/map-controller.js` döşeme yükleme, Pointer Events, klavye ve gözlemci temizliğini; `ui/road-map.js` ortak bileşen ve bağlamayı; `screens/road-map.js` şehir/kategori seçimi ve açıldığı ilana dönüşü yönetir. Yeni framework veya paket yoktur. OSM yol döşemeleri yalnızca görünen harita açılınca yüklenir; servis çalışanı dış harita isteklerini önbelleklemez. Şehir merkezleri işaretlenir; yol navigasyonu veya tıra uygun rota üretilmez. Tahmini mesafe mevcut tablodan korunur.

Doğrulanmış lastikçi, tamirci ve dinlenme tesisleri `ROAD_STOPS` koleksiyonuna ad, kategori, koordinat, kaynak ve doğrulama tarihiyle eklenir. Eksik veya geçersiz noktalar gösterilmez; ilk sürümde bu liste boştur. `ROAD_MAP.tiles` harita sağlayıcısını değiştirmek için tek yapılandırma noktasıdır. [OSM döşeme politikası](https://operations.osmfoundation.org/policies/tiles/) gereği toplu indirme/çevrimdışı harita yoktur; tarayıcı HTTP önbelleğine uyulur ve kaynak haritada görünür.

Arama ve sohbet açma/gönderme Premium kontrolüne tabidir. Gönderirken süresi dolan üyelik tekrar denetlenir. Mevcut host entegrasyonu dışında üyelik hâlâ demo verisidir; gerçek sunucuda aynı yetkiler sunucu tarafında uygulanmalıdır.

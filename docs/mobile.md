# PWA ve mobil kabuk

Manifest adı NakGo; maskable simge daha geniş güvenli alan ve tam zemin kullanır. SW ağ önceliklidir; daha önce açılmış sayfa çevrimdışı kullanılabilir. Font ağı yoksa sistem fontu kullanılır. Web düzeni safe-area ve visualViewport yükseklik değişimini, azaltılmış hareket tercihini destekler.

Resmi adres https://nakgo.vercel.app. Paylaşım ve canonical bu domaine gider; manifest/SW yolları aynı origin'e göreli kalır, API önbelleğe alınmaz. Marka/domain sürümünde kabuk cache sürümü güncellenmiştir. localStorage, PWA kurulumu ve cache origin'e bağlıdır: başka domainin yerel kayıtları kendiliğinden yeni domaine taşınmaz. Eski origin'deki veriler silinmez; depolama anahtarları ve veri şeması korunur. Domain geçişi ortak backend veya otomatik veri aktarımı eklemez.

capacitor.config.json başlangıç yapılandırmasıdır: appId com.nakgo.app, appName NakGo, webDir www. Depoda Capacitor paketleri ve iOS/Android projeleri yoktur. `npm run mobile:prepare` web dosyalarını www/ altına kopyalar; uygulama derlemez, mağazaya yüklemez. Native içinde SW kapalıdır.

Gerçek native proje için ayrı dalda Capacitor CLI/core ve platform paketleri kurulmalı, `npx cap add android`/`ios`, sonra `npx cap sync` çalıştırılmalıdır. Android Studio; iOS için macOS/Xcode; imza sertifikaları ve mağaza hesapları gerekir. Native ikon/splash, izinler, geri tuşu ve WebView klavyesi fiziksel cihazda doğrulanmalıdır. Bunlar bu web yenilemesinin tamamlanmış çıktıları değildir.

Mobil hazırlık komutu güncel bundle zorunluluğunu denetler; kaynakla uyuşmayan index.html kopyalanmaz. Çıktı proje köküne veya üst dizinine yönlendirilemez. Bu çalışma ortamında Java/ADB/Gradle bulunmadığı için Android APK, iOS paketi ve fiziksel cihaz testleri henüz tamamlanmadı.

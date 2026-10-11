# Temizlik kaydı

Kök README.md, README (2).md, README (4).md ve README.txt incelendi. Çalışan komutlar README'ye, mimari docs/architecture.md'ye, mobil notlar docs/mobile.md'ye, geliştirme notları docs/development.md'ye ve ürün kuralları docs/product.md'ye taşındı. Eski Poppins/harici logo betiği gereksinimi kaldırıldı.

Eski tests/run.js kontrolleri aktif app/platform testlerindeki aynı akışlarla karşılaştırıldı; eski çalıştırıcı kaldırıldı ve aktif çalıştırıcı tests/run.js oldu. Kaynaklar içerikleri korunarak src/ altına, araçlar tools/ altına taşındı.

Aktif HTML, manifest, SW ve Capacitor yapılandırmasının referansları kontrol edildi. Çalışan uygulama icons/ dosyalarını kullanıyor; kökteki alternatif marka çıktıları ve eski üreticiler bu akışta kullanılmıyordu. Eski YükYol HTML'i yükleme/bundle listesinde yer almıyordu. Silinen bağımsız eski dosyalar:

- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512.png`
- `icon-background.png`
- `icon-foreground.png`
- `icon-maskable-512.png`
- `icon-only.png`
- `icon.svg`
- `logo-app-full.svg`
- `logo-horizontal-light.png`
- `logo-horizontal-light.svg`
- `logo-horizontal.png`
- `logo-horizontal.svg`
- `logo-mark.svg`
- `logo-vertical.png`
- `logo-vertical.svg`
- `logo.py`
- `nakgo-icon-1024.png`
- `nakgo-icon-fullbleed-1024.png`
- `nakgo-icon-fullbleed.svg`
- `nakgo-icon.svg`
- `nakgo-logo-horizontal-white.png`
- `nakgo-logo-horizontal-white.svg`
- `nakgo-logo-horizontal.png`
- `nakgo-logo-horizontal.svg`
- `nakgo-logo-vertical.png`
- `nakgo-logo-vertical.svg`
- `splash-dark.png`
- `splash.png`
- `gen.py`
- `generate.py`
- `shots.py`
- `prepare-web.js`
- `download`
- `download (1)`
- `download (3)`
- `YükYol – Yük ve Araç Eşleştirme.html`
- `YükYol – Yük ve Araç Eşleştirme.md`

README kopyaları ve eski ARCHITECTURE.md, HANDOFF.md, MOBIL-VE-MARKA.md konsolidasyon sonrasında kaldırıldı. Ürün kuralları canlı kodla karşılaştırılarak docs/product.md'de korundu. Geçmiş içerik Git geçmişinde erişilebilir.

## Yerel güvenilirlik düzenlemesi

Çekirdekteki veri kuralları data.js, cihaz kaydı storage.js, eski host bağlantısı cloud.js olarak ayrıldı. Referansı bulunmayan FUEL_ICON, pods ve featSumCard ile görünmeyen teklif fiyatı istatistiği hesapları kaldırıldı; saklanan eski ücret ve iş kayıtları silinmedi. Tek README düzeni korundu; kaldırılmış HANDOFF.md referansı ürün belgesine taşındı. Çalıştırma için değişken npx serve indirmesi yerine yerleşik Node sunucusu kullanılır. Üretilen www ve test görüntüleri Git dışında kalır.

# Geliştirme ve test

Yeni JS/CSS dosyasını `tools/project.js` sırasına ekleyin. Betikler ortak kapsamı paylaşır: üst düzey isimler çakışmamalı; başlangıç olayları `src/js/app.js` içindedir. Lint birleşik sözdizimini, isim çakışmalarını ve kaynak başlıklarını denetler. `npm run map -- --write` yerel docs/CODEMAP.md üretir.

`tests/run.js` sahte DOM ile davranışı ve yayın çıktısını denetler. Yeni testler tests/unit/ altında *.test.js olur. Yerleşim ve klavye gerçek tarayıcıda doğrulanmalıdır.

Tarayıcı testi için Python 3, `python -m pip install -r tests/requirements.txt` ve `python -m playwright install chromium` gerekir. Kurulu Chrome için NAKGO_BROWSER_CHANNEL=chrome kullanılabilir. NAKGO_E2E_URL testin yerel sunucu yerine önizlemeyi açmasını sağlar; korunan Vercel önizlemesi geçerli paylaşım bağlantısı gerektirir. Testler demo verisi oluşturur, gerçek ödeme veya taşıma yapmaz.

Tekrarlanan harita yakınlaştırma/şehir seçimi testlerinde döşemeler test verisiyle karşılanır; kamusal harita sunucusuna otomatik tarama yapılmaz. Gerçek sağlayıcı ve kaynak görünürlüğü önizlemede ayrıca kontrol edilir. Fiziksel iki parmak hareketi, dokunmatik kaydırma ve telefon klavyesi gerçek cihazda da denenmelidir.

Çalışan komutlar README'dedir. Kontrollerde 360/390/430 px ve masaüstünde iki tema, uzun metin/fiyat, boş sonuç ve görsel klavye alanı incelenmelidir. Fiziksel cihaz klavyesi ayrıca doğrulanmalıdır.

Uygulama her görünüm alanında en fazla 430 px genişliğinde, tek sütunlu telefon düzenini korur. Detay penceresi de aynı genişliği kullanır. Ana menü alttadır. İlan araçları ve form adımları `--nav-height` üzerinden menünün üstüne yerleşir; ana içerik bu alanlar için kaydırma payı bırakır. Yük/araç iletişimi ve sohbet alanları detayın kaydırılan içeriğinden ayrıdır. Tarayıcı matrisi bu işlemlerin kaydırmada görünür kaldığını, karşılaştırmayla çakışmadığını ve geniş ekranda telefon düzeninin korunduğunu denetler.

Özgün logo `assets/brand/logo.png` içinde değiştirilmeden saklanır; arka planı temizlenen sürüm `assets/brand/logo-transparent.png` içindedir. `assets/brand/layout.json` görüntü çerçevelerini ve sloganı belirler. `npm run logo` yerleşik Node modülleriyle 8 bit RGB/RGBA, interlace kapalı PNG'yi boyutlandırır ve alfa kanalını korur. Başlık/açılış görselleri şeffaftır; Apple ve maskable simgelerin zemini turkuazdır. Maskable simgede tır güvenli merkez alanında kalır. `npm run bundle` sloganı aynı kaynaktan iki yere yerleştirir. Marka değişikliğinde önce logo, sonra bundle komutunu çalıştırın. Servis çalışanı görselleri çevrimdışı kullanım için saklar.

Vercel statik yayın kullanır. Kaynaklar/araçlar/belgeler .vercelignore ile dışlanır; index.html, manifest, SW ve icons/ yayınlanır. PR ve otomatik birleşme koşulları [kalite kapısı belgesindedir](quality-gate.md).

GitHub Actions `checks.yml`, her PR ve main güncellemesinde bundle/lint/birim testlerini, Chromium akışlarını ve mobil web çıktısını doğrular. İş akışı yalnızca okuma izni kullanır, deploy yapmaz ve uygulama sırlarına ihtiyaç duymaz. Action sürümleri commit SHA ile, Playwright test sürümü tests/requirements.txt içinde sabittir. Test kurulumu [Playwright’ın CI belgesini](https://playwright.dev/python/docs/ci-intro) izler.

`tests/reliability.py` gerçek formdan güvenli metin, depo dolması, bozuk kayıt, belge fotoğrafı, tarih, filtre, iletişim durumu ve iki temada kontrast senaryolarını kapsar; ana E2E komutu tarafından çağrılır. `tests/forms.py` taslak geçişleri, gecikmeli fotoğraf, geçersiz miktar/seçimler, favori/iş kaydı ve mazot hesabında hata sonrası tutarlılığı denetler. Geçici rapor ve ekran görüntüleri tests/shots altında tutulur.

Bundle satır sonlarını LF olarak sabitler; aynı kaynaklar Windows ve Linux’ta aynı index.html üretir. Yerel HTTP sunucusu tools/serve.js içindedir, dış ağa açılmaz; PORT ortam değişkeni ile port değiştirilebilir.

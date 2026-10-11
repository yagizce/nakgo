# Geliştirme ve test

Yeni JS/CSS dosyasını `tools/project.js` sırasına ekleyin. Betikler ortak kapsamı paylaşır: üst düzey isimler çakışmamalı; başlangıç olayları `src/js/app.js` içindedir. Lint birleşik sözdizimini, isim çakışmalarını ve kaynak başlıklarını denetler. `npm run map -- --write` yerel docs/CODEMAP.md üretir.

`tests/run.js` sahte DOM ile davranışı ve yayın çıktısını denetler. Yeni testler tests/unit/ altında *.test.js olur. Yerleşim ve klavye gerçek tarayıcıda doğrulanmalıdır.

Tarayıcı testi için Python 3, `python -m pip install playwright` ve `python -m playwright install chromium` gerekir. Kurulu Chrome için NAKGO_BROWSER_CHANNEL=chrome kullanılabilir. NAKGO_E2E_URL testin yerel sunucu yerine önizlemeyi açmasını sağlar; korunan Vercel önizlemesi geçerli paylaşım bağlantısı gerektirir. Testler demo verisi oluşturur, gerçek ödeme veya taşıma yapmaz.

Tekrarlanan harita yakınlaştırma/şehir seçimi testlerinde döşemeler test verisiyle karşılanır; kamusal harita sunucusuna otomatik tarama yapılmaz. Gerçek sağlayıcı ve kaynak görünürlüğü önizlemede ayrıca kontrol edilir. Fiziksel iki parmak hareketi, dokunmatik kaydırma ve telefon klavyesi gerçek cihazda da denenmelidir.

Çalışan komutlar README'dedir. Kontrollerde 360/390/430 px ve masaüstünde iki tema, uzun metin/fiyat, boş sonuç ve görsel klavye alanı incelenmelidir. Fiziksel cihaz klavyesi ayrıca doğrulanmalıdır.

Uygulama her görünüm alanında en fazla 430 px genişliğinde, tek sütunlu telefon düzenini korur. Detay penceresi de aynı genişliği kullanır. Ana menü alttadır. İlan araçları ve form adımları `--nav-height` üzerinden menünün üstüne yerleşir; ana içerik bu alanlar için kaydırma payı bırakır. Yük/araç iletişimi ve sohbet alanları detayın kaydırılan içeriğinden ayrıdır. Tarayıcı matrisi bu işlemlerin kaydırmada görünür kaldığını, karşılaştırmayla çakışmadığını ve geniş ekranda telefon düzeninin korunduğunu denetler.

Özgün logo `assets/brand/logo.png` içinde değiştirilmeden saklanır. `assets/brand/layout.json` tır simgesinin ve tam logonun kaynak içindeki çerçevelerini ve sloganı belirler. `npm run logo` yerleşik Node modülleriyle PNG'yi okur ve boyutlandırır; 8 bit RGB/RGBA, interlace kapalı kaynakları destekler. Maskable simgede tır güvenli merkez alanında kalır. Üretilen `icons/brand-logo.png` açılışta, küçük simge başlıkta kullanılır; `npm run bundle` sloganı aynı kaynaktan iki yere yerleştirir. Marka değişikliğinde önce logo, sonra bundle komutunu çalıştırın. Servis çalışanı bu görselleri çevrimdışı kullanım için saklar.

Vercel statik yayın kullanır. Kaynaklar/araçlar/belgeler .vercelignore ile dışlanır; index.html, manifest, SW ve icons/ yayınlanır. Yeni önizleme onaylanmadan üretim dalı birleştirilmez veya üretim yayını yapılmaz.

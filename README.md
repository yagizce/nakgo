# NakGo

Telefon düzeninde yük ve boş araç pazarı; turkuaz/sarı marka, açık/koyu tema ve altta ana işlemler. Büyük ekranlarda da tek sütunlu mobil görünüm korunur. Bağımlılıksız HTML/CSS/JavaScript + PWA kullanır. Ücret alanı bulunmaz; taraflar telefon veya mesajla görüşür. İşlerim iki aşamalı yükleme takibidir; profilden mesajlar, kayıtlılar ve mazot hesabı açılır. Normal web yayınında **yerel demo** çalışır: örnek ilanlar ve otomatik yanıtlar gerçek taşıma talebi değildir; test üyelikleri ödeme almaz.

## Çalıştırma

Node 18+ ile proje kökünde:

```sh
npm run bundle         # kaynaklardan index.html üret
npm start              # HTTP sunucusu; ilk kullanımda serve indirilir
npm test               # çıktı tutarlılığı, lint, davranış testleri
npm run test:e2e        # gerçek Chromium; kurulum docs/development.md
npm run test:shots      # tests/shots/ görüntüleri
npm run logo           # tek SVG kaynağından web/PWA simgeleri
npm run mobile:prepare # www/ çıktısı; native derleme değildir
```

## Kaynak ve çıktı

| Yol | Sorumluluk |
| --- | --- |
| src/index.template.html, src/js/, src/css/ | Düzenlenebilir uygulama kaynakları |
| assets/brand/mark.svg | Tek marka kaynağı |
| tools/ | Kaynak sırası, bundle, lint, harita, simge üretimi |
| tests/run.js, tests/unit/, tests/e2e.py | Testler |
| docs/ | Ayrıntılı belgeler |
| index.html | **Üretilen yayın çıktısı**, doğrudan düzenlemeyin |
| icons/ | **Üretilen** web/PWA simgeleri |
| manifest.webmanifest, sw.js, vercel.json | PWA, önbellek ve statik yayın ayarları |
| capacitor.config.json | Mobil kabuk başlangıç ayarı |

www/, tests/shots/ ve docs/CODEMAP.md yerel üretilen çıktılardır, Git dışında kalır. Kaynak değişikliğinde bundle çalıştırın.

## Belgeler

- [Mimari ve veri saklama](docs/architecture.md)
- [Geliştirme ve test](docs/development.md)
- [PWA ve mobil kurulum](docs/mobile.md)
- [Ürün kuralları ve sınırlar](docs/product.md)
- [Birleştirilen ve kaldırılan dosyalar](docs/cleanup.md)

[GitHub deposu](https://github.com/yagizce/yukyoll) · [Vercel projesi](https://vercel.com/yagizces-projects/yukyoll) · [Canlı site](https://yukyoll.vercel.app). Yeni değişiklikler ayrı dal ve önizleme üzerinden incelenir; canlıya geçiş kullanıcı onayından sonradır.

Yol haritası ve doğrulanacak mola/bakım noktalarının veri biçimi için [mimari belgesi](docs/architecture.md) içindeki harita bölümüne bak. Arama ve uygulama içi mesajlaşma Premium üyelik gerektirir.

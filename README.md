# NakGo

Telefon düzeninde yük ve boş araç pazarı; turkuaz/sarı marka, açık/koyu tema ve altta ana işlemler. Büyük ekranlarda da tek sütunlu mobil görünüm korunur. Bağımlılıksız HTML/CSS/JavaScript + PWA kullanır. Ücret alanı bulunmaz; taraflar telefon veya mesajla görüşür. İşlerim iki aşamalı yükleme takibidir; profilden mesajlar, kayıtlılar ve mazot hesabı açılır. Normal web yayınında **yerel demo** çalışır: örnek ilanlar ve otomatik yanıtlar gerçek taşıma talebi değildir; test üyelikleri ödeme almaz.

## Çalıştırma

Node 18+ ile proje kökünde:

```sh
npm run bundle         # kaynaklardan index.html üret
npm start              # http://127.0.0.1:3000; ek paket indirmez
npm test               # çıktı tutarlılığı, lint, davranış testleri
npm run test:e2e        # gerçek Chromium; kurulum docs/development.md
npm run test:browser    # bağımsız mobil/güvenlik sözleşmesi
npm run test:guard      # main tabanına karşı test/komut koruması
npm run test:gate       # otomatik birleşme engellerinin testleri
npm run test:static     # bağımsız JS/JSON/HTML kontrolleri
npm run test:shots      # tests/shots/ görüntüleri
npm run logo           # özgün logodan web/PWA simgeleri
npm run mobile:prepare # www/ çıktısı; native derleme değildir
```

## Kaynak ve çıktı

| Yol | Sorumluluk |
| --- | --- |
| src/index.template.html, src/js/, src/css/ | Düzenlenebilir uygulama kaynakları |
| assets/brand/logo.png, logo-transparent.png, layout.json | Özgün/şeffaf logo kaynakları, görüntü çerçeveleri ve slogan |
| tools/ | Kaynak sırası, bundle, lint, harita, simge üretimi |
| tests/run.js, tests/unit/, tests/e2e.py, tests/reliability.py | Testler |
| docs/ | Ayrıntılı belgeler |
| index.html | **Üretilen yayın çıktısı**, doğrudan düzenlemeyin |
| icons/ | **Üretilen** logo ve web/PWA simgeleri |
| manifest.webmanifest, sw.js, vercel.json | PWA, önbellek ve statik yayın ayarları |
| capacitor.config.json | Mobil kabuk başlangıç ayarı |
| api/whatsapp/, server/whatsapp/ | WhatsApp V1 backend giriş noktası ve saf parser; frontend'e eklenmez |
| public/ | Vercel için üretilen statik allowlist çıktısı; Git dışında |

www/, tests/shots/ ve docs/CODEMAP.md yerel üretilen çıktılardır, Git dışında kalır. Kaynak değişikliğinde bundle çalıştırın.

## Belgeler

- [Mimari ve veri saklama](docs/architecture.md)
- [Geliştirme ve test](docs/development.md)
- [Kalite kapısı ve otomatik birleşme](docs/quality-gate.md)
- [WhatsApp V1 backend, test ve aktivasyon sınırları](docs/whatsapp-v1.md)
- [PWA ve mobil kurulum](docs/mobile.md)
- [Ürün kuralları ve sınırlar](docs/product.md)
- [Birleştirilen ve kaldırılan dosyalar](docs/cleanup.md)

[GitHub deposu](https://github.com/yagizce/yukyoll) · [Vercel projesi](https://vercel.com/yagizces-projects/yukyoll) · [Canlı site](https://yukyoll.vercel.app). Yeni değişiklikler ayrı dal ve önizleme üzerinden ilerler. Kullanıcının yetkilendirdiği codex/* otomatik birleşme koşulları [kalite kapısı belgesindedir](docs/quality-gate.md); kapsam dışındaki PR'lar inceleme bekler.

Yol haritası ve doğrulanacak mola/bakım noktalarının veri biçimi için [mimari belgesi](docs/architecture.md) içindeki harita bölümüne bak. Arama ve uygulama içi mesajlaşma Premium üyelik gerektirir.

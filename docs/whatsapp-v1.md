# WhatsApp Bot V1 — güvenli temel

Bu sürüm resmi WhatsApp Business Cloud API için altyapıdır. Meta uygulaması, gerçek numara veya kullanıcı verisi bağlanmadı. AI, WhatsApp Web otomasyonu, scraping, mesaj gönderme ve ilan yayınlama yoktur. UI ve mevcut yerel/demo veri şeması değişmez.

## Mimari

- [API giriş noktası](../api/whatsapp/webhook.mjs): Vercel Node.js Web Request/Response GET/POST.
- [Webhook](../server/whatsapp/webhook.cjs): ham gövde, doğrulama, kontrollü yanıt.
- [Normalizer](../server/whatsapp/messages.cjs): messageId, fromPhone (E.164), timestamp (Unix saniyesi), text. Yalnız WhatsApp messages/text olayları.
- [Parser ve validator](../server/whatsapp/parser.cjs): saf, deterministik taslak; dış API yok.
- [Katalog adaptörü](../server/whatsapp/catalog.cjs): şehir, araç ve kasa sabitlerini mevcut src/js/config.js dosyasındaki JSON literal'lerinden okur; eval/VM veya ikinci şehir/araç listesi yoktur.
- [Statik yayın aracı](../tools/whatsapp-web-output.js): mevcut bundle sonrası yalnız index.html, manifest, sw.js ve icons/ dosyalarını public/ çıktısına kopyalar. Backend/env/kaynaklar statik yayına girmez. public/ üretilir ve Git dışında kalır; Vercel kök api/ işlevini ayrıca derler. Fonksiyon için config.js açıkça trace/include edilir.

## Ortam ve webhook

URL: https://<domain>/api/whatsapp/webhook — bu proje için https://yukyoll.vercel.app/api/whatsapp/webhook.

İleride yalnız Vercel backend ortamına tanımlanacak değişkenler:

| Değişken | İşlev |
| --- | --- |
| WHATSAPP_VERIFY_TOKEN | GET Meta doğrulama tokenı |
| META_APP_SECRET | POST HMAC-SHA256 imza anahtarı |

Bu aşamada değişkenler tanımlanmaz; gerçek değer istenmez. WHATSAPP_ACCESS_TOKEN, PHONE_NUMBER_ID ve AI API key kullanılmaz. .env dosyaları Git/statik yayın dışında tutulur. Token, secret, mesaj ve telefon kod tarafından loglanmaz veya yanıtta verilmez. Meta doğrulama tokenı query içinde geldiğinden ileride platform/erişim loglarının da sorgu değerlerini maskelemesi kontrol edilmelidir.

GET: tekil hub.mode=subscribe, doğru hub.verify_token ve sayısal hub.challenge için düz metin challenge/200. Hatalı/eksik/tekrarlanan token veya mode 403; geçersiz challenge 400; yapılandırma yoksa 503. Yanıtlar no-store.

POST: en fazla 128 KiB gövde. X-Hub-Signature-256 içindeki sha256=hex değeri ham baytların HMAC-SHA256 özeti ile node:crypto timingSafeEqual kullanılarak, JSON çözümlemesinden önce karşılaştırılır. Secret varsa eksik/geçersiz imza 401; secret yoksa hosted/default handler 503. Bozuk JSON 400, büyük gövde 413, beklenmeyen yapı/event 200/OK. Text olayları saf taslak hazırlığına girer, sonuç şu an saklanmadan bırakılır. Dış ağ veya kuyruk beklenmez. Bu ACK, kalıcı kayıt ya da teslim garantisi değildir.

İmzasız mock yalnız createWebhook({env:{NODE_ENV:'test'},allowUnsignedLocal:true}) ile local/test'te mümkündür; VERCEL veya VERCEL_ENV varsa kapanır. API giriş noktası bu seçeneği vermez. Debug endpoint bulunmaz. Sadece test fixture'larında uydurma token/numara kullanılır.

## Parser sınırları

Çıkış/varış {city,district}, cargo, weightTon, vehicle, price, date (today/tomorrow), isteğe bağlı phone ve confidence alanlarını verir. issues belirsiz/bozuk girdileri belirtir. Eksik değerler null kalır. Confidence doldurulmuş yedi ana alanın oranıdır; istatistiksel doğruluk veya ilan onayı değildir.

81 şehir mevcut katalogdan gelir. Ekli dokuz ilçe: Aliağa, Bornova, Kemalpaşa, Menemen, Torbalı (İzmir); Gebze, Dilovası (Kocaeli); Çorlu, Çerkezköy (Tekirdağ). Diğer ilçeler tahmin edilmez. Şehir+ilçe tek durak olarak birleşir; iki durak, >, apostrof ve Türkçe yön ekleri desteklenir. Birden fazla olası rota/tonaj/tarih belirsiz sayılır. Sınırlı yük türü sözlüğü dışında cargo null kalır.

Ton/kg, Türkçe ondalık virgülü/binlik noktası, bin/TL/TRY/₺/lira desteklenir. Etiketsiz tek sayı sadece mesaj sonunda ve mutlak değeri >=1000 ise tutar adayıdır; telefon/tarih/sayı tahmin edilmez. Fiyat yalnız backend taslağıdır; uygulamada kaldırılmış ücret alanları geri eklenmez.

Validator aynı rota, eksik şehir/yük/tonaj, 0/negatif veya >100 ton, negatif veya >10.000.000 TL, bozuk sayılar, katalog dışı araç/ilçe ve unsafe cargo'yu reddeder. Bunlar V1 sınırlarıdır. Metin hiçbir noktada HTML olarak çizilmez; parser tag/script içi içeriği kullanmaz. İleride frontend'e bağlanırsa mevcut esc()/textContent sınırı korunmalıdır.

## Duplicate hazırlığı

Normalizer aynı webhook batch'inde aynı messageId'yi bir kez çıkarır; ayrı çağrıların sonucu aynıdır. prepareDrafts, whatsapp:<messageId> idempotencyKey ve SHA-256 fingerprint verir. Fingerprint normalize edilmiş telefon + çıkış/varış şehir/ilçe + yük türü + tonaj + tarih üzerinden üretilir. Fiyat, araç, whitespace ve harf boyutu fingerprint'e yeni kayıt oluşturmaz. Hash anonimleştirme garantisi değildir; loglanmamalıdır.

Kalıcı DB veya process-global duplicate cache yoktur. Ayrı retry'lar tekrar hazırlanır. Aktivasyondan önce messageId için DB unique constraint, atomik kayıt ve durable queue gerekir. today/tomorrow göreli tarihini message timestamp ve Europe/Istanbul gününe sabitleme de o aşamada yapılmalıdır; V1 fingerprint tek başına farklı günlerde duplicate kararı veremez.

## Test ve geliştirme

```sh
npm run whatsapp:test                 # bağımsız Node testleri, token gerekmez
npm run whatsapp:parse                # örneklerin JSON çıktısı
npm run whatsapp:parse -- "İzmir Ankara 24 ton sac tenteli bugün 32000"
npm run build:vercel                  # mevcut bundle + statik allowlist
```

npm start mevcut statik sunucudur; backend'i çalıştırmaz. Local webhook testleri Web Request/Response fixture'larıyla çalışır; gerçek deployment smoke testi Vercel preview'da yapılır.

Yeni tests/unit/whatsapp.test.js dosyası mevcut runner'ın keşfine bağlanır; mevcut npm test komutu ve workflow/test/auto-merge dosyaları değiştirilmez. Tests/ değişikliği nedeniyle mevcut otomatik birleşme politikası PR'ı ayrı incelemeye bırakır; bu kural gevşetilmez.

## Sonraki Meta adımı

Önce PR kontrolleri/önizleme ve inceleme tamamlanmalı. Sonra kullanıcı yetkisiyle test Meta uygulaması/WABA, test numarası, webhook messages aboneliği ve iki backend env değişkeni kurulur. Gerçek bağlantıdan önce kalıcı idempotency/ingestion, veri saklama/izin politikası ve log maskeleme tamamlanır. Outbound token/numara ID veya AI anahtarı ancak ayrı, açık kapsamda eklenir.

Resmi referanslar: [Vercel Node Web handler](https://vercel.com/docs/functions/runtimes/node-js), [fonksiyon dosya tracing](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions), [Meta webhook doğrulaması](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), [Cloud API payload yapısı](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples/). İlçe kaynakları: [İzmir Belediyesi](https://izmirinrakamlari.izmir.bel.tr/tr/2023/43/IlceTuruneGoreBagimsizBolumler?no=3), [Kocaeli Valiliği](https://www.kocaeli.gov.tr/dilovasi), [Tekirdağ ilçe listesi](https://tekirdag.ktb.gov.tr/TR-75727/ilceler.html).

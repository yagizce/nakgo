# Cloudflare Workers DEV geçişi

29 Ekim 2026, Europe/Istanbul. Dal: `codex/nakgo-cloudflare-dev`.
WhatsApp draft [PR #38](https://github.com/yagizce/nakgo/pull/38) kaynakları esas
alındı (uzak başlık `afeb690`, yerel eşdeğer doğrulama tabanı `3a99121`).
PR #38 birleştirilmedi. Bu aşama yerel geliştirme ve runtime kabulüdür;
İlk Cloudflare DEV yayını kullanıcı onayıyla yapıldı; gerçek DEV veri bağlantısı ve
Meta kabulü henüz tamamlanmadı. DB migration veya DNS değişikliği yapılmadı.

## Uyumluluk ve değişiklik sınırı

| Bileşen | Sonuç ve uyarlama |
| --- | --- |
| Modüler HTML/JS, PWA ve ilanlar | Mevcut bundle ve `public/` çıktısı Static Assets ile çalışır. Kaynak, UI ve SW sürümü değişmedi. `/index.html` otomatik `/` adresine 307 döner; test ve giriş adresi kök olmalıdır. |
| Auth config API | Vercel Node req/res yerine küçük Fetch adapteri; aynı `publicAuthConfig` ve feature flag kullanılır. GET/HEAD, no-store, public key ile sınırlı çıktı. |
| Supabase Auth, ilan/RPC/Storage | Tarayıcı doğrudan aynı DEV projesine gider; şema, RLS ve yetki modeli değiştirilmedi. Yeni origin için DEV Auth redirect allowlist gerekli. |
| Google OAuth | Aynı SDK/PKCE. SDK'nın `sb_flow_id` parametresi yeni kabul testinde doğrulanır. Gerçek Google hesabı ile yeni host kabulü deploy sonrasına kalır. |
| WhatsApp webhook | Mevcut HMAC, ham gövde ve boyut sınırı yeniden kullanılır. `node:crypto` ESM köprüsü build sırasında eklenir. |
| Parser kataloğu | Mevcut `catalog.cjs` dosya sistemi okuması build zamanında yapılır; aynı şehir/araç kataloğu bundle içine alınır. Runtime filesystem gerekmez. |
| Supabase server RPC | Workers `redirect:error` desteklemediğinden yalnız adapterde `manual` kullanılır. Store bütün 3xx yanıtları başarısız sayar; anahtar başka origin'e yönlenmez. Vercel store değişmez. |
| Kuyruk/Cron | Yeni kuyruk yok. Mevcut Postgres claim/lease/retry ve `processBatch` (en fazla 5 iş) kullanılır. Dakikalık Cron tanımlı, işleme flag'i varsayılan kapalıdır. Hata generic exception verir, sır veya mesaj loglanmaz. |

Dosyalar: `cloudflare/worker.mjs`, `cloudflare/wrangler.jsonc`, izole
`cloudflare/package*.json`, `tools/cloudflare-build.cjs`, `tests/cloudflare/`.
Vercel API'leri, `vercel.json`, mevcut korumalı testler ve workflow'lar değişmedi.
Build bağımlılıkları kök package dosyasına eklenmedi. Build, Vercel statik güvenlik
ve SW cache başlıklarını `public/_headers` çıktısında korur.

DEV kilidi tam URL `https://axkotffqrsddbrazhcwj.supabase.co` ve `NAKGO_ENV=dev`
ister. Yanlış ortam HTTP API'de 503, scheduled handler'da hata verir. Preview
olarak çağrılan mevcut store guard'ı da çalışır. Production konfigürasyonu yoktur.
Yönetici erişimi mevcut sunucu rolleri/RPC ile sınırlı; yeni üyelik verilmedi.

## Tekrarlanabilir yerel kontroller

Komutları depo kökünden çalıştırın (Wrangler build cwd buna göre ayarlı):

```sh
npm ci --prefix cloudflare
node tools/cloudflare-build.cjs
node tests/cloudflare/runtime.cjs
node cloudflare/node_modules/wrangler/bin/wrangler.js deploy --dry-run --config cloudflare/wrangler.jsonc
node cloudflare/node_modules/wrangler/bin/wrangler.js dev --local --port 8787 --config cloudflare/wrangler.jsonc
```

Son komut açıkken ayrı terminalde:

```sh
node tests/cloudflare/static.cjs
python tests/cloudflare/browser.py
python tests/cloudflare/google.py
```

Mevcut testler için `NAKGO_E2E_URL=http://127.0.0.1:8787/` ile
`python tests/e2e.py`; `NAKGO_AUTH_TEST_URL=http://127.0.0.1:8787/` ile
`python tests/auth_browser.py`. Python/Playwright kurulumu mevcut CI ile aynı.
Sınırlı Windows ortamında Wrangler durum/log dizinini `XDG_CONFIG_HOME` ve
`WRANGLER_LOG_PATH` ile yerel ignored `cloudflare/.wrangler/` altına taşıyın.
Telemetriyi `WRANGLER_SEND_METRICS=false` ile kapatabilirsiniz.

29 Ekim yerel sonuçları:

- `npm test`: 642/642; WhatsApp: 50/50; guard: 65/65.
- Workers Static Assets üzerinde genel tarayıcı: 407/407.
- Yönetici ve WhatsApp mevcut UI fixture'ları: 390/1280 px, hesap değişimi,
  XSS, tekrar gönderim, revizyon çatışması, boş/yetkisiz durumlar geçti.
- E-posta Auth: 6 ekran/tema senaryosu geçti. Cloudflare Google wrapper: 6
  senaryoda gerçek SDK PKCE, iptal/yeniden deneme, profil, yenileme ve çıkış geçti.
- Gerçek workerd: HMAC, webhook doğrulaması, yetkisiz worker, parser,
  boş RPC yanıtı, Cron başarı/hata/kapalı, Production reddi ve redirect güvenliği geçti.
- Statik dosya kontrolleri: kaynak/secret yolları 404, API 404,
  SW cache ve güvenlik başlıkları geçti. İzole npm audit: 0 açık.
- Build ve Wrangler dry-run geçti: 12 statik dosya, 32,56 KiB Worker
  (gzip 9,84 KiB). Dry-run uzak yayın değildir.

RPC yanıtları runtime ve tarayıcı testlerinde sentetiktir; bu sonuçlar yeni
Cloudflare hostunda gerçek DEV RLS/Google/Meta kabulü anlamına gelmez. PR #38'in
önceki gerçek DEV kabulü [WhatsApp rehberinde](whatsapp-review.md) ayrı kayıtlıdır.
Mevcut `auth_google_browser.py` birebir URL beklentisi SDK'nın `sb_flow_id`
eklemesi nedeniyle tek başına başarısızdır. Korumalı test değiştirilmedi;
yeni Cloudflare wrapper aynı origin/path ve yalnız geçerli 32 hex flow-id
kabul ederek diğer tüm PKCE/oturum/iptal/çıkış kontrollerini korur.

## Ücretsiz plan ve sınırlar

[Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
istekleri ücretsiz/sınırsız; yalnız `/api/*` Worker-first çalışır.
[Workers Free sınırları](https://developers.cloudflare.com/workers/platform/limits/):
100.000 dinamik istek/gün, 10 ms CPU, 128 MB bellek, 50 dış alt istek/çalıştırma,
hesap başına 5 Cron. Dakikalık tetik yaklaşık 1.440/gündür; diğer kullanım da
hesap kotasını paylaşır. Ağ bekleme CPU değildir; parser/JSON/HMAC CPU tüketir.
Yerel süre Free CPU uygunluğunu ispatlamaz. Gerçek DEV ölçümü özellikle büyük
mesaj ve 5 işlik batch için gerekli; sınır aşılırsa ücretli plana otomatik
geçilmez, tasarım/kapsam yeniden değerlendirilir. Ücretli hizmet başlatılmadı.
Pinlenen compatibility date `2026-10-23`, kurulu workerd sürümünün desteklediği
tarihtir. Daha ileri tarih verilmesi yerel runtime tarafından reddedildi.
[Pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## DEV yayını için kullanıcıdan gerekenler

Kullanıcı yalnız Cloudflare DEV yayınını açıkça onayladı; ilk yayın tamamlandı.
Aşağıdaki liste kurulum sırasıdır; 1 ve 2 tamamlandı, secret girişi bekleniyor:

1. Yalnız yeni `nakgo-app-dev` Worker'ının ücretsiz Workers planında `workers.dev`
   alt alanına DEV yayınına izin ver. `nakgo-website`, özel domain, canlı DNS,
   Vercel Production ve Supabase Production kapsam dışıdır.
2. Cloudflare CLI hesabını kullanıcı tarayıcıdan yetkilendirsin veya servis UI
   üzerinden sınırlı erişim sağlasın. Token/şifre sohbete yazılmaz. Account bilgisi
   doğrulanmadan deploy yapılmaz; bu dalda hesap ID'si sabitlenmemiştir.
3. Worker Settings > Variables and Secrets altında yalnız DEV için
   `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_WORKER_SECRET` secret olarak girilir. Son ikisi güçlü/rastgele,
   worker secret en az 32 karakter olmalı. Gerçek Meta app henüz yoksa Meta
   anahtarları yok sayılmaz: webhook kabulü bekler veya açıkça sentetik test yapılır.
   `SUPABASE_PUBLISHABLE_KEY` DEV public key'dir. Değerler Git'e/loga konmaz.
4. DEV Supabase Auth redirect allowlist'e yalnız atanmış `https://...workers.dev/`
   eklenir. Mevcut Vercel adresleri korunur. Google provider'ın Supabase callback'i
   değişmez. Production Auth ayarına dokunulmaz.
5. Önce `NAKGO_AUTH_ENABLED=true` ile yeni hostta gerçek DEV yönetici/normal
   kullanıcı sınırı, oturum ve ilan kabulü yapılır. İmzalı webhook→inbox→taslak
   akışı doğrulanır; sonra `WHATSAPP_CRON_ENABLED=true` ile gerçek tetik ve
   hata/lease yeniden deneme kabulü yapılır. Şimdilik iki flag de false.
6. Eski `tools/cloudflare-whatsapp-dev` harici Vercel çağıran scheduler aynı anda
   açılmaz. Bu Worker scheduled handler doğrudan kuyruğu işler; Vercel bypass
   secret istemez. Gerçek Meta akışı için [Meta kurulum rehberi](whatsapp-meta-dev-setup.md)
   izlenir; webhook URL yeni Worker'da `/api/whatsapp/webhook`, abonelik `messages`.

Request query'lerinde webhook verify token bulunabileceğinden observability
şimdilik kapalıdır. Kabul sırasında yalnız içerik/sır taşımayan sonuç ve sayaçlar
kaydedilir; ham request/body/token logging açılmaz.

## Geri dönüş

Vercel yolları ve deployment değiştirilmediği için mevcut Preview çalışmaya devam
eder. Yeni Worker testinden vazgeçilirse önce Cron flag'i kapatılır ve Cron
silinir; Meta callback tekrar önceki doğrulanmış test adresine alınır. DB rollback
ve DNS taşıması gerekmez. Yeni origin'deki tarayıcı oturumu Vercel oturumundan
ayrıdır. Bu dalı main'e almak veya Production'a taşımak ayrı karardır.

## 29 Ekim: ilk uzak DEV yayını

- URL: https://nakgo-app-dev.yagizyedek8.workers.dev/
- Kaynak: `3d75d80`; Cloudflare sürümü `d40f2048-bc80-4be0-97a0-e253f1dd88a0`.
- Hesabın Workers Free ($0) planı UI üzerinde doğrulandı; plan değişmedi.
- Yalnız `nakgo-app-dev` oluşturuldu. Kurumsal `nakgo-website`, Vercel Production,
  canlı DNS ve Supabase Production değiştirilmedi. PR #38 birleştirilmedi.
- Uzak HTTP kabulü: `/` ve `/sw.js` 200, auth config `{enabled:false}`;
  bilinmeyen API, server kaynak yolu ve `.env` 404. Anahtarsız webhook/worker 503.
- Cron her dakika tanımlı fakat `WHATSAPP_CRON_ENABLED=false`: DB işleme yok.
  Gerçek batch CPU ölçümü ve DEV RLS/Meta kabulü henüz yapılmadı.
- Wrangler OAuth cihaz akışıyla açıldı: user/account read, workers_scripts write,
  offline_access. DNS/ödeme yazma kapsamı alınmadı. Windows keyring kayıt girişimi
  erişim reddi verdi; standart oturum dosyası ignored `cloudflare/.wrangler/`
  altındadır. İçeriği loga/Git'e kopyalanmaz. Sonraki CLI çağrılarında aynı
  `XDG_CONFIG_HOME` kullanılmalıdır.
- DEV Worker Settings ekranındaki **Production** etiketi bu ayrı Worker'ın
  ana sürümünü ifade eder; NakGo Production uygulaması veya Supabase Production
  değildir. Hedef Worker adı ve DEV Supabase URL birlikte doğrulanmalıdır.
- `SUPABASE_SERVICE_ROLE_KEY` için Secret alanı kullanıcıya hazırlandı. Henüz
  bir Supabase/Meta gizli anahtarı alınmadı veya Cloudflare'a girilmedi.

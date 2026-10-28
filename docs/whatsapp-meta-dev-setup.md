# Meta WhatsApp DEV test bağlantısı — hazırlık

29 Ekim 2026. PR #38 draft kalır; main/Production değişmez. Kullanıcının
Cloudflare hesabı var; Meta geliştirici uygulaması ve test numarası henüz yok.
Gerçek Meta uçtan uca testi bu önkoşullar tamamlanmadan geçti sayılmaz.

## Hedef akış

Meta test numarası → imza doğrulayan DEV webhook → DEV Supabase özel kuyruk →
mevcut worker → taslak → mevcut DEV yöneticisinin WhatsApp paneli.
Mesaj almak otomatik yayın veya otomatik WhatsApp yanıtı oluşturmaz.

## Kullanıcının Meta hesabında izleyeceği sıra

1. https://developers.facebook.com/apps/ adresine kendi hesabınla gir.
   Gerekirse geliştirici kaydını, telefon/iki aşamalı doğrulamayı ve sözleşmeleri
   kendin tamamla; şifre, doğrulama kodu veya tokenı sohbete yazma.
2. Ayrı `NakGo DEV` uygulaması oluştur. WhatsApp Business Platform kullanım
   senaryosunu/ürününü seç. Ekran eski akış gösteriyorsa Business türü uygulamaya
   WhatsApp ürünü eklenir. Meta'nın gösterdiği gerekli işletme portföyünü seç;
   gerçek üretim numarasını taşıma veya mevcut canlı uygulamayı değiştirme.
3. WhatsApp API Setup / Getting Started bölümünde Meta'nın test numarasını
   hazırla. Kendi telefonunu izin verilen test alıcısı olarak ekleyip Meta'nın
   doğrulamasını tamamla. App ID, test WABA ID ve Phone Number ID'yi özel
   operasyon kaydında tut; bunlar App Secret veya erişim tokenıyla aynı şey değildir.
4. Uygulama ayarlarındaki App Secret'ı, yalnız DEV backend'in
   `META_APP_SECRET` gizli değişkenine gir. Vercel'de yalnız Preview +
   `codex/nakgo-whatsapp-ingestion` dalını seç. Var olan sentetik anahtar gerçek
   Meta imzasını doğrulayamaz. Kaydettikten sonra yalnız Preview yeniden dağıtılır.
5. Ayrı rastgele `WHATSAPP_VERIFY_TOKEN` değeri backend secret alanında ve
   Meta webhook doğrulama alanında aynı olmalı. Değeri URL örneğine, Git'e veya
   sohbete koyma. Worker secret ve App Secret birbirinden ayrıdır.
6. Aşağıdaki HTTPS erişim engeli çözüldükten sonra WhatsApp Configuration /
   Webhooks bölümüne onaylanan DEV callback adresini (`/api/whatsapp/webhook`)
   ve verify tokenı gir; Verify and save işlemini yap. Şu anki korumalı Preview
   adresini çalışır Meta callback'i diye kaydetme.
7. `whatsapp_business_account` nesnesinde `messages` alanına abone ol.
   Uygulamanın test WABA'ya aboneliğini de doğrula; gerekirse Meta'nın
   `/{WABA-ID}/subscribed_apps` işlemi kullanılır. Başka uygulamanın aboneliğini
   kaldırma, mevcut callback override'ını körlemesine değiştirme.
8. Meta panelinin test mesajını kendi izinli telefonuna gönderdikten sonra
   telefondan test numarasına aşağıdaki sentetik metinle cevap ver. Gerçek müşteri
   mesajı veya özel belge kullanma. Bu manuel ilk mesaj uygulamaya outbound API
   veya kalıcı outbound access token eklenmesini gerektirmez.

Örnek: `İzmir Ankara 18 ton sac tenteli yarın sabah NAKGO DEV TEST`

Meta menü adları hesap/arayüz sürümüne göre değişebilir. Bu oturumda Meta
hesabı görülmedi; kesin ekran düzeni iddia edilmez.

## HTTPS erişimi: çözülmesi gereken bağımlılık

Mevcut Vercel Preview Deployment Protection arkasında. Meta tarayıcı oturumu
veya paylaşım çerezi gönderemez. Cloudflare Cron da bu korumayı kendiliğinden
geçmez. Genel Vercel proje koruması kapatılmayacak; Production bypass anahtarı
ve query-string secret kullanılmayacak.

Gerçek callback seçilmeden önce DEV'e özel erişilebilir endpoint gerekir.
Seçenekler: sağlayıcı destekliyorsa yalnız webhook'a sınırlı izin; veya ayrı,
yalnız DEV bağlantılı ingress. Cloudflare ingress istenirse ham gövde HMAC,
128 KiB sınırı, timeout, sabit upstream, yanlış imzada yazmama ve replay kabulü
ayrıca test edilir. Bu hazırlık proxy/ingress kurmaz ve imza kontrolünü kaldırmaz.
Backend'i Cloudflare'e taşımak da bu küçük zamanlayıcı yapılandırması değildir:
mevcut parser katalog okuması Node dosya sistemine bağlıdır ve bundle uyumu
ayrıca sınanmalıdır. Platform göçü adına gereksiz refactor yapılmadı.

## Cloudflare Cron uygunluğu ve ayrı test yapılandırması

Cron Triggers, mevcut POST worker çağrısını dakikada bir tetiklemek için uygundur.
Kalıcı kuyruk ve lease/retry mantığı Supabase'de kalır; Cloudflare yalnız tetikler.
Yapılandırma: `tools/cloudflare-whatsapp-dev/wrangler.jsonc`.

- Ayrı worker adı: `nakgo-whatsapp-dev-scheduler`; public HTTP route yok.
- Varsayılan `SCHEDULER_ENABLED=false`; açıkça `NAKGO_ENV=dev` ister.
- Sabit, kabul edilmiş immutable DEV Preview hedefi kullanır. Production/çağıran
  tarafından verilen URL kabul etmez. Yeni Preview seçilirse sabit hedef,
  public config ve DEV bağlantısı incelenerek güncellenir.
- Secret göndermeden önce public config'te DEV Supabase ve etkin Auth kontrolü.
- Redirect/HTML/koruma ekranı/yanlış DB durumunda durur. Worker secret yalnız
  Authorization başlığında; Supabase anahtarı veya Meta App Secret istemez.
- HTTP 200 içindeki `failed>0` da zamanlayıcı hatası sayılır. Ağ sonucu belirsizse
  kör tekrar yapmaz; sonraki tetikleme mevcut DB lease/retry kurallarını izler.
- Payload/telefon/upstream gövdesi veya secret loglanmaz.

Yerel Node testleri: `node --test tests/whatsapp/scheduler.test.cjs` (4 test).
Bu sonuç gerçek Cloudflare runtime veya kalıcı Cron kabulü değildir. Wrangler
kurulup Cloudflare hesabı yetkilendirilmeden deploy yapılmadı.

Erişim yolu çözüldükten sonra repo kökünden uygulanacak operasyon sırası:

```sh
npx wrangler login
npx wrangler deploy --dry-run --config tools/cloudflare-whatsapp-dev/wrangler.jsonc
npx wrangler secret put WHATSAPP_WORKER_SECRET --config tools/cloudflare-whatsapp-dev/wrangler.jsonc
npx wrangler deploy --config tools/cloudflare-whatsapp-dev/wrangler.jsonc
```

Resmî Wrangler paketini kullan; hesap/planı kontrol et. Secret interaktif girilir,
komut satırında değeri yazılmaz. İlk deploy kapalı kalır. Public config/DEV worker
ulaşılabilirliği kanıtlandıktan sonra `SCHEDULER_ENABLED=true` ile yalnız bu worker
tekrar dağıtılır. Cron değişikliği yayılımı anlık olmayabilir. İlk iki gerçek
Cron olayının başarılı olduğunu ve kuyruk işlediğini kontrol et. Durdurmak için
bayrağı false yapıp dağıt; tamamen kaldırmak için cron dizisini boşaltıp dağıt.
Kuyruk veya kayıtları silme. Plan limitleri/hesap izinleri bu oturumda incelenmedi.

## Gerçek mesaj kabul kontrol listesi

- Callback GET doğrulaması başarılı; yanlış token reddediliyor.
- `messages` alanı ve doğru test WABA aboneliği mevcut.
- Telefondan gönderilen tek test mesajı DEV kaynağında bir kez oluşuyor.
- Meta imzasız/yanlış imzalı istek yazma yapmıyor; ham metin değişmiyor.
- Gerçek Cron çağrısı kuyruğu işler; retry/failed sayıları kontrol edilir.
- DEV yönetici panelinde kaynak ve ayrıştırılmış taslak birlikte görünüyor.
- Gerekli alanlar insan tarafından kontrol edilir; otomatik yayın oluşmuyor.
- Normal kullanıcı/anon erişimi kapalı; Production main/env/migration değişmedi.

Mesaj gövdesi, telefon, secret veya tokenı CI/PR kanıtına ekleme. Güvenli kanıt:
zaman, başarılı HTTP kodu, kuyruk/taslak sayısı ve maskelenmiş panel görüntüsü.

## Resmî kaynaklar

- [Meta başlangıç](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Meta webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- [Meta WABA aboneliği API koleksiyonu](https://www.postman.com/meta/whatsapp-business-platform/request/0yubu4i/subscribe-app-to-whatsapp-business-account)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

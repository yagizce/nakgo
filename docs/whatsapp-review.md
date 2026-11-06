# WhatsApp ilan toplama ve yönetim — V2 DEV kabulü

28 Ekim 2026. `codex/nakgo-whatsapp-ingestion` GitHub dalı ve draft [PR #38](https://github.com/yagizce/nakgo/pull/38) yayımlandı.
Vercel Preview yalnız DEV Supabase kullanır. `20261028020000_whatsapp_review`
DEV'e transaction denemesi sonrası uygulanıp ledger'a kaydedildi. Eski eksik ledger
kayıtları yeniden uygulanmadı. Production migration/deploy ve main birleştirmesi yapılmadı.

## Akış

`POST /api/whatsapp/webhook` ham gövdenin Meta imzasını doğrular, metin mesajlarını
tek transaction ile özel gelen kutusuna yazar. Yalnız başarılı commit sonrası
200 döner; depolama hatasında 503 ile yeniden teslim ister. Mesaj kimliği unique;
aynı mesaj tekrarında kaynak değiştirilmez. Görsel/ses/status olayları işlenmez.
128 KiB istek ve 4096 karakter metin sınırları V1 ile aynıdır.

Ayrı `POST /api/whatsapp/worker` Bearer secret ister. Veritabanı kuyruğundan
`FOR UPDATE SKIP LOCKED` ile bir iş kiralar; iki dakikalık lease ve rastgele lease
kimliği eski worker'ın yazmasını engeller. Bir çağrı en fazla beş mesaj işler.
Taslakların tamamı ve işin bitişi aynı transaction içindedir. Başarısız iş artan
gecikmeyle sekiz kez denenir; sonra yönetici tekrar sıraya alabilir. Süresi dolan
son deneme de panelde hata sayılır. Hiçbir işlem otomatik ilan yayımlamaz.
Worker çağrılmadan kuyruk ilerlemez; zamanlayıcı kurulumu aşağıdaki aktivasyonun
zorunlu parçasıdır. Kuyruk PostgreSQL'de olduğundan process/redeploy kaybına bağlı
değildir. Ücretli kuyruk servisi veya yeni runtime bağımlılığı eklenmedi.

## Parser ve veri doğruluğu

V1 saf parser/sözleşmeleri korunur. `review-parser.cjs` ayrı, deterministik inceleme
adayları üretir; AI bağlantısı yoktur. `analyze` ileride adaptör için sınırdır.
81 il mevcut `src/js/config.js` kaynağından gelir. Sınırlı ilçe sözlüğü Tuzla,
Derince, Gazipaşa, Korkuteli ve Serik ile genişletilmiştir. Maraş/Antep/Urfa/İst/Ank
ve birkaç açık yazım varyantı desteklenir; Türkiye'nin tüm ilçeleri ve her yazım
hatası tanınmış sayılmaz. Tanınmayan bilgi kaynakta kalır ve yönetici tamamlar.

Çok satırlı güzergâhlar ayrı taslak; `yükleme` sonrası `+` duraklar tek ilanın
çoklu teslimatıdır. İlan türü yalnız açık ipuçlarıyla belirlenir. Belirsiz tür ve
tek nokta güzergâhı tamamlanmaz. `0-15 ton` için kesin tonaj uydurulmaz; yönetici
miktarı girer. Güven skoru yayın yetkisi değildir. Kaynakta 30'dan fazla bölüm
varsa ilk 30 aday ve `message_overflow_review` işareti üretilir; tam kaynak
korunur, kalan bölümler manuel inceleme gerektirir. Gönderen telefon numarası
otomatik ilan irtibatı sayılmaz; mesajdaki ortak telefon/firma adayları ayrıdır.

Benzerlik; gönderen bağımsız normalize fingerprint veya aynı tür/ilk güzergâh
adaylarıdır. Yanlış pozitif olabilir. Silme/birleştirme/otomatik ret yapılmaz.
İnceleme işaretleri ilk ayrıştırmanın kaydıdır; düzenleme sonrası kendiliğinden
silinmez veya onaylanmış gibi gösterilmez.

## Yönetici ve yayın

Mevcut Profil → Yönetici paneli → WhatsApp ilanları. Mevcut tek genel yönetici
kullanılır; yeni rol, ortak üyeliği veya belge yetkisi verilmez. Tüm RPC'ler
sunucuda rolü yeniden denetler; normal ve anonim hesaplar erişemez.

Kaynak salt okunur, alanlar düzenlenebilir. İl/ilçe `İstanbul | Tuzla`, çoklu
noktalar ayrı satırlardır. Özel alanlarla yayımlanacak açıklama ayrıdır. Liste,
inceleme, kaydet, yayın, ret, kaldırma ve yayımdaki ilanı yeniden onaylayarak
düzenleme desteklenir. JSON/audit görüntüsü metin olarak kaçışlanır. Fotoğraf
alımı bu metin webhook'unun kapsamına girmez; kaynak medya indirilmez.

İzin/hukuki dayanak kaydı olmadan server yayın yapmaz. Yönetici yayımlanacak
alanları ve çoklu teslimatların/şartların açıklamaya aktarımını kontrol eder.
İletişim telefonu, şirket ve orijinal metin otomatik public ilana kopyalanmaz.
İlanın sahibi işlemi yapan NakGo ilan masası hesabıdır; uygulama mesaj/talepleri
bu hesaba gelir, WhatsApp gönderenine doğrudan yönlendirme yapılmaz.
Mevcut public model ilk teslimat şehrini kullanır; diğer noktalar onaylı public
notta anlatılır, filtrelerin çok duraklı olduğu iddia edilmez.

Yük tarihi mevcut zorunlu serbest metindir (32 karakter); boş araç takvim
kuralları korunur. DB mevcut araç/kasa/şehir/kalem/fotoğraf kontrollerini kullanır.
Yayımdaki düzenlemeler yeniden izin kaydıyla onaylanır. Tür değişiminde eski
ilan kimliği değiştirilmez; eski ilan kapanır, yeni ilan açılır. Mevcut iş/mesaj
geçmişi eski ilanda kalır. Normal ilan düzenleme yolu WhatsApp bağlantılı kaydı
atlayamaz. Genel moderasyon engeli korunur.

Her başarılı değişiklik actor/time ve eski/yeni kayıt ile audit edilir.
Revizyon çakışması ya da belirsiz ağ sonucu otomatik tekrar yayınlamaz; ekran
kaydın güncel halini yükletir. Hesap/ekran değişince geç cevaplar çizilmez.

## Saklama ve operasyon

- Kaynak gövdesi ve gönderen: 30 gün; sonra worker purge ile silinir.
- Taslağın kaynak açıklaması, özel telefon/firma kopyası: 30 gün.
- Yayımlanmayan taslak içeriği: son değişiklikten 90 gün sonra silinir.
- Ayrıntılı audit eski/yeni içerikleri: 90 gün; actor/action/time kalır.
- Yayındaki onaylı ilan alanları ve hukuki dayanak: ilan yönetimi süresince kalır.
- Minimal mesaj kimliği/id/status tombstone tekrar teslim güvenliği için kalır.

Bu teknik varsayılan ürün sahibince gerçek veri toplamadan önce onaylanmalıdır;
hukuki uygunluk garantisi değildir. Tüm kişisel verilerin loglardan ve statik
çıktıdan uzak tutulması gerekir. Özel SQL şeması RLS açık, tablo grant'ları kapalıdır.
Service-role anahtarı yalnız backend'de tutulur. DB yöneticisinin ayrıcalıklı
SQL erişimi immutable kaynak kuralının güven sınırı dışındadır.

## Yerel doğrulama

```sh
npm test
npm run whatsapp:test
node tests/whatsapp/database.cjs
node tools/admin-db-check.cjs
python tests/whatsapp/browser.py
python tests/admin_panel_browser.py
npm run build:vercel
```

PostgreSQL fixture isteğe bağlı mevcut `@electric-sql/pglite` kurulumunu NODE_PATH
ile kullanır; proje bağımlılığı eklemez. Browser fixture Playwright/Chromium ister.
Testler sentetiktir, Meta anahtarı/gerçek telefon/Supabase bağlantısı istemez.
PGlite gerçek çok bağlantılı Supabase kabulünün yerine geçmez.

## Meta test bağlantısı — kalan manuel işlemler

1. Meta Business hesabı, geliştirici uygulaması, WhatsApp Business hesabı ve
   NakGo özel sohbet numarası hazırlanır. Grup okuma veya WhatsApp Web yoktur.
2. DEV migration ve gerçek rol/RLS/yeniden teslim kabulü tamamlandı. Yeniden migration
   çalıştırmayın. Rollback için ingress/worker kapatılır; tablolara yıkıcı down migration uygulanmaz.
3. Backend ortamına `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, en az 32 karakterlik ayrı
   `WHATSAPP_WORKER_SECRET` tanımlanır. Hiçbirini sohbete veya Git'e yazmayın.
   Preview/Development yalnız DEV, Production yalnız mevcut PROD projesini kabul eder.
4. DEV test numarası için Meta callback `<onaylı-host>/api/whatsapp/webhook`
   ve verify token ile doğrulanır; `messages` aboneliği etkinleştirilir.
5. Güvenilir zamanlayıcı her dakika worker endpoint'ine Bearer secret ile POST
   yapacak şekilde kurulur. Secret URL/query'ye konmaz. Bu depoda otomatik cron
   etkinleştirilmedi. Yanıt başarısızlığı ve bekleyen/başarısız iş sayıları izlenir.
6. Sentetik iki mesaj, duplicate teslim ve DB/worker kesintisi provası yapılır;
   taslak→düzenle→yayın→kaldırma ve normal hesabın erişim reddi doğrulanır.
7. Production bağlantısı/yayını ayrıca onaylanır; PR draft kalır ve main'e alınmaz.

Preview env değişkenleri yalnız bu dala sınırlandı. `META_APP_SECRET` şu anda
sentetik imza test anahtarıdır; Meta uygulamasının gerçek App Secret değeri
servisin gizli değişken ekranından girilmeli ve Preview yeniden dağıtılmalıdır.
Secret hiçbir zaman frontend/env çıktısına veya Git'e konmaz. Yeni `sb_secret_*`
Supabase anahtarları `apikey` başlığında kullanılır; JWT Bearer gibi gönderilmez.

Vercel Deployment Protection açık kaldı. Meta callback insan oturum çerezi
kullanamaz: test için erişilebilir HTTPS endpoint veya yalnız ilgili endpoint
için uygun koruma yapılandırması gerekir. Genel proje korumasını kapatmayın.
Vercel Cron Preview'da çalışmaz; worker POST ister. Bu kabulde 30 saniye arayla
iki sınırlı dış çağrı denendi; kalıcı zamanlayıcı kurulmadı. Kullanıcı testlerden
sonra Cloudflare'e geçmeyi düşünüyor; geçiş başlatılmadı. Seçilen ortamda
secret başlığıyla POST yapan sürekli zamanlayıcı ayrıca kurulup doğrulanmalıdır.

Alım için giden mesaj API'si çağrılmıyor; outbound access token veya otomatik
WhatsApp cevabı bu sürüme eklenmedi. Meta ekranları değişebilir; kurulum sırasında
[resmî webhook rehberi](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
kontrol edilmelidir. İmza/handshake davranışı için ayrıca Meta'nın
[resmî örneği](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
referanstır; arşivlenmiş SDK projeye bağımlılık olarak eklenmedi.

## Tamamlanan doğrulama ve açık sınırlar

- Mevcut uygulama: npm test 640/640; Chromium E2E 407/407.
- WhatsApp parser/webhook/worker: 46 test; ayrı PGlite suite 42 kontrol.
- Mevcut SQL: 45 yönetim + 15 Storage ve 11 rollback fixture.
- Panel: 390/1280 px, açık/koyu, XSS, düzenleme, onay, ret/kaldırma,
  çift gönderim, revizyon hatası ve hesap değişimi kontrolleri geçti.
- Guard 65/65, gate 16/16, build başarılı. Uygulama SHA `b7dd511` için
  GitHub verify, quality-gate ve admin-regression başarılı.
- Gerçek DEV: `tests/whatsapp/live-dev.sql` service_role ingest/duplicate/finish;
  normal/anon okuma-yazma reddi; mevcut admin edit/consent/stale revision/
  publish/withdraw/audit; normal ilan yolu ile bypass reddini rollback ile doğruladı.
- `tests/whatsapp/live-dev-queue.sql`: aktif lease tekrar alınamaz; hata sonrası
  backoff; expired lease kurtarma; stale worker reddi; sekiz deneme sınırı ve
  mevcut yöneticinin tekrar kuyruğa alması. Tamamı gerçek DEV'de rollback ile geçti.
  Bu SQL testleri eşzamanlı iki worker stres testi değildir.
- Gerçek Preview HTTP: imzasız webhook ve secretsiz worker 401; imzalı alım ve
  duplicate 200; yeni kaynağı worker `completed:1,failed:0` işledi. İki sınırlı
  zamanlanmış boş kuyruk çağrısı 200 ve sıfır iş döndürdü; handshake geçti.
- Gerçek yönetici oturumunda sentetik taslak kaydedildi, onaysız yayın engellendi,
  onaylı yayın ve ardından kaldırma doğrulandı. Gerçek ilan/veri kullanılmadı.
- DEV üyelikleri değişmedi: tek genel yönetici ve ayrı mevcut belge inceleyicisi.
  Ortak hesaplar mevcut modelde WhatsApp panelini kullanamaz. Çok ortaklı yetki
  ayrı tasarım/onay gerektirir; test hesabına veya başka hesaba yetki verilmedi.

Gerçek HTTP kabulünde iki uyumluluk hatası düzeltildi: yeni Supabase secret key
JWT Bearer olarak gönderilmiyor; başarılı boş/204 PostgREST yanıtı JSON hatası
üretmiyor. Önceki worker gerçekte işi bitirdiği halde 503 raporlayabiliyordu.
Regresyon testleri bu iki durumu kapsar. Mimari ve parser davranışı değiştirilmedi.

### Ayrıştırma ölçümü

`node tests/whatsapp/accuracy.cjs`: 24 etiketli, gerçekçi fakat sentetik Türkçe
mesaj. Mesaj sayısı ve ilk taslağın seçili alanlarında tam eşleşme ölçülür;
gerçek trafik başarısı, tüm taslaklar veya tüm alanlar için genellenemez.

| Ölçüt | Tam eşleşme |
| --- | --- |
| Taslak sayısı | 23/24 (%95,8) |
| İlan türü | 24/24 (%100) |
| Çıkış ili | 22/24 (%91,7) |
| Varış ili | 20/24 (%83,3) |
| Üst tonaj | 23/24 (%95,8) |

Bilinen eksikler: ters sözcük sırası (`Ankara'ya İzmir'den`), iki satırda tek
güzergâh, `İzmr` yazımı ve `Çorlu Tekirdağ İstanbul` ilçe/il sıralaması.
Ayrı başlık satırı fazladan belirsiz taslak üretebilir. Bunlar bu doğrulamada
ölçüldü, yeni parser geliştirmesi yapılmadı. Kaynak ve zorunlu insan incelemesi
korunur; otomatik yayın veya hatasız ayrıştırma iddiası yoktur.

29 Ekim hazırlığı: [Meta test bağlantısı ve ayrı DEV Cron yapılandırması](whatsapp-meta-dev-setup.md). Zamanlayıcı kapalıdır; gerçek Meta kabulü henüz yapılmadı.

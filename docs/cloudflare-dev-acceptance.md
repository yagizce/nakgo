# Cloudflare DEV kabulü — 4 Kasım 2026

Durum: **kısmen hazır; Production geçişi önerilmiyor**. PR #38 ve #39 Draft kalır.
Yalnız nakgo-app-dev ve Supabase axkotffqrsddbrazhcwj kullanıldı. Main, Production,
Vercel yayını, DNS, roller ve şema değiştirilmedi.

## Gerçek HTTP güvenlik kabulü

Normal DEV hesabının mevcut oturumuyla, aynı hostta geçici bir kabul sayfasından
35/35 kontrol geçti. Oturum yalnız tarayıcı belleğinde kullanıldı; JWT, yanıt
içerikleri ve özel dosyalar rapora/loga/Git'e çıkarılmadı.
- Admin ve belge inceleyici rolü: 200/false.
- Admin page/moderate; WhatsApp page/detail/change/retry/ingest/claim/finish/fail/purge;
  belge review/reserve/finalize/remove/transition: 403.
- Olmayan negatif görüşme/iş kimliklerinde send_message 400, read_conversation ve
  transition_transport 403. Bunlar gerçek başka hesaba ait nesneyle IDOR kanıtı değildir.
- Başka kullanıcı filtresiyle profiles, listing_favorites, carrier_applications,
  carrier_document_files, listing_conversations ve transport_jobs: 200/boş dizi.
  RLS'nin boş sonuç döndürmesi beklenir; her özel sorgunun 403 vermesi gerekmez.
- Normal JWT ile Cloudflare worker: 401; sunucu/secret kaynak yolları: 404.
- Mevcut kendi özel dosyası: authenticated 200, anonymous 400; gövde okunmadı.
  Storage kök listesi yalnız oturum sahibinin klasörünü gösterdi.

**Kalan sınır:** DEV'de normal test hesabı dışında hazır ve Storage nesnesi bulunan
belge sayısı 0. Dolayısıyla mevcut yabancı dosyaya doğrudan indirme/signed URL ve
yazma girişimi doğrulanmadı. Bilinmeyen/gerçek dosya oluşturulmadı veya değiştirilmedi.
Mesaj gövdeleri ve bütün owner RPC'leri için iki kontrollü hesaplı, gerçek mevcut
nesne matrisi hâlâ gereklidir. 35 kontrol tam özel API envanteri kapsamı değildir.

## Gerçek hata, backoff ve retry

Kuyruk boşken yalnız bir sentetik kaynak null metinle eklendi. Cron parser hatası
sonrasında kaydı pending/attempts=1 durumuna aldı; kalan retry süresi 35 saniye
ölçüldü, taslak sayısı 0 idi. Bekleme sırasında iki HTTP worker 200 ve 0/0 döndü.
Yalnız sentetik metin düzeltildi, next_attempt değiştirilmedi. Doğal Cron retry
sonrasında done/attempts=2, tam bir taslak ve sıfır yayımlanmış ilan doğrulandı.
Dakika sınırına zamanlanan iki HTTP worker yine 0/0 döndü (wall 990/910 ms).
Cron ile HTTP aynı dönemde etkin olsa da aynı milisaniyede DB claim çakışması
trace edilmedi; kesin eşzamanlı Cron yarış testi diye sunulmaz.

Gerçek DEV PostgreSQL transaction/rollback içinde üç ek kontrol geçti:
sekizinci hatada failed ve 60 dakika backoff tavanı; stale lease completion reddi;
terminal kaydın claim dışında kalması. Transaction tamamen geri alındı.
Önceki beş mesaj duplicate + iki eşzamanlı HTTP worker kabulü 29 Ekim'de geçti.

Veri kaybı: bu deneyde kaynak kaybolmadı, retry tek taslak üretti ve otomatik ilan
yayını olmadı. Kalıcı kesintide sekizinci denemeden sonra yönetici retry gerekir.
Mevcut retention 30 gün sonra kaynak metnini temizler; uzun süre işlenmeyen kuyruk
için alarm/operasyon müdahalesi şarttır. Her kesinti koşulunda sıfır kayıp garantisi yok.

## Temizlik

Yalnız daha önce kaydedilmiş altı sentetik message_id ve bu turun tek retry kaydı
transaction içinde silindi; bağlı taslak/audit hedefleri bu yedi kaynakla sınırlandı.
Kaynak sayısı ve yayımlanmamış taslak şartı kontrol edildi. Sonuç: 0 test kaynağı,
2 diğer kaynak korundu; diğer kaynakların satır hash'leri değişmedi.
Gerçek kullanıcı ilanı, mesajı, belgesi ve bilinmeyen kaynaklar silinmedi.
Geçici rollback fixture kalıcı değildi. Bu tur yeni imza anahtarı oluşturulmadı.

Geçici kabul sayfası kaldırıldı: /dev-acceptance HTTP 404; /api/auth/config 200.
Asıl repo build'i yeniden DEV'e yayımlandı:
577686f1-6023-4ad0-8edb-2acd5545a1b2. Ürün kodu değişmedi.
Kabul HTML'i yalnız yerel outputs dizininde; dağıtım veya Git dosyası değildir.

## CPU ve hata değerlendirmesi

4 Kasım son 24 saat dashboard: CPU P50 1.67/P90 2.77/P99 3.55 ms,
wall P50 732 ms/P99 yaklaşık 2 s; bellek P99 2.37 MB.
CPU limit aşımı 0, bellek aşımı 0, uncaught exception 2.
CPU grafiğinin bir zaman dilimindeki P99 değeri 19.673 ms: toplam P99 bunu
gizleyebilir. Bir hata sentetik parser hatasıyla uyumlu; eski sürümdeki diğer
hatanın nedeni çağrı kaydı olmadan kesinleştirilmedi. İki hatayı da test kaynaklı
saymak veya CPU güvenliğini yalnız toplam P99 ile onaylamak doğru değildir.
Request bazlı trace yok; metrikler kontrollü batch'e özel değildir.

[Cloudflare sınırları](https://developers.cloudflare.com/workers/platform/limits/)
yeniden kontrol edildi. Ücretsiz planda CPU bütçesi ve günlük kota gözetilmeli.
Ücretli plan/limit açılmadı. Sonraki karar: sır içermeyen çağrı bazlı ölçümle
19.673 ms örneğini ayırmak; gerekirse yalnız Cloudflare batch'ini 5'ten 2'ye
düşürüp yoğun mesaj testini tekrarlamak. Ortak mimari bu tur değiştirilmedi.

## Teslim ve canlı geçiş ön koşulları

Build ve DEV yeniden dağıtımı başarılı, mevcut asıl kaynak ağacı korunuyor.
29 Ekim test kanıtı: 646 birim, 50 WhatsApp, 65 guard, 42 izole PostgreSQL;
PR #39 önceki head'inde iki CI başarılı. Bunlar 4 Kasım yeniden çalıştırıldı diye
sunulmaz; bu tur ürün kodu değişmedi.

Canlıya hazır sonucu için:
1. İkinci kontrollü kullanıcıya ait mevcut özel dosya/mesaj nesneleriyle tam IDOR matrisi.
2. Kesin Cron/HTTP overlap kanıtı ve çağrı bazlı CPU, açıklanmamış hata teşhisi.
3. Kuyruk birikmesi/failed/retention için izleme ve müdahale sorumluluğu.
4. Ayrı Production onayı, yapılandırma ve geri dönüş planı.

## Meta bağlantısı için kullanıcı adımları

Meta kısıtlaması kalkınca Developers uygulamasına WhatsApp ürünü/test numarası
eklenir. DEV callback:
https://nakgo-app-dev.yagizyedek8.workers.dev/api/whatsapp/webhook
Verify token ve uygulamanın App Secret değeri yalnız nakgo-app-dev gizli ayarlarına
girilir; sohbete veya Git'e yazılmaz. Webhook doğrulaması tamamlanıp messages
aboneliği açılır, gerekiyorsa WhatsApp Business Account uygulamaya abone edilir.
İzinli test göndereni Meta ekranında doğruladıktan sonra gerçek mesaj -> webhook ->
kuyruk -> taslak -> yetkili panel kabulü ayrı çalıştırılır. Test mesajı için açık
kapsam olmadan gerçek gönderim yapılmaz; otomatik yayın kapalı kalır.

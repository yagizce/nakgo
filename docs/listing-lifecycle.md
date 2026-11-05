# İlan yaşam döngüsü ve doğrudan iletişim — yerel teslim

Tarih: 4 Kasım 2026. Dal: `codex/nakgo-listing-lifecycle`.
Temel: PR #39 Cloudflare DEV dalı, uzak `6b8d4ca`.
Yerel eşdeğer temel bu commit üzerine taşındı; PR #38/#39 değiştirilmedi.

Bu dal yalnız geliştirme ve yerel test içerir. Uzak DEV dahil migration/deploy,
main, Production, DNS ve Draft PR #38/#39 değiştirilmedi. Bu belge yayın izni değildir.

## Davranış

- Manuel ilan, geçerli Türkiye telefonu ve açık yayınlama yetkisi/izin beyanıyla
  doğrudan yayımlanır. Yükleme metni zorunlu serbest metin olarak kalır; Not ve ekler
  geçişi bu metin, telefon veya izin nedeniyle engellenmez. Son yayınlama kontrol edilir.
- Yayın zamanı veritabanınca atanır; bitiş tam altı saat sonradır. İstemci süreyi
  uzatamaz. Kapanan veya süresi dolan ilanın yeniden yayını telefon ve izin doğrulaması
  ister. Kartlar kalan dakikayı gösterir; açık sekme en yakın bitişte yenilenir.
- RLS, iletişim RPC, yeni taşıma talebi ve favoriye ekleme süresi dolan ilanı reddeder.
  İlan sahibi kendi kaydını yönetmek için okuyabilir; genel listede görünmez.
- Cron her çalışmada en fazla 100 bitmiş ilanı kilitleyerek arşivler; tekrar çağrı
  ikinci denetim kaydı oluşturmaz. Cron gecikse de RLS görünürlüğü süre bitiminde keser.
  Askıya alınmış sahibin ilanı da arşivlenebilir. İlan/iş/mesaj geçmişi fiziksel silinmez.
- İletişim yalnız Ara ve WhatsApp; aynı normalize `+90` numarası kullanılır.
  Liste ve detayda kişi/firma adı gösterilmez. Hesap sahibinin kendi profili ve
  yetkili yönetici ekranlarındaki kimlik bilgileri korunur.
- Mesajlaşma ve karşılaştırma ekranları, çağrı noktaları ve kullanılmayan stiller
  kaldırıldı. Eski mesaj tabloları korunur; authenticated/anon tablo ve RPC erişimleri
  kapatılır. Yerel eski sohbet verileri kurtarma/geri dönüş amacıyla saklanır, UI yoktur.

## WhatsApp izin modeli

Kullanıcının kabul ettiği model: yönetici tarafından belgelenmiş, **tek Meta mesaj
kimliği + mesaj gövdesindeki tek iletişim telefonu** için izin kaydı.

Yönetici paneli → WhatsApp ilanları → Mesaj için yayın izni kaydet / geri al.
Mesaj kimliği, normalize telefon, dayanak/kanıt referansı, bitiş ve aktiflik girilir.
İzin bitişi en fazla 30 gün ileride olabilir. Otomatik yayın anında en az altı saat
geçerli olmalıdır. Kaydı oluşturan hesap hâlâ sunucudan yönetici olarak doğrulanmalıdır.
İzin kaydı ve kuyruk tamamlama aynı mesaj için advisory lock ile sıralanır.

Worker tamamladığında veya izin sonradan kaydedildiğinde yalnız eksiksiz,
belirsizlik işareti olmayan, güveni 1 olan, tek hedefli ve izin telefonuyla eşleşen
adaylar yayımlanır. İleten numarası hiçbir zaman iletişim numarası olmaz.
Firma/kişi adı gerekmez; ham mesaj, firma ve özel şart metni otomatik kamu alanına
kopyalanmaz. Özel şart, birden çok araç/telefon/hedef veya belirsiz zaman incelemede
kalır. Boş araç için kesin ve geçerli takvim tarihi gerekir; `bugün` ifadesinden tarih
uydurulmaz. Yönetici gerektiğinde mevcut düzenle/yayımla/kaldır akışını kullanabilir.
İzin geri alımı ilgili yayımlanmış taslakları kapatır. Normal kullanıcı izin veremez.
Uygun aday için izin kaydı dışında ikinci bir Yayınla onayı gerekmez. Ancak izin
mesaj bazlıdır: yeni Meta mesajı kendi belgelenmiş iznini gerektirir; numara veya
kaynak için sınırsız genel izin yoktur. Mesajdaki “paylaşılabilir” ifadesi yeterli değildir.

## Migration ve birlikte dağıtım

Yeni dosya: `supabase/migrations/20261104010000_listing_lifecycle.sql`.
**Hiçbir uzak veritabanına uygulanmadı.** İsim sütunu SELECT yetkisi ve mesajlaşma
sözleşmesi değiştiğinden eski PR #38/#39 istemcileriyle ortak DEV'e tek başına uygulanmaz.
İleride ayrı/izole DEV veya planlı eşleşen istemci + worker + migration geçişi gerekir.

Eski kayıtlara varsayımsal telefon veya izin eklenmez. Eski ilanlar silinmez;
izinli telefonları olmadığında kamuya açık akışta görünmez. Yeniden yayın için
ilan sahibi telefon ve izni doğrular. Bu bilinçli bir veri gizliliği kararıdır.
Migration geri dönüşü yeni veri sütunlarını silerek yapılmamalıdır; eski istemciye
geçişten önce izin/RPC sözleşmesi ve korunacak yeni kayıtlar ayrıca incelenmelidir.

## Doğrulama ve sınırlamalar

- `npm test`: **630/630**. Önceki tek başarısız HTTP kontrolü aynı uygulama
  koduyla ağ erişimi sağlanan ortamda geçti; `connect EACCES 127.0.0.1` ortam kaynaklıydı.
- Yeni yaşam döngüsü PostgreSQL/PGlite: **54 kontrol geçti**.
  Telefon, izin, altı saat, isim sütunu erişimi, mesaj API reddi, izinli otomatik
  yayın, eksik/belirsiz aday engeli, izin geri alma, expiry RLS/RPC, askıya alınmış
  sahibin arşivlenmesi ve denetim kaydı kapsanır. Hem manuel hem izinli WhatsApp
  ilanı için tam 6 saat, Cron öncesi RLS görünmezliği, iletişim/favori/taşıma reddi,
  arşivleme, tekrar Cron'da sıfır işlem ve geçmişin korunması doğrulandı.
- Yönetici regresyonu: **47**, özel Storage bağlamı: **15 kontrol geçti**.
  **11 SQL fixture** başarılı; her rollback sonrası kayıt sayıları değişmedi.
- Mevcut WhatsApp PostgreSQL/PGlite: **42 kontrol geçti**.
- WhatsApp + yeni telefon/ayrıştırma testleri: **53/53**.
- Bağımsız statik kontroller: **52/52**; HTML: **0 hata**.
- Kalite kapısı kontrol mekanizması testleri: **16/16**.
- `node tools/cloudflare-build.cjs`: başarılı (uygulama ve Worker çıktısı).
- Cloudflare workerd/HTTP testi başarılı: yöntem/kimlik/HMAC kontrolleri,
  DEV hedef sınırlaması, sır izolasyonu, Cron başarı/hata/kapalı senaryoları.
  Bu testin veritabanı yanıtları sentetiktir, gerçek Supabase değildir.
- Chromium E2E: **397/397**. Kalite kapısı tarayıcısı: **198 kontrol, 11 senaryo**.
- Yaşam döngüsü tarayıcı testi 390/1280 px geçti: telefon/izin zorunluluğu,
  Ara/WhatsApp, ad gizleme, süre dolumu, kaldırılan mesaj/karşılaştırma ve
  yönetici izin kaydet/geri al formu (sentetik RPC, çift tıklama koruması).
- Mevcut yönetici ve WhatsApp tarayıcı regresyonları geçti; XSS, eski yanıt,
  çatışma ve hesap değişimi kontrolleri korunur.
- Yerel Wrangler Workers + Static Assets üzerinde aynı yönetici/WhatsApp
  tarayıcı senaryoları da geçti. HTTP statik kabulü: kanonik URL, özel kaynak ve
  sır yollarına 404, bilinmeyen API'ye 404, SW önbellek ve güvenlik başlıkları geçti.
- `tests/guard.js`: korumalı test/kaynak yükleme sırası değişiklikleri nedeniyle
  başarısız; beklenen insan incelemesi gereklidir. Guard/workflow/bypass ayarı
  değiştirilmedi. Yeni ürün kuralları için test bakımı ayrı commit olarak sunulur.
- Gerçek Supabase HTTP/RLS, gerçek cihaz, gerçek Cron eşzamanlılığı, Meta bağlantısı
  veya Production kabulü bu yerel testlerin sonucu olarak iddia edilmez.

## Korumalı test değişikliklerinin incelemesi

Eski mesaj gönderme/okuma başarı testlerinin yerini kaldırılmış istemci API'si ve
SQL erişim reddi kontrolleri aldı; geçmiş tabloların korunması ayrıca sınanır.
Karşılaştırma ve Premium iletişim beklentileri yeni ürün sözleşmesiyle değiştirildi.
Form fixture'larına telefon ve açık izin eklendi; böylece negatif miktar, boş tarih,
XSS ve depolama hatası testleri amaçladıkları doğrulamaya ulaşır. Profil telefonu
değişince ilan telefonu sessizce değişmez. `tools/project.js` yalnız kaldırılmış
mesaj modülünü yükleme listesinden çıkarır. Guard ve CI workflow'larında değişiklik
yoktur; korumalı dosya kapısı insan incelemesi beklediğinden başarılı sayılmamıştır.

## Sonraki kabul

1. Korumalı test sözleşmesi değişikliklerini ayrı incele; kalite kapısını atlama.
2. Ayrı Draft PR'da CI sonuçlarını incele; PR #38/#39 Draft ve birleştirilmemiş kalır.
3. Ayrı onaylı DEV hedefinde şema/ledger/backup incelemesi sonrası eşleşen migration
   ve istemciyi birlikte dene. İki hesapla gerçek HTTP erişim reddini, izin yarışını,
   Cron arşivleme ve altı saat sınırını doğrula.
4. Meta bağlantısı hâlâ kapsam dışıdır. Bu dal Production yayınına hazır kabul edilmez.

# 30 günlük ilan temizliği — DEV hazırlığı

4 Kasım 2026. Yerel dal `codex/nakgo-retention-dev`, temel PR #40 `6955a03`.
Kullanıcı yalnız güvenli DEV kabulüne ve koruyucu saklama varsayımına izin verdi.
Mevcut Draft PR #38/#39/#40'a, main, Production, DNS ve uzak ortamlara yazılmadı.

## Geçiş kararı: engelli, dağıtılmadı

PR #40'ın `verify` (41877442158) ve `admin-regression` (41877442212) işleri
GitHub üzerinden yeniden doğrulandı: **completed/success**.
Önceki korumalı test incelemesi `listing-lifecycle.md` içinde;
bu dal guard, workflow veya önceki korumalı test dosyalarını değiştirmez.
Supabase DEV sekmesi envanterde görünse de araç `browser.user is unavailable`
verdi. Kullanıcının DEV Backups ekran görüntüsü ücretsiz planda yönetilen proje
yedeği bulunmadığını gösterdi. Kullanıcı bilinen manuel yedek/restore denemesi
bildirmedi; bu çalışmada da yedek alınmadı. Uzak şema, ledger ve geri yüklenebilir
yedek doğrulanamadı. Yönetilen yedek yokluğu, başka yerde manuel yedek olamayacağının
kanıtı değildir; ancak mevcut geçiş için doğrulanmış bir yedek yoktur.
Kullanıcının “güvenli geçiş mümkün değilse değişiklik yapma” koşuluyla migration,
DEV deploy, gerçek ilan/izin/Cron testi çalıştırılmadı. Yerel test gerçek DEV değildir.

## Saklama davranışı

- 6 saatlik görünmezlik PR #40'taki RLS/RPC ve Cron arşivleme ile korunur.
- Yeni `20261104020000_listing_retention.sql`, oluşturulmasından 30 gün geçmiş
  ve yayın süresi bitmiş ilanları en fazla 100 kayıtlık işlemlerde temizler.
  Sonradan yeniden yayımlanmış, hâlâ geçerli 6 saati olan kayıt önce bu süreyi
  tamamlar; aktif ilan içeriği iletişim sırasında temizlenmez.
- Satır/ID ve ilişkiler silinmez. Telefon, açık izin bayrağı, kişi etiketi,
  yük açıklaması, not, kalemler, gömülü görsel ve müsaitlik metni temizlenir.
  Güzergâh, araç tipi, tonaj, sahip bağlantısı ve zamanlar mevcut ilişkisel
  sözleşmenin asgari kaydı olarak kalır; tam anonimleştirme iddia edilmez.
  Takvimli araçta 1970-01-01 yalnız arşivlenmiş kayıt için işarettir, yeni tarih değildir.
- Temizlenmiş ilan değiştirilemez/yeniden yayımlanamaz; kullanıcı yeni ilan oluşturur.
  Normal hesap temizlik RPC'sine veya temizlenme işaretine yazamaz.
- Herhangi bir taşıma işi, geçmiş görüşme, moderasyon kaydı veya açık saklama
  engeli olan ilan korunur. Tamamlanmış iş de korunur; henüz onaylı hukuki süre yoktur.
- Saklama engeli `private.listing_retention_holds` tablosunda yalnız yetkili DB
  işletimiyle yönetilir. Eklerken aynı transaction içinde ilgili listing satırını
  `SELECT ... FOR UPDATE` ile kilitle, ardından gerekçe referansını yaz.
  Geri alınamaz temizlikten önce engellerin tam envanteri gereklidir.
- WhatsApp kaynak metni/göndereni 30 gün sonra, kaynak done/purged ise temizlenir.
  Güncel veya denetim geçmişindeki eski bir bağlı ilan korunuyorsa kaynak da korunur.
  Tür değişiminde draft.listing_id yeni ilana geçse bile eski bağlantı korunur.
  Pending/processing/failed iş
  temizlenmez; `unprocessedOldSources` sayacı müdahale ihtiyacını gösterir.
- Temizlenmiş WhatsApp ilanının taslak içeriği temizlenip purged yapılır.
  Yayımlanmamış taslaklarda eski 30 günlük iletişim/90 günlük içerik politikası
  korunur. İzin kaydı, hukuki dayanak ve denetim kanıtları temizlenmez.
  Eski purge'ın denetim kanıtlarını 90 gün sonra silmesi koruyucu politikayla durdurulur.
  Bu kayıtlar kişisel bilgi içerebilir; onaylı takvim gelmeden saklama süresi uydurulmaz.
- Özel taşıyıcı belgeleri ve Storage nesneleri silinmez; ilan görselleri bu modelde
  `listings.image_data` içindedir. Storage metadata satırı silmek dosya temizliği değildir.

## Cron ve izlenebilirlik

Cloudflare scheduled: önce 6 saat arşivleme, `LISTING_RETENTION_ENABLED=true`
ise redaction + koruyucu WhatsApp purge. WhatsApp kuyruğu kapalıyken de temizlik
çalışır. Yeni anahtar yapılandırmada **false**; yalnız migration ve kabul sonrası açılır.
Redaction transaction'ı advisory lock, row lock ve SKIP LOCKED kullanır. Hata
işlemi geri alır; sonraki Cron tekrar dener. Tek kayıt için tek, içeriksiz audit işareti.
Kayıt başına büyük JSON/görsel içeriği denetim tablosuna kopyalanmaz.

Yetkili yönetici `public.nakgo_retention_status()` RPC'sini çağırabilir. Normal
hesap/anon reddedilir. Yalnız toplu metrikler döner:

- `databaseBytes`, `listingRelationBytes`, `waAuditRelationBytes`;
- `storageObjectCount`, `storageMetadataBytes` (eksik metadata 0 sayılır; fatura değildir);
- `due`, `held`, `redacted`, `retainedPermissionCount`, `unprocessedOldSources`;
- `state.last_success_at`, `last_redacted`, `total_redacted`.

Bu RPC panelde yeni bir ekran açmaz; SQL Editor veya yönetici oturumundaki RPC
istemcisiyle okunabilir. Başarı zamanı 5 Cron periyodundan eskiyse, due büyüyorsa
veya eski iş kuyruğu sıfırdan büyükse işletim incelemesi gerekir. Otomatik alarm
servisi kurulmadı. Postgres MVCC/TOAST alanı hemen dosya sistemine iade edilmeyebilir;
ölçülen ilişki boyutu bloat/index içerir. VACUUM FULL, kota artırımı ve ücretli kaynak yok.

## Yedek ve kontrollü geçiş ön koşulları

1. CI tamamlanmalı; korumalı test farkları inceleme kaydıyla kabul edilmeli.
2. Yalnız DEV `axkotffqrsddbrazhcwj` şema/ledger'ı doğrulanmalı. İki yeni migration'ın
   uygulanmış olup olmadığı kesinleştirilmeli; isim çakışmasında tekrar uygulanmamalı.
3. Yeni temizlik başlamadan listings, ilişkili işler/görüşmeler, private WhatsApp,
   izin/denetim/engel kayıtları ve ilgili function/policy/grant tanımları güvenli
   yedeğe alınmalı. Storage değişmediği yine doğrulanmalı. Yedek sır/Git/log içerisine
   yazılmamalı; kontrollü ayrı veritabanına restore ve satır/ilişki kontrolü yapılmalı.
   Bu tur yedek alınmış/geri dönüş doğrulanmış DEĞİLDİR.
4. DEV Cron/webhook yazıları bakım aralığında durdurulmalı; mevcut Worker version,
   ortam değişken adları, eski client'lar ve önbellekteki sürümler envantere alınmalı.
   Eski PR #38/#39 frontend'i yeni sütun yetkileri ve kapalı mesaj API'siyle çalışmaz.
   Bu hostları etkisizleştirmek mevcut yetki kapsamını aşıyorsa izole DEV gerekir.
5. İki migration ve eşleşen PR #40 + retention client/worker kontrollü uygulanır;
   temizlik anahtarı önce false kalır. Gerçek normal/admin hesaplarla HTTP, ilan,
   iletişim, izin, expiry/Cron kabulü yapılır. Yalnız açıkça etiketli sentetik
   kayıtlarla 30 gün ve hold testi yapılır; gerçek kayıtların zamanı değiştirilmez.
6. Engellerin envanteri ve temizlenecek kayıt sayısı incelendikten sonra temizlik
   açılır. Backlog ve CPU ölçülür. Bu tur CPU/yük güvenliği kanıtı oluşmadı.
7. Sorunda önce temizlik anahtarını false yap ve Cron'u durdur. Sırf Worker rollback
   silinmiş içeriği geri getirmez. Şema geri dönüşü guard/izinleri gevşeterek yapılmaz;
   doğrulanmış yedek üzerinden hedefli restore veya yeni şemayla uyumlu düzeltme gerekir.

## Yerel kanıt

- `npm test`: son çalıştırmada 631/631 (önceki çalıştırma 630/630).
- `tests/retention/database.cjs`: 42 kontrol (PostgreSQL/PGlite).
- Yaşam döngüsü DB: 54; WhatsApp DB: 42; admin: 47 + 11 rollback fixture.
- Cloudflare build, mevcut gerçek yerel workerd HTTP/Cron testi ve yeni
  `tests/retention/runtime.cjs` başarılı. Dış RPC'ler sentetik, gerçek Supabase değildir.
- Yeni testler: 30 gün/29 gün, manuel/WhatsApp/boş araç, RLS yetki reddi,
  immutable arşiv, yasal/iş/görüşme/moderasyon engeli, kanıt koruma, başarısız
  transaction rollback, batch 100+1, tekrar no-op, temizlik hatası ve sonraki Cron,
  DEV-only, kapalı WhatsApp'tan bağımsızlık, Storage metadata ve izleme gizliliği.

Gerçek eşzamanlı Cron yarışları, uzak CPU, yeni şemanın canlı HTTP kabulü ve
tam yedekten restore testi tamamlanmadı. DEV geçişi **henüz hazır değil**.

## İçerik kopyası ve güvenlik incelemesi

Bu envanter kaynak kodu ve izole fixture incelemesidir; uzak tablo/logların
gerçek içeriği bu tur taranmadı. “Her kopya silindi” sonucu çıkarılmaz.

| Alan | Sonuç / saklama davranışı |
| --- | --- |
| listings | Serbest içerik, telefon ve image_data temizlenir; ID/sahip/rota/araç/tonaj kalır. |
| transport_jobs.listing_snapshot | İlan özeti kopyası kalabilir. Bağlı iş varsa ilan zaten korunur; snapshot silinmez. |
| listing_conversations, conversation_messages, message_inbox | Ad/rota/son mesaj ve serbest mesaj kopyaları kalabilir. Geçmiş korunur, eski istemci yetkileri PR #40'ta kapalıdır. |
| wa_sources, wa_drafts | Kaynak ve taslak politikası uygulanır; tarihsel ilan bağlantısındaki hold da korunur. |
| wa_audit.before_value/after_value | Tam fields kopyası; telefon, metin veya görsel barındırabilir. Koruyucu izin/denetim politikası nedeniyle tutulur; normal hesaba açık değildir. |
| wa_publication_permissions / legal_basis | Telefon ve izin kanıtı korunur. Hukuki takvim netleşmeden otomatik silinmez. |
| admin_audit / moderation.reason | Serbest gerekçe kişisel veri içerebilir; korunur. Yeni lifecycle audit yalnız ID/işlem/zaman içerir. |
| listing_favorites | İçerik snapshot'ı yok; FK ve hesabın favorisi korunur, ilan RLS uygulanır. |
| Storage | İlan fotoğrafı DB'de; özel taşıyıcı belgeleri ayrı bucket'ta. Gerçek bucket envanteri doğrulanmadı, hiçbir nesne silinmez. |
| Worker logları | Kodda ham webhook/body/DB cevabı loglaması yok; genel hata kodları var. Gerçek Cloudflare/Supabase log saklama ve olası geçmiş içerik kopyaları ayrıca kontrol edilmeli. |
| Service Worker | Yalnız statik kabuk allowlist'i cache'lenir; API/Supabase yanıtları cache'e yazılmaz. |
| Tarayıcı belleği / localStorage | Gerçek hesap form taslakları oturum belleğinde; demo yy2/ng-post-drafts ve eski yerel sohbet/kurtarma verileri ayrı kalabilir. Sunucu Cron'u çevrimdışı cihaz kopyalarını silemez. |
| Yedekler / WAL / eski export dosyaları | Silinmiş içeriği barındırabilir; saklama ve erişim politikası ayrıca uygulanmalı. Bu tur incelenemedi. |

Korumalı testler: PR #40'ta mesaj gönderme başarı senaryoları kaldırılan özellik
nedeniyle erişim reddi ve UI yokluğu senaryolarına dönüştürüldü. XSS, yanlış rol,
storage hatası, eski yanıt ve kapalı ilan kontrolleri korunuyor. Retention dalında
bu testler değiştirilmedi; iki yeni test dosyası eklendi. Guard/workflow farkı yok;
CI başarısı korumalı dosyalar için gerekli insan incelemesini otomatik kaldırmaz.

Yeni güvenlik düzeltmesi: WhatsApp purge yalnız güncel draft.listing_id'ye
bakıyordu. Audit'teki eski listing_id de hold kontrolüne alındı; iki regresyon
assertion'ı kaynak ve taslağın temizlenmediğini doğruluyor. Diğer alanlardaki
kanıt kopyalarını toplu silmek, kabul edilmiş koruyucu politikaya aykırı olurdu.

## Ücretsiz yedek doğrulaması için gerekenler

Yönetilen yedek satın alınmayacak. Yetkili kişinin DEV veritabanı bağlantısını
yerel güvenli credential store/pg_service/pgpass üzerinden sağlaması gerekir;
şifre veya bağlantı sırrı sohbete, Git'e veya komut loglarına yazılmaz.
Uygun sürümde pg_dump ile tek tutarlı snapshot, gerekli rol/izin tanımları ve
manifest güvenli Git dışı konuma alınır. Dosyanın varlığı veya pg_restore --list
tek başına yeterli değildir: aynı uyumlu PostgreSQL ortamında ayrı veritabanına
restore, satır sayıları, FK ilişkileri, RLS/grant/function tanımları ve örnek
erişim testleri doğrulanır. Son yazma zamanı, yedek zamanı ve aradaki değişiklikler
bakım planında değerlendirilir. Yedek ve restore hedefi doğrulanınca kullanıcıya
somut migration/worker sürümleriyle uygulama onayı sorulur; şu an koşullar eksik.

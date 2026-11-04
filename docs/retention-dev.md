# 30 günlük ilan temizliği — DEV hazırlığı

4 Kasım 2026. Yerel dal `codex/nakgo-retention-dev`, temel PR #40 `6955a03`.
Kullanıcı yalnız güvenli DEV kabulüne ve koruyucu saklama varsayımına izin verdi.
Mevcut Draft PR #38/#39/#40'a, main, Production, DNS ve uzak ortamlara yazılmadı.

## Geçiş kararı: engelli, dağıtılmadı

PR #40'ın `verify` (41877442158) ve `admin-regression` (41877442212) işleri
GitHub connector ve doğrudan salt okunur GitHub API üzerinden hâlâ queued/null.
CI başarılı sayılamaz. Önceki korumalı test incelemesi `listing-lifecycle.md` içinde;
bu dal guard, workflow veya önceki korumalı test dosyalarını değiştirmez.
Supabase DEV sekmesi envanterde görünse de araç `browser.user is unavailable`
verdi. Uzak şema, ledger ve geri yüklenebilir yedek doğrulanamadı.
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
  Bir bağlı ilan korunuyorsa kaynak da korunur. Pending/processing/failed iş
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

- `npm test`: 630/630.
- `tests/retention/database.cjs`: 40 kontrol (PostgreSQL/PGlite).
- Yaşam döngüsü DB: 54; WhatsApp DB: 42; admin: 47 + 11 rollback fixture.
- Cloudflare build, mevcut gerçek yerel workerd HTTP/Cron testi ve yeni
  `tests/retention/runtime.cjs` başarılı. Dış RPC'ler sentetik, gerçek Supabase değildir.
- Yeni testler: 30 gün/29 gün, manuel/WhatsApp/boş araç, RLS yetki reddi,
  immutable arşiv, yasal/iş/görüşme/moderasyon engeli, kanıt koruma, başarısız
  transaction rollback, batch 100+1, tekrar no-op, temizlik hatası ve sonraki Cron,
  DEV-only, kapalı WhatsApp'tan bağımsızlık, Storage metadata ve izleme gizliliği.

Gerçek eşzamanlı Cron yarışları, uzak CPU, yeni şemanın canlı HTTP kabulü ve
tam yedekten restore testi tamamlanmadı. DEV geçişi **henüz hazır değil**.

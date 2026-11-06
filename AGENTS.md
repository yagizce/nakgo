# NakGo — ajan çalışma kuralları

6 Kasım son durum: dokuz arşiv migrationı ve bc98998 yalnız DEV’de yayında.
[Arşiv/KVKK güncel kabul ve sınırlar](docs/archive-privacy-work.md) önce okunur.
Aşağıdaki eski bekliyor notları tarihseldir. Cron/purge/gerçek hesap silme kapalı.

6 Kasım güncel çalışma: `codex/nakgo-group-capacity`; durum ve yeni CPU kabulü
[grup kapasitesi notunda](docs/group-capacity.md). PR43 kontrol paketi main 4d472e9'a ayrı onayla
alındı; korumalar geri açık, uygulama Guard 71/71. Aşağıdaki eski 48/65 notları
tarihsel. Yeni grup migration'ı uzakta uygulanmadı. Free CPU kabulü hâlâ başarısız;
dispatcher 503 düzeltmesi gerçek DEV'de geçti; mevcut veri değişmedi.
Draft PR44 dört GitHub kontrolünü geçti (8081ca4). Grup migration'ı DEV'de taze yedek/restore sonrası uygulandı (59 tablo/256 satır,
RLS ve içerik hash eşleşti). Production Storage 7 dosya şifreli ve yerelde
doğrulandı; gerçek servis restore değil. Yeni CPU/Storage optimizasyonu yerelde;
ikinci migration ve tam gerçek DEV yük/CPU kabulü bekler.
Cron/retention kapalı; Production/main/DNS/Paid için yeni onay gerekir.

Son çalışma: `codex/nakgo-dev-release-checks`. DEV `73c477e` migrationları ve
`f61ab3b` uygulama/Worker yayımlandı. Cron/purge kapalı. Gerçek normal/admin,
RLS, izinli yayın, paralel Worker, retry/backoff ve sentetik temizlik doğrulandı.
CPU optimizasyonu DEV'de yayında; batch 1, gerçek dolu kuyruk P99 21 ms.
Ücretsiz plan Production CPU kabulü geçmedi; ücretli hizmet açılmadı.
[Güncel sonuç ve Production ön koşulları](docs/production-readiness.md).
[17 guard farkı ve ayrı Production hazırlığı](docs/production-preflight.md):
yerel testler geçti, guard 48/65 bağımsız inceleme bekler; abonelik/yayın onayı yok.
Production/main/DNS kapsam dışı; eski Draft PR'lar değiştirilmez.
Aşağıdaki eski kapsam notları güncel kullanıcı talimatının yerine geçmez.

Bu dalın güncel kapsamı: `codex/nakgo-listing-lifecycle` üzerinde yerel ilan/profil
yaşam döngüsü. [Devir ve doğrulama sınırları](docs/listing-lifecycle.md) okunur.
Uzak DEV migration/deploy yetkisi bu geliştirme kapsamında verilmedi; main,
Production, DNS ve Draft PR #38/#39 değiştirilmez. Aşağıdaki Cloudflare notları
temel dalın geçmişidir. Test değişiklikleri ayrı inceleme gerektirir; guard atlanmaz.

Önce [proje devir rehberini](docs/PROJECT_HANDOFF.md) okuyun. Kullanıcıyla Türkçe
ve açık iletişim kurun. Rehber tarihli bir kayıttır; uzak Git/PR/CI/deployment
ve veritabanı durumu yeni oturumda yeniden doğrulanır.

## Başlangıç ve kapsam

- Mobil web/PWA deposu `yagizce/nakgo`, canlı adres `https://nakgo.vercel.app/`.
  `nakgo-website` kurumsal site ve deneysel `nakgo-corporate` ayrı kaynaklardır.
- Yerel `git status --short`, branch, HEAD ve origin ile uzak main/ilgili PR'ı
  inceleyin. Eski DEV dalını güncel uygulama sanmayın. Kullanıcı çalışmalarına
  toplu reset, temizlik, checkout veya `git add .` uygulamayın.
- Kullanıcının son kapsamı esastır. Bir durum notu, tamamlanmamış özellik listesi
  veya geçmiş onay yeni iş başlatma yetkisi değildir. Bu dalın kapsamı PR #38 temelli
  Cloudflare Workers + Static Assets için yerel DEV uyarlaması ve testlerdir.
  [Cloudflare devir notunu](docs/cloudflare-dev-migration.md) okuyun. Cloudflare
  DEV yayını kullanıcı tarafından onaylandı ve yalnız `nakgo-app-dev` yayımlandı.
  Eksik sırları kullanıcı güvenli ayarlara girer; değerleri sohbete istemeyin. Production, canlı
  DNS ve migration kapsam dışıdır; main birleştirilmez, PR #38 draft kalır.
- Kullanıcının onayladığı kapsamı tekrar sormayın; yeni main/Production yayını,
  migration veya yetki değişikliği için mevcut onayın gerçekten o işlemi
  kapsadığını doğrulayın. Eski tek seferlik istisnayı yeniden kullanmayın.

## Mimari ve ürün kuralları

- Modüler HTML/CSS/klasik JavaScript ve PWA yapısını koruyun; izinsiz framework
  geçişi veya yeniden tasarım yapmayın. Tek yükleme sırası `tools/project.js`.
- Kaynaklar `src/` altındadır. `index.html` elle düzenlenmez; kaynak değişirse
  `npm run bundle` ile üretilir. `public/`, `www/`, test görüntüleri çıktıdır.
  Sadece belge değişikliğinde bundle/SW sürümü değiştirilmez.
- Turkuaz/sarı marka, açık/koyu tema, en fazla 430 px tek sütun ve alt gezinme
  korunur. Logo, splash, ikon ve alanlara sebepsiz müdahale edilmez.
- YÜK ilanında yükleme tarihi başlangıçta boş, zorunlu serbest metindir.
  `bugün`, `yarın sabah` veya başka dolu metin kabul edilir; yalnız boş/boşluk
  reddedilir. Mevcut 32 karakter sınırı korunur. Takvim formatı dayatmayın,
  tarih uydurmayın, Not ve ekler adımına geçişi tarih için engellemeyin.
- Yeni metinli yük `loading_text` alanında saklanır; `available_on` null kalır.
  Eski takvim kayıtları ve boş araç müsaitlik tarih/saat doğrulaması ayrı kalır.
  Otomatik tarih, date picker, varsayılan seçim veya açıklama eklemeyin.
- Taşıma ücret alanlarını geri getirmeyin. Demo Premium/ödeme ekranlarını gerçek
  tahsilat veya sunucudan doğrulanmış üyelik olarak sunmayın.
- Gerçek hesap verileri demo `yy2` deposuna karışmaz. Eski host/demo akışı,
  localStorage işareti veya profil hesap türü gerçek yetkilendirme değildir.

## Güvenlik, veri ve ortam

- Varsayılan geliştirme ortamı DEV `axkotffqrsddbrazhcwj`; Production
  `fimlifldsivecezbxwuo`. Her işlemde hedefi doğrulayın. Production Auth açıktır;
  eski kurulum rehberlerindeki kapalı/boş ortam notları güncel durum değildir.
- RLS, sütun izinleri ve sunucu RPC kontrolleri esastır. Arayüz gizleme güvenlik
  sınırı değildir. Rol yalnız sunucudan strict `true` sonucuyla gösterilir.
- Tek aktif genel yönetici `private.admin_members` ve unique index ile korunur.
  Belge inceleyicisi ayrı `private.document_reviewers` üyeliğidir; genel yönetici
  olmak özel belge inceleme yetkisi vermez. Otomatik rol ataması yapmayın.
- Production'da son kabulde 1 genel yönetici, 0 aktif belge inceleyici vardır.
  Geçici belge inceleme yetkisi test sonunda geri alınmıştır. Normal test
  hesabına yönetici/inceleyici verilmez. Yeni işlemde güncel rolü doğrulayın.
- Şifre, token, OAuth secret, service-role anahtarı, oturum veya özel dosya
  içeriğini loga/sohbete/frontend'e/PR'a koymayın. Hesap e-posta/UUID bilgilerini
  public belgelere sabitlemeyin. Sırları kullanıcının uygun servis UI'sinde yönetin.
- Belgeler private Storage'dadır. Public bucket, kalıcı genel URL, overwrite/
  upsert veya istemcinin kendine onay vermesi eklenmez. Gönderilmiş dosyaların
  değişmezliği, reservation/finalize ve revizyon kontrolleri korunur.
- Hesap/ekran değişince geç yanıtlar reddedilir; rol, taslak ve dosya URL'leri
  temizlenir. Belirsiz ağ sonucu/eski revizyon sahte başarı üretmez.
- Migration öncesi gerçek şemayı ve ledger'ı inceleyin. SQL Editor'de uygulama,
  kendiliğinden CLI geçmişi oluşturmaz. Son iki migration DEV/PROD'a uygulanmış
  ve kaydedilmiştir; tekrar çalıştırmayın. DEV'nin eski geçmişi eksiktir.
- RLS kapatma, tablo silme veya izin genişletme hata çözümü değildir. Gerçek
  kullanıcı ilanı/işi/mesajı/belgesi üzerinde deneme moderasyonu yapmayın.
  Sentetik fixture, transaction/rollback ve hedefi belli test hesabı kullanın.

## Doğrulama ve teslim

- Değişikliğe uygun kontrolleri çalıştırın. `npm test`, browser/SQL/ci sonuçlarını
  ayırın; mock/PGlite gerçek Supabase veya fiziksel cihaz kabulünün yerine geçmez.
  Yalnız Markdown değişikliğinde link, kaynak doğruluğu ve dosya farkını denetleyin;
  gerekli GitHub kontrollerinin tamamlanmasını bekleyin.
- Mevcut korumalı test, guard veya workflow'u hatayı gizlemek için değiştirmeyin.
  Gerekli test bakımı ayrı ve insan incelemeli iştir. PR #21/#37'deki tek seferlik
  istisnalar tarihsel ve sınırlıdır; sonraki işe izin vermez. Korumalar geri açıktır.
- Main'de PR, güncel dal ve GitHub Actions kaynaklı `quality-gate` + `verify`
  gereksinimlerini koruyun. Yönetici bypass engeli açık, force push/silme kapalıdır.
  Bir kontrol başarısızsa tüm CI yeşil diye anlatmayın.
- Kullanıcının gerçek iPhone 15 testinde Google sonrası panel görünürlüğü ve
  son serbest yükleme metniyle ilan yayımlama doğrulanmıştır. Bu kabulü sebepsiz
  yeniden başlatmayın; yeni değişikliğin etkilediği akışı sınayın.
- Teslimde değişen dosyaları, doğrulamayı ve DEV/Production durumunu belirtin.
  Kalıcı aşama tamamlanınca `docs/PROJECT_HANDOFF.md` içindeki güncel durumu
  düzenleyin; çelişen bekliyor notları ve geçici log yığınları eklemeyin.

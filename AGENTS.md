# NakGo — ajan çalışma kuralları

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
  veya geçmiş onay yeni iş başlatma yetkisi değildir. Bu dalın kapsamı WhatsApp ilan toplama/yönetim geliştirmesidir;
  Production değişikliği veya otomatik deploy/push yapılmaz.
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

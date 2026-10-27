# NakGo — ajan çalışma kuralları

Önce [proje devir rehberini](docs/PROJECT_HANDOFF.md), sonra ilgili kaynakları
okuyun. Rehberdeki tarihli bilgiler uzak branch/PR/deployment doğrulamasının
yerine geçmez. Kullanıcıyla Türkçe ve açık iletişim kurun.

## Başlangıç

- Repo `yagizce/nakgo` mobil web/PWA uygulamasıdır. `yagizce/nakgo-website`
  kurumsal siteyle ve deneysel `nakgo-corporate`/Next.js ile karıştırmayın.
- `git status --short`, branch, HEAD ve origin'i kontrol edin. Yerel kopya
  uzak DEV'den eski olabilir. Kullanıcı çalışmalarını koruyun; toplu reset,
  temizlik veya `git add .` yapmayın.
- PR #21 ve Storage düzeltmesi PR #35 main'e alındı; Production Auth açıktır. Uzak durumlarını
  yeniden doğrulayın. Başarılı eski CI yeni commit için kanıt değildir.

## Mimari ve ürün

- Modüler HTML/CSS/klasik JavaScript + PWA yapısını koruyun; izinsiz framework
  geçişi veya baştan tasarım yapmayın. Yükleme sırası `tools/project.js`.
- `src/` kaynaklarını değiştirin, `index.html` dosyasını `npm run bundle` ile
  üretin. `public/`, `www/`, test görüntüleri geçici/üretilen çıktıdır.
- Turkuaz/sarı marka, iki tema, en fazla 430 px tek sütun ve alt gezinmeyi
  koruyun. Logo/splash/ikonları sebepsiz değiştirmeyin.
- Yükleme/müsaitlik tarihleri başlangıçta boş, elle yazılan alanlardır.
  Otomatik tarih, date picker, varsayılan seçim veya açıklama eklemeyin.
- Taşıma ücret alanlarını geri getirmeyin. Demo Premium/ödeme işlemlerini
  gerçek tahsilat veya sunucudan doğrulanmış üyelik olarak sunmayın.
- Gerçek hesap verileri demo `yy2` kaydına karışmamalı. Eski host/demo akışı
  gerçek hesap yetkilendirmesinin yerine geçmez.

## Güvenlik ve ortam

- Varsayılan çalışma DEV `axkotffqrsddbrazhcwj`. PROD `fimlifldsivecezbxwuo`,
  main merge ve Production promotion için kullanıcının açık kapsamı gerekir.
- RLS/sütun izinleri ve sunucu RPC kontrolleri esastır. Arayüz gizleme,
  localStorage admin/onay işareti veya profil hesap türü yetki vermez.
- Belge inceleyici ile genel yönetici ayrı yetkilerdir. Yetkiyi otomatik
  atamayın; önceki dar yetki onayını daha geniş erişim için kullanmayın.
- Şifre, token, OAuth secret, service-role anahtarı, oturum veya özel dosya
  içeriğini loga/sohbete/frontend'e/PR'a koymayın. Yönetici ve test hesaplarının
  e-posta/UUID bilgilerini herkese açık dosyalara sabitlemeyin.
- Belgeler private Storage'dadır. Public bucket, kalıcı genel URL, upload
  upsert veya istemcinin kendi kendine onay vermesi eklenmez.
- Hesap değişince geç yanıtlar reddedilir; rol/taslak/dosya URL'leri temizlenir.
  Belirsiz ağ sonucu veya eski revizyon sahte başarı üretmemeli.
- Migration durumunu önce inceleyin. SQL Editor uygulaması CLI geçmişine
  kendiliğinden yazılmaz. Aynı migration'ı yeniden çalıştırıp tablo silerek,
  RLS'yi kapatarak veya izinleri genişleterek hata çözmeyin.
- Gerçek kişiler üzerinde deneme moderasyonu/evrak kararı vermeyin. Sentetik
  DEV fixture kullanın; gerçek ilan/iş/mesaj geçmişini koruyun.

## Test ve teslim

- Olağan feature işinde mevcut korumalı test/guard/workflow'u değiştirerek
  hatayı gizlemeyin. Gerekli test bakımı ayrı ve insan incelemeli iştir.
- `npm test` ve alana uygun browser/SQL kontrollerini çalıştırın. Mock, yerel
  PostgreSQL, canlı Supabase kabulü ve fiziksel cihaz testini ayırın.
- DEV tabanında geçen guard main kapısının başarısı değildir. PR #21 için incelenmiş beş korumalı fark
  tek seferlik açık kullanıcı onayıyla geçti; eski gate 35/40 olarak kaldı.
  Yönetici bypass engeli geri açıldı. Bu istisna sonraki işlemlere izin değildir.
- İnceleme istendiyse bulguyu tetikleyici, etkisi ve dosya/satırıyla bildirin.
  Doğrulanmamış migration/deploy'u tamamlanmış saymayın.
- Görev sonunda değişiklik, doğrulama, engel ve DEV/Production durumunu belirtin.
  Kalıcı aşama tamamlanınca `docs/PROJECT_HANDOFF.md` dosyasını tarih, commit/PR,
  migration ve kabul durumuyla güncelleyin. Geçici logları rehbere yığmayın.

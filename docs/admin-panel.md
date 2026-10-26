# Ortakların yönetici paneli

Profil > Yönetici paneli. Her ortak kendi doğrulanmış hesabıyla giriş yapar.
Sunucuda private.admin_members üyeliği her istekte kontrol edilir; kullanıcı
metadata/profil alanları yetki vermez. Yönetici üyeliği belge inceleyiciliği
vermez. Özel sohbet ve belge dosyaları yönetim listelerine dahil edilmez.

## İşlemler

- Genel sayımlar, kullanıcı/ilan arama ve 20 kayıtlık sayfalama.
- Kullanıcının faaliyetlerini askıya alma ve askıyı kaldırma. Gerekçe zorunludur.
  Yeni ilan/profil değişikliği, mesaj, görüşme, favori ekleme, belge işlemleri,
  yeni taşıma isteği ve isteği kabul etme durdurulur. Bu bir Auth oturum iptali
  değildir: giriş, mevcut katılımcı geçmişi, reddetme/geri çekme ve kabul edilmiş
  işlerin yükleme/teslim adımları devam eder. Mevcut ilanlar otomatik kaldırılmaz;
  gerektiğinde ilan kaldırma işlemini ayrıca kullanın.
- İlanı kaldırma: arşivler ve sahibi dahil yeniden yayını engeller. Engel açma
  ilanı kapalı duruma getirir; süresi geçmiş ilan otomatik yayımlanmaz.
- Belge işlem geçmişi ve yönetim işlem geçmişi ayrı listelenir. Her başarılı
  değişiklikte sunucudan alınan aktör, hedef, gerekçe, revizyon ve zaman kaydedilir.
- Her işlem için onay formu vardır. Çift gönderim engellenir. Eski revizyon
  reddedilir; ağ hatasında işlem sonucu varsayılmaz, güncel durum istenir.
- Kendi hesabını veya başka aktif yöneticiyi askıya alma engellenir.

Faaliyet yazmaları ve hesap askıya alma advisory transaction lock ile sıralanır.
İlan moderasyonu ilan satırını kilitler; durum ve audit aynı transaction içindedir.
Var olan işler/görüşmeler silinmez. İstemci audit tablosuna doğrudan yazamaz.

## DEV kurulumu

Sırayla 20261026010000_admin_panel.sql ve 20261026020000_admin_moderation.sql
migration'larını yalnız doğrulanmış DEV projesine uygulayın. Her ortağın hesabını
ve doğrulanmış e-postasını teyit ettikten sonra güvenilir SQL yönetim konsolundan
private.admin_members tablosuna gerçek auth.users UUID'sini ekleyin. İptal için
active=false kullanın. Migration'lar hiçbir hesaba otomatik yetki vermez.
Belge inceleyici atamaları ayrıca yapılır. Service-role anahtarı istemciye konmaz.

## Doğrulama

- npm test ve npm run test:static.
- NAKGO_BROWSER_CHANNEL=chromium python tests/admin_panel_browser.py: gerçek
  Chromium, sentetik servis yanıtları; mobil/masaüstü, metin kaçışı, çift gönderim,
  eski revizyon hatası, yenileme, boş/izinsiz görünüm ve taşma kontrolü.
- tools/admin-db-check.cjs, isteğe bağlı @electric-sql/pglite paketi NODE_PATH
  üzerinden sağlanarak çalıştırılır. Runtime bağımlılığı değildir. Tüm migration'ları
  yerel PostgreSQL motorunda sentetik auth/storage şemalarıyla çalıştırır; normal,
  anonim, doğrulanmamış ve iptal edilmiş kullanıcı; iki ortak, yetki yükseltme,
  askı/kaldırma, eski revizyon, yeniden yayın, mevcut işi tamamlama ve audit sınanır.
  Gerçek Auth/Storage servisi veya eşzamanlı çok bağlantılı test değildir.

Canlı DEV kabulü halen gereklidir: iki ortak + normal kullanıcıyla giriş, rol
iptali, askıya alınmış açık oturumdan yeni faaliyet, Storage işlemleri, iki
ortak aynı kayda işlem yaptığında revizyon çatışması ve mevcut taşıma işi akışı.
Hiçbir canlı migration veya rol ataması bu değişiklikle otomatik uygulanmaz.

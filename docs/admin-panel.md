# Tek genel yönetici paneli

Profil > Yönetici paneli. Yalnız atanmış tek doğrulanmış hesap genel yönetici olarak giriş yapar.
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

Yeni taşıma isteği ve kabul, hem yük sahibi hem taşıyıcının aktif olmasını gerektirir.
Katılımcı kilitleri UUID sırasıyla alınır; önceden kabul edilmiş işin tamamlanması korunur.
Faaliyet yazmaları ve hesap askıya alma advisory transaction lock ile sıralanır.
İlan moderasyonu ilan satırını kilitler; durum ve audit aynı transaction içindedir.
Var olan işler/görüşmeler silinmez. İstemci audit tablosuna doğrudan yazamaz.

## Canlı sayfa

- `nakgo_admin_live(p_kind)` yalnız yöneticiye bugünün (Türkiye saati) sayılarını,
  son 60 dakika ve saatlik dağılımı, il bazında çıkış/varış sayılarını ve son 24
  saatin isimsiz ilan özetini (no, tür, güzergâh, araç, saat) verir. Sahip adı ve
  telefon gelmez. Sayfa 30 saniyede bir yenilenir; sekme gizliyken istek atılmaz.
- Ara/WhatsApp tıklaması, `nakgo_listing_contact(p_id,p_channel)` numarayı başka
  doğrulanmış hesaba gerçekten verdiğinde `private.contact_clicks` tablosunda saatlik
  sayılır. Tabloda hesap, ilan, telefon veya IP yoktur. Kendi ilanı ve reddedilen
  istekler sayılmaz. Aynı kişinin tekrar tıklaması da sayılır (tekil kişi sayımı yok).
- Migration (`20261115075953_admin_live.sql`) istemciden önce uygulanmalıdır;
  yeni istemci `p_channel` gönderir.

## Bölümler (Kasım 2026 sadeleştirmesi)

Menü yalnız arka ucu çalışan bölümleri gösterir. Her sayfada başlık, kısa açıklama ve gerekli süzgeçler vardır.

| Bölüm | Sayfalar | Sunucu |
|---|---|---|
| Genel Bakış | Özet (dikkat gerektirenler + 4 temel sayı + son 24 saat ilanları), Canlı, İstatistikler | `nakgo_admin_page('overview'/'health'/'listings'/'stats'/'insights')`, `nakgo_admin_live` |
| İlan Yönetimi | arama, birleşik süzgeç, ayrıntı, geçmiş, kaldırma/engel açma, toplu kaldırma, yasal saklama | `nakgo_admin_page('listings'/'history')`, `nakgo_admin_moderate` |
| İlan Arşivi | arşiv, saklama kuralları, gece temizliği çalışmaları | `nakgo_admin_page('archive'/'retention')` |
| Şikâyet Yönetimi | durum süzgeci, ayrıntı, karar (incelemeye al, çözüldü, reddet, yeniden aç) | `nakgo_admin_reports`, `nakgo_admin_report_set` (#146) |
| Güvenlik ve Denetim | Limit ihlalleri, Yönetici işlemleri, Kullanıcılar | `nakgo_admin_page('security'/'moderation'/'users')`, `nakgo_admin_moderate` |
| Sistem Sağlığı | veritabanı, API v1, gece temizliği, zamanlanmış görevler, güvenlik olayları | `nakgo_admin_page('health')` |

- **Sistem Sağlığı** (`20261118110000_admin_panel_health.sql`): yalnız veritabanında kayıtlı bilgiler. pg_cron kurulu değilse
  görev durumu "okunamıyor" yazar; yedek ve geri yükleme durumu veritabanına yazılmadığı için panelde izlenmez ve üretilmez.
  Görevlerin hata metni döndürülmez.
- **Genel Bakış uyarıları:** açık/incelenen şikâyet, son 24 saatin limit ihlalleri, gecikmiş ya da hiç çalışmamış gece
  temizliği, başarısız zamanlanmış görev, yasal saklamadaki ilan, askıdaki hesap. Sağlık bilgisi alınamazsa "bilinmiyor"
  yazar; sorun yokmuş gibi gösterilmez.
- **Kaldırılanlar:** Genel Bakış'taki yüzdeli özet kartları ve otomatik dönem özeti; Kullanıcılar ve İşlem geçmişi
  sayfalarındaki üst kartlar (aynı sayılar süzgeç çiplerinde var). Sunucu fonksiyonları değişmedi.
- **Menüde olmayanlar:** WhatsApp ilan onayları (taslaklar saklanmıyor; arka uç yok) ve Yasal Kayıtlar (#125, B8; MFA ve
  ayrı yetki ile kendi arayüzü gelecek). Panel bu kayıtların deposu değildir.
- **Şikâyet kararı çakışması** `PT409` ile döner. `nakgo_admin_moderate` hâlâ `40001` döndürür; PostgREST bunu yeniden
  dener ve yanıt gelmez (istemci 15 sn sonra "doğrulanamadı" der). Düzeltme #125 ile birlikte ayrı karar gerektirir.
- Doğrulama: `tests/admin_sections_browser.py` (Chromium, 1280 ve 390 px), `tests/db/admin-health.test.cjs`.

## DEV kurulumu

Sırayla 20261026010000_admin_panel.sql ve 20261026020000_admin_moderation.sql
migration'larını yalnız doğrulanmış DEV projesine uygulayın. Ardından 20261026030000_single_admin_access.sql uygulanır. Hedef hesabı
ve doğrulanmış e-postasını teyit ettikten sonra güvenilir SQL yönetim konsolundan
private.admin_members tablosuna yalnız hedef auth.users UUID'sini ekleyin.
Tek aktif yönetici unique index ile korunur. Diğer hesaplarda profil düğmesi
gizlidir; RPC'ler istemcinin görünürlüğünden bağımsız yetki denetler. İptal için
active=false kullanın. Migration'lar hiçbir hesaba otomatik yetki vermez.
Belge inceleyici atamaları ayrıca yapılır. Service-role anahtarı istemciye konmaz.

## Doğrulama

`admin-regression.yml` mevcut kontrol workflow'larını değiştirmeden bu PostgreSQL
ve admin Chromium kontrollerini her PR'da çalıştırır. PGlite test paketi geçici
klasöre sabit sürümle kurulur; uygulama bağımlılıklarına eklenmez.


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

Canlı DEV kabulü halen gereklidir: tek yönetici + normal kullanıcıyla giriş, rol
iptali, askıya alınmış açık oturumdan yeni faaliyet, Storage işlemleri, eski revizyonla aynı kayda işlem yapıldığında revizyon çatışması ve mevcut taşıma işi akışı.
Hiçbir canlı migration veya rol ataması bu değişiklikle otomatik uygulanmaz.

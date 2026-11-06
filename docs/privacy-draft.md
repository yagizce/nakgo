# NakGo gizlilik / KVKK taslağı — yayıma hazır değil

Veri sorumlusu: **belirlenecek**. Resmi başvuru adresi: **belirlenecek**.
İletişim: destek@nakgolojistik.com. Bu taslak kullanıcı onayı/nihai hukuk görüşü değildir.

| Veri | Amaç / erişim | Saklama ve açık konu |
|---|---|---|
| E-posta, hesap kimliği, profil | Supabase Auth, giriş ve hesap hizmeti; hesap sahibi / görevli | Hesap silme ve hukuki istisna değerlendirmesi; genel 3 yıl kuralı yok |
| Güzergâh, yük, izinli telefon, görsel | İlan hizmeti; 6 saat kullanıcı erişimi | Sonra 8 gün yetkili arşiv; tüm kopya temizliği kabul bekler |
| WhatsApp kaynak/draft | Ayrıştırma, tekrar önleme, hata kurtarma; sunucu/görevli | Tamamlanmış kaynak ve yayımlanmamış aday için 72 saat; başarısız işler ayrıca çözülür |
| Yayın izni/dayanak kanıtı | Kamuya açık telefon yayınının dayanağı | Kısıtlı alan; belge türü ve hukuki süre hukukçu incelemesinde |
| Taşıma, özel taşıyıcı belgeleri, eski görüşmeler | Hizmet ve uyuşmazlık/kanıt | Ayrı ilişki incelemesi; otomatik toplu silme yok |
| Başvuru/işlem kayıtları | Hakların kullanımı ve güvenlik | Başvuru yanıt takibi 30 gün; silme işlem kanıtı en az 3 yıl, içerik kopyası yok |

İşleme şartı her amaç için ayrıca belirlenecek. Aydınlatma ile açık rıza ayrıdır;
her amaç için otomatik rıza varsayılmaz. WhatsApp grubunda paylaşım, NakGo'da
telefonu yayımlama izni değildir. Mevcut yayın için kayıtlı, süreli ve telefon/mesajı
kapsayan dayanak gerekir; geri alma aktif yayını durdurur.

Hizmetler: Supabase (Auth/DB/Storage), Cloudflare (DEV barındırma/Worker),
Vercel (mevcut canlı barındırma), Google (isteğe bağlı giriş), Cloudflare Email
Routing ve Gmail (destek iletileri). Meta bağlantısı beklemede. Ara/WhatsApp
bağlantıları ilgili telefon uygulamasını açar. Yurt dışı aktarım, sağlayıcı sözleşmeleri,
log saklama, yedek süresi ve gerçek kişi/şirket yükümlülükleri ayrıca doğrulanacak.

Mağaza envanteri: iletişim bilgileri, kullanıcı kimlikleri, kullanıcı içeriği ve belgeler,
uygulamadaki işlem geçmişi bulunur. Cihaz/teşhis verileri sağlayıcı loglarına göre
ayrıca doğrulanmalı; izleme/reklam beyanı varsayımla doldurulmamalı. Native SDK,
Google Play Data Safety ve Apple App Privacy beyanları son yayın paketine göre yapılır.

Kaynaklar (6 Kasım 2026):
- [KVKK imha yönetmeliği](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK)
- [Apple hesap silme](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- [Google Play hesap silme](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

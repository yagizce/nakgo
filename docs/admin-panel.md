# Ortakların yönetici paneli — ilk sürüm

Profil > Yönetici paneli. Her ortak kendi doğrulanmış hesabıyla giriş yapar.
Genel sayımlar, kullanıcı/ilan arama ve sayfalama, belge işlem geçmişi sunucuda
kontrol edilen private.admin_members üyeliği gerektirir. Kullanıcı metadata veya
profil alanları yönetici yetkisi vermez. Özel sohbetler ve belge dosyaları bu
RPC tarafından döndürülmez. Belge inceleme mevcut bağımsız reviewer yetkisini
kullanmaya devam eder; admin olmak kendiliğinden belge erişimi vermez.

## DEV kurulumu

20261026010000_admin_panel.sql migration'ını önce DEV'e uygulayın. Her ortağın
hesabını ve doğrulanmış e-postasını teyit ettikten sonra güvenilir SQL yönetim
konsolundan private.admin_members tablosuna gerçek auth.users UUID'sini ekleyin.
İptal için active=false kullanın. İstemciye servis anahtarı eklemeyin. Migration
hiçbir hesaba otomatik yetki vermez. Aynı üyelik kaydı birden fazla ortak için
ayrı ayrı eklenebilir. Belge inceleyici atamaları ayrıca yapılır.

## Sınır ve kabul testi

Bu ilk sürümde kullanıcı askıya alma ve ilan kaldırma yoktur. Bunlar mevcut
RLS ve taşıma işi akışlarıyla birlikte uygulanmalıdır; sahte yönetim düğmeleri
gösterilmez. Ayrı URL yerine uygulamanın mevcut güvenli girişini kullanır.

DEV kabulü: normal ve anonim kullanıcı RPC çağrısında reddedilmeli; iki ayrı
aktif ortak aynı sayımları görmeli; iptal edilmiş ortak yeni istekte
reddedilmeli. Arama, 21+ satırda sonraki/önceki sayfa, boş sonuç ve ağ hatası
kontrol edilmeli. Hesap değişiminde panel kapanmalı ve geciken yanıt yeni
hesaba çizilmemeli. Yetkili reviewer başka bir başvuruyu inceleyebilmeli;
admin-only hesap özel belgeleri açamamalı. Gerçek DEV doğrulaması yapılmadan
üretime alınmamalı.

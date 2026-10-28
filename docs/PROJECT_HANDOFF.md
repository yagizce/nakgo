# NakGo proje devri

## Güncel aşama — 28 Ekim 2026, son üç kabul testi

Üç belge submit/review kabulü TAMAMLANDI. Normal taşıyıcı #5 için üç sentetik JPEG
fiziksel olarak yüklendi/finalize edildi, ayrı inceleyici oturumunda üçü de auth
download ile açıldı. Submit revision 8 -> approved revision 9 -> owner withdraw
revision 10. Ayrı #7 başvurusu üç sentetik JPEG ile submit revision 8 -> gerekçeli
rejected revision 9 -> owner withdraw revision 10. Onay/ret sonuçları her iki
hesaba yansıdı. Kullanıcı işlem-anı onayıyla yalnız belirlediği genel yöneticiye
geçici document_reviewers yetkisi verildi; test sonunda active=false yapıldı.
Son sorgu: 0 aktif reviewer, 1 genel yönetici, iki withdrawn test başvurusu,
#5 için bir approved audit, #7 için bir rejected audit. Test hesabına admin veya
reviewer verilmedi. Gerçek belge yok; sentetik dosyalar private Storage'da kaldı.
Kullanıcının kendi #6 taslağına dokunulmadı. Geçici rol tekrar açık varsayılmaz.

Kullanıcının gerçek iPhone 15 Google girişinde doğru hesap ve mail görünürken
ilk profil açılışında Yönetici paneli yoktu; yenileyince göründü. Production'da
hedef doğrulanmış Auth hesabı, Google identity ve aktif admin üyeliği 1/1/1 idi.
Kök neden profil hydration sırası: renderProfile, profile=null iken adminRole
çağırıyor; listingAccount hata veriyor ve ilk denied sonucu hesap için cache'leniyordu.
Yeni test eski kodda hatayı üretti. PR #36 yalnız profil hazırken ensure çağırır;
server role/strict boolean/account isolation kuralları aynı kalır. Bundle üretildi,
SW nakgo-v43-google-profile-readiness oldu. Dört dosya; protected test/workflow
farkı yok. Yeni test geçti; yerel 576/577, tek EACCES local socket sandbox sınırı.
Tüm GitHub quality-gate (iki koşu), verify ve admin-regression başarılı.
Kullanıcı kesin 7405b508361e4533a2a62eb3280125383519234e için yayını onayladı;
PR #36 main c11f8c17b4e995e1e89a56f76f2fbbff20fadfc2 olarak birleşti.
Production dpl_BNKN6zv4j85BbyKkDimvXFBNYYsC READY; canlı sw.js HTTP 200 v43.
Yeni Google girişinde panelin reload olmadan görünmesi kullanıcıdan teyit bekler.

Telefon ilan denemesinde kullanıcı tarih alanına 'bugün' yazdı; mevcut parsePostDate
28.10.2026 gibi açık tarih beklediğinden reddetti. Kullanıcı türün gerçekten boş
araca dönmediğini, yalnız uyarıdaki müsaitlik kelimesinden öyle düşündüğünü açıkladı.
Tarih giriş davranışı değiştirilmedi. Canlı formda boş tarihle son adıma geçilip
uyarının gizli önceki adım alanına ait olması ayrıca gözlendi; bu UX notu PR #36
ile çözülmüş sayılmaz. Kullanıcıdan yeni Google girişindeki panel ve açık tarih
ile Not ve ekler adımına geçiş sonucunun tamamlanması bekleniyor. Son yanıt
henüz eksik olduğundan üç testin tamamı geçti denmez. Telefon tarayıcısı 'Google'
olarak tarif edildi; Chrome/Google uygulaması ayrımı kesinleştirilmedi.

## Son kabul — 27–28 Ekim 2026, Production moderasyon

Mevcut supabase/tests/admin-moderation.sql Production'da sentetik kayıtlarla
BEGIN/ROLLBACK içinde çalıştı. Askı/kaldırma, askıdan önce kabul edilmiş işin
tamamlanması, askıdaki katılımcıyla yeni talep/kabulün reddi, Storage kısıtları,
ilan remove/restore, eski revision reddi, audit, self/other-admin koruması ve
geçici yetki iptali kontrolleri geçti. Fixture hiçbir yeni yönetici atamaz;
geçici değişikliklerin tamamı ROLLBACK edildi. Gerçek kişilere işlem yapılmadı.

İlk ek sayım kontrolü, transaction dışında tutulduğu varsayılan set_config
anlık görüntüsünün aynı batch ROLLBACK'iyle silinmesi nedeniyle hata verdi.
Kayıtlı anlık görüntü uzunluğu 0 ve mevcut sayımlar doğrulandı. Anlık görüntü
haricen alınıp SQL'e sabit jsonb olarak verildi; paket tekrar çalıştı ve tam
veri/rol/bucket/policy karşılaştırması PASS döndü. Sequence ilerlemesi rollback
olmaz; sayım eşitliği kesintisiz ID dizisi anlamına gelmez.
Son sayımlar: 3 Auth hesabı, 2 profil, 2 kapalı test ilanı, 1 iş, 1 görüşme,
2 test mesajı, 1 geri çekilmiş belge başvurusu, 2 belge metadata kaydı,
1 fiziksel sentetik JPEG, 1 aktif genel yönetici, 0 reviewer,
0 account/listing moderation kaydı ve 0 admin audit. Kişisel veri kaydedilmedi.

Gerçek yönetici tarayıcısında normal test hesabı Aktif hesap, yönetici hesabı
Korumalı göründü. Askıya alma onay formu doğru test hesabının adını ve duracak
faaliyetleri gösterdi. Boş gerekçeyle gönderim HTML required doğrulamasıyla
engellendi. Vazgeç ile çıkıldı; test hesabı aktif ve audit boş kaldı. Bu UI
kontrolü kalıcı askıya alma/geri açma tıklamaları yapılmış gibi sunulmaz;
mutasyon kontrolleri canlı SQL rollback paketinde gerçekleştirildi.
Yeni uygulama kodu, migration, yetki veya deployment değişikliği yapılmadı.
Fiziksel cihaz ve gerçek Google callback doğrulaması açık kalır; Production
belge reviewer ataması/üç belge submit-review kabulü ayrıca kapsam gerektirir.

## Son düzeltme ve kabul — 27 Ekim 2026, özel belge Storage

Production upload testinde bulunan AccessDenied / Sign in required hatası kapatıldı.
PR #35, incelenen 913d87b0fa2aaf67cb7f7fbfd2c17ee4976c2cdb sürümünden main'e
bcf6c837afddd951ed6c4c614fab86dc69a0a946 olarak alındı. quality-gate (iki koşu),
verify 40496082204 ve admin-regression 40496082205 başarılı. Koruma istisnası
kullanılmadı. Production dpl_4Fmkj8NN3tAGFaJWhqMR9CWWFnTb READY; canlı config
HTTP 200, enabled=true, doğru PROD URL'si ve private/no-store doğrulandı.

20261027010000_storage_service_activity.sql yalnız Storage iç servis completion
adımında eksik kullanıcı sub durumunu düzeltir. Eksik aktör sadece service_role /
supabase_storage_admin için var olan rezervasyon sahibi ve tam dosya yolundan
çözülür. Doğrulanmış hesap, askı, başvuru durumu, rezervasyon süresi ve değişmez
kimlik kontrolleri korunur. RLS politikaları, private bucket/JPEG/1 MiB sınırları,
tek genel yönetici ve belge inceleyici üyelikleri değiştirilmedi.

Kullanıcının PR #35 / DEV+Production migration sorusuna verdiği 'en mantıklısı
olması gerekeni yap' yanıtıyla bu dar düzeltme için kapsam sağlandı. Önce eski
hata yeniden üretildi; 15 yeni kontrol, 45 eski DB kontrolü ve 10 SQL suite geçti.
Yeni test mevcut admin CI runner'ına bağlandı. Production ve DEV geçiş dosyaları
önce ROLLBACK ile prova edildi. DEV prova dosyasındaki ayırıcı hatası giderildi;
hiçbir kalıcı değişiklik oluşmadan başarılı prova tekrarlandı. Ardından önce DEV,
sonra Production atomik COMMIT edildi. Sayı/rol/bucket/RLS karşılaştırmaları geçti.

Production migration ledger artık 14 kayıt içerir. DEV'de ledger önceden yoktu;
RLS ve özel izinlerle oluşturuldu, yalnız yeni 20261027010000 kaydı içerir.
Önceki 13 DEV migration kurulu olsa da ledger'da benimsenmiş sayılmaz; tekrar
uygulamayın. DEV kaynak dalı ae39bec olabilir; yeni migration'ın güvenilir kaynağı
main bcf6c83/PR #35'tir. Sırf geçmiş eşitlensin diye schema'yı yeniden kurmayın.

Gerçek fiziksel kabul: normal test hesabı başvuru #2'ye sentetik K-belgesi JPEG
fotoğrafı yükledi; finalize ready oldu ve sahibi auth download ile görseli açtı.
Diğer mevcut Production hesabı aynı nesneyi ve dosya metadata'sını SQL'de
SET LOCAL ROLE authenticated altında göremedi. Bu test ayrı bir tarayıcı HTTP
saldırı testi diye sunulmaz. İlk başarısız SRC rezervasyonu dosyasız reserved
metadata olarak kaldı. Başvuru test sonunda owner RPC ile withdrawn, revision 5
oldu; onay/rozet veya reviewer yetkisi verilmedi. Tarayıcı geri çekme confirm'i
sonrasında yanıt vermediğinden önce sunucu durumu okunup hâlâ draft/revision 4
olduğu doğrulandı; sonra aynı authenticated owner transition RPC'si güvenilir
SQL konsolundan yalnız bu sentetik başvuruya uygulandı. Fiziksel sentetik JPEG
private Storage'da kaldı; gerçek kişisel veri içermez. Kalıcı dosya silme yapılmadı.

Üç belgeyle submit/review ve özel belge onayı bu Production turunda denenmedi;
reviewer ataması ayrı açık onay gerektirir. Sonraki açık işler: moderasyon
mutasyonlarının Production kabulü, fiziksel cihaz ve Google callback doğrulaması.
Yerel npm testte sandbox EACCES nedeniyle 571/572 görülmüştü; aynı PR'ın GitHub
verify işi başarılıdır. Guard/test/workflow gevşetilmedi.

## Son kabul — 27 Ekim 2026, Production sunucu erişim reddi

Gerçek ve e-postası doğrulanmış normal test hesabının UUID'si auth.users'tan
SQL içinde alındı; BEGIN READ ONLY + SET LOCAL ROLE authenticated + yerel
request.jwt.claim.sub ile sunucu yetki sınırları sınandı. nakgo_admin_role ve
nakgo_document_reviewer false döndü. overview/users/listings/audit/moderation
bölümlerinin tamamı insufficient_privilege ile reddedildi. private.admin_members
ve private.document_reviewers doğrudan okuması da reddedildi. Sonuç PASS;
ROLLBACK tamamlandı. Tek aktif yönetici ön koşulu kontrol edildi.
Bu, canlı PostgreSQL rol/RPC kontrolüdür; tarayıcı HTTP isteğiyle yapılmış saldırı
testi olarak sunulmaz. Hiçbir veri veya yetki değiştirilmedi. Önceki 'doğrudan
RPC reddi henüz test edilmedi' notu bu tarihli SQL kontrolüyle güncellenmiştir.
Sonraki açık kabul alanları: fiziksel belge upload/indirme, Production belge
inceleme yetkisi (henüz verilmedi), moderasyon mutasyonları ve fiziksel cihaz.

## Son kabul — 27 Ekim 2026, canlı taşıma işi

Aynı iki gerçek Production oturumuyla yalnız sentetik yük ilanı #14 kullanıldı.
Başlık NAKGO TEST — gerçek yük değildir; açıklama gerçek yük/taşıma/teslim/ödeme
olmadığını belirtir. İstanbul-Ankara, 10 ton, elle girilen 27.10.2026 tarihi.
Normal taşıyıcı talep gönderdi; yük sahibi gelen talebi kabul etti; taşıyıcı
Yükledim bildirdi; yük sahibi Yüklemeyi onayla işlemini tamamladı. İki hesaptaki
sayfa reload sonrasında Yükleme onaylandı durumu korundu. Her iki profil
1 onaylanan iş / 0 devam eden iş gösterdi. Yük sahibi test ilanını kapattı;
aktif ilan sayacı 0 oldu. İlan/iş geçmişi silinmedi.
Bu akış fiziksel teslim doğrulaması veya ödeme değildir; mevcut son adım
YÜKLEME ONAYIDIR. Önceki sohbetlerde teslim denmesi ayrı özellik var anlamına gelmez.
Yeni kod, migration, deployment veya yetki ataması yapılmadı. Test taşıyıcısı
normal hesap olarak kaldı. Gerçek belge yükleme, doğrudan yetkisiz RPC reddi,
moderasyon mutasyonu ve fiziksel cihaz kabulü bu turda yapılmadı.

## Son kabul — 27 Ekim 2026, iki canlı hesap

Kullanıcı isteğiyle geçici e-posta kullanan normal taşıyıcı test hesabı oluşturuldu;
şifreyi kullanıcı girdi. Gerçek NakGo doğrulama e-postası teslim edildi, bağlantı
Production'a döndü ve doğrulanmış oturum açıldı. Bu hesaba yönetici veya belge
inceleyici yetkisi VERİLMEDİ; profilinde yönetici girişi görünmedi.
Yönetici ayrı Production deployment origin'inde e-posta/şifreyle giriş yaptı.
Sentetik İstanbul-Ankara 10 ton boş araç ilanı, elle girilen 27.10.2026 tarihi
ve açık test açıklamasıyla oluşturuldu. Reload sonrası ilan/not korundu.
Yönetici hesabının favorisi reload sonrası kaldı; taşıyıcı favorileri 0 kaldı.
İki açıkça test işaretli mesaj karşılıklı teslim edildi; ilk mesaj alıcıda
1 okunmamış gösterildi, okunduktan sonra profil sayacı temizlendi.
Kendi ilanına mesaj gönderme düğmesi kapalıydı.
Test sonunda ilan sahibi ilanı KAPATTI (silmedi); aktif ilan sayacı 0 oldu.
Yönetici hesabındaki test favorisi kaldırıldı. İki test mesajı geçmişte kaldı.
Normal hesabın UI kısıtı doğrulandı; bu turda doğrudan RPC erişim reddi,
iş talebi/kabul/teslim veya moderasyon mutasyonu test edilmedi.
Yeni kod/migration/deploy yapılmadı; önceki hazır sürüm üzerinde kabul yapıldı.
Geçici posta hesabına gerçek veri eklemeyin; sonraki testte oturum durumunu doğrulayın.

## Son kabul — Production tek genel yönetici

26 Ekim 2026: Kullanıcının işlem-anı açık onayıyla yalnız belirlediği ve
Production'da e-postası doğrulanmış hesap private.admin_members üzerinden
tek aktif genel yönetici yapıldı. Ön kontrolde aktif yönetici 0 ve unique index
mevcuttu; transaction hedef hesabı doğrulayıp başka aktif yönetici varsa işlemi
reddedecek şekilde uygulandı. Son aktif yönetici sayısı 1. Gerçek canlı oturumda
Profil > Yönetici paneli açıldı; sunucudan genel bakış 1 profil, 0 aktif ilan,
0 bekleyen belge, 0 devam eden iş döndü. Belge inceleyici yetkisi verilmedi.
Gerçek kullanıcı/ilan üzerinde deneme moderasyonu yapılmadı. Fiziksel dosya,
iki canlı hesap arasında mesaj/iş ve moderasyon kabulü henüz tamamlanmadı.
Aşağıdaki yetki atanmamış/kayıt bekleniyor ifadeleri önceki aşamanın kaydıdır.
Hesap e-postası ve UUID bu herkese açık rehbere yazılmaz.

## Güncel aşama — 26 Ekim 2026, Production hesap açılışı

Kullanıcının sıradaki hesap açılışı aşamasına devam talebiyle yalnız Production
NAKGO_PRODUCTION_AUTH_ENABLED=true yapıldı. Aynı main 6f23563 sürümü yeniden
yayımlandı: dpl_F66kECX2jtWX1HnkYY3cnJMgEniT READY, nakgo.vercel.app alias bağlı.
Canlı /api/auth/config HTTP 200, enabled=true, marketplaceEnabled=true,
URL kesin PROD fimlifldsivecezbxwuo ve private/no-store olarak doğrulandı.
Main verify ve admin-regression başarılı. Yeni kod veya migration eklenmedi.
Canlı Kayıt ol ekranı açıldı; kullanıcıdan belirlediği yönetici e-postasıyla
kayıt ve e-posta doğrulaması bekleniyor. Gerçek oturum testi henüz tamamlanmadı.
PROD genel yönetici/belge inceleyici yetkisi atanmadı; ayrı işlem-anı onayı gerekir.
DEV oturumları taşınmaz. Aşağıdaki kapalı Auth ifadeleri önceki yayın aşamasının
tarihsel kaydıdır; güncel etkinleştirme durumu bu bölümdür.

Son inceleme: **26 Ekim 2026, Europe/Istanbul**. Önce kökteki `AGENTS.md`
okunur. Bu dosya tarihli bağlamdır; uzak ref, PR, deployment ve veritabanı
gelecek oturumda yeniden doğrulanır.

## 1. İki ayrı ürün ve kaynak

| Ürün | Repo | Yayın |
| --- | --- | --- |
| Mobil web/PWA | yagizce/nakgo | https://nakgo.vercel.app |
| Kurumsal statik site | yagizce/nakgo-website | https://nakgolojistik.com |

Kurumsal sitenin DNS/yayın bağlantısı Cloudflare üzerinden ayrıca doğrulanır.
Eski adres https://nakgo-website.vercel.app. Deneysel nakgo-corporate/Next.js
kaynağı kullanılmaz. Bu mobil rehber site/DNS değişikliği yetkisi vermez.

## 2. Git ve yayın durumu

26 Ekim'de GitHub ve Vercel'den doğrulandı:

- main: `6f23563a52e4bc5894b9ae1e9ee31e432589df55`.
- DEV: `codex/nakgo-email-auth`, `ae39bec912078baa1c88e87815ed792fcac03304`.
- [PR #21](https://github.com/yagizce/nakgo/pull/21) bu kesin DEV sürümünden squash ile main'e alındı.
- Production deployment `dpl_8BcxG4DqWTDDQDNnibMcBueMFgxH` aynı main SHA ile READY.
- https://nakgo.vercel.app/api/auth/config HTTP 200, `{"enabled":false}`, private/no-store.
- PR #31 ve #34 kodları bu sürümdedir. Production hesap bağlantısı ve rol ataması açılmadı.
- [DEV Preview](https://nakgo-git-codex-nakgo-email-auth-yagizces-projects.vercel.app/).

İlk adım yerel status/HEAD/origin ve uzak ref'leri incelemektir. Eski kopyadan
başlamayın; kullanıcının önceki çalışmalarına reset/temizlik uygulamayın. Bu
SHA'lar tarihli kanıttır, yeni oturumda güncel olduklarını varsaymayın.

## 3. Mimari ve kaynak haritası

Bağımlılıksız modüler HTML/CSS/klasik JS ve PWA. React/Next.js/React Native
kullanılmaz. Betikler ortak kapsamda çalışır; isim ve sıra çakışmaları önemlidir.

| Yol | Görev |
| --- | --- |
| tools/project.js | Tek JS/CSS yükleme sırası |
| src/index.template.html, src/js/, src/css/ | Düzenlenecek kaynaklar |
| src/js/cloud.js | Eski host ile ayrı Supabase Auth/market/jobs/favorites/messages API ve state katmanları |
| src/js/features/account.js | Hesap akışları ve nakgoDocuments özel belge durumu |
| src/js/features/listings.js, offers.js | İlan ve taşıma davranışları |
| src/js/screens/ | Ekranlar; main.js yönlendirir, profile.js profil |
| src/js/ui/dialog.js | Sheet odağı, inert arka plan, kapatma |
| api/auth/config.mjs | Açık istemci yapılandırması; Production Auth bağlantısı kapalı |
| supabase/migrations/, supabase/tests/ | Şema, RLS/RPC, sentetik SQL kontrolleri |
| api/whatsapp/, server/whatsapp/ | Etkinleştirilmemiş WhatsApp V1 temeli |
| assets/brand/, tools/brand.js | Logo kaynakları ve ikon üretimi |
| index.html, public/, www/ | Üretilen bundle/yayın/mobil kabuk çıktıları |

Kaynak değişince `npm run bundle`; yeni modül varsa project.js güncellenir.
index.html elle düzenlenmez. SW yalnız uygulama kabuğunu önbellekler; kişisel
API/dosya ve harita istekleri önbelleklenmez. Kabuk değişiminde SW sürümü ve
eski cache'den güncelleme davranışı doğrulanır.

## 4. Gerçek hesap ve demo ayrımı

Production/yerel statik uygulama ile DEV bağlantısı aynı mod değildir.
`api/auth/config.mjs` Production'da iki açık etkinleştirme anahtarı ve kesin PROD URL'si ister.
NAKGO_PRODUCTION_AUTH_ENABLED=false olduğu için bağlantı kapalıdır.
Bu güvenceyi yanlış env değerlerini telafi etmek için kaldırmayın.

Demo ilan/iş/sohbet/belge/favori/üyelik `yy2` gibi yerel kayıtlarda, gerçek
Supabase oturumu ayrı SDK kaydındadır. Gerçek kayıt demo deposuna taşınmaz.
account_type ürün tercihidir; yönetici/Premium rolü değildir.

Auth: e-posta/şifre, doğrulama, Google PKCE ve recovery. Kullanıcının önceki
teslimine göre Resend SMTP kuruldu ve gerçek e-posta teslimi doğrulandı.
Eski supabase-setup.md içindeki SMTP kurulmadı notu tarihsel kalmıştır.
Google izinli dönüş adresi farklı Preview'dan sabit origin'e döndürebilir:
kabul testinde URL, hesap ve commit birlikte doğrulanır. İki originin
oturumları ayrı olabilir; sadece giriş bildirimi doğru sekme kanıtı değildir.

Eski architecture.md/product.md/supabase-setup.md demo veya ilk Auth aşamasını
da anlatır. İlan/mesaj hâlâ demo, ilk mesaj işi oluşturur veya belge checkbox'ı
rozet verir ifadeleri gerçek DEV hesap akışı için esas alınmaz. Güncel
kaynak/RPC ve bu tarihli durum birlikte incelenir.

## 5. Çalışan DEV özellikleri

### Profil, ilan ve işler

Özel profil/iletişim; sahiplik korumalı ilan/fotoğraf/düzenleme/kapatma/arşivleme
bağlıdır. Yükleme/müsaitlik alanları boş başlayan manuel metindir. Otomatik
tarih/date picker eklenmez. Görünür metin ile sunucudaki normalize tarih/saat
alanları karıştırılmaz. Taşıma ücret alanları geri getirilmez.

Gerçek yük akışı: aktif başkasının yüküne talep → sahibi kabul/ret → taşıyıcı
bekleyen talebi geri çekebilir → kabul edilmiş işte taşıyıcı Yükledim → yük
sahibi onaylar. transport_jobs yalnız iki katılımcıya açıktır; yazma RPC'den
geçer. İlan özeti iş geçmişinde kalır. Profil sayaçları hesap genelindeki gerçek
toplamdır. İş onayı ödeme veya hukuki teslim sistemi olarak sunulmaz.

### Favoriler ve mesajlar

Favoriler hesap bazında kalıcı; feed'den bağımsız kaydedilenler ve erişilemeyen
ilan yer tutucusu vardır. İki hesap izolasyonu/yenileme/kaldırma gerçek oturumda
denenmiştir. Sohbet yalnız ilan sahibi ile konuk arasındadır. Mesaj, geçmiş,
okunmamış toplamı ve okuma sınırı sunucudadır. Uygun olmayan ilandan yeni
sohbet açılamaz; mevcut geçmiş korunur.

Idempotent nonce ile gönderim ve hesaba özel session taslağı reload/aç-kapa
sonrası korunur. Taslak saklanamazsa gönderim başlamaz. Görünen mesajlar okunur;
DOM gereksiz kurulmaz, eski geçmiş okuma kaydırması korunur. Normal görünür
polling 8 saniye, hata backoff en fazla 60 saniye, ağ sınırı 15 saniyedir.
Hesap/ekran değişiminde geç yanıt ve eski döngü geri dönmemelidir.

### Belgeler ve bağımsız inceleme

carrier_applications/files/audit tabloları ve private carrier-documents bucket.
Kaynak JPEG/PNG boyut/piksel sınırıyla JPEG'e normalize edilir; Storage JPEG,
en fazla 1 MiB kabul eder. Türler SRC, K yetki, ruhsat. Rezervasyon/finalize
akışı yarım yüklemeyi kurtarır. Yollar sunucuda türetilir; overwrite yoktur.
Metadata kaldırılmadan önce Storage sonucu doğrulanır. Storage mutasyonları
başvuru satırıyla kilitlenir. Özel görüntüleme auth indirme ve yerel blob URL'dir.

draft → submitted → approved/rejected; withdraw onayı kaldırır. Gönderilmiş
dosya değiştirilemez; revizyon eskiyse reddedilir. Yükleme tek başına rozet
vermez. Minimal rozet yanıtı yalnız sunucu onaylı kullanıcı kimliklerini döndürür.
private.document_reviewers ayrı üyeliktir; istemci atayamaz, kişi kendini
onaylayamaz. Kullanıcının belirlediği doğrulanmış hesaba yalnız DEV belge
inceleme yetkisi açık onayla verildi; e-postası/UUID'si kaynakta sabitlenmez.
Bu üyelik PR #31'in genel admin rolü değildir.

Gerçek owner/reviewer kabulü üç sentetik yükleme, özel önizleme, gönderme,
reload, bağımsız onay ve ilanda rozetle geçti. Başvuru #3 sonra server transition
ile geri çekildi; rozet kalktı, bir onay/bir withdraw audit'i kaldı. Üç küçük
sentetik dosya private DEV'de kaldı. Gerçek kişisel belge kullanılmadı.

## 6. Ortam ve migration

| Ortam | Supabase project ref |
| --- | --- |
| DEV / nakgo-dev | axkotffqrsddbrazhcwj |
| PROD / nakgo-production | fimlifldsivecezbxwuo |

main/PROD migration/promotion ayrı kullanıcı kapsamı gerektirir. Preview env
adları NAKGO_AUTH_ENABLED, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Değerleri
belgeye/loga eklemeyin. Yeni branch'e Preview env otomatik taşınmış sayılmaz.
Service-role/OAuth secret/frontend anahtarı aynı şey değildir; secret frontend'e
konmaz. Yönetici hesap kimliklerini public rehbere sabitlemeyin.

DEV'de uygulanan migration dizisi 20261014000000_profiles.sql ile başlayıp
20261025230000_private_carrier_documents.sql ile biter: profil detayları,
ilan/fotoğraf/saat, işler, favoriler, mesajlar ve sender index dahildir.
SQL Editor uygulaması CLI migration ledger'ı değildir; tekrar çalıştırmadan
şemayı doğrulayın. RLS kapatmak/tablo silmek çözüm değildir. SQL testleri
sentetik transaction/rollback'tir, gerçek Auth/Storage servisini kanıtlamaz.

## 7. PR #31 yönetici paneli — tek hesapla DEV’de etkin

src/js/screens/admin.js, profil girişi, API wrapper'ları, üç migration ve
[admin kurulum rehberi](https://github.com/yagizce/nakgo/blob/codex/nakgo-admin-panel/docs/admin-panel.md)
eklenmiştir. Özet, kullanıcı/ilan arama/sayfalama ve audit listeleri; gerekçeli
askı/kaldırma, revizyon/audit ve kapalı duruma restore vardır.

private.admin_members her RPC'de kontrol edilir; belge inceleyiciliği vermez.
Askı Auth ban değildir: giriş/geçmiş ve önceden kabul edilmiş işi bitirme
korunur; eski ilanlar otomatik kaldırılmaz. 20261026010000_admin_panel.sql,
20261026020000_admin_moderation.sql ve 20261026030000_single_admin_access.sql
DEV'e uygulandı. Kullanıcının açık işlem-anı onayıyla yalnız belirlediği doğrulanmış
hesap genel yönetici yapıldı. Hesap e-postası/UUID kaynakta sabitlenmez.
Tek aktif yönetici unique index ile korunur. Profil girişi yalnız sunucu rolü
strict true ise görünür; hesap değişimi ve geç yanıt temizlenir. Canlı SQL
kabulünde diğer iki mevcut DEV hesabının rol/panel erişimi reddedildi; atanmış
hesabın gerçek tarayıcı oturumunda panel açıldı ve korumalı yönetici satırı görüldü.
Deneme moderasyonu veya başka ürün değişikliği yapılmadı.

26 Ekim incelemesindeki askı/kabul açığı PR #31'de düzeltildi. Yeni talep ve
kabul sırasında aktör, yük sahibi ve taşıyıcının aktif olması gerekiyor;
katılımcı kilitleri UUID sırasıyla alınıyor. Ek regression testi eski kodda
başarısız oldu, düzeltmeden sonra geçti. Askıdan önce kabul edilmiş işin
her iki katılımcı askıdayken de tamamlanabildiği ayrıca doğrulandı.

İlan kaldırma/restore onayı artık ilan #id ve rotayı gösterir. Yeni read-only
admin-regression.yml bu PostgreSQL ve Chromium kontrollerini PR'larda çalıştırır.
Son erişim CI'ları 40301475019 ve 40301475613 başarılı: 551 uygulama, 407 E2E,
45 PostgreSQL ve mobil/masaüstü yönetici Chromium kontrolü. DEV aynı commit'te READY.

## 8. Test ve kalite kapısı

```sh
npm run bundle
npm test
npm run test:static
npm run test:gate
npm run test:guard
npm run test:e2e
npm run test:browser
npm run mobile:prepare
```

Node 18+, Python, tests/requirements.txt sabit Playwright sürümü ve Chromium
gerekir. npm start dış ağa açılmayan yerel demodur. Windows python alias'ı
yoksa kurulu Python'ın tam yolunu kullanın. Sandbox yerel portu engellerse
testi değiştirip geçirmeyin; erişimle tekrar doğrulayın veya sınırlamayı bildirin.

- [DEV belge CI](https://github.com/yagizce/nakgo/actions/runs/40222583797):
  542 uygulama, 407 E2E ve mobile geçti. Bağımsız browser 197 kontrol/11 senaryo.
  DEV baseline guard 57/57; main gate başarısı değildir.
- [Admin CI](https://github.com/yagizce/nakgo/actions/runs/40299402263) ve
  [admin regression CI](https://github.com/yagizce/nakgo/actions/runs/40299402277) son düzeltme commit'inde başarılı; yeni oturumda güncel sonuçları doğrulayın.
  26 Ekim yeniden çalıştırma: 545/545 uygulama, 53/53 statik, HTML 0 hata,
  41 PGlite kontrolü, 407 mevcut E2E ve mobil/masaüstü admin Chromium kontrolleri geçti.
- tools/admin-db-check.cjs isteğe bağlı @electric-sql/pglite kullanır. Runtime
  bağımlılığı değildir. Sentetik Auth/Storage şeması gerçek servis veya çok
  bağlantılı eşzamanlılık testi değildir.
- UI değişince 360/390/430 px, iki tema, masaüstü, sheet/klavye, uzun metin,
  boş/hata durumu, hesap değişimi ve reload kontrol edilir.

Tarihsel kalite engeli: dört tarih testi ve tools/project.js eski main tabanından
farklı olduğu için quality-gate 35/40 kaldı. Beş fark incelendi ve kullanıcı
kesin ae39bec sürümü için tek seferlik yönetici istisnasını açıkça onayladı.
26 Ekim'de PR #21 birleştirildi; bypass engeli hemen geri açılıp yeniden okundu.
Eski gate başarısızlığı başarılı diye sunulmaz; guard/workflow gevşetilmedi.
Bu istisna sonraki işlemlere izin değildir.

## 9. Korunacak kayıtlar ve kalan işler

DEV orijinal test yükü #16 ve tamamlanan iş #9 korunur. Sentetik araç kapalı,
favori test kayıtları temiz, iki açıkça test işaretli sohbet mesajı geçmiştedir.
Tarihleri geçmiş olabilir; yeni kabul için ayrı sentetik fixture kullanın.
Gerçek kullanıcı verisi üzerinde deneme kararı veya toplu temizlik yapmayın.

26 Ekim canlıya hazırlık kabulü: PR #33 test bakımı DEV'e fast-forward ile
alındı. Güncel DEV `a450ab889511be07311c823d768f5489eeea71a0`; uygulama runtime
kaynakları değişmedi. verify 40305515816 ve admin-regression 40305515989 başarılı.
45 yerel PostgreSQL kontrolü ve 10 SQL paketi geçti; aynı 10 paket canlı DEV'de
BEGIN/ROLLBACK ile çalıştı. Kullanıcı/profil/ilan/iş/mesaj/belge/Storage ve aktif
yönetici kayıt sayıları korundu. Bağımsız browser 197 kontrol/11 senaryo,
kalite otomasyonu 16/16 ve production npm audit 0 bulgu. PGlite Storage/Auth
şeması gerçek servis veya eşzamanlı bağlantı kabulünün yerine geçmez.

Production bağlantısı hazırlığı PR #34 ile DEV'e alındı. Güncel DEV
`ae39bec912078baa1c88e87815ed792fcac03304`. Production Auth yalnız
NAKGO_AUTH_ENABLED=true + NAKGO_PRODUCTION_AUTH_ENABLED=true ve kesin PROD
proje URL'siyle açılır. Preview/Development PROD URL'sini reddeder; Production
DEV URL'sini reddeder. Yeni regresyon paketiyle 578/578 uygulama, 16/16 otomasyon,
53/53 statik ve HTML 0 hata. PR #34 verify 40340704583 ve admin-regression
40340704538 başarılı; READY Preview gerçek config endpoint'inde HTTP 200,
enabled=false ve private/no-store doğrulandı.

Vercel'de dört değişken yalnız Production kapsamındadır. Production etkinleştirme
anahtarı false kalır. Kullanıcının açık tek seferlik onayıyla ae39bec sürümü
PR #21 üzerinden main'e alındı. verify 40346471224 ve admin-regression
40346471743 başarılıydı; quality-gate 40346471555 beş korumalı farkta 35/40 kaldı.
Yalnız "Do not allow bypassing the above settings" geçici kapatıldı ve merge
sonrasında hemen tekrar açıldı; kaydedilmiş değer yeniden okunarak doğrulandı.
PR, güncel dal, GitHub Actions kaynaklı quality-gate + verify gereksinimleri
korundu. Force push ve dal silme kapalı kaldı. Production READY; Auth hâlâ kapalı.

26 Ekim Production şema kurulumu tamamlandı. Kullanıcı, 12 migration'ın
kurulumunu açıkça istedi. Mevcut FREE plan korundu. İlk profiles migration'ının
sütunları, constraint/RLS/policy ve sütun izinleri doğrulanıp yeniden çalıştırılmadan
baseline olarak benimsendi. DEV `a450ab889511be07311c823d768f5489eeea71a0`
kaynağındaki kalan 12 migration sırayla tek transaction içinde uygulandı.
Önce aynı batch Production'da ROLLBACK ile prova edildi; ardından COMMIT edildi.

`supabase_migrations.schema_migrations` artık 13 sürümü/name/source statements
ile izler. İlk sürüm benimsenmiş baseline, diğerleri uygulanmış migration'lardır.
Son sürüm `20261026030000_single_admin_access`. Migration kaynak checksum'ları
CRLF/LF farkı normalize edilerek 13/13 eşleşti. Gelecek ajan tüm migration'ları tekrar çalıştırmamalıdır.
14 public/private uygulama tablosunda RLS açık; anonim tablo/RPC erişimi yok.
carrier-documents bucket private, JPEG ve 1 MiB sınırında; fiziksel nesne yok.

Production'da 9 mevcut SQL paketi sentetik fixture + BEGIN/ROLLBACK ile geçti.
Genel yönetici üyeliği bulunmadığından admin-moderation.sql pozitif rol paketi
Production'da çalıştırılmadı; yetkisiz admin rolü/dashboard/moderasyon reddi
ayrıca doğrulandı. Mevcut Auth hesabı sayısı 1 korundu; bütün uygulama tabloları
boş kaldı. Kalıcı test verisi, genel yönetici veya belge inceleyici ataması yok.
Sequence değerleri rollback ile geri alınmaz; ID'lerin 1'den başlayacağı varsayılmaz.
Fiziksel Storage upload/indirme veya gerçek hesapla admin kabulü yapılmış sayılmaz.

Production uygulaması main `6f23563a52e4bc5894b9ae1e9ee31e432589df55` ile READY.
Hesap bağlantısının kapalı olduğu canlı endpoint'ten doğrulandı. Kurulum
başarısızlığında transaction rollback korur; commit sonrası otomatik tablo/drop
veya veri silen down migration çalıştırmayın. Yeni veri geldiyse önce yedek ve
ayrı düzeltme planı gerekir. Yerel outputs içindeki preflight/manifest/kurulum ve
kabul kanıtları şema kurulumunu kaydeder; Auth sırları veya kullanıcı verisi dump'ı değildir.

PROD Email ve Google sağlayıcıları, e-posta doğrulaması ve özel SMTP etkin;
SMTP host smtp.resend.com, port 465. Kimlik bilgileri okunmadı/yayımlanmadı.
Site URL ve görünen redirect allowlist `https://nakgo.vercel.app/`.
E-posta teslimi ve gerçek Google callback'i ayrıca uçtan uca doğrulanmalıdır.
Vercel hesap bağlantısı değişkenleri Preview ve Production'da ayrı kapsamlardadır;
Production etkinleştirme anahtarı kapalıdır. DEV yöneticisinin doğrulanmış hesabı
PROD'da yok; DEV UUID/üyelikleri taşınmaz. PROD rol ataması yapılmadı.

Önerilen sıra (kullanıcının verdiği görev kapsamına göre):

1. Production Auth açılışını ayrıca kapsamlandırın; mevcut anahtar false kalır.
2. PROD migration geçmişini okuyun; 12 migration zaten kurulu, tekrar uygulamayın.
3. Ayrı PROD kayıt/doğrulama sonrası tek yönetici atamasını açık onayla yapın;
   DEV UUID veya üyeliklerini taşımayın.
4. SMTP teslimi, Google callback, fiziksel cihaz, gerçek dosya ve Production
   hesap/moderasyon kabulünü tamamlayın. READY yayını bu testlerin yerine geçmez.
5. Rehber PR #32 hâlâ taslaktır; eski tabanını incelemeden birleştirmeyin.

Ödeme/Premium entitlement, push, mesaj eki, Apple giriş, gerçek telefon
 doğrulaması ve WhatsApp aktivasyonu tamamlanmış değildir. WhatsApp V1 imza
kontrol/parser temelidir; gerçek mesaj göndermez/ilan yayımlamaz. AI, scraping
ve WhatsApp Web otomasyonu etkinleştirilmiş varsayılmaz.

## 10. Yeni sohbete verilecek kısa metin

> Bu depoda önce AGENTS.md ve docs/PROJECT_HANDOFF.md oku. Yerel değişiklik,
> uzak branch/PR ve Preview commit'ini doğrula. Çalışan DEV admin durumunu ve tek yönetici
> sınırını doğrula. Statik mimariyi, boş manuel tarihleri, RLS ve kalite kapısını
> koru. Güncel durumu ve sıradaki somut adımı özetleyip verdiğim görev kapsamında
> ilerle; main/Production değişikliği varsayma.

Rehberin bulunduğu branch'i veya GitHub dosya bağlantısını yeni ajana verin.
Main'e alınmamış dosyanın yalnız main'i açan araçça otomatik okunacağı
varsayılmaz. Kalıcı aşama sonunda rehberi tarih/commit/PR/migration/kabul ve
engellerle güncelleyin; özel hesap bilgisi veya geçici log eklemeyin.

# NakGo proje devri

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

26 Ekim'de GitHub'dan doğrulandı:

- main: `5b46c28f03528a3ae9e4ada25bb6405a268a8a5a`.
- Çalışan DEV: `codex/nakgo-email-auth`, `b0df3bdf987daed91b952ccbd92b3da6313f798f`.
- [Taslak PR #21](https://github.com/yagizce/nakgo/pull/21) DEV toplamını main'e önerir;
  Production'a taşınmadı.
- [DEV Preview](https://nakgo-git-codex-nakgo-email-auth-yagizces-projects.vercel.app/).
- Geceki admin dalı: `codex/nakgo-admin-panel`, `b0df3bdf987daed91b952ccbd92b3da6313f798f`.
  [PR #31](https://github.com/yagizce/nakgo/pull/31) DEV dalına alındı;
  main/Production'a alınmadı.

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
`api/auth/config.mjs` VERCEL_ENV=production iken Auth bağlantısını kapatır.
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

Ana kalite engeli: #25 tarih testi bakımı DEV'e alındı; tests/e2e.py,
tests/forms.py, tests/reliability.py, tests/gate/browser.py main tabanından
farklıdır. Main guard korumalı farkları bilerek engeller. Güvenilir taban/insan
incelemesi olmadan korumayı kaldırmayın, base-ref'i keyfi değiştirmeyin veya
feature CI'ını tüm main kapıları geçti diye sunmayın.

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

Vercel'de dört değişken yalnız Production kapsamına eklendi. Ayrı Production
etkinleştirme anahtarı false; uygulama yayını/promote veya yetki ataması yapılmadı.
Main'e geçiş gate'i aynı beş korumalı farkta 35/40: 40346471555. GitHub classic
main kuralı PR, güncel dal, GitHub Actions kaynaklı quality-gate + verify ister;
"Do not allow bypassing the above settings" açık. Bu ayar değiştirilmedi.
Kontrollü bakım geçişi için açık kullanıcı kararı gerekir; eski genel devam
isteğini güvenlik korumasını azaltma izni saymayın.

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

Production uygulaması hâlâ main `5b46c28f03528a3ae9e4ada25bb6405a268a8a5a`.
Uygulama/env/Auth koruması bu veritabanı kurulumuyla değiştirilmedi. Kurulum
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

1. Main guard 35/40: dört tarih testinin yanında `tools/project.js` de korumalı
   farktır. Beş farkı güvenilir bakım incelemesiyle çözün; guard'ı gevşetmeyin.
2. PROD migration geçmişini ve şemayı tekrar okuyun; 12 migration artık kurulu.
   Production env/Auth açılışı ve uygulama yayını ayrı kapsamdır; otomatik açmayın.
3. Ayrı PROD kayıt/doğrulama sonrası tek yönetici atamasını açık kapsamla yapın;
   rol iptali, askı, revision conflict ve gerçek dosya kabulünü doğrulayın.
4. Fiziksel cihaz, SMTP teslimi, Google callback ve Production smoke kabulünü
   tamamlayıp ondan sonra main/Production geçişini değerlendirin.

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

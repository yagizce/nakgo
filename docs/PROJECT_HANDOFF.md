# NakGo proje devir rehberi

Son güncelleme: **28 Ekim 2026 — Europe/Istanbul**.
Önce [AGENTS.md](../AGENTS.md), sonra bu rehber okunur. Bu dosya mevcut ürünü,
kararları ve kabul kanıtlarını yeni ajana devreder; yeni özellik veya yetki
vermez. Yeni kapsam: WhatsApp V2 GitHub/Preview ve DEV kabulü.
Dal push edildi, Preview dağıtıldı ve WhatsApp migration yalnız DEV'e uygulandı.
Production değişikliği ve main birleştirmesi yapılmadı. [Teknik devir](whatsapp-review.md).

## 1. Güncel durum ve tamamlanan kabul

Mobil uygulama Production'da gerçek hesaplarla çalışmaktadır. Auth kapalı,
Production boş veya yönetici yalnız DEV'de gibi eski notlar güncel değildir.

| Konu | 28 Ekim 2026 durumu |
| --- | --- |
| Repo / canlı adres | `yagizce/nakgo` / https://nakgo.vercel.app/ |
| Son uygulama değişikliği | [PR #37](https://github.com/yagizce/nakgo/pull/37), uygulama commit'i `d9764131ce431710ae1cb8c3ff49a721f94a14e1` |
| Doğrulanmış Production yayını | `dpl_C9dme3Am3brNuKV1A2TEL2CYuAzg`, READY, canlı alias aynı uygulama commit'inde |
| Uygulama kabuğu | `nakgo-v44-free-text-loading`; canlı sw.js HTTP 200 |
| E-posta / Google | Production bağlantısı açık; kayıt, e-posta doğrulama ve gerçek Google girişi kabulü tamamlandı |
| Yönetici | Sunucudan korunan tek aktif genel yönetici; diğer hesaplar panel/RPC erişimi alamaz |
| Belge inceleyici | Genel yöneticiden ayrı rol; Production geçici test yetkisi geri alındı, son kontrolde 0 aktif inceleyici |
| Yükleme tarihi | Yük ilanında zorunlu serbest metin; boş/yalnız boşluk reddedilir; Not ve ekler geçişi aynı |
| Fiziksel telefon kabulü | Kullanıcı iPhone 15'te Google sonrası yönetici panelini ve yeni metinle ilan yayımlamayı doğruladı |
| Migration | Production `20261028010000_load_timing_text`; DEV ayrıca `20261028020000_whatsapp_review` kayıtlı |
| GitHub koruması | PR, güncel dal, GitHub Actions kaynaklı quality-gate + verify gerekli; yönetici bypass engeli açık; force push/silme kapalı |

Bu commit ve deployment **son uygulama yayınının kanıtıdır**. Yalnız belge
commit'leri de main SHA'sını değiştirebilir. Yeni oturumda uzak ref/deployment
okunmadan bu tarihli değerler güncel HEAD diye sunulmaz.

Tamamlanan gerçek hesap kabulü: profil/oturum, iki hesap arasında ilan ve
fotoğraf, favori izolasyonu/yenileme, iki yönlü mesaj ve okunma, taşıma talebi ve
yükleme onayı, özel belge yükleme/indirme/inceleme, genel yönetici sınırları.
Önceki uygulama kabulü bitti. WhatsApp V2 ayrı draft PR #38 ve DEV Preview'da doğrulandı; Production'a alınmadı.

## 2. Ürün sınırları ve kaynak seçimi

| Ürün | Kaynak | Kapsam |
| --- | --- | --- |
| Mobil web/PWA | `yagizce/nakgo` | Bu rehberin konusu |
| Kurumsal site | `yagizce/nakgo-website` | Ayrı repo; site/DNS değişikliği bu görevden çıkarılamaz |
| Deneysel kurumsal kaynak | `nakgo-corporate` / Next.js | Mobil ürünün temeli değildir |

Eski yerel kopya veya `codex/nakgo-email-auth` dalı güncel main'den geride
olabilir. Önce yerel status/HEAD/origin ve uzak main/ilgili PR karşılaştırılır.
Kullanıcının değişiklikleri korunur; toplu reset, temizlik ve staging yapılmaz.

Modüler HTML/CSS/klasik JavaScript + PWA kullanılır. React/Next.js/React Native
geçişi yoktur. Tek ortak JS kapsamı nedeniyle yükleme sırası ve ad çakışmaları
önemlidir. Marka turkuaz/sarı, iki tema, en fazla 430 px tek sütun ve alt menüdür.
Logo/splash/ikonları veya ürün alanları sebepsiz değiştirilmez.

## 3. Kaynak haritası

| Yol | Sorumluluk |
| --- | --- |
| [tools/project.js](../tools/project.js) | Tek JS/CSS modül yükleme sırası |
| [src/index.template.html](../src/index.template.html), [src/js](../src/js/), [src/css](../src/css/) | Düzenlenecek kaynaklar |
| [src/js/cloud.js](../src/js/cloud.js) | Eski host adaptörü, Supabase Auth/API; market/jobs/favorites/messages oturum durumları |
| [src/js/data.js](../src/js/data.js) | Veri normalizasyonu, tarih/metin ve form kuralları |
| [src/js/screens/post.js](../src/js/screens/post.js), [src/js/ui/post-draft.js](../src/js/ui/post-draft.js) | İlan formu, adımlar ve hesaba göre taslak |
| [src/js/features/listings.js](../src/js/features/listings.js) | Kart, düzenleme, kapatma/arşiv, süre ve ilan davranışı |
| [src/js/features/offers.js](../src/js/features/offers.js), [src/js/screens/offers.js](../src/js/screens/offers.js) | Demo iş davranışı ve gerçek hesap iş ekranı |
| [src/js/features/account.js](../src/js/features/account.js) | Hesap, özel belge başvuruları ve nakgoDocuments durumu |
| [src/js/screens/profile.js](../src/js/screens/profile.js), [src/js/screens/admin.js](../src/js/screens/admin.js) | Profil, rol görünürlüğü ve yönetici paneli |
| [src/js/screens/inbox.js](../src/js/screens/inbox.js) | Görüşme/mesaj arayüzü |
| [src/js/screens/main.js](../src/js/screens/main.js) | Ekran yönlendirme |
| [src/js/ui/dialog.js](../src/js/ui/dialog.js) | Sheet, odak, inert arka plan ve kapatma |
| [api/auth/config.mjs](../api/auth/config.mjs) | Ortama bağlı açık istemci yapılandırması |
| [supabase/migrations](../supabase/migrations/), [supabase/tests](../supabase/tests/) | Şema/RLS/RPC ve rollback SQL kontrolleri |
| [assets/brand](../assets/brand/), [tools/brand.js](../tools/brand.js) | Logo kaynakları ve ikon üretimi |
| [index.html](../index.html), public/, www/ | Üretilen uygulama/yayın/mobil kabuk çıktıları |

Kaynak değişince `npm run bundle` çalışır; index.html elle düzenlenmez.
Sadece belge değişikliğinde bundle/SW değiştirilmez. public/ ve www/ Git dışı
çıktılardır. SW yalnız kabuğu önbellekler; kişisel API/dosya ve harita istekleri
önbelleklenmez. Kabuk değişirse SW sürümü ve eski cache'den geçiş doğrulanır.

## 4. Gerçek hesap, demo ve oturum güvenliği

Demo ilan/iş/mesaj/favori/üyelik yerel `yy2` gibi kayıtlardadır. Gerçek Supabase
SDK oturumu ve hesap verileri ayrıdır. Gerçek kaydı demo deposuna taşımayın.
`account_type` ürün tercihidir; yönetici, belge onayı veya Premium yetkisi vermez.

Auth; e-posta/şifre, e-posta doğrulama, Google PKCE ve recovery içerir. Resend
SMTP kurulumu/e-posta teslimi kabul edilmiştir; credential bu rehberde tutulmaz.
Google dönüşünde URL, hesap ve uygulama sürümü birlikte kontrol edilir. Farklı
originlerin oturumları farklı olabilir; bir sekmede giriş diğerini doğrulamaz.

Production config iki etkinleştirme anahtarı ve kesin Production URL'si ister.
Preview/Development, Production Supabase URL'sini; Production, DEV URL'sini
reddeder. Bu ortam denetimini yanlış env değerini telafi etmek için kaldırmayın.
Config yanıtı açık istemci ayarıdır; secret/service-role/OAuth anahtarı içermez.

Hesap değişimi sırasında geç yanıtlar, eski polling, rol, taslak ve blob URL'leri
temizlenir/reddedilir. Gerçek ilan oluşturulunca yalnız doğrulanmış sunucu yanıtı
listeye girer. Ağ hatasında yerel hayalet ilan veya sahte başarı üretilmez.

## 5. Çalışan ürün davranışları

### İlan, serbest yükleme metni ve işler

Profil/özel iletişim, sahiplik kontrollü ilan, fotoğraf, düzenleme, kapatma ve
arşivleme bağlıdır. İlanlar public anonim veri olarak açılmaz.

**Yük ilanı yükleme tarihi:** başlangıçta boş manuel alan, mevcut sınır 32
karakter. `bugün`, `yarın sabah`, `uygun olduğunda` gibi dolu metinler kabul
edilir. Yalnız boş/whitespace yayınlanmaz. Son adıma geçiş tarih için kesilmez.
Yeni metin `loading_text` içinde aynen saklanır ve çizim sınırında kaçışlanır;
`available_on` null, otomatik gün/bitiş tarihi yoktur. Metinli yük sahibi
kapatana/arşivleyene veya moderasyon kaldırana kadar açık kalabilir. Takvim günü
bilinmeyen metni bugün/yarın filtresine uydurmayın.

Eski takvim kayıtları değiştirilmemiştir; onların mevcut takvim düzenleme akışı
korunur. Yeni metinli yükün düzenlemesi de serbest metindir. Boş araç ilanının
müsaitlik tarihi/saat doğrulaması ayrı ve geçerlidir. Otomatik tarih/date picker,
varsayılan seçim veya alan altı açıklama eklemeyin. Ücret alanlarını geri getirmeyin.

Gerçek yük akışı: başkasının aktif yüküne talep → sahip kabul/ret → bekleyen
talebi geri çekme → taşıyıcının Yükledim işlemi → yük sahibinin yükleme onayı.
Bu, ödeme veya fiziksel teslimat takibi değildir. transport_jobs yalnız iki
katılımcıya açıktır; yazma RPC üzerinden geçer, ilan özeti geçmişte korunur.
Sayaçlar gerçek hesap toplamıdır. Yeni metinli yükün snapshot'ı da metni taşır.

### Favoriler ve mesajlar

Favoriler hesap bazında kalıcıdır; feed dışında kaydedilen ilanlar ve artık
ulaşılamayan ilan yer tutucusu desteklenir. Gerçek iki hesap izolasyonu,
yenileme ve kaldırma kabulü tamamlanmıştır.

Sohbet ilan sahibi ve konuk arasındadır. Mesaj/geçmiş/okunmamış toplamı/okuma
sınırı sunucudadır. Uygun olmayan ilandan yeni sohbet açılamaz; katılımcı geçmişi
korunur. Gönderim nonce ile idempotenttir; hesaba özel session taslağı reload ve
aç/kapa sonrasında korunur. Taslak saklanamazsa gönderim başlamaz. Görünür
mesajlar okunur; geçmiş okuma kaydırması korunur. Normal görünür polling 8 sn,
hata backoff en fazla 60 sn, ağ sınırı 15 sn'dir. Değişiklikte kaynakla doğrulayın.

### Özel belgeler ve bağımsız inceleme

carrier_applications, carrier_document_files/audit ve private carrier-documents
bucket kullanılır. JPEG/PNG kaynak boyut/piksel sınırıyla JPEG'e normalize edilir;
Storage JPEG ve en fazla 1 MiB kabul eder. SRC, K yetki, ruhsat türleri vardır.
Yollar sunucuda türetilir; overwrite yoktur. Reservation/finalize, yarım yükleme,
revizyon ve satır kilitleri korunur. Görüntüleme auth download + yerel blob URL'dir.

Akış draft → submitted → approved/rejected; withdraw onayı kaldırır. Gönderilmiş
dosya değiştirilemez. Dosya yükleme tek başına rozet vermez. Public minimal rozet
sonucu yalnız sunucu onayını taşır; özel dosyaya erişim vermez.

Son Production kabulünde normal test hesabının #5/#7 başvurularına üçer sentetik
JPEG yüklendi, ayrı inceleyici oturumunda indirilip açıldı; onay ve gerekçeli ret
iki hesaba yansıdı. İkisi de owner withdraw ile geri çekildi. Geçici inceleme
üyeliği test bitince kapatıldı; gerçek kişisel belge kullanılmadı. Gönderilmiş
belgelere erişim için yeni, ayrı yetki kapsamı gerekir.

### Tek genel yönetici

Profil → Yönetici paneli; `private.admin_members` her RPC'de doğrulanır. Tek
aktif üye unique index ile korunur. Rol yalnız strict true sunucu yanıtıyla
arayüzde görünür. Google sonrası profil hazır olmadan rol sorgulama hatası
[PR #36](https://github.com/yagizce/nakgo/pull/36) ile düzeltildi; kullanıcı
telefonda panelin ilk girişte göründüğünü doğruladı.

Sayım, kullanıcı/ilan arama/sayfalama, gerekçeli faaliyet askısı ve kaldırılması,
ilan kaldırma/kapalı duruma restore ve işlem geçmişi vardır. Askı Auth ban veya
oturum iptali değildir. Geçmiş ve önceden kabul edilmiş işi tamamlama korunur;
yeni faaliyet, talep ve kabul sunucuda engellenir. Eski ilanlar otomatik kaldırılmaz.
Kendi hesabına/aktif yöneticiye askı yapılamaz. Revizyon/audit ve atomik yazmalar
korunur; istemci aktör/audit oluşturamaz. Yönetici özel sohbet veya belge dosyası
listesi yetkisi almaz. [Yönetici teknik rehberi](admin-panel.md) ilk kurulum
adımlarını da içerir; mevcut ortama migration'ları yeniden uygulamayın.

## 6. Ortam ve migration kaydı

| Ortam | Supabase project ref | Son doğrulanan durum |
| --- | --- | --- |
| DEV / nakgo-dev | `axkotffqrsddbrazhcwj` | Son iki migration ledger'da kayıtlı; eski 13 sürümün ledger geçmişi tamamlanmış değildir |
| Production / nakgo-production | `fimlifldsivecezbxwuo` | 15 kaynak sürümüne ulaşan kurulum; son migration tek kayıtla doğrulandı |

Üç önemli son sürüm:

- `20261026030000_single_admin_access`: tek aktif genel yönetici sınırı.
- `20261027010000_storage_service_activity`: Supabase'in iç Storage tamamlamasında
  eksik kullanıcı sub durumunu, yalnız güvenilir servis rolü ve tam rezervasyon
  eşleşmesiyle ele alır; RLS/bucket veya çağıran hesabın kurallarını genişletmez.
- `20261028010000_load_timing_text`: serbest yükleme metni, uyumlu ilan okuma,
  taşıma snapshot'ı ve yönetici sayımı. DEV/Production'a uygulandı; tekrarlanmaz.

Önceki şema; profil/profil detayları, ilan/fotoğraf/saat, işler, favoriler,
mesajlar/sender index, özel belgeler, admin panel/moderasyon migration'larını
kapsar. Tam sıralı kaynak [supabase/migrations](../supabase/migrations/) içindedir.
İlk Production profiles şeması doğrulanarak baseline olarak benimsenmiştir.
DEV'de ledger eksik diye bütün geçmişi yeniden çalıştırmayın veya geçmişi
incelemeden adopted saymayın. Gerçek şema, ledger ve kaynak birlikte karşılaştırılır.

Env **adları**: NAKGO_AUTH_ENABLED, NAKGO_PRODUCTION_AUTH_ENABLED,
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Değer/sırları belgeye veya loga koymayın.
Preview env her yeni branch'e taşınmış varsayılmaz. Production/DEV hesapları,
UUID'leri ve rol üyelikleri birbirine taşınmaz.

Migration yazma/uygulama, main yayını ve rol değişikliği için güncel kullanıcı
kapsamını doğrulayın. Canlı uygulamadan önce rollback provası, sonra postcheck
ve ledger kaydı gerekir. RLS kapatma/tablo silme/veri kaybeden down migration
çözüm değildir. Rollback sequence numaralarını geri almaz; kesintisiz ID beklenmez.

## 7. Doğrulama ve kanıtın sınırı

Son uygulama değişikliğinin kabulü:

- Yerel `npm test` **603/603**, tam Chromium E2E **407/407**, bağımsız browser
  **198 kontrol / 11 senaryo** başarılı.
- PGlite **45 moderasyon + 15 Storage kontrolü**, **11 rollback SQL fixture**
  başarılı. PGlite sentetik Auth/Storage motorudur; gerçek servis/eşzamanlı
  çok bağlantı testi değildir.
- DEV ve Production'da son migration rollback provası ve gerçek SQL RLS,
  favori/mesaj/taşıma snapshot kabulü başarılı; sentetik kayıtlar rollback edildi.
- Gerçek Production test hesabıyla boş/whitespace publish reddi, `yarın sabah`
  ile oluşturma, reload/kart/detayda literal metin, `uygun olduğunda` ile düzenleme
  ve yalnız sentetik #22 kapatma geçti. Önceki kullanıcı ilanları değişmedi.
- Kullanıcı son mesajında **iPhone 15'te yeni yükleme metniyle ilanı
  yayımlayabildiğini doğruladı**. Bu telefon kontrolü artık beklemiyor.

Normal komutlar (Node 18+, sabit Python/Playwright gereksinimleri):

```sh
npm run bundle
npm test
npm run test:static
npm run test:gate
npm run test:guard
npm run test:e2e
npm run test:browser
```

`tools/admin-db-check.cjs` isteğe bağlı PGlite bağımlılığıyla SQL paketlerini;
`tests/admin_panel_browser.py` yönetici browser regresyonlarını çalıştırır.
Kurulum için [geliştirme rehberi](development.md) ve
[kalite kapısı rehberi](quality-gate.md) okunur. npm start yerel statik sunucudur;
gerçek backend/Auth ortamı yerine geçmez. Port/sandbox hatasında testi değiştirip
geçirmeyin; uygun erişimle doğrulayın veya sınırlamayı açıkça kaydedin.

UI değişikliklerinde mobil genişlikler, iki tema, sheet/klavye, uzun metin,
boş/hata durumu, hesap değişimi ve reload sınanır. Belge değişikliğinde link,
kaynak doğruluğu ve yalnız beklenen dosyaların değiştiği denetlenir. Başarılı
eski CI yeni commit için kanıt değildir; yeni PR'ın gerekli kontrolleri beklenir.

## 8. GitHub teslim ve güvenlik kuralları

Main'e doğrudan yazmayın. Ayrı dal/PR ve son main tabanını kullanın; var olan
PR'ın eski base'ini incelemeden değiştirmeyin veya eski uygulama dosyalarını
main'e taşımayın. Docs-only teslimde fark yalnız Markdown olmalıdır.

Koruma: PR + güncel dal + GitHub Actions kaynaklı `quality-gate` ve `verify`;
yöneticiler de kurallara tabi. Force push ve dal silme kapalıdır. Olağan kod
işinde korumalı test/guard/workflow değiştirilerek hata gizlenmez. Gerekli test
bakımı ayrı ve insan incelemeli iştir.

Tarihsel istisnalar: PR #21'de beş korumalı fark; PR #37'de serbest metin ürün
kararı nedeniyle üç mevcut test beklentisi incelendi ve yalnız kesin sürüme
kullanıcı istisnası verildi. PR #37 `verify` ve `admin-regression` geçti;
quality-gate **61/64** kaldı. Bu sonucu tüm CI yeşil diye anlatmayın. Geçici
admin bypass istisnası merge ardından hemen kapatılıp yeni GET ile doğrulandı.
Bu izinler sonraki işe taşınmaz; koruma/guard/workflow kalıcı gevşetilmedi.

Tarihsel PR #32 belge teslimi main'e alındı; yalnız AGENTS.md, README.md ve
bu rehber değişti. Bu yerel dal sonraki, ayrıca istenmiş WhatsApp V2 çalışmasıdır;
önceki belge teslimi kapsamı yeni kullanıcı isteğini geçersiz kılmaz.

## 9. Korunacak veriler ve yeni ajan için kapanış

Gerçek kullanıcı ilanı, mesajı, işi veya özel dosyası temizlik için silinmez.
DEV'deki orijinal kabul kayıtları ve geçmiş işler korunur. Production'daki
sentetik kapalı araç, tamamlanmış yükleme onayı/iki test mesajı, geri çekilmiş
belge başvuruları ve kapalı sentetik #22 kayıtları geçmişte kalabilir. Bunları
gerçek taşıma veya aktif doğrulama olarak sunmayın. Kullanıcının kendi ilanına
ve belge taslağına dokunmayın. Private sentetik dosyaları izinsiz kalıcı silmeyin.

Ödeme/Premium entitlement, push, mesaj ekleri, Apple girişi veya gerçek telefon
numarası doğrulaması tamamlanmış kabul edilmez. Bu liste backlog yetkisi veya
sonraki adım talimatı değildir; kullanıcı kapsamını bekleyin. WhatsApp dışındaki backlog bu göreve dahil değildir.

Eski [mimari](architecture.md), [ürün](product.md),
[ilk Supabase kurulumu](supabase-setup.md) ve yönetici kurulum belgeleri demo/ilk
kurulum aşamalarına ait ifadeler de içerir. Güncel davranış için önce bu tarihli
rehber, ardından uzak main kaynakları/RPC, gerçek ortam ve son kullanıcı kararı
birlikte incelenir. Eski kurulum adımı mevcut sisteme körlemesine uygulanmaz.

Yeni sohbet için kısa başlangıç metni:

> NakGo için önce AGENTS.md ve docs/PROJECT_HANDOFF.md oku. Yerel değişiklikleri
> koruyup uzak main/PR/CI ve hedef ortamı doğrula. Production Auth açık; tek
> genel yönetici ile belge inceleyici ayrı. Yükleme tarihi yükte zorunlu serbest
> metin; Not ve ekler geçişi aynı, araç takvim doğrulaması ayrı. Kullanıcı iPhone
> kabulünü tamamladı. Son iki migration kurulu; ledger eksikliğini yeniden
> çalıştırmayla çözme. Eski bypass iznini kullanma. Yalnız yeni kullanıcı talebinin
> kapsamındaki işi yap; sır veya hesap kimliği yayımlama.

## 10. WhatsApp V2 DEV / Preview kabulü

GitHub `codex/nakgo-whatsapp-ingestion`, başlangıç main `2979ae3`, draft
[PR #38](https://github.com/yagizce/nakgo/pull/38). Yerel doğrulama dalı
`codex/nakgo-whatsapp-dev-validation`; ilk yerel/uzak commit metadata'sı farklı,
aynı kaynak ağacı korunmuştur. Yeni migration yalnız DEV'e uygulandı ve ledger'a
kaydedildi; eski ledger eksikliği yeniden migration çalıştırılarak giderilmedi.

Kalıcı inbox/lease kuyruğu, ayrıştırma, özel yönetici düzenleme/yayın ve audit/
retention mevcut. Gerçek DEV RLS/RPC, hata/backoff/lease, Preview imzalı HTTP ve
mevcut yönetici UI kabulü geçti. Sentetik yayımlanan ilan test sonunda kaldırıldı.
Tek yönetici sınırı ve mevcut üyelikler korundu; ortak hesaplara yetki verilmedi.
Yeni secret-key başlığı ve boş PostgREST yanıtı hataları regresyon testiyle düzeltildi.

Canlı kabuk v44, Preview v45. Kalıcı scheduler ve gerçek Meta bağlantısı kurulmadı.
24 sentetik mesaj ölçümünde varış ili 20/24; parser'ın bilinen sınırları ve
manuel Meta adımları [WhatsApp rehberinde](whatsapp-review.md). Yeni özellik
isteği olmadan parser refactor veya ortak yetkisi eklemeyin. Kullanıcı ileride
Cloudflare'e geçiş düşünüyor; bu görevde taşıma/Production yayını yapılmadı.

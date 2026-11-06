# Production hazırlığı — 5 Kasım 2026

445b937 CPU tabanı; bu paket yalnız yerel hazırlıktır. Production SQL yazımı,
Cloudflare deploy, abonelik, DNS ve Draft PR #38–41 değişmedi. Kullanıcının ayrı
onayıyla yalnız kontrol PR #42 main’e alındı (aa6386d); Vercel otomatik yayını READY.
Canlı HTML/SW önceki uygulama kaynağıyla aynı; API config HTTP 200.

## Testler ve Guard

674 uygulama kontrolü, 397 E2E, 198 bağımsız tarayıcı kontrolü; 77 Node senaryosu;
79 lifecycle, 42 retention, 42 WhatsApp DB; admin SQL/Storage kontrolleri geçti.
Yerel Workers üzerinde Auth 6/6, Google SDK 6/6, admin/WhatsApp mobil/masaüstü,
DEV/retention/Production workerd geçti. İki npm audit: 0 açık. Production build
ve Wrangler --dry-run geçti; gerçek Production Google/Paid kabulü yapılmadı.

Eski Guard 47/65 idi: ilk 17 ürün dosyasına strict Google fixture farkı eklendi.
Aşağıdaki farklar tek tek incelendi; güvenlik reddi/RLS/XSS kontrolleri korunur.
| Dosya | İncelenen fark ve güvenlik sonucu |
| --- | --- |
| e2e.py | Sohbet/karşılaştırma yerine Ara/WhatsApp; kalıcılık, klavye ve XSS kontrolleri sürüyor. |
| forms.py | Geçerli telefon/izin fixture'ı eklendi; negatif miktar, boş tarih ve kayıt hatası reddi korundu. |
| gate/browser.py | Yeni iletişim ve zorunlu izin alanları; çift yazma, taşma, XSS ve depo hatası kontrolleri korunuyor. |
| reliability.py | Profil telefonu ilan numarasını değiştirmez; XSS, depolama kaybı ve kapanan ilanda iletişim reddi sürüyor. |
| unit/app.test.js | TTL 14 günden 6 saate; fixture timestamp'leri ve kaldırılan ücretli sohbet/karşılaştırma beklentileri güncellendi. |
| unit/contact.test.js | Inbox girişi kaldırıldı; mevcut iş verisi, profil kalıcılığı ve metin kaçışı korunuyor. |
| unit/favorites-api.test.js | İzinli contact_phone okunabilir, owner_label okunamaz; sayfalama/RLS ve hesap sınırı korunuyor. |
| unit/form-state.test.js | Telefon/izin fixture'ları; miktar, takvim ve başarısız kayıt kontrolleri korunuyor. |
| unit/listing-refresh.test.js | Sahibin adı/sohbet/karşılaştırma kaldırıldı; yeni iletişim ve eski iş kaydı kontrolleri mevcut. |
| unit/listings-api.test.js | İstemci owner_label yazmaz; owner_id, created_at ve özel alan enjeksiyonu hâlâ reddediliyor. |
| unit/message-resilience.test.js | Silinmiş test kapsamı giderildi: hesap değişiminde geçmiş temizliği ve inbox yükleme grafiğinden çıkması sınanıyor. |
| unit/messages-api.test.js | Silinmiş test kapsamı giderildi: eski SDK yöntemleri giriş/hesap değişimi sonrasında da yok. |
| unit/post-wizard-date.test.js | Serbest zorunlu yükleme metni korunuyor; fixture telefon/izin şartını karşılıyor. |
| unit/private-messages.test.js | Silinmiş test kapsamı giderildi: eski yerel kayıt silinmez, genel ekranlara sızmaz ve sohbet açılmaz. |
| unit/reliability.test.js | İsim gizleme, ilan bazlı izinli telefon ve 6 saat; not/içerik XSS kaçışı korunuyor. |
| unit/road-map.test.js | Demo Premium iletişim kilidi kaldırıldı; emekli mesajlaşma girişi yok, harita kontrolleri sürüyor. |
| tools/project.js | Yalnız inbox kaynaktan çıkarıldı; modül sırası değişmedi. |

| auth_google_browser.py | Gerçek SDK dönüşünde yalnız tam origin/path + 32 hex sb_flow_id kabul edilir; keyfi redirect reddi korunur. |


Kontrol paketi a68b0ad ile aynı ağaç, GitHub 28a33b4 üzerinden PR #42/aa6386d
olarak kabul edildi. Ledger yalnız trusted base checkout'tan exact eski/yeni hash
kabul eder; candidate ledger, keyfi düzenleme, symlink/silme ve kontrol/workflow
kendi kendine onayı reddedilir. Kontrol testleri 17/17; yeni gerçek main tabanıyla
Guard 66/66 (uygulama dalında da). PR42 verify/admin geçti; eski kalite kapısı iki
kontrol dosyası farkında 63/65 kaldı, kullanıcıya özgü geçiş izniyle birleşti.
Yönetici bypass engeli hemen açılıp yeni GET ile doğrulandı; PR/up-to-date ve
Actions quality-gate/verify şartları açık, force-push/silme kapalı. Başka istisna
verilmedi. Uygulama dalı trusted üç dosyayla yerelde eşitlendi; bütün uygulama
GitHub CI'sının yeni base ile başarılı olduğu henüz ileri sürülmez. Özellikle
trusted bağımsız browser runner denendi: kaldırılan #mg/Mesaj düğmesini beklediği
için navigation/sheet senaryosu başarısız. Bu eski sözleşme uyuşmazlığı ayrıca,
trusted kontrol sınırını koruyan incelenmiş bir paketle giderilmelidir; PR42
onayıyla yeni workflow/browser değişikliği main’e alınmadı.

## Ayrı Production Worker — kaynak hazır, yayında değil

`cloudflare/wrangler.production.jsonc`: nakgo-app-prod, sabit hesap/proje;
DEV ayrı wrapper ile korunur. Paylaşılan runtime taşıması dışında refactor yok.
Prod API, doğru proje + iki Auth flag + release flag olmadan 503; sır browser'a
verilmez. Kaynakta public key boş, release false; workers.dev/preview/routes yok.
Batch 1, cpu_ms 100; Meta/Cron/maintenance/retention kapalı. Maintenance false
zamanlanmış çağrıda expire dahil sıfır DB yazımıdır. Yanlış hedef testleri ağdan
önce reddedilir. Her iki config ile build sırayla çalıştırılır; public çıktı ortaktır.

Yayın onayından sonra yalnız prod public key ayarlanır. Gereken ayrı
SUPABASE_SERVICE_ROLE_KEY / WHATSAPP_WORKER_SECRET yalnız Worker Secret alanına,
terminalin gizli girişiyle alınır; DEV anahtarları taşınmaz. Şimdilik Meta/worker
kapalı olduğundan bunları açmak yayının ön koşulu değildir. Google secret
Supabase'de kalır; sırlar argv/log/Git'e girmez, kurtarma kabulünden önce eskiler
iptal edilmez. Release flag yalnız onaylı migration ve smoke kontrolüyle açılır.

## Production DB yedeği ve yerel prova — geçti

Production salt okunur, TLS verify-full, tek repeatable-read snapshot. Repo dışı
user+SYSTEM ACL altında AES-256-GCM/Scrypt şifreli yedek; parola saklanmadı.
52 tablo / 293 satır / 51 FK / 16 RLS policy; şema, içerik hash ve ilişkiler eşleşti.
Güncel crypto 50.0.2 ile mevcut şifreli yedek tekrar açıldı; ayrı localhost
kopyasında sırasıyla aşağıdaki üç migration geçti, eski satır/sütunlar korundu:
1. 20261028020000_whatsapp_review.sql
2. 20261104010000_listing_lifecycle.sql
3. 20261104020000_listing_retention.sql

Base migration ledger kontrol edildi; eski mesaj tablo/RPC ve owner_label erişimi
reddedildi. Test sunucuları kapandı, geçici açık dosyalar temizlendi. Yerel role
grantor Supabase servis kimliği yerine yerel admin olarak uyarlanır; membership
seçenekleri korunur. Bu, Supabase servislerinin tam felaket kurtarma provası değildir.
Storage bytes ve Auth/OAuth/SMTP/platform ayarlarının servis restore testi hariçtir;
şifreli ikinci/offsite kopya da henüz yok. Kanıtlar yerel private tools'tadır,
yedek/PII Git'e eklenmez. Geçiş anında yazıları durdurup taze snapshot/Storage
delta alınır; 5 Kasım yedeği sonraki yazıları kapsamaz. Purge kapalı kalır.

## Paid kapasite ve maliyet

DEV 75 iş P50/P95/P99 5/16/21 ms; Free 10 ms güvenli hedef değil. Paid varsayılan
HTTP 30 s; önerilen ilk sınır 100 ms. Paid'de gerçek kabul henüz yok. Batch 1,
dakikalık Cron açılırsa en fazla 60 deneme/saat; retry/backlog izlenir.
Minimum $5/ay: 10M dinamik istek + 30M CPU-ms; ek 1M istek $0.30, ek 1M CPU-ms
$0.02. 21 ms varsayılan ortalamayla 1M/10M/15M çağrı yaklaşık $5/$8.60/$12.20.
21 ms ölçülmüş ortalama değildir. Hesaptaki DEV/diğer Worker/retry dahildir;
statik Assets ücretsiz. Vergi/Supabase/Meta/logs ayrı; fiyat yayında yeniden teyit
edilir. Kullanım %75/%90 alarmı ve günlük maliyet/CPU/backlog takibi gerekir;
bunlar sert harcama tavanı değildir. Abonelik açılmadı.
[Fiyat](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Limit](https://developers.cloudflare.com/workers/platform/limits/)

## app.nakgolojistik.com geçişi ve geri dönüş

Root/www zaten nakgo-website; mevcut 13 DNS kaydı, MX/SPF/DKIM/Google ve auth
kayıtları korunur. Yeni app hostu henüz yok. Onaydan sonra yalnız app Custom
Domain/HTTPS eklenir; root/www veya registrar taşınmaz, CNAME ile çakıştırılmaz.
Production Supabase şu an yalnız https://nakgo.vercel.app/ Site URL/redirect:
https://app.nakgolojistik.com/ tam redirect eklenmeli; eski adres korunmalı.
Google provider callback https://fimlifldsivecezbxwuo.supabase.co/auth/v1/callback
kalır; gerekiyorsa Google JS origin yeni app hostu eklenir. HTTPS ve gerçek
Google/login/logout/normal-admin kabulünden sonra Site URL kontrollü değiştirilir.

Sıra: uygulama CI kabulü → taze yedek/Storage envanteri → onaylı üç migration
→ ayrı Worker secret/config → onaylı deploy → app HTTPS/OAuth → smoke/trafik.
Sürümlü kaynak arşivi + migration hash listesiyle uyumlu Vercel kurtarma build'i
hazırlanır; Vercel'e yüklenmez. Eski mesajlaşmalı live build yeni şemaya rollback
değildir. Geri dönüş, uyumlu Worker sürümü veya test edilmiş Vercel build'ine
geçiştir; app hostu Vercel'e alınacaksa önce Custom Domain kaldırılıp ayrı onaylı
DNS/sertifika işlemi gerekir. Eski Vercel giriş adresi korunur. Yeni origin yeniden
giriş/PWA cache ayrımı getirir. Veri geri dönüşü bakım + hedefli restore/ileri
onarım; yeni kullanıcı yazıları kör eski yedekle ezilmez. Purge açılmadan kalır.

**Durum:** yerel teknik hazırlık tamam; uygulama CI kabulü, Storage/platform
kurtarma kapsamı ve onaylı gerçek Production kabulü kapanmadan yayına hazır denmez.

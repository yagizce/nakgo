# 10/20 grup hazırlığı

800 mesaj/grup/gün: 8.000 / 16.000 mesaj; 30 günde 240.000 / 480.000 kaynak.
Bu dal Production yayını değildir. Cron/dispatch/retention kapalı; yeni migration
henüz uzak DEV veya Production'a uygulanmadı. PR38–41 değişmez.

Kontrol PR43, ayrı kullanıcı onayıyla main 4d472e9 olarak kabul edildi. Eski ve
Ara/WhatsApp uygulamaları 198'er bağımsız browser kontrolü geçti; fixture'lar
yalnız trusted base'den seçilir. PR43 verify/admin geçti, eski guard 63/66 idi;
dar istisna sonrası bypass engeli hemen açıldı. Vercel controls-only yayını READY.
Uygulama dalı yeni main ile birleşti, yerel Guard 71/71 ve npm 675/675 geçti.

Yeni kaynak: freightOnly ayrıştırması gereksiz V1 rota/fiyat işlemini atlar.
Gerçek DEV'de public self-fetch dispatcher 503 verdi; yerine aynı Worker içinde
2 paralel claim, en çok 16 iş ve 50 sn başlatma bütçesi kullanılır. Tüm başlatılan
işler beklenir; hata saklanmaz. En kötü 16×3+1=49 RPC; CPU ayrı ölçülmez.
Bu düzeltmenin yerel runtime kabulü geçti; gerçek DEV tekrarı bekler.
Dakikalık Cron'un teorik üst sınırı 960 deneme/saat; yoğun saat garantisi değildir.
Cron/dispatch/retention kapalıdır; Paid abonelik açılmadı.

Migration 20261105010000: claim için iki dar indeks; expired lease önceliği;
aynı aktif izinli ilanın farklı kaynaklardan çift yayınını engelleyen private
hash anahtarı/advisory lock; eski validator/audit aynen korunur. Duplicate
yayında statement geri alınır, kaynak/taslak/izin kalır, eski ilan süresi uzamaz.
Yalnız bir günden eski operasyonel dedupe cache anahtarları küçük batch'lerle
yenilenir; ilan/audit/izin silinmez. Yeni tuple'lara LZ4 (destek yoksa pglz)
sıkıştırması; eski içerik rewrite edilmez. Admin/service-only kapasite RPC'si
350/400/450 MB eşikleri ve kuyruk metrikleri verir; bildirim servisi açılmadı.

PGlite yükü: iki senaryoda %20 delivery tekrarları, belirsiz/ilansız %10,
ayrıca izinsiz %5, içerik tekrarı %10; dolayısıyla yayın oranı %75'tir.
8.000/16.000 kaynak ve taslak; 6.000/12.000 yayın; 6.800/13.600 belgeli izin;
480/960 işlem öncesi retry; 81/164 kayıp başarı yanıtı. Çift yayın/kayıp kaynak 0.
Backoff kontrolünden sonra kalan sentetik retry zamanı yerelde ilerletildi.
Bu tek bağlantılı WASM fixture'ı native çok bağlantılı yarış/Cloudflare CPU
kanıtı değildir. 18 ek DB güvenlik kontrolü ve 61 WhatsApp testi geçti.
Yerel workerd: dispatcher auth, 48 bütçe, overlap, hata sinyali, sıfır purge geçti.

Native PostgreSQL 17, dört ayrı bağlantı: 8.000/16.000 kaynak tamamlandı,
6.000/12.000 yayın; kayıp kaynak ve çift yayın 0. 480/960 retry ve 81/164 kayıp
başarı yanıtı tekrarında idempotency korundu. Süre 48,81/83,66 sn (localhost;
Cloudflare uçtan uca throughput kanıtı değildir). Yeni ilişkilerin tahsis büyümesi
46,76/76,11 MB; kaynak başına 5,85/4,76 KB. DEV tabanı dahil doğrusal 30 günlük
hesap ~1,43/2,31 GB: bu senaryoda 500 MB yeterli değildir. Bloat/tahsis etkisi
vardır; eski içerik/evidence silinerek kota hesabı yapıldığını varsaymayın.

Gerçek DEV 2f06e38, marker cpu-7c389226fd90a648: her dolu senaryo 100 çağrı:

| Senaryo | P50 / P95 / P99 / max CPU (ms) |
| --- | --- |
| Kısa | 2 / 6 / 8 / 10 |
| Büyük | 3 / 7 / 10 / 12 |
| Çoklu ilan | 5 / 13 / 16 / 17 |

Cloudflare invocation kayıtları; client wall time CPU değildir. 400 Worker çağrısı
200; 20 yetkisiz çağrı 401; 20 bilinmeyen API 404. Statik/Auth istekleri başarılı,
ancak invocation kaydı yalnız 4 Auth/8 red/94 boş çağrı için erişilebilir; tam
örneklem yüzdeliği diye sunulmaz. Son drain çağrısı 503: tüm kabul geçti denemez.
Sentetik kaynak 0 kaldı, mevcut dört tablo snapshot'ı eşleşti. Free 10 ms CPU
kabulü başarısız. Paid gereksinimi ayrıca kullanıcı onayına tabidir; mevcut kodda
Cron/purge açılmaz. CPU sonucu CF dashboard, native sonuç özel yerel rapordadır.

Kalan: düzeltilmiş drain için gerçek DEV kabulü; yeni migration öncesi taze yedek
ve rehearsal; tüm GitHub CI; Storage byte yedeği, Production OAuth/secret ve
uyumlu Vercel dönüş kabulü. Main/Production/DNS/Paid için ayrı onay gerekir.

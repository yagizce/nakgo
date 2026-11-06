# Production öncesi kontrol — 5 Kasım 2026

Sonraki hazırlık: [17 guard farkı, Paid maliyet, prod backup/OAuth/domain planı](production-preflight.md).
Yerel kapsam boşlukları kapatıldı; guard bağımsız incelemesi ve prod restore henüz tamamlanmadı.

Dal `codex/nakgo-dev-release-checks`, temel DEV paketi `73c477e`.
Kartın kalan süresi en fazla 360 dakika gösterilir. Sunucu süresi 21600 saniyedir.
HTTP worker purge için açık `LISTING_RETENTION_ENABLED=true` ister. Cron'daki
ikinci purge kaldırıldı. DEV'de iki otomasyon bayrağı false, Cron tanımı boş kalır.

## Production geçiş sırası

1. Production şema/ledger ve yazan istemciler salt okunur envantere alınır.
   Production'a ait yeni tutarlı yedek ve izole restore doğrulanır. DEV yedeği
   Production kurtarma kanıtı değildir. Storage dosyaları ve Auth/OAuth ayarları
   ayrıca korunur, güvenli konum ve erişim yetkileri kaydedilir.
2. Paket hash'i, eski Worker/istemci sürümü ve geri dönüş noktası sabitlenir.
   Mevcut Cloudflare adaptörü DEV hedefini zorunlu tutuyor. Production için ayrı,
   incelenmiş runtime/config ve ortam guard'ı hazırlanması hâlâ gereklidir.
3. İki migration Production şemasının restore kopyasında sırayla denenir.
   Ledger eksikliği toplu yeniden uygulamayla kapatılmaz. Bakımda yazarlar durur,
   son yedek alınır, satır/FK/içerik karşılaştırmasıyla transaction uygulanır.
4. Production'a özel secret ve publishable anahtarlar güvenli servise girilir.
   DEV anahtarları kopyalanmaz. Yeni istemci/Worker önce ayrı kabul adresinde
   sınanır. Cron, purge ve Meta başlangıçta kapalı tutulur.
5. Kullanıcı alan adını seçer. Mevcut DNS, TTL, HTTPS, OAuth redirect ve e-posta
   MX/TXT kayıtları kaydedilir. Ayrı onayla yalnız uygulama hostu yönlendirilir.
   Vercel geri dönüş adresi erişilebilir tutulur. DNS yetkisi bu belgeyle verilmez.
6. Hata durumunda trafik önceki kabul edilmiş sürüme döner. Yeni şemayla uyumsuz
   eski istemci doğrudan açılmaz. Şema/veri için hedefli restore veya uyumlu ileri
   düzeltme gerekir. Redaction sonrasında Worker rollback içeriği geri getiremez.

## DEV kabul sonucu ve kalan engeller

`f61ab3b` DEV'de yayımlandı. 634 uygulama, 55 WhatsApp, 54 yaşam döngüsü,
42 temizlik ve 42 WhatsApp DB kontrolü geçti. Runtime testleri de başarılı.
Yeni Supabase secret ile HTTP Worker 200, yanlış anahtar 401 verdi. İki eşzamanlı
çağrı 5 sentetik işi 2+3 paylaştı. Sekiz denemelik backoff, canlı lease'in tekrar
alınmaması ve tekrar çağrıda no-op doğrulandı. Test kayıtları 0; mevcut kaynak,
ilan ve redaction sayacı eşleşti. DEV çağrı anahtarı onayla yenilendi ve Windows
kimlik kasasında saklandı. Cron/purge kapalı.

Aktif sürüm `12a68b21`, az örnekli son 24 saat filtresi: CPU P50 2,86 ms,
P99 15,04 ms; bellek P99 2,63 MB; CPU/bellek limit hatası 0. Ücretsiz planın
10 ms CPU sınırı nedeniyle CPU kabulü koşullu. İstek bazlı profil ve gerekirse
1–2 mesajlık batch ile ölçüm gerekli; ölçüm olmadan iyileşme iddia edilmez.
Gerçek Cron tetiklemesi kapalı; ortak claim/lease iki HTTP consumer ile sınandı.
Tam altı saat gerçek zaman bekleme ve Meta E2E yapılmadı. Production runtime/config,
Production restore provası ve alan adı kararı hâlâ gerekli. Yayın ayrı onay ister.

## CPU sonucu — ücretsiz plan kabul edilmedi

Sabit eşleştiriciler/normalizasyon tekrarları azaltıldı; Cloudflare batch 1,
diğer runtime varsayılanı 5. DEV yayını ve 75 dolu kuyruk çağrısı geçti.
Cloudflare invocation logları, CPU ms (25 çağrı/senaryo; P99 maksimuma yakındır):

| Mesaj | P50 | P95 | P99 | Önceki P99 (batch 5) |
| --- | ---: | ---: | ---: | ---: |
| Kısa | 4 | 13 | 15 | 44 |
| Büyük | 3 | 7 | 10 | 47 |
| 25 ilanlı | 7 | 17 | 21 | 294 |

Toplam 75 çağrı: P50/P95/P99 5/16/21 ms; 75 ok, exceededCpu/hata 0.
Sentetik kayıt 0, mevcut ilan/kaynak/taslak/retention kayıtları eşleşti.
Düzeltmeden sonra toplam 280 HTTP çağrısı beklenen sonucu verdi. Hafif API
yollarında bağımsız CPU yüzdelikleri için yeterli log oluşmadı; HTTP kabulüyle
karıştırılmaz. Statik dosya, gerçek giriş ve ilan CRUD için Worker CPU uydurulmaz.
Önceki 15,04 ms tek isteği eski loglar kapalı olduğundan belirlenemiyor;
yeni profil ayrıştırma yükünü doğruladı. İyileşme ücretsiz planın 10 ms
sınırına güvenli marj sağlamadı. WhatsApp Production için Workers Paid önerilir:
aylık $5 taban, 10M istek/30M CPU-ms dahil; aşım $0.30/M istek ve $0.02/M CPU-ms
([resmî fiyat](https://developers.cloudflare.com/workers/platform/pricing/)).
Ücretli hizmet açılmadı. Batch 1 ile dakikalık Cron en fazla 60 mesaj/saat işler;
gelecekte backlog alarmı ve hacme göre kabul gerekir. Cron/purge hâlâ kapalı.
270 çıktı eşleşmesi, 635 uygulama/58 WhatsApp kontrolü, build/workerd/Assets geçti.
Guard 48/65: temel daldaki korumalı farklar ayrı inceleme ister; gevşetilmedi.
Giriş/ilan CRUD Supabase, statik dosyalar Assets üzerinde; ağ süresi Worker CPU değildir.

# Runbook: olay inceleme, K2 serbest bırakma ve K6 muafiyeti

## Olay açıldığında
1. Son çalışmanın özetinde `legal.blocking` kodlarına bak (ör. `deleted_before_retention`, `chain_gap_unexplained`).
2. Kontrol noktası gövdesini çevrim dışında K7 (ya da age kopyası) ile aç; olayın `finding_keys` listesindeki kayıt
   kimliklerini incele. Gerekirse hukukçuya danış.
3. Karar: (a) açıklanabilir ve kabul edilebilir → serbest bırak; (b) açıklanamıyor → serbest BIRAKMA; olay açık kalır,
   silme kapalı kalır, kök neden ve gerekirse yetkili makamlara bildirim ayrıca değerlendirilir.

## K2 serbest bırakma belgesi
Alanlar: `version:1`, yeni rastgele `release_id` (UUIDv4), `event_id` ve `event_binding` (zincirdeki olaydan aynen),
`scope:{type, findings_sha256}` (olaydan aynen), en az 10 karakter `reason`, `environment`, `not_before` (olayın açılış
zamanından önce olamaz), `not_after` (en fazla 72 saat sonra). Çevrim dışı K2 ile `nakgo-legal-release/v1` alan adıyla
imzalanır ve `audit/inbox/releases/` altına konur.

Sonraki çalışma: belge doğrulanır → N'ye `consumption_pending` → N+1'de `consumed`, olay kapanır. Çökme olursa sonraki
çalışma tamamlar. Reddedilenler: yanlış anahtar/ortam/bağ/kapsam, süre dışı, 72 saati aşan aralık, olaydan önce başlayan
geçerlilik, tekrar kullanım, aynı olay için birden çok geçerli belge (hepsi reddedilir). Reddedilen `release_id` bir daha
kullanılamaz; yeni belge yeni kimlikle imzalanır.

## Silme günlüğü olayı (`deletion_result_missing`, `deletion_intent_*`, `deletion_result_*`)
1. `audit/deletions/intents/<sıra>.json` niyetini oku: hangi nesneler, hangi yedekler.
2. Nesnelerin depoda olup olmadığını ve son doğrulanmış yedeklerin yerinde olduğunu kontrol et.
3. Beklenmeyen bir silme yoksa olayı K2 ile serbest bırak. Sonraki çalışma "reconciled" sonuç yazar ve silme kapısı
   yeniden değerlendirilir. Beklenmeyen silme varsa serbest BIRAKMA; kök neden incelenir.
4. Sahte ya da bağsız bir niyet nesnesi kilit nedeniyle silinemez. Serbest bırakıldıktan sonra "kabul edilmiş bulgu"
   olarak listede görünmeye devam eder ama yeni olay açmaz.

## K6 muafiyeti (yalnız test ortamı)
- Production'da **her koşulda kapalı** (kodda sabit). Test ortamında `config.json → k6_waiver` ile ve PR onayıyla açılır.
- Yalnız A1 `stop_waivable` için: izin listesinde olmayan ya da değişmiş SECURITY DEFINER fonksiyon farkı.
- Belge (`nakgo-backup-waiver/v1`, K2): `waiver_id`, açık ön kontrol olayının `event_id`'si, farkın hash'i ve kapsadığı
  fonksiyonların **tam** listesi, ortam, gerekçe, en fazla 48 saat geçerlilik. `audit/inbox/waivers/` altına konur.
- Yedekten önce zincirde tüketilir; her `waiver_id` bir kez. Olay 7 günü aşarsa muafiyet kabul edilmez, olay yalnız K2
  serbest bırakmasıyla kapanır.

### Asla muaf tutulamayanlar
Yedek rolüne SELECT dışı yetki, rol üyeliği, CREATE yetkisi, rol özelliklerinde değişiklik (BYPASSRLS dışında yetki,
CREATEROLE, REPLICATION, süper kullanıcı, bağlantı sınırı); TLS/hedef sunucu doğrulaması; alıcı anahtar listesi hash'i;
K1 imzası ve kontrol noktası zinciri; S1 geri yükleme testinin herhangi bir hatası. Bunlar muafiyet kodunun kapsamı
dışındadır.

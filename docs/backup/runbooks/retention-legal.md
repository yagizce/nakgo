# Runbook: saklama ve yasal kayıtlar

## Yedek saklama
- Hedef: döküm nesneleri **kural olarak 15 gün**; açık bir inceleme sürerken karar verilene kadar saklanır (K4 metni
  hukukçu onayıyla kesinleşir).
- **D1:** R2 yaşam döngüsü kuralıyla otomatik silme YOK. Silme yalnız uygulama kapısından:
  `config.json → deletion.enabled` (PR onayı) + K3 kanıtı (`store_capabilities`) + açık olay 0 + dış çapa doğrulanmış +
  en az 4 doğrulanmış yedek kalması ve en yenisinin 24 saatten yeni olması.
- Kova kilidi bağımsız sınırdır: `db/` 14 gün, `audit/` 90 gün. Kilitli nesne koddan silinemez.
- Silme günlüğü (`tools/backup/deletion-journal.cjs`):
  1. Silmeden ÖNCE K1 imzalı **niyet** `audit/deletions/intents/<sıra>.json` "yoksa yaz" ile yazılır ve geri okunup baytı
     baytına doğrulanır. Niyet; nesneleri, her birinin manifestini ve şifreli dosya hash'ini, dayandığı kontrol noktasının
     sırasını ve başlık hash'ini içerir. Niyetten hemen önce zincirin başı yeniden okunur; araya başka çalışma girdiyse
     niyet yazılmaz.
  2. Yalnız niyetteki nesneler silinir.
  3. Silmeden SONRA ayrı K1 imzalı **sonuç** `audit/deletions/results/<sıra>.json` yazılır (niyetin hash'i + nesne başına
     durum).
  4. Her çalışma bütün niyet ve sonuçları denetler ve sonraki kontrol noktası hepsini anahtar + SHA-256 ile bağlar.
  5. Sonucu olmayan niyet (çökme, yazma hatası) bulgu olur, olay açar ve **otomatik silme durur**. Sahip inceler, K2 ile
     serbest bırakır; sonraki çalışma nesnelerin gerçek durumunu okuyup "reconciled" sonuç yazar. Eski niyet yeniden
     yürütülmez.
  Ayrıca her çalışmanın kararı (izin verilmese bile) `audit/deletions/decisions/` altına yazılır.

## Yasal kayıt kanıtı
- Her çalışma #125 tablolarının tam listesini kontrol noktasına yazar; kanıtlanamayan her silme olay açar ve silmeyi
  durdurur. Kurallar: `docs/backup/legal-evidence.md`.
- Politika değişikliği (`legal_policies`) hukukçu onayıyla yapılır. Değişiklik kontrol noktasına kaydedilir; aynı aralıkta
  o politikaya dayanan silmeler kanıtlanamaz sayılır. Yeni süre bir sonraki aralıkta geçerli olur. Pratikte: politika
  değiştirildikten sonra bir yedek çalışmasının tamamlanmasını bekleyin, retention o zaman çalışsın.
- İlk kontrol noktası (ve yasal tabloların ilk görüldüğü nokta) sahip incelemesi ve K2 serbest bırakmasıyla başlangıç
  kabul edilir.

## Kontrol noktası gövdelerinin saklanması
Başlıklar kalıcıdır. Gövdeler en az 90 gün kilitli, sonra en az 13 ay saklanır. Gövde silme bu aşamada uygulanmadı;
ayrı onay ve runbook gerektirir.

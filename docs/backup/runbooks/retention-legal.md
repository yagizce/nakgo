# Runbook: saklama ve yasal kayıtlar

## Yedek saklama
- Hedef: döküm nesneleri **kural olarak 15 gün**; açık bir inceleme sürerken karar verilene kadar saklanır (K4 metni
  hukukçu onayıyla kesinleşir).
- **D1:** R2 yaşam döngüsü kuralıyla otomatik silme YOK. Silme yalnız uygulama kapısından:
  `config.json → deletion.enabled` (PR onayı) + K3 kanıtı (`store_capabilities`) + açık olay 0 + dış çapa doğrulanmış +
  en az 4 doğrulanmış yedek kalması ve en yenisinin 24 saatten yeni olması.
- Kova kilidi bağımsız sınırdır: `db/` 14 gün, `audit/` 90 gün. Kilitli nesne koddan silinemez.
- Her silme kararı (izin verilmese bile) K1 imzalı olarak `audit/deletions/` altına yazılır ve sonraki kontrol noktasına
  bağlanır.

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

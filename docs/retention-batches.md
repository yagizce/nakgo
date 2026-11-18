# Parçalı gece temizliği

Migration: `supabase/migrations/20261118030000_b2_retention_batches.sql`. Testler: `tests/db/retention-batches.test.cjs`.
Kasıtlı bozma: `node tools/retention-mutations.cjs`. Ölçüm: `node tools/retention-bench.cjs` (yalnız yerel PostgreSQL).

## Neden

`private.retention_run()` her şeyi tek işlemde yapar. İlan karartma adımında `public.listings` tetikleyicilerini
`ALTER TABLE` ile kapattığı için tabloya yazma kilidi alır; birikmiş büyük bir yığında kullanıcıların ilan yazmaları
temizlik bitene kadar bekler. Hata olursa bütün iş geri alınır ve ertesi gece baştan başlar.

## Nasıl

| Saat (UTC) | İş | Ne yapar |
|---|---|---|
| 23:40 | `call private.retention_batches()` | Üç ağır adımı 1.000 satırlık, ayrı işlemlerde yapar: ilan karartma (8 gün), karartılmış ilan silme (1 yıl), erişim kaydı silme (1 yıl) |
| 00:00 | `select private.retention_run()` | **Değişmedi.** Kalan az işi ve bütün diğer adımları (yasal kayıtlar dahil) yapar |

- Koşullar `retention_run` ile birebir aynıdır; eşdeğerlik testi iki yolun aynı sonucu verdiğini doğrular.
- Her parti atomiktir: iş, parti ve iş kaydındaki sayım aynı işlemde yazılır. Hata yalnız o partiyi geri alır.
- Kaldığı yerden devam: koşula uyan satırlar seçilir; tamamlanan partiler bir daha seçilmez. Kesilen iş (`running`
  kalmış) sonraki çalışmada `interrupted` olarak kapatılır.
- Tek çalışma: oturum kilidi `7301` ikinci yordamı `skipped` ile durdurur. Parti başına `7300` işlem kilidi
  `retention_run` ile aynı anda çalışmayı engeller (`stopped`). Satırlar `FOR UPDATE SKIP LOCKED` ile alınır: aynı satır
  iki kez işlenmez, kullanıcının o an kilitlediği satır beklenmez, sonraki çalışmaya kalır.
- Denetim: `private.retention_jobs` her işin durumunu, parti sayısını, adım sayımlarını ve hatayı tutar (3 yıl).
  Biten, durdurulan, hata alan ve kesilen her iş `retention_runs`'a özet satırı yazar (`batched_job`, `status`).

## Yasal kayıt ve delil zinciri

- `retention_run`, yasal kayıt imhası, `legal_access_log` ve imha tutanağı silmeleri bu değişiklikten etkilenmez.
- Parçalı işin `retention_runs` satırlarında yasal anahtar (`legal_*`, `destructions_*`) yoktur. Yasal kanıt modeli
  (`tools/backup/legal-evidence.cjs`) yalnız bu anahtarlarla sayım yaptığı için yeni satırlar sayımı değiştirmez.
  Parçalı iş `retention_runs`'a yalnız ekleme yapar; satır değiştirmez ya da silmez.
- Yasal arşiv (#125) kuruluysa aktif yasal koruması olan kullanıcının erişim kayıtları parçalı işte de silinmez. Bu,
  #125'in `retention_run` kuralıyla aynıdır ve #125'in sabitlenmiş kopyasıyla test edilir.
- **#125 birleşirken:** #125, `retention_run`'ı tam metniyle yeniden tanımlar. Parçalı işin koşulları #125'in
  `retention_run` koşullarından gevşek olmamalıdır. #125 ilan karartma, ilan silme ya da erişim kaydı koşulunu
  değiştirirse bu migration da aynı PR'da güncellenmelidir. Eşdeğerlik testi bu durumda kırılır.

## Ölçüm (yerel PostgreSQL 17, 200.000 ilan, 180.000'i karartılacak)

| | Toplam süre | Aynı anda gelen ilan yazmasının en uzun beklemesi |
|---|---|---|
| Tek işlem (`retention_run`) | 4,4 sn | 4,3 sn |
| Parçalı, 250'şer | 12,6 sn | 81 ms |
| Parçalı, 1.000'er (varsayılan) | 7,3 sn | 101 ms |
| Parçalı, 5.000'er | 6,5 sn | 201 ms |

Toplam süre uzar; buna karşılık kullanıcı yazmaları artık saniyelerce beklemez. `listings_unredacted` kısmi indeksi
olmadan parçalı iş her partide tabloyu baştan tarıyordu (1.000'erle 16,3 sn). Yerel makinede ağ gecikmesi yoktur;
mutlak sayılar Supabase'te farklı olur.

## Gerçek altyapıda doğrulanmayan

- Supabase üzerinde `pg_cron` ile çalışma. Yerelde `pg_cron` 1.6.2 ile doğrulandı: iş zamanlanıyor, `CALL` içindeki
  `COMMIT` arka plan işçisinde çalışıyor, sonra `retention_run` çalışıyor.
- Supabase'in küçük sunucusunda süreler.

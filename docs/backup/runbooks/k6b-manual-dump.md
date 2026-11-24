# Runbook: K6b — istisnai elle döküm

> K6 (muafiyet) elle döküm DEĞİLDİR. Bu runbook gerçek bir elle döküm içindir ve **her seferinde ayrı onay** ister.
> `postgres` rolüyle ya da güvenlik denetimini atlayarak döküm alınmaz.
>
> **Tek istisna (K6b-0):** yedek rolü ve dışa aktarma fonksiyonları Production'da henüz yokken alınan ilk yedek.
> Ayrı runbook: [bootstrap-first-backup.md](bootstrap-first-backup.md). Araç, fonksiyonlar veritabanında varsa
> çalışmayı reddeder; o andan sonra bu runbook geçerlidir.

## Ne zaman
Otomatik yedek uzun süre (ör. 24 saati aşan) alınamıyor ve beklemek kabul edilemez bir veri kaybı riski yaratıyorsa.

## Koşullar
0. **Geçiş engeli (açık, 24.11.2026):** K6b kipi Production tablo envanteri denetimini (`scope.json →
   coverage_inventory`) uygulamıyor ve B7 sayım fonksiyonu kova yaşam döngüsü tablolarını saymıyor. Bu iki iş
   tamamlanıp test edilmeden bu runbook kullanılmaz ([bootstrap-first-backup.md](bootstrap-first-backup.md) →
   "B7'ye geçmeden önce ayrı iş").
1. Yazılı onay: neden, kapsam, süre, kim yapacak.
2. Kimlik bilgisi: yalnız `nakgo_backup` rolü; parola tek kullanımlık olarak yenilenir ve iş bitince tekrar yenilenir.
   Parola sohbete, dosyaya ya da kabuk geçmişine yazılmaz (ortam değişkeni, `HISTCONTROL=ignorespace`).
3. Makine: tam disk şifreli, güncel, yalnız bu iş için kullanılan oturum.
4. Bağlantı: Supavisor oturum modu (5432), `sslmode=verify-full` ve kök sertifika.

## Adımlar
Araç: `tools/backup/k6b.cjs` (bootstrap ile aynı üç aşama; [offline-signing.md](offline-signing.md)).
1. `node tools/backup/k6b.cjs run --out <klasör> --recipients ops/backup/recipients.txt --recipients-sha256 <değer> --approval "<onay>"`.
   Önce A1 yetki denetimi (`nakgo_backup` rolüyle) `ok` olmalı; `postgres` rolüyle bağlanılırsa ve dışa aktarma
   fonksiyonları yoksa reddedilir. Döküm + S1 + şifreleme aynı boru hattıyla; şifresiz dosya yalnız geçici klasörde.
   Çıkış 2 = imza bekliyor (kısa kod).
2. İstek ve paket USB ile imza makinesine; `offline-sign.cjs` (L2 önerilir; K6b'de L1'e izin vardır, kayıtta `level: L1`
   görünür ve geri yükleme kanıtı yoktur). K6b'de T8 ölçümü alınmaz (`reference: not_measured`).
3. `node tools/backup/k6b.cjs finalize --out <klasör> --response <USB>/response-<run>.json` (çıkış 0 = tamamlandı).
   Dosyalar `manual/` önekinde; otomatik kapsama ve silme hesabına girmez; `dr-fetch` yalnız `--manifest` ve K9 zinciriyle.
4. Geçici klasör silinir; parola yenilenir.
5. Kayıt `ops/backup/drills.md`'ye: tarih, onaylayan, neden, paket hash'i, kayıttaki `offline` özeti.

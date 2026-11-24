# T8 — referans ölçümü: ne kanıtlar, ne kanıtlamaz

Araç: `tools/backup/reference-measure.cjs`. Kullanan: `bootstrap.cjs run` (ölçüm), `offline-sign.cjs` (karşılaştırma).
Testler: `tests/backup/b9-manual-flow.test.cjs` (birim, negatif), `tests/backup/b9-offline-e2e.test.cjs` (PG17).

## Ne yapılır

1. `run` (yalnız bootstrap kipi): ön kontrol geçtikten sonra ve dökümün S1 anlık görüntüsü açılmadan **önce**, ayrı ve
   salt okunur bir oturumda; döküm, geri yükleme denetimi ve şifreleme bittikten **sonra** yine aynı biçimde:
   - `pg_current_snapshot()` (txid sayaçları) ve sunucu saati;
   - `public`, `private` ve kapsamdaki Auth/Storage tablolarının satır **sayıları** (içerik okunmaz);
   - `supabase_migrations.schema_migrations` (sürüm, ad) hash'i.
   İki ölçüm `manual/pending/<run>/reference.json`'a (katı kanonik JSON) yazılır; hash'i (`nakgo-reference/v1`) imza
   isteğine (`reference_sha256`) girer. Ölçüm alınamazsa `run` başarısız olur (`reference_before` / `reference_after`).
2. `offline-sign` (L2): dosyanın hash'i istekteki değerle aynı olmalı; sonra çözülmüş paketteki değerlerle karşılaştırılır:
   - sıra: `önce.xmax ≤ döküm.xmax ≤ sonra.xmax`;
   - migration geçmişi hash'i: önce = sonra = paketteki;
   - her tablo: döküm sayısı `[min(önce, sonra), max(önce, sonra)]` içinde; ölçülmemiş tablo yok.
   Sonuç kayda `offline.reference` olarak girer: `match` (bütün tablolarda önce = sonra = döküm) ya da `bounds` (bazı
   tablolar ölçümler arasında değişti, döküm aralıkta). Tutarsızlıkta imza reddedilir (`reference_*`).
3. K6b (fonksiyon kipi): yedek rolü tabloları doğrudan sayamaz; ölçüm alınmaz, `reference_sha256: null`,
   `offline.reference: not_measured`. Şema, ölçüm bağlı değilken `match`/`bounds` yazılmasını reddeder.

## Ne kanıtlamaz

- **Kaynak kanıtı değildir.** Ölçümler ve paket aynı çevrim içi makineden gelir; ikisi birlikte sahte bir kaynaktan da
  üretilebilir. Paket bütünlüğü (SHA-256, K9) yalnız "imzalanan paket bu" demektir. Production'dan geldiğinin güvencesi
  bağlantı kurallarıdır (TLS `verify-full`, sunucu adı, port; [bootstrap-first-backup.md](bootstrap-first-backup.md)).
- **Sıralama garantisi değildir.** txid sayaçları aynı kümede tutarlılık denetimidir; dökümün tam olarak hangi anda
  alındığını kanıtlamaz. `bounds` yalnız "döküm, iki ölçümün arasıyla çelişmiyor" demektir.
- **İçerik eşitliği değildir.** Yalnız sayılar karşılaştırılır; içerik bütünlüğü S1 geri yükleme denetimleri
  (`counts`, `b_content`, `fingerprint`) ve paketin hash'iyle sağlanır.

Kayıt ve raporlar bu yüzden "ölçümle tutarlı" der; "Production'ın kanıtlanmış anlık görüntüsü" demez.

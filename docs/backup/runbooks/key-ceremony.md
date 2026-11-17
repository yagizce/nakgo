# Runbook: anahtar töreni (K1, K2, K7, age alıcıları A ve B)

> Bu runbook B7-B/C'de, **ayrı onayla** uygulanır. Claude anahtar üretmez, görmez ve saklamaz. Gizli anahtarlar bu
> belgeye, PR'a, sohbete ya da kayıtlara yazılmaz.

## Anahtarlar

| Ad | Ne işe yarar | Gizli kısmı nerede durur | Repo'ya giren |
|---|---|---|---|
| A, B (age X25519) | Yedekleri şifreler; çözmek için A **veya** B yeter | Çevrim dışı: A sahibinde, B ikinci yetkilide; her biri kâğıt + parola korumalı USB | Açık anahtarlar `ops/backup/recipients.txt`, SHA-256'ları `config.json → recipients_sha256` |
| K1 (ed25519) | CI'ın manifest, kontrol noktası ve silme kaydı imzası | Yalnız GitHub `backup-production` ortam gizlisi | Açık anahtar `config.json → trusted_k1` |
| K2 (ed25519) | Sahibin serbest bırakma (olay kapatma) ve K6 muafiyet imzası | Çevrim dışı, sahipte | Açık anahtar `config.json → trusted_k2` |
| K7 (32 bayt) | Kontrol noktası gövdelerinin şifrelenmesi | Yalnız GitHub ortam gizlisi; çevrim dışı yedeği A/B ile şifreli kâğıt | Hiçbir şey (yalnız kimliği başlıkta) |

## Adımlar

1. **Hazırlık.** Ağ bağlantısı kapalı, temiz bir makine. Gerekli araçlar (`age`, `age-keygen`, Node) önceden, sürümü ve
   SHA-256'sı doğrulanarak USB ile getirilir.
2. **A ve B.** `age-keygen -o A.key` (sahip), `age-keygen -o B.key` (ikinci yetkili). Her biri kâğıda basılır ve parola
   korumalı USB'ye yazılır. Açık anahtar satırları (`age1…`) not edilir.
3. **K2.** Çevrim dışı makinede ed25519 anahtarı üretilir. Gizli kısım kâğıt + USB. Açık PEM ve 16 haneli kimlik not
   edilir (`tools/backup/crypto.cjs → keyIdOf`).
4. **K1 ve K7.** Ayrı ve temiz bir makinede üretilir; doğrudan GitHub ortam gizlisine girilir ve yerel kopya silinir.
   K7'nin çevrim dışı yedeği A ve B'ye age ile şifrelenmiş olarak kâğıda basılır.
5. **Repo değişikliği (PR, inceleme ile).** `ops/backup/recipients.txt` (A ve B açık), `config.json` içinde
   `recipients_sha256`, `trusted_k1`, `trusted_k2`. Bu PR birleşmeden iş akışı çalışmaz.
6. **Deneme.** Test ortamında (K3 kovası) bir yedek alınır; A ile ve ayrıca B ile çözülüp geri yüklenir (bkz. `drills.md`).
7. **Kayıt.** Tarih, katılanlar, anahtar kimlikleri ve parmak izleri `ops/backup/drills.md`'ye yazılır; gizli değer yazılmaz.

## Rotasyon ve kayıp

- Yılda bir ya da şüphede yenilenir. Eski A/B gizli anahtarları, onlarla şifrelenmiş son yedeğin saklama süresi dolana
  kadar çevrim dışı tutulur.
- **K1 sızıntısı şüphesi:** iş akışı durdurulur, yeni K1 üretilir, `trusted_k1` değiştirilir; eski anahtarla imzalı
  zincir, eski açık anahtar ayrı bir "geçmiş anahtar" listesine taşınarak doğrulanmaya devam eder (B7-C'de tasarlanır).
- **K2 kaybı:** olaylar kapatılamaz; silme kapalı kalır (güvenli taraf). Yeni K2 tören ve PR ile eklenir.
- **K7 kaybı:** gövdeler age kopyasından çözülür; yeni K7 ile devam edilir.
- **A ve B'nin ikisinin de kaybı:** mevcut yedekler okunamaz. Bu yüzden iki ayrı kişi ve iki ayrı yer şarttır.

# Runbook: anahtar töreni (K1, K2, K7, K9, güven çapası, age alıcıları A ve B)

> Bu runbook B7-B/C'de, **ayrı onayla** uygulanır. Claude anahtar üretmez, görmez ve saklamaz. Gizli anahtarlar bu
> belgeye, PR'a, sohbete ya da kayıtlara yazılmaz.

## Anahtarlar

| Ad | Ne işe yarar | Gizli kısmı nerede durur | Repo'ya giren |
|---|---|---|---|
| A, B (age X25519) | Yedekleri şifreler; çözmek için A **veya** B yeter | Çevrim dışı: A sahibinde, B ikinci yetkilide; her biri kâğıt + parola korumalı USB | Açık anahtarlar `ops/backup/recipients.txt`, SHA-256'ları `config.json → recipients_sha256` |
| K1 (ed25519) | CI'ın manifest, kontrol noktası ve silme kaydı imzası | Yalnız GitHub `backup-production` ortam gizlisi | Açık anahtar `config.json → trusted_k1` |
| K2 (ed25519) | Sahibin serbest bırakma (olay kapatma) ve K6 muafiyet imzası | Çevrim dışı, sahipte | Açık anahtar `config.json → trusted_k2` |
| K7 (32 bayt) | Kontrol noktası gövdelerinin şifrelenmesi | Yalnız GitHub ortam gizlisi (`NAKGO_K7`; rotasyondan kalanlar `NAKGO_K7_PREVIOUS`) | Hiçbir şey |
| K9 (ed25519) | Elle yedeğin (bootstrap, K6b) manifest gövdesi ve izin listeli kaydının çevrim dışı imzası ([offline-signing.md](offline-signing.md)) | Yalnız çevrim dışı imza makinesinde: parola korumalı (şifreli PKCS#8) dosya + kâğıt; çevrim içi makineye hiç girmez | Açık anahtar `config.json → trusted_k9`, kimliği `active_k9` |
| Güven çapası | İmza makinesinin güvendiği şeylerin özeti: K9 açık anahtarı, alıcı hash'i, araç paketi özeti, repo commit'i, izinli sözleşme istisnaları | `anchor.json` (gizli değil) USB'de; **hash'i kâğıtta** | Hash `config.json → trusted_anchors`, `active_anchor_sha256` |

## Adımlar

1. **Hazırlık.** Ağ bağlantısı kapalı, temiz bir makine. Gerekli araçlar (`age`, `age-keygen`, Node) önceden, sürümü ve
   SHA-256'sı doğrulanarak USB ile getirilir.
2. **A ve B.** `age-keygen -o A.key` (sahip), `age-keygen -o B.key` (ikinci yetkili). Her biri kâğıda basılır ve parola
   korumalı USB'ye yazılır. Açık anahtar satırları (`age1…`) not edilir.
3. **K2.** Çevrim dışı makinede ed25519 anahtarı üretilir. Gizli kısım kâğıt + USB. Açık PEM ve 16 haneli kimlik not
   edilir (`tools/backup/crypto.cjs → keyIdOf`).
3a. **K9 ve çapa (imza makinesinde, ağ kapalı).** ed25519 anahtarı üretilir ve yalnız parola korumalı olarak yazılır
   (`crypto.generateKeyPairSync('ed25519')` → `privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase})`);
   şifresiz kopya diske yazılmaz. Araç paketi özeti (`tools/backup/toolset-hash.cjs → computeToolset`, imza makinesinde
   kullanılacak klasörlerle) alınır. Çapa (`anchor.json`, katı kanonik JSON: `version, created_at, k9_key_id,
   k9_public_key` (SPKI DER base64), `recipients_sha256, toolset_sha256, repo_commit, contract_exceptions`) yazılır ve
   hash'i (`tools/backup/offline-sign.cjs → anchorSha256`) iki ayrı kâğıda elle yazılıp karşılıklı okunur. İlk yedekte
   `contract_exceptions: ["no_contract_at_applied_ref"]` (Production'ın uygulanmış migration'larında sözleşme dosyası yok).
   Uygulama içinde anahtar üreten bir komut **yoktur**; bu adım tören tutanağına göre elle yapılır.
4. **K1 ve K7.** Ayrı ve temiz bir makinede üretilir; doğrudan GitHub ortam gizlisine girilir ve yerel kopya silinir.
   K7'nin ayrıca yedeklenmesi gerekmez: her gövdenin veri anahtarı K7'ye ek olarak A ve B'ye de sarılır (zorunlu).
   K7 böylece CI alanında, kurtarma anahtarları (A, B) ise çevrim dışı alanda kalır.
5. **Repo değişikliği (PR, inceleme ile).** `ops/backup/recipients.txt` (A ve B açık), `config.json` içinde
   `recipients_sha256`, `trusted_k1`, `trusted_k2`, `trusted_k9`, `active_k9`, `trusted_anchors`, `active_anchor_sha256`.
   Bu PR birleşmeden iş akışı ve elle yedek (`run`/`finalize`) çalışmaz; PR'daki çapa hash'i kâğıttakiyle karşılaştırılır.
6. **Deneme.** Test ortamında (K3 kovası) bir yedek alınır; A ile ve ayrıca B ile çözülüp geri yüklenir (bkz. `drills.md`).
7. **Kayıt.** Tarih, katılanlar, anahtar kimlikleri ve parmak izleri `ops/backup/drills.md`'ye yazılır; gizli değer yazılmaz.

## Rotasyon ve kayıp

- Yılda bir ya da şüphede yenilenir. Eski A/B gizli anahtarları, onlarla şifrelenmiş son yedeğin saklama süresi dolana
  kadar çevrim dışı tutulur.
- **K1 sızıntısı şüphesi:** iş akışı durdurulur, yeni K1 üretilir, `trusted_k1` değiştirilir; eski anahtarla imzalı
  zincir, eski açık anahtar ayrı bir "geçmiş anahtar" listesine taşınarak doğrulanmaya devam eder (B7-C'de tasarlanır).
- **K2 kaybı:** olaylar kapatılamaz; silme kapalı kalır (güvenli taraf). Yeni K2 tören ve PR ile eklenir.
- **K7 kaybı:** iş akışı `body` aşamasında durur; silme kapısı kapalı kalır (testli). Kurtarma çevrim dışı makinede
  yapılır: baş kontrol noktasının gövdesi A ya da B ile açılır (`openBodyWithAge`), veri anahtarı yeni K7'ye sarılıp
  `audit/checkpoints/<sıra>.rewrap.<yeni K7 kimliği>` olarak yüklenir (`rewrapWithAge`). Ardından `NAKGO_K7` yeni anahtarla
  değiştirilir. Kilitli gövde değişmez; sahte bir yeniden sarma yalnız çözmeyi başarısız kılar.
- **K7 rotasyonu:** yeni anahtar `NAKGO_K7`'ye, eskisi `NAKGO_K7_PREVIOUS`'a konur. Eski anahtarla yazılmış gövdeler
  okunmaya devam eder; yeniler yalnız yeni anahtarla sarılır. Eski gövdeler artık okunmayacaksa (bir sonraki baş yeni
  anahtarla yazıldıktan sonra) eski anahtar listeden çıkarılabilir; A/B yine her gövdeyi açar.
- **Görev ayrılığı:** K1, K2 ve K9 ikişer ikişer aynı anahtar olamaz (B7 orkestratörü, `run`, `finalize` ve imza makinesi
  yapılandırmayı reddeder). K1 ile imzalanmış serbest bırakma belgesi reddedilir. K9 imzası yalnız elle yedek amaç
  etiketleriyle (`nakgo-manual-manifest/v1`, `nakgo-manual-record/v1`) geçerlidir. K7 yalnız gizlilik içindir.
- **K9 ya da çapa rotasyonu:** yeni çapa (ve gerekirse yeni K9) tören + PR ile `trusted_*` listelerine eklenir ve
  `active_*` yapılır; eski çapa ve K9 listede kalırsa eski kayıtlar doğrulanmaya devam eder, ama `finalize` yalnız
  **etkin** K9 ve çapayla atılmış yeni imzayı kabul eder. Araç paketi (araçlar, migration'lar, PostgreSQL/node sürümü)
  değiştiğinde yeni çapa gerekir.
- **K9 kaybı:** elle yedek tamamlanamaz (finalize reddeder); mevcut kayıtlar açık anahtarla doğrulanmaya devam eder.
  **K9 sızıntısı şüphesi:** `trusted_k9`'dan çıkarılır (o anahtarla imzalı kayıtlar da artık doğrulanmaz; gerekirse
  yeniden L2 + yeni K9 ile imzalanır).
- **A ve B'nin ikisinin de kaybı:** mevcut yedekler okunamaz. Bu yüzden iki ayrı kişi ve iki ayrı yer şarttır.

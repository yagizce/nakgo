# B7-A3 — Yasal kayıt kanıtı, kontrol noktası zinciri, K2 serbest bırakma ve K6 muafiyet durum makinesi

Bu belge `tools/backup/merkle.cjs`, `legal-evidence.cjs`, `checkpoint.cjs`, `state-machine.cjs`, `legal-run.cjs` ve
`deletion.cjs` içindeki kapsama kuralını anlatır. Testler: `tests/backup/a3-legal.test.cjs`.

Testler **gerçek #125 migration'ını** kullanır: `tests/backup/fixtures/legal_archive.b25013e.sql`, b25013e'deki dosyanın
birebir kopyasıdır (SHA-256 `a32d8e90…d099`, testte sabit; git nesnesi varsa onunla, #125 birleşince depodakiyle de
karşılaştırılır). İmha ve saklama testleri gerçek `retention_run()` ve `legal_destroy()` ile koşar; zincir hash'i gerçek
`legal_chain_check()` ile karşılaştırılır. Yalnız zamanı geçmişe yazan dört yardımcı ayrıdır ve farkları dosyanın başında
yazılıdır: `tests/backup/legal-test-helpers.sql`.

Önceki sentetik şemanın gerçek migration'a göre eksikleri (katalog karşılaştırmasıyla bulundu, artık geçersiz): 15 CHECK
kısıtı (eylem listesi, metin uzunlukları, onay/süre ve serbest bırakma tutarlılığı, koruma kapsamı), 9 indeks, 4 TRUNCATE
tetikleyicisi, 6 tabloda RLS ve 10 koruma/iş fonksiyonu (`legal_close`, `legal_destroy`, `legal_expired`,
`legal_chain_check`, `legal_log` imzası dahil).

> Bu aşama hiçbir canlı sisteme dokunmaz. Depo testlerde bellek içi taklittir; R2 davranışı (koşullu yazma V1, tutarlı
> okuma V2, kilit V3) **kanıtlanmamıştır**. Kanıt B7-B'de K3 test kovasında alınır. O zamana kadar başlıkta
> `single_use_guaranteed=false` yazılır ve silme kapısı (`capabilityVerified`) kapalı kalır.

## 1. Neden tam liste

Merkle kökü tek başına silinen kaydı göstermez. Her kontrol noktası, #125 tablolarının **tam yaprak listesini** taşır:

| Liste | Yaprakta bulunanlar |
|---|---|
| `log` (`legal_access_log`) | id, UTC gün, tam zaman (µs), `prev_hash`, `row_hash`, politika kodu + politika hash'i |
| `destructions` | aynıları + `record_no`, kayıt politikası, `retain_days`, açılış/kapanış ayı, kaldırılan koruma sayısı, neden |
| `records` | id, açılış günü, durum, kapanış zamanı/günü/ayı, `snapshot_sha256`, değişmez sütunların hash'i, kapanış alanlarının hash'i, politika + hash |
| `holds` | id, kayıt id, açılış günü, serbest mi, değişmez sütunların hash'i, serbest bırakma alanlarının hash'i |
| `runs` (`retention_runs`) | id, çalışma zamanı, sayılar ve sayıların hash'i |

Satır hash'leri dökümde fonksiyona güvenilmeden doğrudan ifadeyle yeniden hesaplanır
(`sha256((to_jsonb(satır)-'row_hash')::text)`, oturum UTC).

Kök RFC 6962 biçimindedir (yaprak `0x00`, iç düğüm `0x01` önekli SHA-256); CT test vektörleriyle doğrulanır. Kapsama
kanıtı (`merkle.proof`/`verifyProof`) tek bir kaydı denetçiye göstermek içindir.

## 2. Silme kanıtı kuralları (`verifyTransition`)

Önceki kontrol noktasındaki tam liste şimdikiyle karşılaştırılır. Aşağıdakilerin **hepsi** sağlanmazsa silme
kanıtlanamaz sayılır, olay açılır, insan incelemesi gerekir ve olay kapanana kadar yedek silme yapılmaz.

Zincirli tablolar (`log`, `destructions`):
- Silinen yaprak önceki listede vardı.
- İlgili politika (`legal_access_log` / `destruction_record`) hem önceki hem şimdiki noktada **onaylı ve aynı**.
- Aralıkta (önceki noktadan sonra kimliği büyük) en az bir retention çalışması var ve satırın zamanı o çalışmanın
  sınırından (`ran_at − retain_days × 24 saat`) **kesin olarak önce**.
- Aralıktaki çalışmaların bildirdiği silme sayısı gözlenen silmeyle **birebir** aynı (fazlası: görülmemiş satır silinmiş
  → `integrity`; eksiği: retention dışında silinmiş → `legal_regression`).
- Mevcut satırlar değişmemiş (`row_hash`, `prev_hash`); yeni satırların kimliği öncekinden büyük.
- Yeni satırın `prev_hash`'i ya şimdiki selefine ya da selefiyle kendisi arasında kalan, görülmüş ve silinmiş bir
  satıra bağlı; aksi `chain_gap_unexplained` (`integrity`).

Yasal kayıtlar:
- Kayıt önceki noktada **kapalı** görülmüş, aktif koruması yok.
- Politika onaylı ve aralıkta değişmemiş.
- Aralıkta bu kayıt için **tam olarak bir** yeni imha tutanağı var; politika, süre, açılış/kapanış ayı, koruma sayısı ve
  neden kayıtla uyumlu.
- `kapanış + retain_days ≤ tutanak zamanı`.
- Mevcut kayıtların değişmez alanları ve snapshot hash'i aynı; durum yalnız `open → closed`.
- Görülmemiş bir kayıt için tutanak → `destruction_without_seen_record`.

Korumalar yalnız kaydıyla birlikte silinebilir; serbest bırakma tek yönlüdür. `retention_runs` değişmez; bir kayıt
yalnız aralıkta bir retention çalışması varsa ve o çalışmanın zamanından **3 takvim yılı** (PostgreSQL `interval '3 years'`
ile aynı hesap, 29 Şubat dahil test edildi) eskiyse silinebilir.

### Tek başına yeterli sayılmayanlar
Hash zinciri (kuyruğu göremez), dizi numarası (geri alınan işlemler de boşluk bırakır — yalnız `id_gap` bilgisi),
işlem zamanı (id ile birlikte artmaz) ve retention sayısı (hangi satırı sildiğini söylemez). Karar dördünün ve tam
listenin birlikte değerlendirilmesidir.

### Açık güvenli varsayılanlar
| Durum | Varsayılan |
|---|---|
| İki nokta arasında eklenip silinen satır | Yasal yoldan mümkün değil (yeni satır saklama sınırı içinde). Zincir boşluğu ya da sayım fazlalığıyla görülürse `integrity`. |
| Kuyruktan silinen (görülmüş) satır | Diğer silmelerle aynı kurallar. |
| Kuyrukta görülmeden ekle-sil | **Bilinen sınır**: tetikleyici yeni satırı mevcut son satıra bağladığı için zincir göremez; yalnız `id_gap` bilgisi kalır. Retention yolundan yapılmışsa sayım fazlalığı yakalar. Testte belgelendi. |
| Politika değişikliği | `policy_changed` (bilgi) kaydedilir; aynı aralıktaki o politikaya dayalı her silme `legal_regression`. Kısalan süre ancak bir sonraki aralıkta geçerli. Politika silinmesi `integrity`. |
| İlk kontrol noktası | Mevcut durum ancak K2 serbest bırakmasıyla başlangıç kabul edilir (`genesis_baseline`). |
| Yasal tablolar yok (#125 öncesi) | `legal_absent`, yasal aşama n/a. Sonradan gelirse başlangıç onayı; vardıktan sonra kaybolursa `integrity`. |
| Bulgu mevcut bir açık olayın kapsamındaysa | Yeni olay açılmaz; aynı durum yeniden bulgu üretmez. |

## 3. Kontrol noktası

- `audit/checkpoints/<seq 12 hane>.body.<sha16>`: şifreli gövde. AES-256-GCM, rastgele veri anahtarı; anahtar **K7** ile
  (yalnız CI'da duran 32 bayt) ve isteğe bağlı olarak çevrim dışı **age** alıcılarına sarılır. AAD = sıra + önceki başlık
  hash'i: gövde başka bir noktaya taşınamaz.
- `audit/checkpoints/<seq 12 hane>.json`: açık başlık, **K1** imzalı (`nakgo-legal-checkpoint/v1`): sıra, önceki başlık
  hash'i, gövde hash'i, beş kök, sayılar, politika/retention/bulgu/olay/belge/muafiyet özetleri, `single_use_guaranteed`,
  `anchors_confirmed`, yedek referansı. Kişisel veri, kimlik ya da gün içermez.
- İkisi de "yoksa yaz" (If-None-Match). Başlık yazıldıktan sonra geri okunur; farklıysa çakışma sayılır.
- Okuma: zincir baştan doğrulanır (imza, kesintisiz sıra, önceki hash bağı); gövde açılır ve başlıktaki her özet gövdeden
  yeniden hesaplanarak karşılaştırılır.

### Açık metin meta verinin gizliliği
| Konu | Karar |
|---|---|
| Şifreleme | Gövde K7 ile şifreli; açık başlıkta yalnız kökler ve sayılar. |
| Erişim | K7 yalnız yedek iş akışının ortam gizlisinde (B7-B'de, ayrı onayla). Okuma yalnız sahip ve CI. Yaprakta ad, iletişim, gerekçe metni, IP, kullanıcı/ilan kimliği **yok**; yalnız yasal tablo kimlikleri, günler, hash'ler. |
| Saklama | Başlıklar kalıcı (küçük, kişisel veri yok). Gövdeler `audit/` kilidi (90 gün) boyunca silinemez; sonra en az 13 ay tutulur. Gövde silme bu aşamada **yok**; ayrı onay ve runbook gerektirir (B7-B/C). |
| Kurtarma | Her gövdenin veri anahtarı K7'ye ek olarak çevrim dışı age alıcılarına (A, B) sarılır (A4'te zorunlu). K7 kaybında gövde A ya da B ile açılır (`openBodyWithAge`); veri anahtarı yeni K7'ye sarılıp ayrı bir nesneye yazılır (`rewrapWithAge` → `<seq>.rewrap.<K7 kimliği>`); kilitli gövde değişmez. Sahte yeniden sarma yalnız çözmeyi başarısız kılar. |
| Rotasyon | `k7 = [yeni, ...eski]`: yazma yeni anahtarla, okuma halkadaki herhangi biriyle. Halkada uygun anahtar yoksa çalışma `body` aşamasında durur; açık olay sayısı bilinmez, çapa doğrulanmaz, silme kapısı kapalı kalır. |
| Görev ayrılığı | K1 (CI imzası), K2 (sahip; serbest bırakma/muafiyet), K7 (gövde şifrelemesi), A/B (yedek ve gövde kurtarma) ayrı anahtarlardır. K1 ile imzalanmış serbest bırakma belgesi reddedilir (testli); A4 yapılandırma denetimi K1 ile K2 listelerinin kesişmesini reddeder. |

## 4. Olaylar ve K2 serbest bırakma

Olay kimliği rastgele UUIDv4. Bağ: `sha256(canonical{event_id,type,opened_seq,opened_prev_sha256,findings_sha256})`;
olay listesi kökü imzalı başlıkta.

Belge (K2 imzalı, `nakgo-legal-release/v1`): `version, release_id, event_id, event_binding, scope{type,findings_sha256},
reason (≥10), environment, not_before, not_after (≤72 saat), key_id, signature`.

| Durum | Anlamı |
|---|---|
| issued | Gelen kutusunda; zincirde yok. |
| validated | Bu çalışmada imza, ortam, bağ, kapsam ve süre doğrulandı. |
| consumption_pending | Kontrol noktası N'ye yazıldı; olay hâlâ açık. Çökme olursa sonraki çalışma tamamlar. |
| consumed | N+1'e yazıldı; olay kapandı. |
| rejected | Gerekçesiyle zincirde. Aynı `release_id` bir daha kabul edilmez. |

Reddedilenler: imza/anahtar, ortam, bağ, kapsam, süre dışı, 72 saati aşan aralık, olay açılmadan önce başlayan geçerlilik
(eski belge yeni olayı kapatamaz), tekrar kullanım, aynı olay için birden çok geçerli belge (hepsi reddedilir, olay açık
kalır), bekleyen başka belgesi olan olay.

**Tek kullanımlılık sınırı:** Garanti, zincirin doğrusal kalmasına (aynı sıra numarasının bir kez yazılabilmesine)
dayanır. Bu R2'nin koşullu PUT'u ve tutarlı okuması kanıtlanmadan **iddia edilmez**. GitHub `concurrency` atomik tek
kullanım sağlamaz; yalnız aynı anda iki çalışmayı azaltır. Ek savunma: dış çapalar. Çapa zincirde olmayan bir sıra ya da
farklı hash gösterirse (geri sarma, çatal) çalışma durur.

## 5. K6 muafiyeti (durum makinesi tarafı)

A1 `stop_waivable` → `preflight_waivable` olayı. Muafiyet belgesi (A1 `waiver.cjs` doğrular) bu olaya ve farkın hash'ine
bağlı olmalı; her `waiver_id` bir kez kullanılır. Olay 7 günü aşarsa muafiyet kabul edilmez, olay yalnız K2 ile kapanır.
Fark ortadan kalkınca olay kendiliğinden kapanır. Muafiyet yalnız yedeğin ilerlemesine izin verir; olay açıkken silme
yoktur.

## 6. Silme kapısı (A2'ye eklenen)

`deletion.plan` artık `coverage` ister: silmeden sonra en az 4 doğrulanmış yedek kalmalı ve en yeni doğrulanmış yedek 24
saatten yeni olmalı. Kapsama bilinmiyorsa silme yok. Diğer koşullar A2'deki gibi: açıkça etkin, depo davranışı kanıtlı,
açık olay 0, dış çapa doğrulanmış.

## 7. Dış çapalar

Arayüz: `{name, put(seq, sha), list()}`. Her çalışmanın son başlık hash'i her çapaya yazılır. Çapa tanımlı değilse,
yazılamazsa ya da başı doğrulamıyorsa `anchorsOk=false` ve silme kapısı kapalı. Somut çapalar (ayrı hesap/kova, iş akışı
özeti) A4'te bağlanır; gerçek hesaplar B7-B'de ayrı onayla açılır.

## 8. Test edilemeyenler
- R2 koşullu PUT, tutarlı okuma ve kilit davranışı (K3, B7-B).
- Gerçek #125 migration'ı bu dalda migration olarak yoktur; testler onun birebir kopyasını uygular.
- Gerçek K1/K2/K7 anahtarları: yalnız test süresince bellekte üretilen geçici anahtarlar kullanıldı.

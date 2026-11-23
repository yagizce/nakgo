# Runbook: elle yedeğin çevrim dışı imzası (K9) — run → offline-sign → finalize

> Elle alınan yedekler (ilk yedek/bootstrap ve K6b) üç aşamada tamamlanır. Özel imza anahtarı **K9** yalnız ağı olmayan,
> ayrılmış imza makinesinde ve yalnız bütün denetimler geçtikten sonra kullanılır. Bu belge kodun ne yaptığını anlatır;
> gerçek yedek, gerçek anahtar töreni ve Production erişimi her biri **ayrı yazılı onay** ister.

## Neden üç aşama

- Çevrim içi makine Production'a bağlanır; orada özel anahtar bulunursa makinenin ele geçirilmesi imzanın da ele
  geçirilmesi olur. `bootstrap.cjs` ve `k6b.cjs`'te özel anahtar okuyan ya da imza atan **hiçbir yol yoktur**
  (`--sign-key` reddedilir; test kaynakta denetler).
- Çevrim içi makinenin "doğrulandı" demesi kanıt değildir. İmza makinesi paketi **kendisi** çözer, ağsız bir kümede
  geri yükler ve denetler (L2). İmza, imza makinesinin gördüğünü onaylar.

| Aşama | Makine | Girdi | Çıktı | Çıkış kodu |
|---|---|---|---|---|
| `run` | Çevrim içi (Production'a salt okunur) | Bağlantı (ortam), alıcılar, onay kimliği | `manual/db/…tar.age`, `manual/pending/<run>/request.json`, `reference.json` (bootstrap) ya da `failed.json` | 2 = imza bekliyor, 1 = başarısız |
| `offline-sign` | Çevrim dışı (ağ arayüzü yok) | USB: istek, paket, ölçüm, çapa; kâğıt: çapa hash'i; A **veya** B kimliği; parola korumalı K9 | USB: `response-<run>.json` | 0 = imzalandı, 1 = reddedildi |
| `finalize` | Çevrim içi (Production'a bağlanmaz) | Yanıt + depodaki bekleyen istek ve paket + main'deki `config.json` | `manual/manifests/…json`, `manual/records/…json` | 0 = tamamlandı, 1 = reddedildi |

Yedek ancak `finalize` 0 ile bittiğinde **tamamlanmış** sayılır. `run` 2 ile bittiğinde yedek henüz tamamlanmamıştır.

## Güven zinciri

```
kâğıt (anahtar töreni) ──► anchor_sha256 ──► anchor.json ─┬─► K9 açık anahtarı (SPKI) ── config.trusted_k9[active_k9]
                                                          ├─► recipients_sha256 ──────── config.recipients_sha256, paket
                                                          ├─► toolset_sha256 ─────────── imza makinesindeki araçlar
                                                          ├─► repo_commit
                                                          └─► contract_exceptions (izin verilen sözleşme istisna kodları)
config.json (main, PR'la) : trusted_k9, active_k9, trusted_anchors{sha: …}, active_anchor_sha256, recipients_sha256
istek (nakgo-manual-request/v1 hash'i, kısa kod) ──► kayıt.request_sha256
manifest gövdesi (nakgo-manual-manifest-body/v1) ──► kayıt.manifest_sha256 ──► paket SHA-256 ve boyutu
imzalar: manifest gövdesi K9 + nakgo-manual-manifest/v1 · kayıt K9 + nakgo-manual-record/v1 (birbirinin yerine geçmez)
```

- **Çapa** (`anchor.json`, katı kanonik JSON): `version, created_at, k9_key_id, k9_public_key` (SPKI DER base64),
  `recipients_sha256, toolset_sha256, repo_commit, contract_exceptions`. Hash'i (`nakgo-anchor/v1`) anahtar töreninde
  kâğıda yazılır ve `config.json → trusted_anchors` / `active_anchor_sha256`'ya PR ile girer. İmza makinesi USB'deki çapayı
  kâğıttaki hash'le karşılaştırır; USB'deki `config.json` kullanılmaz (repodaki, incelenmiş olan okunur).
- **Araç paketi**: `tools/backup/*.cjs`, `tools/db-lib.cjs`, `tools/api-contract.cjs`, migration dosyaları,
  `scope.json`, `migration-aliases.json`, `package*.json`, node-pg klasörü, PostgreSQL sunucu ve istemci klasörleri,
  `node`, `age`, `age-keygen`, `tar` (`tools/backup/toolset-hash.cjs`). `config.json` kapsam dışıdır (çapa hash'ini taşır).
  Araçlardan biri değişirse çapa da yenilenir (tören + PR). Özet K9'dan önce iki kez alınır (başta ve K9'dan hemen önce).
- **K1, K2, K9** ikişer ikişer farklı anahtarlardır; `run`, `finalize`, B7 orkestratörü ve imza makinesi yapılandırmayı
  reddeder.

## Hazırlık (her biri ayrı onay)

1. Anahtar töreni tamam ([key-ceremony.md](key-ceremony.md)): A, B, K9 ve çapa; `config.json` PR'ı main'de.
2. İmza makinesi: tam disk şifreli, ağ kartı devre dışı (kablosuz dahil; `ip link` yalnız `lo`), repo `anchor.repo_commit`
   ile aynı araçlarla; PostgreSQL 17 sunucu kurulumu (`initdb`, `pg_ctl`, `postgres`) ve istemcisi, `age` 1.1+, Node 24,
   node-pg 8.23.1. Root olarak çalışılıyorsa `NAKGO_PG_RUN_AS=<sistem kullanıcısı>` (PostgreSQL root ile çalışmaz).
3. Çevrim içi makine: [bootstrap-first-backup.md](bootstrap-first-backup.md) ya da [k6b-manual-dump.md](k6b-manual-dump.md).

## Adımlar

```sh
# 1) Çevrim içi: run
node tools/backup/bootstrap.cjs run --out <klasör> --recipients ops/backup/recipients.txt \
  --recipients-sha256 <config.json'daki değer> --approval "<onay kimliği>" [--run-id <ad>]
#    Çıkış 2 ve "İMZA BEKLİYOR: kısa kod xxxx-xxxx-xxxx-xxxx-xxxx" (80 bit). Kısa kodu kâğıda yazın.
#    USB'ye: manual/pending/<run>/request.json → request.json, reference.json (varsa), manual/db/…tar.age (aynı ad), anchor.json

# 2) Çevrim dışı: offline-sign (ağ yok)
node tools/backup/offline-sign.cjs --usb <USB> --anchor-sha256 <kâğıttaki çapa hash'i> --confirm-code <kâğıttaki kısa kod> \
  --identity <A kimlik dosyası> --identity-b <B kimlik dosyası> --identity-label AB --k9-key <şifreli K9 PEM> \
  --pg-install <PostgreSQL 17 sunucu kurulumu> --pg-bin <PostgreSQL 17 istemci bin> --pg-dirs <toolset'e giren klasörler, virgüllü>
#    Önerilen: A ve B aynı oturumda (iki sahip birlikte) → --identity-label AB. Tek kişiyle: --identity <A ya da B> --identity-label A|B.
#    Bütün denetimler geçerse K9 parolası terminalden (yankısız) istenir. Çıktı: USB/response-<run>.json

# 3) Çevrim içi: finalize (Production'a bağlanmaz)
node tools/backup/bootstrap.cjs finalize --out <klasör> --response <USB>/response-<run>.json
#    Çıkış 0: manual/manifests/… ve manual/records/… yazıldı, zincir geri okunup doğrulandı.
```

K6b'de `bootstrap.cjs` yerine `k6b.cjs` (aynı alt komutlar). Kurtarmada indirme: [restore-dr.md](restore-dr.md).

## offline-sign ne denetler (sırayla; biri tutmazsa K9 hiç okunmaz)

| # | Denetim | Kod (red) |
|---|---|---|
| 1 | Ağ arayüzü yok (yalnız loopback) | `network_present` |
| 2 | Çapa katı kanonik; hash kâğıttakiyle aynı; K9 kimliği açık anahtarla aynı | `anchor_mismatch`, `anchor_schema`, `anchor_key`, `strict_json` |
| 3 | Yapılandırma: K9/çapa listeleri tutarlı, çapa **etkin**, etkin K9 = çapadaki, alıcı hash'i = çapadaki, K1/K2/K9 ayrık | `config`, `anchor_not_active`, `anchor_k9`, `anchor_recipients` |
| 4 | Araç paketi = çapadaki; `age`/`age-keygen` açık yoldan, `--pg-install` ve `--pg-bin` `--pg-dirs` içinde (L2'de ikisi zorunlu); sembolik bağların hedef içeriği de özetlenir | `toolset_mismatch`, `pg_paths` |
| 5 | İstek katı kanonik, hash içerikten; kısa kod operatörün yazdığıyla aynı; çevrim içi beyanlar imzalanabilir; yanıt dosyası yok | `short_code`, `request_*`, `request_hash`, `response_exists` |
| 6 | T8 ölçüm dosyası istekteki hash'le aynı; bootstrap'ta ölçüm zorunlu | `reference_hash`, `reference_required` |
| 7 | L1: paket boyutu ve SHA-256 manifestle aynı; age başlığı tam iki X25519 alıcısı | `package_hash`, `package_header` |
| 8 | L2 (bootstrap'ta zorunlu): her kimlik alıcı listesinde ve etiketi yerine uygun (sıralı listede A ilk, B ikinci); her kimlik paketi AYRI çözer, AB'de iki düz metin birebir aynı; tar içeriği izin listesinde ve yalnız düz dosya | `identity`, `identity_label`, `decrypt`, `decrypt_mismatch`, `tar_entry` |
| 9 | R1–R3: migration geçmişi repo ile (sürümle tam eşleşme ya da PR'lı takma ad; ad yalın ya da `<14 hane>_<ad>.sql`, ad kısmı birebir); bilinmeyen, ad farkı, bozuk ad, belirsiz damga, yineleme, boşluk yok; damga farkı yalnız `migration-aliases.json → timestamp_exceptions` izin listesindeki satırla (sürüm + slug + Production adı birebir), uyarı + kayıt; listede olmayan yeni fark ret | `migration_history` |
| 10 | T8: döküm anlık görüntüsü ve sayılar önce/sonra ölçümleriyle tutarlı | `reference_order`, `reference_counts`, `reference_migrations`, `reference_tables` |
| 11 | Referans derlemesi: uygulanmış migration'lar ağsız atılabilir kümede (pg_cron taklidiyle) çalıştırılır | `reference_migration` |
| 12 | Ağsız kümede **süper kullanıcı olmayan** rolle geri yükleme; S1 denetimleri, `migration_history`, `cron_jobs` (R6, referansa karşı), `external_triggers` (O5), `schema_reference` (R4) | `restore_*`, `check_missing` |
| 13 | Sözleşme politikası: çevrim içi `passed` beyanı (kayda `claimed_passed` olarak) ya da çapada izinli istisna (`no_contract_at_applied_ref`) | `contract_policy` |
| 14 | Şifresiz dosyalar ve kümeler silinir (postmaster kalmadığı ve klasör silindiği doğrulanır, değilse durur); araç paketi yeniden özetlenir; ağ yeniden denetlenir | `cleanup_failed`, `toolset_changed`, `network_present` |
| 15 | K9: şifreli PKCS#8 olmalı, parola terminalden; kimliği çapa ve etkin K9 ile aynı. **Bundan sonra alt süreç başlatılmaz** | `k9_unencrypted`, `k9_passphrase`, `k9_mismatch` |
| 16 | Kayıt izin listeli (yalnız kodlar, sayılar, hash'ler); iki imza; zincir finalize'ın koduyla yeniden doğrulanır; yanıt atomik, üzerine yazmadan | `response_exists` |

## Kayıt (nakgo-manual-record, `version: 2`) neyi söyler, neyi söylemez

`version: 1` kayıtlar (istisna kimlikleri ve hash'i olmayan) `record_version` koduyla açıkça reddedilir; Production'da
hiç elle kayıt yayımlanmadığı için geriye dönük gevşek kural yoktur.

**Zaman damgası istisnaları aşamalar arasında (aynı ortak kod, `migration-match.cjs`):**

| Aşama | Gördüğü | Kural |
|---|---|---|
| run | yedekteki geçmiş (geri yükleme doğrulaması) | satır kuralı (sürüm + slug + Production adı izin listesinde birebir) ve küme kuralı (`requireAllExceptions`: listedeki her satır geçmişte); bozulursa `migration_history` düşer, imza isteği yazılmaz |
| offline-sign | aynı geçmiş (çözülmüş paket) | aynı satır ve küme kuralı + `exceptionSetProblems` (K9'dan önce; `migration_history` / `migration_exceptions`); kimlikler ve hash imzalı kayda yazılır |
| finalize | yalnız imzalı kayıt (paketi çözemez) | önce kayıt imzası; sonra `exceptionSetProblems`: kayıttaki kimlikler main'deki izin listesiyle birebir (eksik, fazla, yinelenen, bilinmeyen, değiştirilmiş yok) ve `exceptions_sha256` eşleşir; ret `migration_exceptions`, hiçbir yazım yapılmadan |

dr-fetch kimlikleri yalnız biçim olarak doğrular (imzalı kayıt sonradan değişen bir izin listesine göre yeniden
yargılanmaz; hangi listeyle imzalandığı `exceptions_sha256` ile kanıtlanır).

- `offline.level: L2`, `decrypted_with: A|B|AB`, `restore_role: non_superuser` (başka değer yok), `checks` (geçen kodlar;
  `target_role` geri yükleyen oturumun süper kullanıcı OLMADIĞININ ölçümüdür), `migrations {applied, pending, aliases,
  nameless, normalized, timestamp_mismatch}` (`normalized`: adı `<14 hane>_<ad>.sql` biçiminde olup ad kısmı dosyayla
  aynı satırlar; `timestamp_mismatch`: bunlardan addaki zaman damgası sürümden farklı olanlar, imza makinesi ekrana
  sürümleriyle de yazar; `timestamp_mismatch ≤ normalized`, `normalized + nameless ≤ applied`;
  `timestamp_exceptions`: kabul edilen her istisnanın tam kimliği `{version, slug, production_name}`, sürüme göre
  kesin artan, sayısı `timestamp_mismatch`'e eşit; `exceptions_sha256`: doğrulamada kullanılan izin listesinin kanonik
  hash'i — `nakgo-migration-timestamp-exceptions/v1` etiketi + sürüme göre sıralı `[version, slug, production_name]`
  satırları; açıklama metni ve dosya biçimi dahil değil),
  `cron {jobs, inactive}`, `triggers`, `schema: match`, `reference: match|bounds|not_measured`,
  `contract {status: claimed_passed|exception, exception}`.
- `claims` çevrim içi makinenin **beyanıdır** (kanıt değil); kanıt `offline` alanıdır. **İstisna:** `offline.contract`
  imza makinesinde doğrulanmaz. `claimed_passed` yalnız çevrim içi beyanın politikadan geçtiğini, `exception` çapada izinli
  bir istisnayı söyler; sözleşme geride kalan şemada çalıştırılamaz, provada çalıştırılır ([migration-rehearsal.md](migration-rehearsal.md)).
- `decrypted_with: A` ya da `B` paketin yalnız o anahtarla çözüldüğünü gösterir; age başlığındaki diğer alıcının
  gerçekten diğer anahtar olduğunu göstermez. `AB`: iki kimlik aynı çalıştırmada paketi ayrı ayrı çözdü ve düz metinler
  birebir aynı; iki alıcının ikisinin de kurtarabildiğinin kanıtı budur. İlk yedekte `AB` kullanılır; tek kişiyle
  yapılmışsa tatbikatta ([drills.md](drills.md)) aynı paket diğer anahtarla da imzalanır (yalnız biri finalize edilir).
- `reference: match|bounds` Production kaynağının ya da sıralamanın **kanıtı değildir**; tutarlılıktır
  ([reference-measurement.md](reference-measurement.md)). Ölçüm dosyası bağlı değilse kayıt "ölçüldü" diyemez (şema reddeder).
- Paket bütünlüğü (SHA-256 + K9) paketin imzalanan paket olduğunu gösterir; Production'dan geldiğini göstermez.

## Belgelenmiş riskler

- **Paket SQL'i çalışır, ama yalnız yetkisiz rolle.** Geri yükleme (`pg_restore`) paketteki SQL'i çalıştırır; bu yüzden
  rol süper kullanıcı değildir (CREATEDB, CREATEROLE, `createrole_self_grant='set,inherit'`; ölçülür: `target_role`).
  Süper kullanıcıyla geri yükleme yolu **kaldırıldı** (`--allow-superuser-isolated` reddedilir; şema `superuser_isolated`'i
  kabul etmez). PostgreSQL 16+ kurallarına göre bu rol süper kullanıcı oluşturamaz, `COPY … PROGRAM`/sunucu dosyası
  yetkileri (`pg_execute_server_program`, `pg_read/write_server_files`) ve C dili fonksiyonları yoktur; bu PostgreSQL'in
  belgelenmiş davranışıdır ve yerel PG17 ağsız kümede sınandı (`b9-offline-e2e`: süper kullanıcı/BYPASSRLS rolü, kendini
  yükseltme, `COPY PROGRAM`, sunucu dosyası okuma/yazma, C fonksiyonu, yetkili rol üyeliği reddedilir). Bugünkü paket bu rolle geri yüklenir (PG17 testi). Bir gün
  yetmezse imza yapılmaz; çözüm kod değişikliği ve yeni çapadır. Küme yine de `NAKGO_PG_RUN_AS` ile K9, USB ve kimlik
  dosyalarına erişemeyen ayrı bir işletim sistemi kullanıcısıyla çalıştırılır (savunma derinliği).
- **pg_cron taklidi.** Referans derlemesi gerçek pg_cron yerine aynı API'yi taklit eden eklentiyle çalışır; zamanlama
  arka planı yoktur. Beklenen işler bu yüzden "migration'ın çağırdığı" işlerdir; gerçek Supabase davranışı G20'dir.
- **Ağ denetimi** işletim sisteminin arayüz listesine dayanır; fiziksel ayrımın yerine geçmez (kablo/kart çıkarılır).
- **TOCTOU.** USB dosyaları sembolik bağ, hard link ve yarış denetimiyle bir kez okunur; çözme doğrulanmış baytların
  kopyasından yapılır. Araç paketi iki kez özetlenir; aradaki değişiklik `toolset_changed` ile reddedilir.
- **Sinyal ve çökme.** SIGINT/SIGTERM'de alt süreçler (age, tar, pg_restore, initdb, pg_ctl, postmaster) gruplarıyla
  sonlandırılır; küme ve şifresiz klasör silinir; yanıt yazılmaz; çıkış 128+sinyal (test). Güç kesintisinde geçici
  klasör (`nakgo-offline-*`, `nakgo-pgc-*`) diskte kalabilir: imza makinesi her açılışta bunları siler (tam disk şifreli).
  Çevrim içi makinede de aynısı geçerlidir: `run`'ın şifresiz çalışma klasörü (`nakgo-backup-*`, Production verisi)
  çökme ya da SIGKILL'de kalabilir; makine tam disk şifreli olmalı ve her çalıştırmadan önce/sonra bu klasörler silinir.
  Temizlik başarısızsa sonuç `cleanup_failed: true` taşır ve kalan klasör elle silinir.
- **Prova (migration-rehearsal) yedekteki SQL'i çalıştırır.** `A.dump` geri yüklenirken ve `X.pre.sql` (katı biçim
  denetiminden sonra) çalışırken paket içeriği geri yükleyen rolün yetkisiyle işler. Prova yalnız atılabilir, ağsız bir
  hedefte ve süper kullanıcı olmayan bir rolle yapılmalıdır.

- **Araç paketi kendini doğrular.** Özeti alan kod da araç paketinin parçasıdır; güven kökü, imza makinesindeki repo
  kopyasının `anchor.repo_commit` olmasıdır. Kod bunu git ile karşılaştırmaz: offline-sign kayıttaki `repo_commit`'i
  ekrana yazar, operatör kâğıttaki tören kaydıyla karşılaştırır. Sistem kütüphaneleri (libc, OpenSSL, ICU) özete
  girmez; `NODE_OPTIONS`, `LD_PRELOAD`, `PG*` gibi ortam değişkenleri alt süreçlere geçer. İmza makinesinde temiz bir
  oturumda, bu değişkenler boşken çalıştırılır (`env -i` ile yalnız `PATH`, `HOME`, `NODE_PATH`, `NAKGO_PG_RUN_AS`).
- **Yarım kalan atomik yazım.** Süreç `link()` ile geçici dosyanın silinmesi arasında ölürse hedef dosyanın iki bağı olur
  ve güvenli okuma onu `EHARDLINK` ile reddeder (yanlış kabul yok). Kurtarma: aynı klasördeki `.nakgo-tmp-*` ikizi
  incelenip silinir, sonra işlem tekrarlanır.
- **`approval_ref`** imzalı kayda girer; yalnız onay kimliği (ör. `ONAY-2026-11-23-1`) yazılır, ad, e-posta ya da
  bağlantı yazılmaz (biçim harf, rakam, `._:/-` ve boşluğa izin verir; içerik insan denetimindedir).

## DURDURMA

- Herhangi bir red kodu: neden incelenmeden tekrar denenmez. `toolset_mismatch`/`anchor_*`: makine ya da çapa
  güvenilmez sayılır; yeni tören gerekebilir.
- `finalize` `conflict`: hedefte farklı manifest ya da kayıt var; üzerine yazılmaz, incelenir.
- `restore_*`, `migration_history`, `reference_*`: yedek kullanılmaz; yeni `run` gerekir.

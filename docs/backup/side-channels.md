# Yedek rolünün yan yolları ve Supabase sistem şemalarındaki SECURITY DEFINER fonksiyonları (B7-A5)

Kapsam: yedek rolü (`nakgo_backup`) okuma dışında bir şey yapabiliyor mu? Ya da kapsamı dışındaki veriye bir fonksiyon
üzerinden ulaşabiliyor mu? Bu belge yalnız repo içi incelemeye ve yerel PostgreSQL 16/17 denemelerine dayanır. Supabase'teki
gerçek durum B7-B'de (V6, V7) doğrulanır: [b7b-acceptance.md](b7b-acceptance.md).

## 1. Rolün sahip olmadığı yetkiler (kapalı)

| Yol | Neden kapalı | Denetim |
|---|---|---|
| Tablo/dizi yazma | Yalnız SELECT verilir | A1 `table_write`, `sequence_write` (muaf tutulamaz) |
| Şema/veritabanında CREATE | Verilmez | A1 `schema_create`, `database_create` |
| Rol üyeliği (`pg_read_all_data`, `pg_write_all_data`, API rolleri) | Verilmez | A1 `membership` (dolaylı dahil) |
| Auth/Storage/Vault tablolarını doğrudan okuma | Şemalarda USAGE yok; `postgres` tablo yetkisini zaten devredemez | A1 `read_outside_scope`, `verifyRole` olumsuz denetimi; test 42501'i gösterir |
| Ağ: `net.http_*` (pg_net), `http*`, `dblink*` | `net` şemasında USAGE yalnız belirli rollere verilir, PUBLIC'e değil (supabase/postgres f0ae55d, `migrations/db/migrations/20261016000001_search_path_for_supa_functions.sql` satır 104 ve 119–123) | A1 `network_function` (muaf tutulamaz): rol çağırabiliyorsa yedek durur |
| Replikasyon yuvası oluşturma (`pg_create_logical_replication_slot`) | PUBLIC'e açık ama REPLICATION özniteliği ister; rolde yok | Yerelde denendi: "permission denied to use replication slots" |
| Sunucu dosyası (`lo_import`/`lo_export` sunucu tarafı, `COPY … PROGRAM`) | Süper kullanıcı ya da `pg_read_server_files`/`pg_execute_server_program` ister | Üyelik denetimi |
| Başka oturumu sonlandırma (`pg_terminate_backend`) | Hedef rolün üyeliğini ya da `pg_signal_backend` ister | Üyelik denetimi |

## 2. Kapatılamayan PUBLIC yollar (kabul edilmiş kalan risk)

Bu fonksiyonların sahibi önyükleme süper kullanıcısıdır. `REVOKE … FROM PUBLIC` yalnız süper kullanıcıyla yapılabilir;
Supabase'te `postgres` süper kullanıcı değildir. Yalnız bir rolden geri almak mümkün değildir (PUBLIC herkesi kapsar).
**Bu yüzden bunlar için güvenlik garantisi verilemez.** A1 bunları `accepted_residual` bilgisi olarak raporlar.

| Yol | Ne yapabilir | Yerel deneme (PG16, PG17) | Önlem |
|---|---|---|---|
| `lo_create`, `lo_creat`, `lo_from_bytea`, `lowrite`, `lo_put` | Rolün sahibi olduğu büyük nesne oluşturur; veritabanında kalıcı yer tüketir | Yazılabilir işlemde başarılı; `default_transaction_read_only` açıkken "cannot execute lo_create() in a read-only transaction" | (1) Rol varsayılanı salt okunur işlem. (2) A2 koruması: `pg_largeobject_metadata` boş değilse yedek DURUR ve izleme uyarısı üretir; tek kalıcı iz böylece görünür. (3) Bağlantı sınırı 2, `statement_timeout` 15 dk. |
| `pg_logical_emit_message` | WAL'a mesaj yazar (tabloya değil); mantıksal kod çözme kullanan bir tüketici mesajları isterse görür | Salt okunur işlemde **de** başarılı | Kalıcı tablo verisi değiştirmez. Supabase Realtime'ın mesajları işleyip işlemediği V7'de denetlenir. |
| TEMP (geçici tablo) | Oturum ömrünce geçici tablo; disk kullanımı | Salt okunur işlemde engellenir | Oturum bitince silinir; `search_path` kuralı (`pg_temp` en sonda) A1'de. |
| Oturum düzeyi danışma kilitleri (`pg_advisory_lock`) | Uygulamanın kullandığı anahtarları (ör. `7291`: yönetici hesap işlemleri; `hashtextextended(<kullanıcı>, 7290)`) tutarak ilgili RPC'leri **bekletebilir** (erişilebilirlik) | — | Veri değiştirmez. Oturum kilidi işlem dışı boşta oturumda da kalır; `idle_in_transaction_session_timeout` bunu kesmez. Önlem yalnız parolanın korunması ve şüphede `pg_terminate_backend` (postgres) ile oturumu kapatmak. |
| `pg_notify`, `set_config` | Oturum içi; uygulama `LISTEN` kullanmıyor (migration'larda yok) | — | Bağlantı sınırı, zaman aşımları. |

**Neden bu kabul edilebilir:** Bu yolların hiçbiri kullanıcı verisini değiştirmez ya da veritabanı dışına veri taşımaz.
Kötüye kullanım için yedek rolünün parolası gerekir; parola yalnız GitHub ortam gizlisindedir. En kötü durum disk/WAL
tüketimidir. Bu bir **kabul kararıdır** ve proje sahibinin onayını ister (B7-B kararı K-3).

**Garanti verilemeyen nokta:** `default_transaction_read_only` bir güvenlik sınırı değildir. Parolayı ele geçiren biri
`set default_transaction_read_only = off` diyerek `lo_create`'i çalıştırabilir. Bu ancak A2 korumasıyla, bir sonraki
yedekte fark edilir; önlenemez.

## 3. Supabase sistem şemalarındaki PUBLIC SECURITY DEFINER fonksiyonları

Kaynak: `supabase/postgres` deposu, commit `f0ae55d` (Supabase'in PostgreSQL imajı). Supabase'in kendi testi
`nix/tests/sql/security.sql`, `supabase_admin`'in sahibi olduğu SECURITY DEFINER fonksiyonlarını listeler
(`nix/tests/expected/security.out`, 20 satır, bütün uzantıların kurulu olduğu test ortamında).

| Şema | Fonksiyonlar | Yedek rolünün şemada USAGE'ı | Sonuç |
|---|---|---|---|
| `graphql` | `get_schema_version`, `increment_schema_version` | Yok | Çağrılamaz |
| `pgbouncer` | `get_auth` (PUBLIC'ten geri alınmış) | Yok | Çağrılamaz |
| `pgsodium` | anahtar ve maske fonksiyonları | Yok | Çağrılamaz |
| `vault` | `create_secret`, `update_secret` | Yok (USAGE yalnız `postgres`, `service_role`: `migrations/db/migrations/20221207154255_create_pgsodium_and_vault.sql` 13–16) | Çağrılamaz |
| `repack` | `repack_trigger` | Yok | Tetikleyici; çağrılamaz |
| `public` | `dblink_connect_u`, `pgaudit_*`, `st_estimatedextent` | **Var** (`public` tam şema) | Yalnız ilgili uzantı `public` şemasına kurulursa bulunur. Kurulursa A1: `dblink*` → `network_function` (muaf tutulamaz); diğerleri izin listesi dışı → yedek durur (K6 ile muaf tutulabilir) |
| `auth`, `storage` | Supabase sürümüne göre değişir | Yok (USAGE yalnız anon/authenticated/service_role/postgres: `migrations/db/init-scripts/00000000000001-auth-schema.sql` 109, `…00000000000002-storage-schema.sql` 12) | Çağrılamaz |
| `extensions` | olay tetikleyicisi fonksiyonları (`grant_pg_net_access` vb.) | Yok | Olay tetikleyicisi; A1 kapsamı dışı ve çağrılamaz |

**Sonuç:** Dar rolün USAGE'ı yalnız `public` ve `private`'tadır. Supabase sistem şemalarındaki SECURITY DEFINER
fonksiyonları bu rolle çağrılamaz. Tek açık kapı `public` şemasına kurulan bir uzantıdır; A1 bunu yakalar ve yedeği
durdurur. Migration değişmezi (`--invariants`) ayrıca `public`/`private`'ta PUBLIC'e açık SECURITY DEFINER olmadığını
denetler.

**Garanti verilemeyen noktalar:**
- Gerçek projedeki uzantı ve şema listesi bu depodan bilinemez (V6).
- PUBLIC'e USAGE verilmiş bir Supabase şeması varsa, oradaki PUBLIC SECURITY DEFINER fonksiyonlar çağrılabilir. A1 bunları
  bulur ve inceleme olmadan yedeği durdurur; ama içeriklerini önceden inceleyemeyiz (V6).
- C dilindeki fonksiyonların gövdesi incelenemez; izin listesine giremezler.

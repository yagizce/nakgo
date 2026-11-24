# Runbook: bekleyen migration'ların geri yüklenmiş kopyada provası

> Yalnız yerel, geçici PostgreSQL'de. Gerçek yedekle yapılan prova kişisel veri içerir: çevrim dışı, şifreli diskli
> makinede ve sahibin onayıyla. Production'a migration uygulamak bu provanın sonucuna bakılarak verilen **ayrı** bir
> karardır.

Araç: `tools/backup/migration-rehearsal.cjs` (restore-verify kancası). Test: `tests/backup/b8-bootstrap.test.cjs`.

## Ne yapar

1. Paketi boş, geçici bir veritabanına geri yükler ve bütün S1 denetimlerini çalıştırır ([../core.md](../core.md)).
2. Yedekteki migration geçmişinden (`meta/supabase_migrations.schema_migrations.jsonl`) bekleyenleri hesaplar: geçmişte
   repoda olmayan sürüm ya da en son uygulanandan eski, uygulanmamış bir migration (boşluk) varsa **durur**.
3. Supabase'in hedefte kuracağı ama yedekte olmayan tabloların yapısını (`X.pre.sql`, veri yok; yalnız katı biçim
   denetiminden sonra: `create sequence if not exists` ve sade `create table`) ve bizim o tablolardaki tetikleyicilerimizi
   (ör. `auth.sessions → nakgo_access_log`) kurar. Tetikleyiciler **yedekteki tanımdan değil**, referans derlemesinden
   (`--pg-install`: uygulanmış migration'ların ağsız kümedeki gerçek sonucu) gelir; yedekteki liste bununla birebir aynı
   olmalı, değilse prova durur.
4. Bekleyenleri **dosya sırasıyla**, her biri kendi işleminde uygular. Oturumda `lock_timeout=5s`,
   `statement_timeout=60s` (Production'da kullanılacak değerler). Her migration için süre ve işlem sonuna kadar tutulan
   ilişki kilitlerinin tam envanteri kaydedilir; önceden var olan tablolardaki güçlü kilitler (ACCESS EXCLUSIVE, EXCLUSIVE,
   SHARE ROW EXCLUSIVE, SHARE) ayrıca listelenir. Migration dosyaları değişmez; yalnız en dıştaki `commit;` kilitleri
   okumak için araç tarafından verilir. Hata olursa işlem geri alınır ve prova durur.
5. Sonra: şema özeti `supabase/schema/snapshot.txt` ile **0 fark**, API sözleşmesi v0+v1, depodaki SQL fixture'ları
   (her biri geri alınır; satır sayıları değişmemeli).

## Komut

```sh
export NAKGO_PG_HOST=localhost NAKGO_PG_PORT=<yerel port> NAKGO_PG_BIN=<PostgreSQL 17 bin>
export NODE_PATH="$PWD/ops/backup/ci/node_modules"   # node-pg 8.23.1: npm ci --prefix ops/backup/ci --ignore-scripts
node tools/backup/migration-rehearsal.cjs --bundle <çözülmüş paket> --report <yeni dosya> --pg-install <PostgreSQL 17 sunucu kurulumu>
```

Rapor: kontrol sonuçları, notlar, her migration için süre/kilit, şema farkı, sözleşme hataları, fixture sonuçları.
Gizli değer içermez ama tablo adları ve sayılar içerir; çevrim dışı makinede kalır.

## Fixture'lar ve gerçek veri

Provanın geçmesi için depodaki fixture'ların **hepsi** geçmelidir; araçta gevşetme seçeneği yoktur. Fixture'lar boş
test veritabanı için yazılmıştır ve gerçek veride bulunabilecek bazı durumları "olmamalı" diye denetler. Gerçek yedekte
bunlardan biri başarısız olursa prova **başarısızdır** ve durulur; insan, başarısızlığın aşağıdaki varsayımlardan mı yoksa
gerçek bir sorundan mı geldiğini inceler (fixture'lar korumalı testtir, değiştirilmez):

| Fixture | Varsayım | Gerçek veride ne zaman başarısız olur |
|---|---|---|
| `api-contract.sql` | Ana yönetici (`owner`) yok; fixture kendisi ekler | Production'da ana yönetici varsa (`admin_members_one_owner`) |
| `suspended-owner-flag.sql` | Fixture'ın askıya aldığı hesap dışında askıda sahip yok | Askıda başka hesap varsa (`FAIL other owners flagged`) |

Testler (`b8-bootstrap.test.cjs`) iki veri kümesiyle sınar ve ikisinde de bütün fixture'ların geçmesini şart koşar:
Production'a sadık veri (askıda 0, saklama 0) ve zengin veri (askıda bir hesap, saklamada bir ilan). Zengin veride
veri dönüşümleri (askı işareti, saklama, gece temizliği) fixture'lardan önce denetlenir; ardından askı panel yoluyla
kaldırılır (kaldırınca işaretin indiği de denetlenir).

## Geçme ölçütleri

- Bütün bekleyen migration'lar hatasız ve sırayla uygulandı; hiçbiri `lock_timeout`/`statement_timeout`'a takılmadı.
- Şema özeti 0 fark; sözleşme 0 hata.
- Fixture'lar yukarıdaki kurala göre temiz.
- Veri dönüşümleri gerçek veride doğru (testte: askıdaki sahibin ilanları `owner_suspended`, saklama işareti korunur,
  saklamadaki ilan silinemez, gece temizliği saklamadaki ilanı silmez).
- Güçlü kilit listesi incelendi: ACCESS EXCLUSIVE alan migration'lar (yerel provada `public.listings` için
  `20261118080000_b3c2_listing_revision.sql` ve `20261119050000_suspended_owner_flag.sql`, `private.admin_members` için
  `20261117000000_legal_archive.sql`) trafiğin en düşük olduğu saatte ve `lock_timeout` ile uygulanır.

## Sınırlar

- Yerel PostgreSQL'de `pg_cron` yok: migration'ların `cron.schedule` blokları atlanır (kendi koşullarıyla). Zamanlanmış
  işlerin kurulması hedefte (Supabase) doğrulanır.
- Süreler yerel donanımda ve küçük veriyle ölçülür; Production'daki süre bekleyen kilitlere de bağlıdır. Ölçü,
  `lock_timeout` aşılırsa migration'ın beklemek yerine başarısız olacağıdır.

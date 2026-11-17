# Yedek rolü yetki denetimi (B7-A1)

Araç: `tools/backup/privilege-audit.cjs`. Yalnız katalog okur, hiçbir şey yazmaz. Her yedek çalışmasından önce yedek rolüyle çalışır (A4) ve CI'da migration şemasına karşı çalışır (`npm run test:backup`).

## Ne denetlenir

| Alan | Beklenen | Sapma sınıfı |
|---|---|---|
| Rol özellikleri | LOGIN, BYPASSRLS, süper kullanıcı değil, CREATEROLE/CREATEDB/REPLICATION yok, bağlantı sınırı 1–2 | Muaf tutulamaz |
| Rol üyelikleri (dolaylı dahil) | Hiç | Muaf tutulamaz |
| Veritabanında CREATE | Yok | Muaf tutulamaz |
| Şemada CREATE | Hiçbir şemada | Muaf tutulamaz |
| Tablo/kolon yetkileri | Yalnız SELECT | INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER muaf tutulamaz |
| Dizi yetkileri | Yalnız SELECT | USAGE/UPDATE muaf tutulamaz |
| Çağrılabilir SECURITY DEFINER | İzin listesinde ve parmak izi aynı | Muaf tutulabilir (K6), varsayılan olarak döküm başlamaz |

"Çağrılabilir": rolün şemada USAGE ve fonksiyonda EXECUTE yetkisi var (PUBLIC, doğrudan ya da üyelik yoluyla), fonksiyon tetikleyici değil. Rolün USAGE yetkisi olan bütün şemalar taranır (public, private, auth, storage ve PUBLIC'e açık diğerleri).

## Fonksiyon parmak izi

Her çağrılabilir SECURITY DEFINER fonksiyon için:
- kimlik ve imza, dönüş tipi, dil, tür;
- gövde hash'i (yorum ve boşluklar ayıklanmış);
- sahip ve sahibin süper kullanıcı/BYPASSRLS durumu;
- ham EXECUTE ACL ve yetkinin yolu (PUBLIC / doğrudan / üyelik);
- şema USAGE;
- tüm fonksiyon ayarları, `search_path` kuralının sonucu;
- oynaklık, LEAKPROOF, paralellik;
- risk işaretleri: dinamik SQL, ağ (`net.*`, http), dblink, `pg_notify`, güvenlikle ilgili ayar değişikliği, danışma kilidi, `pg_sleep`, COPY, büyük nesne, veri yazma, DDL;
- gövdede şema-nitelikli olarak geçen tabloların sahibi, ACL'si, RLS ve zorunlu RLS durumu, politikalarının hash'i;
- çağırdığı fonksiyonların parmak izleri (en fazla 3 seviye, aşılırsa işaretlenir).

Bunlardan biri değişirse, gövde aynı kalsa bile parmak izi değişir. Testler gövde, bağımlı tablo ACL'si, RLS, politika, sahip, EXECUTE yolu ve ayar değişikliklerinin her birinin fark ürettiğini doğrular.

## `search_path` kuralı

PostgreSQL, geçici şema (`pg_temp`) `search_path` içinde açıkça yazılmadığında onu tablo ve tip adlarında **ilk sırada** arar (fonksiyon ve operatör adlarında hiç aramaz). Yedek rolü veritabanında TEMP yetkisini PUBLIC üzerinden alır ve bu yetki yalnız bir rol için geri alınamaz. Bu yüzden `search_path=''` tek başına koruma sağlamaz.

İzin listesine alınabilmek için: `search_path` sabit ve `pg_temp` açıkça en sonda; ya da kayıtta, gövdenin şema belirtilmemiş hiçbir tablo ve tip adı kullanmadığını açıklayan `search_path_exception` gerekçesi.

Doğrulanmamış (V): geçici şemada oluşturulan bir tipin yerleşik bir tip adını gerçekten gölgeleyip gölgeleyemeyeceği. Kural bu yüzden en kötü durumu varsayar.

## İzin listesi

`ops/backup/definer-allowlist.json`. Kayıt alanları: `id`, `fingerprint_sha256`, `reviewed_by`, `reviewed_at`, `reason`, `data_scope` (döndürdüğü veri), gerekirse `search_path_exception` ve `risk_exception`. Araç hiçbir zaman kendiliğinden kayıt eklemez. Kayıt yalnız incelemeli bir PR ile eklenir. C/internal gövdeli ve çağrı grafiği derinlik sınırını aşan fonksiyonlar listeye alınamaz.

Bilinen sınır: PL/pgSQL ve metin gövdeli SQL fonksiyonlarının bağımlılıklarını PostgreSQL izlemez. Tablolar gövdedeki şema-nitelikli adlardan statik olarak çıkarılır. Şemasız adlar ve dinamik SQL bu yolla bulunamaz. Bu yüzden dinamik SQL içeren fonksiyonlar gerekçesiz listeye giremez.

## Değişmezler (`--invariants`)

Migration'lardan kurulan şemada:
1. `public` ve `private`'ta PUBLIC'e açık, tetikleyici olmayan SECURITY DEFINER fonksiyon yok.
2. `service_role`'e verilen açık yetkiler `supabase/contract/service-role.json` ile birebir aynı (bugün yalnız Storage temizleme kuyruğu için iki EXECUTE).

## K6 muafiyeti (`tools/backup/waiver.cjs`)

- **Varsayılan kapalı.** Yalnız `enabled=true` ve belge ile çalışma ortamı aynıysa değerlendirilir; production iş akışı kapalı çalışır.
- Proje sahibinin çevrim dışı K2 anahtarıyla imzaladığı belge; alan adı `nakgo-backup-waiver/v1`.
- Belge, o anki farkın hash'ine ve kapsadığı fonksiyonların tam listesine bağlıdır; en fazla 48 saat geçerlidir; rastgele `waiver_id` ve `event_id` taşır.
- Muaf tutulamayan bir bulgu varken hiçbir belge geçmez.
- Tek kullanımlılık ve "aynı fark için en fazla 7 gün" kuralı imzalı kontrol noktası zincirinde sağlanır (A3).
- K6 elle döküm ya da `postgres` ile kontrol atlama yolu değildir. TLS, alıcı anahtarı, imza/zincir ve geri yükleme testi hataları muafiyete hiç bakmaz.

## Yedek rolü betiği

`ops/backup/backup-role.sql`, `tools/backup/backup-role.cjs` tarafından `ops/backup/scope.json`'dan üretilir; test, dosyanın üreticiyle birebir aynı olduğunu doğrular. Testler betiği yerel veritabanında uygular ve rolün beklenen profilde olduğunu, `auth.sessions` ve `auth.refresh_tokens`'ı okuyamadığını doğrular. Production'da uygulanması B7-D'de, ayrı onayla yapılır.

`default_transaction_read_only=on` bir güvenlik sınırı değildir; oturum onu kapatabilir. Sınırlar yukarıdaki yetki kontrolleridir.

## Test edilemeyenler

- PGlite: veritabanı düzeyinde CREATE testi atlanır. Geri alınmış bir işlemden sonra `pg_database` güncellemesi PGlite'ta hata veriyor; test PG16 ve PG17'de çalışır.
- Supabase'in kendi `auth` ve `storage` fonksiyonları yerelde yok. Gerçek kapsam B7-B'deki T2 geçidinde denetlenir.

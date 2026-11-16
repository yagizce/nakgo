# Yedekleme tasarımı (B7): çevrim dışı anahtar ve otomatik geri yükleme testi

Durum: tasarım. B7 ayrıca onaylanmadan hiçbir kova, gizli anahtar veya iş akışı oluşturulmaz.

Kararlar (kullanıcı, 16.11.2026):

- Günlük şifreli yedek Cloudflare R2'ye gider.
- Saklama süresi 14 gün.
- 24 saatlik veri kaybı (RPO) kabul edildi.
- Geri yükleme yalnız yalıtılmış ortamda sınanır.
- Production'a otomatik geri yükleme yapılmaz.

## 1. Şifreleme anahtarı neden ve nasıl çevrim dışı

Açık anahtarlı şifreleme kullanılır (`age`, X25519). Şifrelemek için yalnız açık anahtar gerekir. Çözmek için gizli anahtar gerekir.

- **Gizli anahtar** internete bağlı hiçbir yerde durmaz: GitHub, Cloudflare, Supabase, Vercel ve geliştirici dizüstünün dosya sistemi dahil. Böylece CI, R2 ya da bir hesap ele geçirilse bile yedekler okunamaz.
- **Anahtar üretimi:** Proje sahibi gizli anahtarı ağ bağlantısı kapalı bir makinede üretir (`age-keygen`).
- **Saklama:** Gizli anahtar iki ayrı fiziksel yerde tutulur:
  - kâğıda basılı kopya;
  - parola korumalı bir USB bellek.
- **Repo'daki kayıt:** Repo'ya yalnız açık anahtar ve parmak izi girer (`ops/backup/recipient.txt`).
- **Yedek iş akışının kontrolü:** İş akışı şifrelemeden önce açık anahtarın parmak izini repo'daki değerle karşılaştırır. Eşleşmezse durur. Böylece biri gizli anahtarı kendisinde olan başka bir alıcıyı sessizce koyamaz.
- **Anahtar kaybına karşı:** İsteğe bağlı ikinci bir çevrim dışı alıcı eklenebilir (`age` birden fazla alıcıya şifreler). Örneğin ikinci bir yetkilinin anahtarı. Bu ikinci anahtar da internete bağlı bir yerde durmaz.
- **Rotasyon:**
  - Yılda bir ya da şüphe hâlinde yeni anahtar çifti üretilir.
  - Eski gizli anahtar, onunla şifrelenmiş son yedeğin saklama süresi (14 gün) dolana kadar çevrim dışı tutulur, sonra imha edilir.
  - Rotasyon tarihi ve parmak izleri `ops/backup/recipient.txt` geçmişinde görünür.
- **R2 erişim belirteci:**
  - Yalnız yedek kovasına ve yalnız nesne yazma/okuma yetkisiyle kısıtlanır; hesap genelinde yetkisi olmaz.
  - Silme işini R2 yaşam döngüsü kuralı (14 gün) yapar, iş akışı yapmaz.
  - Mümkünse kovaya nesne kilidi (bucket lock, 14 gün) konur. Böylece ele geçirilmiş bir belirteç eski yedekleri silemez.

## 2. Otomatik geri yükleme testi gizli anahtara dokunmadan nasıl yapılır

Gizli anahtar çevrim dışı olduğu için otomatik iş şifreli dosyayı çözemez. Bunu bilinçli kabul ediyoruz. Kontrol iki parçaya bölünür:

### a) Her gün, otomatik: yedeğin geri yüklenebilirliği

Aynı GitHub Actions işinde, şifrelemeden önce:

1. `pg_dump` ile döküm alınır (`public`, `private`, `auth`, `storage` şemaları). Aynı anda kaynakta tablo başına satır sayısı ve şema parmak izi (`schema-check --fingerprint-sql`) okunur.
2. Döküm, işin kendi içindeki geçici PostgreSQL 17 servis konteynerine geri yüklenir.
   - Bu konteyner dış ağa açık değildir; iş bitince yok olur.
   - Geri yükleme betiği yalnız yerel adreslere bağlanır (`db-lib.cjs` ile aynı koruma). Production'a veya DEV'e yönelemez.
3. Doğrulama yapılır:
   - tablo başına satır sayıları kaynakla aynı mı;
   - şema parmak izi `supabase/schema/snapshot.txt` + `known-drift.txt` ile aynı mı;
   - yasal arşiv hash zincirleri bozulmamış mı (`legal_chain_check`, #125 birleştikten sonra);
   - sözleşme testi (`api-contract.sql`) geri yüklenen veride geçiyor mu.
4. Yalnız doğrulama geçerse döküm açık anahtarla şifrelenir ve R2'ye yüklenir.
   - Şifreli dosyanın SHA-256 değeri bir manifestoya yazılır.
   - Yüklenen nesne geri indirilip hash karşılaştırılır (depolama bütünlüğü).
5. Şifresiz döküm hiçbir zaman runner dışına çıkmaz; iş sonunda silinir.
6. Herhangi bir adım başarısız olursa iş kırmızı biter ve bildirim gider. O günün yedeği "doğrulanmamış" sayılır.

### b) Ayda bir, elle: şifre çözme tatbikatı

Proje sahibi çevrim dışı makinede, kontrol listesiyle şunları yapar:

1. Son yedeği indirir.
2. Gizli anahtarla çözer.
3. Yerel bir PostgreSQL'e geri yükler.
4. (a)'daki doğrulama betiğini çalıştırır.
5. Sonucu (tarih, yedek adı, geçti/kaldı, süre) `ops/backup/drills.md` dosyasına işler.

Bu tatbikat gizli anahtarın gerçekten çalıştığını ve kaybolmadığını kanıtlar. Kaçırılan tatbikat bir sonraki aşama raporunda açık sorun olarak görünür.

### Neden "otomatik çözme" yok

Otomatik çözme, gizli anahtarın CI'da durmasını gerektirir. O zaman CI'ı ele geçiren herkes bütün yedekleri okuyabilir. Bu da çevrim dışı anahtar kararını boşa çıkarır.

Geri yüklenebilirliği her gün otomatik, anahtarın çalıştığını ise ayda bir elle kanıtlamak bu riski almadan iki şeyi de güvenceye alır.

## 3. Production'a geri yükleme

Otomatik değildir. Gerekirse:

1. Ayrı onayla yeni bir Supabase projesine veya yalıtılmış ortama geri yüklenir.
2. Doğrulanır.
3. Geçiş ayrı bir karar olarak yapılır.

En kötü durumda kaybolan veri, son doğrulanmış yedekten sonraki en fazla ~24 saattir. PITR'ye geçiş yolu denetim belgesinde ayrıca anlatılır.

## 4. B7 için gereken onaylar

1. R2 kovasının oluşturulması, yaşam döngüsü ve kilit kuralı.
2. GitHub secrets eklenmesi:
   - veritabanı bağlantısı (yalnız okuma yapan yedek rolü);
   - R2 belirteci.
3. Gizli anahtarın proje sahibi tarafından çevrim dışı üretilmesi. Bu işi Claude yapmaz ve görmez.
4. Yedek iş akışının main'e birleşmesi.

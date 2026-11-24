# Runbook: geri yükleme ve felaket kurtarma (S1, S2a, S2b)

> Production'a otomatik geri yükleme **yoktur**. Her adım ayrı onaydır. Gizli anahtar yalnız çevrim dışı makinede açılır.

## Düzeyler

| Düzey | Ne kanıtlar | Nerede | Ne zaman |
|---|---|---|---|
| S1 | Dökümün düz PostgreSQL'e geri yüklenebildiği; sayımlar, FK'ler, parmak izi, sözleşme, yasal kanıt | Her çalışmada, iş akışının geçici PG17 servisinde (otomatik) | Her yedek |
| S2a | Yöntemin Supabase'e taşınabildiği (rol, Auth, Storage meta verisi) | İki **geçici** Supabase projesi arasında, sahte veriyle | B7-B'de bir kez, sonra yılda bir |
| S2b | Gerçek verinin gerçekten geri geldiği; Auth kurtarması ancak burada "başarılı" sayılır | Yalıtılmış geçici Supabase projesi, gerçek yedek | Ayda bir (`drills.md`) ve felakette |

## S2b / felaket adımları

1. **Karar ve onay.** Olayı yazılı kaydet (tarih, neden, kim onayladı). Production'a dokunma.
2. **Yedeği seç.** İmzalı manifesti `verified=true` olan en yeni yedek. Manifest imzası ve şifreli dosyanın SHA-256'sı
   doğrulanır; kontrol noktası zincirinde açık `integrity` olayı varsa önce o incelenir. Araç:
   `node tools/backup/dr-fetch.cjs --out DOSYA --latest` (ya da `--manifest manifests/....json`). Bu denetimleri yapar,
   şifreli dosyayı 0600 olarak kaydeder, şifre çözmez; daha yeni bir manifestte bütünlük sorunu görürse durur.
   **Elle alınmış yedek** (bootstrap, K6b): yalnız `--manifest manual/manifests/....json` ile; `--latest` ve K1 yolu
   onu seçmez. Doğrulama K9 zinciridir: manifest ve kayıt imzaları `trusted_k9`'la (ayrı amaç etiketleri), kayıttaki çapa
   `trusted_anchors`'ta, kayıt **zorunlu**, manifest hash'i, alıcı hash'i ve paketin SHA-256/boyutu. Bekleyen istek
   dosyası varsa ona bağ da denetlenir; `--require-request` verilirse istek yoksa durur. Bilinen sınır: kayıttaki alıcı
   hash'i bugünkü `config.json → recipients_sha256` ile aynı olmalı; A/B rotasyonundan önceki elle yedekler için eski
   değer geçici bir yapılandırma kopyasıyla (PR'lı) verilir.
3. **Çevrim dışı çöz.** A (ya da B) gizli anahtarıyla, ağsız makinede. Şifresiz dosya yalnız o makinede ve şifreli diskte.
4. **Yalıtılmış hedef.** Yeni, geçici bir Supabase projesi (ayrı onay). Bağlantı yalnız `sslmode=verify-full`.
5. **Sıra.** Yeni Supabase projesinde Auth/Storage şemasını Supabase kurar; `bootstrap.sql`, `B.pre.sql` ve
   `B.post.sql` yalnız düz PostgreSQL doğrulaması içindir, Supabase'e UYGULANMAZ. Sıra: `B/*.jsonl` verisi (Auth sürümü
   yedektekiyle aynı olmalı; değilse DUR) → A (`public`, `private`) → izinli tetikleyiciler. Tek kullanımlık belirteçler
   yedekte yoktur; herkes yeniden giriş yapar. Ayrıntı: `docs/backup/core.md`. Yükleme yöntemi S2a'da kanıtlanır.
6. **Doğrula.** S1 denetimlerinin hepsi + giriş denemesi (test hesabı), Storage nesne listesi, yasal kayıt sayıları ve
   `legal_chain_check`.
6a. **Yönetim verisi ve dış tetikleyiciler.** `node tools/backup/restore-meta.cjs --bundle <paket> --sql <yeni dosya> --pg-install <PostgreSQL 17 sunucu kurulumu>`:
   migration geçmişinin (R1–R3) ve zamanlanmış işlerin tutarlılığını yazar (tutarsızsa çıkış kodu 1: DUR) ve kurtarma
   SQL'ini üretir: `supabase_migrations.schema_migrations` sürümleri, `cron.schedule` çağrıları (hedef canlıya alınmayacaksa
   işler pasif bırakılır) ve Supabase'in kurduğu tablolardaki NakGo tetikleyicileri (ör. `auth.sessions → nakgo_access_log`).
   Beklenen işler ve tetikleyiciler **yedekten değil**, uygulanmış migration'ların ağsız atılabilir kümedeki gerçek
   sonucundan (`reference-build.cjs`) gelir; yedekteki tanım yalnız karşılaştırılır, çalıştırılmaz. `--pg-install` yoksa
   dış tetikleyici içeren pakette SQL üretilmez.
   SQL incelenir, hedef projede **elle** çalıştırılır; tek işlemdir ve pg_cron yoksa hiçbir şey yazmaz, ikinci kez
   çalıştırmak aynı sonucu verir (yerelde pg_cron API taklidiyle sınandı; gerçek pg_cron: real-infra-gaps G20).
   pg_cron'un dışarıya iş yapan işleri hedef Production değilse kapalı tutulur.
6b. **Bekleyen migration'lar.** Yedek repodan gerideyse (ilk yedekte böyledir) önce yerel provası yapılır
   ([migration-rehearsal.md](migration-rehearsal.md)); hedefe uygulanması ayrı karardır. API sözleşmesi geride kalan
   kopyada değil, migration'lardan sonra denetlenir.
7. **Geçiş** ayrı bir karardır (DNS, uygulama ayarları): bu runbook'un dışında.

## DURDURMA koşulları (biri bile varsa dur, insan incelemesi)

- Manifest imzası, şifreli dosya hash'i ya da alıcı listesi hash'i uyuşmuyor.
- Kontrol noktası zinciri doğrulanmıyor ya da dış çapa farklı hash gösteriyor.
- Geri yükleme sırasında herhangi bir hata, eksik tablo, eksik rol ya da FK yetimi.
- Sayım ya da parmak izi farkı (dışlanan tablolar hariç).
- Auth şema sürümü hedef projeyle uyumsuz.
- Bilinen kayıp kapsamı (MFA kurtarma kodları, Auth denetim günlüğü, oturumlar) kabul edilmeden ilerleme.
- Hedef proje production ya da DEV projesiyse.
- `restore-meta.cjs` migration geçmişinde repoda olmayan sürüm ya da boşluk, ya da repoyla tutarsız zamanlanmış iş
  bildiriyor (insan incelemesi).

## Supabase planı

Production Free planda (22.11.2026): Supabase'in kendi günlük yedeği, PITR ve "yeni projeye geri yükleme" yok. Kurtarma
yalnız bu runbook'taki yedekle mümkündür. Ücretli planda platform yedeği ek bir katmandır; bu yedeğin yerini tutmaz
(Storage dosyalarını o da almaz).

## Bilinen kayıplar
Oturumlar ve yenileme belirteçleri (kullanıcılar yeniden giriş yapar), MFA kurtarma kodları, Auth denetim günlüğü,
Storage nesnelerinin **içeriği** (yalnız meta veri yedeklenir; şu an Storage boş olmalı, değilse yedek durur).

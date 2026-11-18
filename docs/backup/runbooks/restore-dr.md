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
3. **Çevrim dışı çöz.** A (ya da B) gizli anahtarıyla, ağsız makinede. Şifresiz dosya yalnız o makinede ve şifreli diskte.
4. **Yalıtılmış hedef.** Yeni, geçici bir Supabase projesi (ayrı onay). Bağlantı yalnız `sslmode=verify-full`.
5. **Sıra.** Yeni Supabase projesinde Auth/Storage şemasını Supabase kurar; `bootstrap.sql`, `B.pre.sql` ve
   `B.post.sql` yalnız düz PostgreSQL doğrulaması içindir, Supabase'e UYGULANMAZ. Sıra: `B/*.jsonl` verisi (Auth sürümü
   yedektekiyle aynı olmalı; değilse DUR) → A (`public`, `private`) → izinli tetikleyiciler. Tek kullanımlık belirteçler
   yedekte yoktur; herkes yeniden giriş yapar. Ayrıntı: `docs/backup/core.md`. Yükleme yöntemi S2a'da kanıtlanır.
6. **Doğrula.** S1 denetimlerinin hepsi + giriş denemesi (test hesabı), Storage nesne listesi, yasal kayıt sayıları ve
   `legal_chain_check`.
7. **Geçiş** ayrı bir karardır (DNS, uygulama ayarları): bu runbook'un dışında.

## DURDURMA koşulları (biri bile varsa dur, insan incelemesi)

- Manifest imzası, şifreli dosya hash'i ya da alıcı listesi hash'i uyuşmuyor.
- Kontrol noktası zinciri doğrulanmıyor ya da dış çapa farklı hash gösteriyor.
- Geri yükleme sırasında herhangi bir hata, eksik tablo, eksik rol ya da FK yetimi.
- Sayım ya da parmak izi farkı (dışlanan tablolar hariç).
- Auth şema sürümü hedef projeyle uyumsuz.
- Bilinen kayıp kapsamı (MFA kurtarma kodları, Auth denetim günlüğü, oturumlar) kabul edilmeden ilerleme.
- Hedef proje production ya da DEV projesiyse.

## Bilinen kayıplar
Oturumlar ve yenileme belirteçleri (kullanıcılar yeniden giriş yapar), MFA kurtarma kodları, Auth denetim günlüğü,
Storage nesnelerinin **içeriği** (yalnız meta veri yedeklenir; şu an Storage boş olmalı, değilse yedek durur).

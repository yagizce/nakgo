# Yedekleme tasarımı (B7)

Durum: B7-A kodu ve testleri tamam (PR #127–#130, birleştirilmedi). Hiçbir kova, gizli anahtar, ortam, Worker ya da
zamanlama oluşturulmadı. Gerçek altyapı adımları B7-B/C'de ve her biri ayrı onayla yapılır.

Bu belge önceki (16.11.2026) taslağın yerini alır. Değişen kararlar: günlük → 6 saatte bir; 14 gün → kural olarak 15 gün;
R2 yaşam döngüsüyle silme → uygulama kapısıyla silme (D1); yasal kayıtlar için tam liste kanıtı ve imzalı zincir.

## Kararlar

| Konu | Karar |
|---|---|
| Sıklık | 6 saatte bir `pg_dump`. RPO 24 saat bir **hedeftir**, garanti değil. Alarm: 13 saat uyarı, 19 saat kritik. |
| Depo | Ayrı R2 kovası (tercihen ayrı Cloudflare hesabı). Kilit: `db/` 14 gün, `audit/` 90 gün. |
| Silme | Yaşam döngüsüyle otomatik silme yok (D1). Kapı varsayılan kapalı; K3 kanıtı ve PR onayı olmadan açılmaz. |
| Şifreleme | `age`, iki çevrim dışı alıcı (A, B). Alıcı listesi hash'i repo'da sabit. |
| İmza | K1 (CI): manifest, kontrol noktası, silme kaydı. K2 (çevrim dışı sahip): serbest bırakma ve K6 muafiyeti. |
| Gizlilik | K7 (CI): kontrol noktası gövdelerinin şifrelenmesi. |
| Bağlantı | Yalnız `nakgo_backup` rolü (BYPASSRLS, üyelik yok, `public`/`private` SELECT, Auth/Storage yalnız sabitlenmiş dışa aktarma fonksiyonlarıyla); Supavisor oturum modu 5432; `sslmode=verify-full`. 6543 reddedilir. |
| Doğrulama | Her çalışmada S1 (düz PG17'ye geri yükleme ve denetim). S2a/S2b ayrı ve elle. |
| Production'a geri yükleme | Otomatik değil; yalıtılmış projeye, ayrı onayla. |
| K5 (şifreli e-posta eki) | Uygulanmadı; kapalı. Açılması ayrı tasarım ve onay ister. |
| K6 (muafiyet) | Production'da kodda kalıcı olarak kapalı; test ortamında da `config.json` varsayılanı kapalı. |
| Tek kullanımlılık (K2) | R2 koşullu yazma ve tutarlı okuma (V1, V2) kanıtlanana kadar iddia edilmez (`single_use_guaranteed=false`). |

## Bölümler

- A1 — yedek rolü ve yetki denetimi: [backup/privilege-audit.md](backup/privilege-audit.md)
- A2 — tutarlı anlık görüntü, S1, şifreleme, depo, manifest, silme kapısı: [backup/core.md](backup/core.md)
- A3 — yasal kayıt kanıtı, kontrol noktası zinciri, olaylar, K2/K6: [backup/legal-evidence.md](backup/legal-evidence.md)
- A4 — orkestratör (`tools/backup/run.cjs`), silme günlüğü (`tools/backup/deletion-journal.cjs`: önce imzalı niyet, sonra imzalı sonuç), iş akışı (`.github/workflows/backup.yml`, etkisiz), izleme Worker'ı
  (`ops/backup/monitor/`, dağıtılmadı), yapılandırma (`ops/backup/config.json`, bilinçli olarak eksik)

## Runbook'lar

- [Anahtar töreni](backup/runbooks/key-ceremony.md)
- [Geri yükleme ve felaket kurtarma (S1/S2a/S2b ve durdurma koşulları)](backup/runbooks/restore-dr.md)
- [Tatbikatlar](backup/runbooks/drills.md)
- [Alarmlar ve izleme](backup/runbooks/alarms.md)
- [Olay inceleme, K2 serbest bırakma, K6 muafiyeti](backup/runbooks/release-waiver.md)
- [K6b istisnai elle döküm](backup/runbooks/k6b-manual-dump.md)
- [Saklama ve yasal kayıtlar](backup/runbooks/retention-legal.md)

## Neden otomatik çözme yok
Otomatik çözme gizli anahtarın CI'da durmasını gerektirir; CI'ı ele geçiren herkes bütün yedekleri okuyabilir. Bunun
yerine her çalışmada şifrelemeden önce S1 ile geri yüklenebilirlik, ayda bir çevrim dışı tatbikatla anahtarın çalıştığı
kanıtlanır.

## B7-B'ye geçiş ENGELLERİ
1. **Yedek rolü (A1, B7-A5'te daraltıldı):** üyelik yok; Auth/Storage yalnız `private.nakgo_backup_*` dışa aktarma
   fonksiyonlarıyla (migration `20261118000000_backup_export.sql`). Oturum/yenileme belirteci tablolarına erişim yok.
   Gerçek projede V4–V8 doğrulanmadan B7-D'ye geçilmez: [backup/b7b-acceptance.md](backup/b7b-acceptance.md).
2. **Kabul edilmesi gereken kalan risk:** PUBLIC `pg_catalog` yan yolları (`lo_create`, `pg_logical_emit_message`, TEMP)
   süper kullanıcı olmadan kapatılamaz: [backup/side-channels.md](backup/side-channels.md). Sahibin açık kabulü gerekir.
3. **Storage dosyaları:** veritabanı yedeği yalnız meta veriyi alır. Dosya yedeği tasarımı:
   [backup/storage-files.md](backup/storage-files.md). Uygulanana kadar `storage.objects` dolu ise yedek durur.
4. R2 V1–V3: [backup/b7b-acceptance.md](backup/b7b-acceptance.md).

## #125 ve B1 API sözleşmesi
`supabase/contract/v0.json → migration_execute`: `nakgo_legal_page` ve `nakgo_legal_action` yalnız `authenticated`.
#125'in migration dosyası depoda yokken isteğe bağlıdır (veritabanında varsa imza ve roller birebir doğrulanır). Dosya
depoya girdiği anda zorunlu olur. #125'in migration'ı değişmedi. Birleştirme sırası: bu sözleşme değişikliği (#129)
#125'ten önce ya da onunla birlikte birleşmelidir; aksi hâlde #125 tek başına birleşirse `nakgo/altyapi`'de sözleşme
denetimi "sözleşme dışı çalıştırma yetkisi" verir.

## Gerçek altyapıda doğrulanması gerekenler (B7-B)
- V1: R2 koşullu PUT (`If-None-Match: *`) gerçekten 412 döndürüyor mu.
- V2: yazdıktan hemen sonra okuma ve listeleme tutarlı mı.
- V3: kova kilidi silmeyi ve üzerine yazmayı engelliyor mu.
- Supabase V4–V8: [backup/b7b-acceptance.md](backup/b7b-acceptance.md).
- S2a: iki geçici Supabase projesi arasında yöntem kanıtı.

## B7 için gereken onaylar
1. K3 test kovası ve V1–V3 kanıtı.
2. Anahtar töreni ve `config.json` PR'ı.
3. Production yedek kovası, kilit kuralları, belirteçler; çapa kovası.
4. GitHub `backup-production` ortamı ve gizlileri; yedek rolünün production'da oluşturulması.
5. İş akışının main'e alınması; zamanlamanın açılması.
6. İzleme Worker'ının dağıtımı.
7. Silmenin açılması (K3 kanıtı + K4 hukuk metni).

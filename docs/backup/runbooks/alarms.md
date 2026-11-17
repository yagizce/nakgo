# Runbook: alarmlar ve izleme Worker'ı

İzleme kodu: `ops/backup/monitor/` (dağıtılmadı). Saatte bir çalışır; yedek kovasını **yalnız okur**.

| Kod | Düzey | Anlamı | Yapılacak |
|---|---|---|---|
| `backup_age` | 13 saat uyarı, 19 saat kritik | Son doğrulanmış yedek eski | İş akışı geçmişine bak; başarısız aşamayı manifestte bul; yeniden çalıştır |
| `no_verified_backup` | kritik | Son iki günde doğrulanmış yedek yok | Aynı; nedeni giderilmeden silme zaten kapalı |
| `manifest_signature`, `checkpoint_signature` | kritik | İmza doğrulanmadı | Kovaya yetkisiz yazma şüphesi: iş akışını durdur, belirteçleri değiştir, `integrity` olayı gibi incele |
| `checkpoint_age`, `checkpoint_gap` | kritik | Zincir ilerlemiyor ya da kesintili | Son çalışmanın `legal` özeti; zincir doğrulanmıyorsa olay incelemesi |
| `event_open`, `event_escalated` | kritik | Açık olay (7 günü aşınca yükseltilir) | `release-waiver.md` |
| `legal_not_observed` | uyarı | Döküm alınamadığı için yasal durum gözlenemedi | Dökümün başarısız aşamasını gider |
| `workflow_failed`, `workflow_stuck`, `workflow_silent` | uyarı | İş akışı başarısız, takıldı ya da çalışmıyor | GitHub Actions kaydı |
| `deletion_lag` | uyarı | Silme açıkken en eski döküm 16 günü aştı | Silme kaydındaki engelleri oku (`audit/deletions/`) |
| `deletion_disabled`, `single_use_unverified` | bilgi | Beklenen durum (D1, K3 öncesi) | Haftalık özette görünür |
| `monitor_error` | kritik | İzleme veriyi okuyamadı | Kalp atışı gönderilmez; harici ölü adam anahtarı da alarm verir |

## Bildirim
- Uyarı ve kritik: her çalışmada `NOTIFY_WEBHOOK`'a. Haftalık özet pazartesi 09:00 (İstanbul).
- Kalp atışı (`HEARTBEAT_URL`): izleme başarıyla karar ürettiyse. Gelmezse harici servis alarm verir.
- WhatsApp kullanılmaz.

## Dağıtım (B7-B/C, ayrı onay)
1. Yedek kovasının bulunduğu ayrı Cloudflare hesabında, yalnız okuma bağlamasıyla.
2. `wrangler.example.toml` kopyalanır; gerçek kova adı ve değişkenler girilir. `GITHUB_TOKEN` yalnız `actions:read`.
3. Önce test kovasıyla bir hafta gözlem; sonra production kovası.

# Push bildirimi ve fotoğraf depolama — teknik tasarım ve bağımlılık raporu

**Durum:** yalnız tasarım. Canlı bağlantı, bucket, anahtar, migration ya da veri taşıması yok.

## 1. Bugünkü durum
- **Fotoğraf:** yalnız yük ilanında, `listings.image_data` sütununda JPEG data URL (≤60 000 karakter, ~44 KB; istemci
  `toDataURL('image/jpeg')` ile küçültür). v1 listede yalnız `has_photo`, fotoğrafın kendisi yalnız üyeye ayrıntı ucunda.
- **Bildirim:** uygulama içi; `route_alerts` kayıtları eşleşmeyi istemcide gösterir. Sunucudan cihaza push yok.

## 2. Fotoğraf: önerilen yol (R2)
| Konu | Öneri |
|---|---|
| Depo | Cloudflare R2, **özel** bucket (herkese açık URL yok) |
| Nesne adı | `listings/<listing_id>/<rastgele-uuid>.jpg` — sahip kimliği, telefon ya da ad içermez |
| Yükleme | İstemci → Worker `POST /photos/upload-url` → Worker oturumu ve ilan sahipliğini `worker` şemasındaki bir fonksiyonla doğrular → kısa ömürlü (≤5 dk), tek nesneye, boyut ve `image/jpeg` sınırlı imzalı PUT URL |
| Okuma | Worker `GET /photos/<id>` → üyelik ve ilan görünürlüğü doğrulanır → R2'den akış ya da ≤5 dk imzalı GET; `Cache-Control: private` |
| Doğrulama | Sunucuda boyut (≤2 MB), JPEG imzası, en/boy sınırı; EXIF (konum) silinir |
| DB | Yeni sütun `photo_key` (null olabilir) — ek alan; `image_data` geçiş süresince korunur |
| v1 sözleşme | `has_photo` aynı kalır; ayrıntıda `photo` yerine ek `photo_url` (süreli) — eklemeli değişiklik, v0 bozulmaz |
| Silme | İlan/hesap silinince nesne silme kuyruğu; yasal saklama (#125) kapsamındaki ilanlar için **önce saklama kuralı kararı** |
| Geçiş | Eski `image_data` kayıtları toplu iş ile R2'ye; doğrulama sonrası sütun boşaltma ayrı onay |

Bağımlılıklar: B4 Worker'ın canlıya çıkması (yukarıdaki 5 madde, `docs/server/b4.md`); R2 bucket ve erişim anahtarı
(onay); #125 yasal arşivde fotoğrafın saklanıp saklanmayacağı kararı; KVKK aydınlatma metninde depolama yerinin
(yurt dışı aktarım) belirtilmesi.

## 3. Push bildirimi: önerilen yol
| Konu | Öneri |
|---|---|
| Web/PWA | Web Push (VAPID). `sw.js` içinde `push` ve `notificationclick` işleyicisi; izin yalnız kullanıcı eylemiyle istenir |
| Mobil (ileride) | Yerel uygulama çıkarsa FCM (Android) / APNs (iOS); aynı sunucu arayüzü, farklı gönderici |
| Abonelik kaydı | Yeni tablo `private.push_subscriptions(user_id, endpoint, p256dh, auth, created_at, last_ok_at)`; RLS kapalı tablo, yalnız SECURITY DEFINER fonksiyonlar; kullanıcı kendi aboneliğini ekler/siler |
| Tetik | Yeni ilan → eşleşen `route_alerts` → kuyruk tablosu → Worker zamanlı iş (Cron Trigger) gönderir. `pg_cron` gerekmez |
| İçerik | Yalnız rota ve tür ("İstanbul → Ankara yeni yük"); telefon, ad, fiyat, not yok |
| Sınırlar | Kullanıcı başına saatlik üst sınır, sessiz saatler, 404/410 dönen abonelik silinir |
| Gizli anahtar | VAPID özel anahtarı yalnız Workers Secret; depoda/CI'da yok |
| Günlük | Endpoint ve anahtarlar `redact` kuralına girer (`endpoint` alanı eklenecek) |

Bağımlılıklar: B4 Worker canlı; VAPID anahtar üretimi (onay); hesap silmede aboneliklerin silinmesi
(`erase_account`'a ek — #125 ile birlikte değerlendirilmeli); bildirim izni ve içerik için ürün kararı.

## 4. Karar bekleyenler
1. Fotoğraf R2'ye taşınsın mı, yoksa mevcut DB içi küçük JPEG yeterli mi? (Bugünkü sınır 44 KB; mobilde çoklu foto istenirse R2 gerekli.)
2. Yasal arşivde (#125) fotoğraf saklanacak mı, süre ne?
3. Push yalnız rota alarmı için mi, yoksa teklif/mesaj için de mi?
4. Sessiz saatler ve günlük üst sınır değerleri.
5. Kişisel veri aktarımı (R2/FCM yurt dışı) için KVKK metni güncellemesi.

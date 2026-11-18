# API sözleşmesi v1

Kaynak: `supabase/contract/v1.json`. Migration: `supabase/migrations/20261118040000_b3a_api_framework.sql`.
Denetim: `node tools/api-contract.cjs` (v0 ile birlikte), kasıtlı bozma: `node tools/contract-mutations.cjs`.
Testler: `tests/db/api-v1.test.cjs` (PGlite, PG16, PG17), `tests/db/api-v1-http.test.cjs` (yerel PostgREST).
Planın tamamı: B3 teknik değerlendirmesi (18 Kasım 2026).

v0 (`docs/api/contract-v0.md`) olduğu gibi çalışmaya devam eder. v1 ondan ayrıdır; v0 otomatik kapatılmaz.

## Kurallar

| Konu | Kural |
|---|---|
| Yer | Yalnız `api` şemasında fonksiyon. Tablo, görünüm, dizi ya da tip yok. İstemci tabloya dokunmaz. |
| Ad | `<kaynak>[_<eylem>]_v<N>`, ör. `api.status_v1`, ileride `api.listings_v1`, `api.listing_create_v1`. |
| Fonksiyon | `jsonb` döner; `SECURITY DEFINER`; `search_path=''`; nesneler şema adıyla; `VOLATILE`; ilk ifade `perform private.api_begin('<ad>')`. `declare` bölümünde fonksiyon çağrısı yok (api_begin'den önce çalışırdı). |
| Çağrı | Yalnız `POST /rpc/<ad>`, başlıklar `Content-Profile: api`, `Accept-Profile: api`. GET reddedilir (sayım yazılamaz). |
| Yetki | PUBLIC'e kapalı; yalnız sözleşmedeki roller (`anon`, `authenticated`). `private.api_*` yardımcıları istemciye kapalı. |
| Yanıt | Tek kayıt `{"data": …}`. Liste `{"data": […], "page": {"next": "<imleç>" | null}}`. İmleç opak metindir; sayfa boyutu sunucuda sabittir. |
| Hata | Sabit SQLSTATE + makinece okunur anahtar. PostgREST gövdesi: `code` = SQLSTATE, `message` = anahtar, `details` = sabit açıklama, `hint` = `nakgo.api`. İstemci `details` metnine dayanmaz. |
| Sürüm | v1 içinde yalnız geriye uyumlu: yeni isteğe bağlı argüman, yeni alan, yeni fonksiyon. Silme, yeniden adlandırma ya da anlam değişikliği v2'dir. |

## Hata anahtarları

| Anahtar | SQLSTATE | HTTP | Ne zaman |
|---|---|---|---|
| `auth_required` | 42501 | 401 | Oturum yok ya da anonim oturum |
| `account_unverified` | 42501 | 403 | E-posta doğrulanmamış |
| `account_suspended` | 42501 | 403 | Askıya alınmış hesap yazmaya çalışıyor |
| `admin_required` | 42501 | 403 | Yönetici olmayan hesap |
| `invalid_argument` | 22023 | 400 | Geçersiz argüman |
| `invalid_cursor` | 22023 | 400 | Geçersiz sayfa imleci |
| `not_found` | PT404 | 404 | Kayıt yok ya da erişilemiyor (ikisi ayırt edilmez) |
| `conflict` | PT409 | 409 | Kayıt başka işlemle değişti |
| `api_disabled` | PT503 | 503 | v1 kapalı; istemci v0 kullanır |
| `limit_reached` | PT429 | 429 | Hesap sınırı: 10 etkin ilan, 20 rota uyarısı (B3-c) |
| `not_allowed` | 42501 | 403 | İşlem bu hesap/kayıt için yapılamaz: ana yönetici hesabını silme, kaldırılmış ilanı açma (B3-c) |
| `internal_error` | XX000 | 500 | Beklenmeyen hata; ayrıntı yanıtta yok, günlükte yalnız SQLSTATE (B3-c) |

`PTxyz` kodları PostgREST'in HTTP durumunu doğrudan belirler. `not_found` ve `conflict` için PostgreSQL'in kendi
kodları (`P0002`, `40001`) **kullanılmaz**: yerel PostgREST 12.2.3'te `P0002` HTTP 500 döndü, `40001` ise yanıtsız
kaldı (PostgREST serileştirme hatasını yeniden deniyor). HTTP değerleri `tests/db/api-v1-http.test.cjs` ile ölçülür.

## Oturum ve yetki yardımcıları

| Yardımcı | Ne yapar |
|---|---|
| `private.api_begin(ad, kapalıyken_çalışır=false)` | v1 kapalıysa `api_disabled`; kullanım sayımı |
| `private.api_actor(yazma=false)` | Doğrulanmış, anonim olmayan hesap; yazmada askıya alınmışlık ve etkinlik kilidi (`private.require_activity`) |
| `private.api_admin()` | `api_actor` + mevcut yönetici kuralı (`private.is_nakgo_admin`) |
| `private.api_cursor(metin)` | İmleç doğrulama |
| `private.api_ok(veri)`, `private.api_page(öğeler, sonraki)` | Yanıt biçimi |
| `private.api_raise(anahtar)` | Kayıtlı anahtarla hata; kayıtsız anahtar programlama hatasıdır |

## SECURITY DEFINER ve RLS

v1 fonksiyonları tablo sahibinin yetkisiyle çalışır; bu yüzden **RLS içeride uygulanmaz** ve sütun izinleri
atlanır. Bu kasıtlıdır (istemciye tablo yetkisi açmamak için) ama bir sonucu var: okuma uçları RLS'deki görünürlük
koşullarını açıkça yazmalı, yazma uçları alan listesini kendisi sınırlamalı. Tetikleyiciler (kota, moderasyon,
erişim kaydı) çalışmaya devam eder, çünkü kimliği `auth.uid()` ile JWT'den okurlar. B3-b ve B3-c bunu eşdeğerlik
testleriyle güvenceye alır: her v1 okuması, aynı sorgunun `authenticated` rolüyle RLS altındaki sonucuyla
karşılaştırılır.

## Kullanım ölçümü

`private.api_usage`: saat (UTC), sürüm, fonksiyon, parça (0–3), çağrı sayısı. Hesap, IP ya da istek içeriği yok.
Yalnız başarılı çağrılar sayılır (hata işlemi geri alır). 400 günden eski satırlar günlük işle silinir.
v0 kullanımı veritabanında sayılmaz (v0 fonksiyonlarına dokunulmaz, tablo okumaları sayılamaz); v0'ı kapatma kararı
için platformun istek günlükleri kullanılacaktır.

## v1'i kapatma ve v0'a dönüş

`private.api_settings.v1_enabled=false` yapılınca `api.status_v1` `enabled:false` döner, diğer uçlar `api_disabled`
verir. İstemci önce `status_v1`'i çağırır; hata ya da `enabled:false` gelirse v0'ı kullanır. Bu ayar yalnız sunucu
tarafındadır (istemciye kapalı).

## Canlıda yapılacaklar (son aşama, ayrı onay)

- Supabase "Exposed schemas" ayarına `api` eklenmesi.
- Supabase'in PostgREST sürümünde hata kodlarının ve HTTP durumlarının bir kez doğrulanması.
- `pg_cron` işi `nakgo-api-usage-retention`.

## İlan okuma uçları (B3-b1)

Migration: `supabase/migrations/20261118050000_b3b1_api_listings.sql`. Testler: `tests/db/api-v1-listings.test.cjs`,
`tests/db/api-v1-listings-http.test.cjs`. Kasıtlı bozma: `node tools/api-v1-listings-mutations.cjs`. Ölçüm: `node tools/api-bench.cjs`.

| Uç | Kim | Ne döner |
|---|---|---|
| `listings_v1(p_cursor, p_kind)` | misafir, üye | Herkese görünen ilanlar; 50'şer, kimliğe göre azalan; `p_kind`: `load`/`truck` |
| `listing_v1(p_id)` | misafir, üye | Tek ilan; üyeye ayrıca kendi ilanı (karartılmamışsa, durumu ne olursa olsun). Görünmeyen → `not_found` |
| `my_listings_v1(p_cursor)` | üye | Kendi ilanları (bütün durumlar, karartılmışlar hariç) |

Görünürlük: misafir ve üye için tek kural, `private.api_visible_listings` (v0 `nakgo_public_listings` kuralı: aktif,
süresi dolmamış, tarihi geçmemiş, moderasyonla kaldırılmamış, sahibi askıda değil).

İlan alanları (`listing_item` sözleşmede): misafir için kimlik, tür, nereden/nereye (il, ilçe), araç, kasa, tutar, yük,
kalemler, tarih (gün, bitiş, saat, metin), durum, oluşturma zamanı, `has_photo`. Üyeye ayrıca sahip etiketi, not,
`mine`, bitiş ve güncelleme zamanı, `contact_allowed`. Fotoğraf (`photo`) yalnız üyeye ve yalnız ayrıntıda. Telefon,
sahip kimliği, karartma zamanı hiçbir yanıtta yok. Zamanlar UTC, `YYYY-MM-DDTHH:MM:SS.mmmZ`.

v0 ile bilinen fark (onaylı karar 1): v0 üye listesi sahibin kendi süresi geçmiş ama henüz kapanmamış aktif ilanlarını da
gösterir (RLS sahip kuralı); v1 akışı göstermez, bu ilanlar `my_listings_v1`'de. Moderasyonla kaldırılan ve askıdaki
sahibin ilanları v0'da durum alanıyla gizlenir (gerçek akışlarda `archived`/`closed` olurlar); v1 bunu ayrıca açıkça
denetler.

## Hesap okuma uçları (B3-b2)

Migration: `supabase/migrations/20261118060000_b3b2_api_account.sql`. Testler: `tests/db/api-v1-account.test.cjs`,
`tests/db/api-v1-account-http.test.cjs`. Kasıtlı bozma: `node tools/api-v1-account-mutations.cjs`. Hepsi yalnız üye ve yalnız
kendi verisi; misafire kapalı.

| Uç | Ne döner |
|---|---|
| `profile_v1()` | `{data:{display_name, account_type, city, about, phone}}`; profil satırı yoksa `{data:null}` |
| `favorites_v1(p_cursor)` | Liste, 50'şer, ilan kimliğine göre azalan: `{listing_id, available, listing}`. İlan görünmüyorsa (başkasının kapalı ilanı, karartılmış, kaldırılmış, süresi geçmiş) `available:false`, `listing:null`. `listing` üye alanlarıyla, fotoğrafsız |
| `favorite_ids_v1(p_cursor)` | Yalnız kimlikler, 200'er (v0'daki kalp işaretleme okuması) |
| `route_alerts_v1(p_cursor)` | `{id, kind, from, to, vehicle, body, active, seen_at, created_at}`, 20'şer (yazma ucu hesap başına 20 ile sınırlar) |

Favori ilanın görünürlüğü ayrıntı ucuyla aynıdır: herkese görünen ilan ya da kendi karartılmamış ilanı. Bu, v0'daki
gömülü ilan okumasıyla (RLS) testte birebir aynı çıktı.

## Yazma uçları (B3-c)

Migration: `supabase/migrations/20261118070000_b3c_api_write.sql`. Testler: `tests/db/api-v1-write.test.cjs`,
`tests/db/api-v1-write-http.test.cjs`. Kasıtlı bozma: `node tools/api-v1-write-mutations.cjs`. Hepsi yalnız üyeye;
kullanıcı kimliği hiçbir uçta argüman değildir, her zaman oturumdan (`auth.uid()`) alınır.

| Uç | Yanıt `data` | Not |
|---|---|---|
| `listing_create_v1(p_request_id uuid, p_listing jsonb)` | `{listing, created}` | `kind` zorunlu + yazılabilir alanlar. Aynı istek kimliği 24 saat içinde aynı ilanı döner (`created:false`); aynı kimlik farklı gövdeyle `conflict` |
| `listing_update_v1(p_id, p_revision, p_changes jsonb)` | `{listing}` | `p_revision` = ilanın son okunan `updated_at` değeri; farklıysa `conflict` ve hiçbir şey yazılmaz. Yazılabilir alanlar + `status` |
| `listing_close_v1(p_id)` | `{listing, changed}` | Tekrar güvenli |
| `profile_update_v1(p_changes jsonb)` | profil (`profile_v1` biçimi) | Profil yoksa oluşturur. `display_name` ≤60, `city` ≤40, `about` ≤200, `phone` `05XXXXXXXXX` ya da boş, `account_type` carrier/owner; metin, kırpılır |
| `favorite_add_v1(p_listing_id)` / `favorite_remove_v1(p_listing_id)` | `{listing_id, saved}` | Tekrar güvenli. Ekleme yalnız görünen ilana (okuma uçlarıyla aynı kural) ve v0 kuralına (etkin ilan) |
| `route_alert_create_v1(p_kind, p_from, p_to, p_vehicle, p_body)` | `{alert, created}` | Aynı uyarı varsa onu döner (sınırdayken de) |
| `route_alert_update_v1(p_id, p_active)` | `{alert}` | v0'daki tek değişiklik: açma/kapatma |
| `route_alert_delete_v1(p_id)` | `{id, removed}` | Yoksa ya da başkasınınsa `removed:false` (ikisi ayırt edilmez) |
| `route_alerts_seen_v1()` | `{updated}` | v0 `nakgo_route_alerts_seen` |
| `listing_contact_v1(p_id, p_channel)` | `{phone, limited}` | Sınır aşımında hata değil `phone:null, limited:true` (güvenlik olayı geri alınmasın) |
| `account_delete_v1()` | `{deleted}` | Tekrar güvenli |

Yazılabilir ilan alanları v0 istemcisinin gönderdikleridir: il/ilçe, araç, kasa, tutar, yük, not, tarih alanları, kalemler,
fotoğraf, iletişim telefonu ve izni. `owner_id`, `owner_label`, `status` (oluştururken), `expires_at`, `created_at`,
`redacted_at`, `kind` (güncellerken) kabul edilmez. İlan adı (`owner_label`) profildeki görünen addan alınır (v0 istemcisi
de böyle yapıyor); profil yoksa `NakGo kullanıcısı`.

**İş kuralları tek yerde.** Favori, rota uyarısı, telefon ve hesap silme v0 fonksiyonlarını çağırır: kota ve kilitler,
telefon sınırı (30 farklı ilan/60 dk, 100/24 saat, güvenlik olayı), tıklama sayımı, yasal saklama (`erase_account`) ve
denetim kaydı orada. İlan ve profil yazımı tabloya yapılır; SECURITY DEFINER RLS'yi ve sütun yetkisini atladığı için sahiplik,
karartma ve alan beyaz listesi açıkça yazılır. Tetikleyiciler (yazma koruması, ilan kotası, moderasyon/askı, erişim
kaydı) `auth.uid()` okuduğu için v1 içinden de çalışır; testler her birini v1 üzerinden tetikler.

**Revision.** Ayrı bir sütun eklenmedi (v0 tablosu değişmesin diye). Satır kilitlenir ve `updated_at` (yazma koruması
tetikleyicisi her güncellemede yeniler) son okunan değerle karşılaştırılır. Değer milisaniyeye yuvarlıdır; kayıp güncelleme
için iki istemcinin aynı milisaniye içinde okuyup yazması gerekir, ağ üzerinden pratikte oluşmaz.

**Tekrar koruması.** `private.api_requests`: hesap, istek kimliği, fonksiyon, gövdenin md5 özeti, oluşan ilan. Gövde
(telefon, metin) saklanmaz. 24 saatten eskiler saatlik işle (`private.api_requests_retention`, pg_cron) ve aynı hesabın
sonraki isteğinde silinir; hesap silinince hemen silinir. Başarısız istek (kota, geçersiz girdi) kayıt bırakmaz.

**Hata ve günlük.** Yakalanan her hata sabit anahtara çevrilir; v0 hata metni ve kısıt hatasının satır içeriği yanıta
ve günlüğe gitmez. Bilinmeyen hata günlüğe yalnız SQLSTATE ile yazılır (`internal_error`).

v0 ile bilinen farklar (hiçbiri kuralı gevşetmez):
- Favori ekleme: v0 moderasyonla kaldırılmış ya da sahibi askıdaki ilanı, durumu `active` kaldıysa ekler (gerçek akışlarda
  durum değiştiği için oluşmaz); v1 reddeder.
- Rota uyarısı: v0 aynı uyarıda hata (`23505`) verir ve 20 sınırını tekrardan önce denetler; v1 aynı uyarıyı döner.
- Rota uyarısı silme: v0 olmayan uyarıda hata verir; v1 `removed:false` döner.
- İlan adı istemciden alınmaz; durum güncellemesinde v0 ile aynı değerler (`active`, `closed`, `archived`).

### B3-c canlıda yapılacaklar (son aşama, ayrı onay)
- Yukarıdaki genel maddeler (Exposed schemas, Supabase PostgREST üzerinde bir kez deneme).
- `nakgo-api-requests-retention` pg_cron işinin Supabase'de çalıştığının görülmesi.
- Supabase günlük ayarında hata ifadesi parametrelerinin yazılmadığının (`log_parameter_max_length_on_error=0`) görülmesi.

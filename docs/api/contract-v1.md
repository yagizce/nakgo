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
Oturum açmış bir üyenin engellediği hesapların ilanları bu üyeye listede ve ayrıntıda gösterilmez. Bu filtre v0 okumalarında da uygulanır.
Engelleme işlemi ilan kimliğini kullanır ve ilan yanıtına sahip kimliği eklemez. Telefon erişimi ve favori ekleme de aynı engeli uygular.

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
| `listing_update_v1(p_id, p_revision bigint, p_changes jsonb)` | `{listing}` | `p_revision` = ilanın son okunan tamsayı `revision` değeri (B3-c2); farklıysa `conflict` ve hiçbir şey yazılmaz. Yazılabilir alanlar + `status` |
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

**Revision (B3-c2).** `public.listings.revision` tamsayıdır; oluşturmada 0, her güncellemede (v0 ve v1, yönetici ve hesap
silme dahil) tetikleyiciyle tam 1 artar ve elle atanamaz. `listing_update_v1` satırı kilitler ve revision'ı kilit altında
karşılaştırır: aynı revision'ı okuyan istemcilerden yalnız biri yazar, diğerleri `conflict` alır. Zaman damgası kullanılmaz
(aynı milisaniyedeki iki sürüm, geride kalan işlem saati ya da geri alınan saat karışmasın). Üye yanıtında `revision` yalnız
kendi ilanında dolu, başkasınınkinde `null`; misafirde yok. v0 istemcisi sütunu göremez ve yazamaz. Tetikleyicileri
kapatan bakım yazmaları (replica modu) artırmaz; bunlar ilanı karartır ve karartılmış ilan v1'de güncellenemez.

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

## İstemci geçişi (B3-d)

`src/js/cloud.js` (`nakgoAuth`) bütün kullanıcı çağrılarını v1'e taşır; yönetici çağrıları B8'e kadar v0'da kalır. Ekran kodu
değişmez: v1 yanıtı `v0Listing`/`v0Alert` ile bugünkü satır biçimine çevrilir, v1 hata anahtarı bugünkü hata koduna
(`V1_CODES`) eşlenir, böylece bugünkü uyarı metinleri aynen görünür.

**Sürüm seçimi (tek yer):** `API_PREFERENCE` (`'auto'` | `'v0'`). `'auto'`: oturumda bir kez `api.status_v1` sorulur;
yalnız `enabled:true` dönerse v1. Şema açık değil (`PGRST106`), fonksiyon yok, ağ hatası, 15 sn zaman aşımı ya da SDK'da
`schema()` yoksa v0. `/api/auth/config` yanıtındaki isteğe bağlı `"api":"v0"` alanı v1'i istemci tarafında kapatır.
Hesap değişince yeniden sorulur.

**v0'a dönüş (kalıcı):** yalnız sunucunun o isteği hiç çalıştırmadığı kesin olan üç yanıtta otomatik v0 tekrarı yapılır ve
oturumun kalanı v0'dadır:
- `api_disabled` (PT503): `private.api_begin` her uçta ilk adımdır ve kapatma anahtarını hiçbir yazmadan önce denetler;
  hata işlemi geri alır.
- `PGRST106` (şema açık değil) ve `PGRST202` (fonksiyon yok): PostgREST isteği veritabanına göndermeden reddeder.

Bunların dışında hiçbir hata v0'a devredilmez: ağ hatası, zaman aşımı, ağ geçidi 5xx yanıtı, `PGRST001/002` gibi bağlantı
hataları ve iş hataları (`conflict`, `limit_reached`, `not_found`…). Sonucu belirsiz bir **ilan oluşturma** denemesinden
sonra v1 kapatılsa bile aynı içerik v0'a gönderilmez (v0'da tekrar koruması yok); kullanıcıya "Bağlantı kesildiği için
ilanın yayınlanıp yayınlanmadığı doğrulanamadı. İlanlarım'ı yenileyip kontrol et." gösterilir. Diğer yazmalar v0'da da
tekrar güvenlidir (favori, profil, alarm açma/kapatma, hesap silme; aynı alarm "zaten kurulu" döner; aynı telefon
görüntülemesi sayılmaz).

**İstek kimliği:** ilan oluşturmada içerik + hesap aynı kaldıkça aynı kimlik kullanılır (ağ hatası sonrası yeniden gönderim
ikinci ilan açmaz); başarıdan sonra sıfırlanır.

**Revision:** kayıtta `rev` (= tamsayı `revision`, B3-c2); düzenleme onu gönderir. Çakışmada ilanın güncel hâli yüklenir ve
"İlan başka bir yerde değişti; güncel hâli yüklendi, yeniden dene." gösterilir.

**Fotoğraf:** v1 listesi yalnız `has_photo` taşır; kartta "Fotoğraflı" etiketi, ayrıntıda yer tutucu ve `listing_v1` ile
sonradan yükleme. Boş yanıtta yer tutucu kalkar; hata, ağ kesintisi ve 15 sn zaman aşımında "Yeniden dene". Başka ilan
açıldıysa ya da oturum değiştiyse geç gelen fotoğraf yazılmaz. Misafire fotoğraf verilmez (v0'da da yok).

**v1'de bilinçli fark (onaylı karar, 18 Kasım 2026):** v1 başkasının ilanında sahip kimliği vermez (veri minimizasyonu,
B3-b); sahip kimliği v1'e eklenmeyecek. Arayüzdeki sonuç (`tests/unit/owner-hidden-v1.test.js` ile doğrulanır): v1
modunda başkasının ilan ayrıntısında cihaz içi "Engelle" düğmesi görünmez ve engellenen hesap filtresi v1 ilanlarına
uygulanmaz. İlan sahibinin adı, "Profili gör", "Şikayet et", iletişim ve kendi ilanının tanınması (`mine`) sürer. Bu
engelleme zaten yalnız o oturumda geçerliydi (hesaba geçişte sıfırlanır); v1 etkinleştiğinde kaldırılabilir. v0 modunda
davranış değişmez.

Testler: `tests/unit/api-v1-client.test.js`, `tests/unit/listing-photo-v1.test.js`, `tests/unit/listing-revision-v1.test.js`,
`tests/db/api-v1-client-http.test.cjs` (gerçek supabase-js + yerel PostgREST; CI'da atlanır). Kasıtlı bozma:
`node tools/api-v1-client-mutations.cjs`.

## Araç verileri (B10)

Araç tipi, kasa tipi ve tonaj ilan tablosunda zaten vardı ve ilk migration'dan beri tablo kısıtıyla doğrulanıyor; yeni sütun
açılmadı, v0 tablosu, kısıtları, RLS, kotalar ve moderasyon değişmedi. Migration: `20261118090000_b10_vehicle_data.sql`.

| Alan | Sütun | İzin verilen değerler | Kural |
|---|---|---|---|
| Araç tipi | `vehicle` | Tır, Kırkayak, Kamyon, Kamyonet, Panelvan, Tanker, Lowbed, Konteyner | Zorunlu; tam eşleşme (büyük/küçük harf, boşluk dahil) |
| Kasa tipi | `body` | Tenteli, Kapalı kasa, Açık kasa, Frigorifik, Damperli, Tanker, Lowbed, Konteyner | Zorunlu; tam eşleşme |
| Tonaj | `amount` | 0 < değer ≤ 9007199254740991; v1'de en fazla 3 ondalık | **Birim: ton.** Yük ilanında yük ağırlığı, boş araç ilanında boş kapasite |

- **Katalog:** `listing_catalog_v1()` (misafir ve üye) `{vehicles, bodies, amount:{unit:"ton", min_exclusive:0, max, max_decimals:3}}` döner.
  Katalog, tablo kısıtları ve istemci listeleri (`src/js/config.js`) aynıdır; `tests/db/api-v1-vehicle.test.cjs` denetler.
- **Girdi (v1):** `amount` yalnız JSON sayı, en fazla 3 ondalık ve yanında `amount_unit:"ton"` ile kabul edilir; birimsiz,
  başka birimli, metin, 3'ten fazla ondalıklı tonaj ve tonajsız birim `invalid_argument`. Ondalık sayısı sayının yazıldığı
  biçimle ölçülür: `18.5`, `18.250`, `0.001`, `1e-3` geçerli; `18.2501`, `18.2500`, `0.0001` geçersiz. Araç/kasa listede
  olmalı. Yanıt biçimi değişmedi (`amount` ton).
- **Form (istemci):** v1 modunda ilan formu (yük ağırlığı, boş kapasite) ve düzenleme formu girilen metni ve gönderilecek
  sayıyı denetler; 3'ten fazla ondalıkta form gönderilmez ve "Tonaj en fazla 3 ondalık basamak içerebilir. Örnek: 18,250
  ton." gösterilir. Yuvarlama yapılmaz. Boş, sıfır ve geçersiz karakter bugünkü mesajlarla reddedilir. v0 modunda (oturum
  ortasında v0'a dönüldüğünde de) form davranışı değişmez. Kontrol sunucu doğrulamasının yerine geçmez. Mod, istemcinin o an
  bildiği sürümdür (`nakgoAuth.apiMode()`); sürüm sorgusu sürerken v0 sayılır ve sunucu yine reddeder.
- **v0 ve eski veri:** hassasiyet kuralı yalnız v1 girdisinde; tablo kısıtı ve v0 değişmedi. v0 ile girilmiş daha hassas
  tonaj (ör. 18.2501) v1'de olduğu gibi okunur; tonaja dokunmayan v1 düzenlemesi serbesttir, tonaj v1 ile yeniden yazılırken
  kural uygulanır.
- **Akış filtreleri:** `listings_v1` isteğe bağlı `p_vehicle`, `p_body`, `p_min_amount`, `p_max_amount` (ton, uçlar dahil)
  alır; eski çağrılar aynen çalışır. Geçersiz değer ya da alt sınırın üst sınırı geçmesi `invalid_argument`.
- **Rota alarmı (v1):** araç/kasa verilirse katalogdan olmalı. v0'ın serbest metni ve eski alarmlar değişmez; eski
  alarmlar v1'de okunur, açılıp kapatılır, silinir.
- **v0:** değişmedi; v0 istemcisi birim göndermez, tonaj her zaman ton. Uygulama (B3-d) v1'e tonajı `amount_unit:"ton"` ile
  gönderir; filtreleme uygulamada yerel olarak sürer.

### B10 iş kuralları kararları (18 Kasım 2026)

1. **Tonaj üst sınırı:** yeni ticari sınır yok; teknik güvenli sayı sınırı (9007199254740991) ve mevcut veritabanı
   doğrulamaları korunur. Gerçekçi üst sınır, araç sınıfları ve sektör gereksinimleri incelenerek ileride kararlaştırılacak.
2. **Araç–kasa uyumu:** bütün geçerli araç/kasa birleşimleri kabul edilir; uyumluluk matrisi ya da otomatik ret kuralı yok.
   Ayrıca değerlendirilecek.
3. **Kapasite eşleştirmesi:** B10 kapsamında değil (aşağıdaki gereksinim).
4. **Birim ve hassasiyet:** yalnız ton; v1'de en fazla 3 ondalık. Birimsiz ya da başka birimli v1 istekleri reddedilir.
   v0 değişmez.

### Sonraki eşleştirme aşaması için teknik gereksinim: kapasite eşleştirmesi

Bir yük ilanı ile bir boş araç ilanı ancak aşağıdakilerin hepsi sağlanıyorsa uygun eşleşme sayılır:
- **Tür ve yön:** biri yük (`kind='load'`), diğeri boş araç (`kind='truck'`) ilanıdır; yükün çıkış ve varış ili aracın çıkış ve
  varış iliyle uyumludur (yön ters değil). İlçe ve ara güzergâh kuralları o aşamada ayrıca belirlenir.
- **Kapasite:** aracın boş kapasitesi (`amount`, ton) yükün ağırlığından (`amount`, ton) **küçük olamaz**. Kapasitesi yetersiz
  araç uygun eşleşme sayılmaz. Karşılaştırma ton ve en fazla 3 ondalıkla yapılır; v0'dan gelen daha hassas eski değerler
  yuvarlanmadan karşılaştırılır.
- **Araç ve kasa:** yük ilanında istenen araç/kasa ile aracın araç/kasası; uyumluluk matrisi kararı (madde 2) verilene kadar
  birebir eşitlik.
- **Uygunluk:** iki ilan da herkese görünür olmalıdır (etkin, süresi dolmamış, tarihi geçmemiş, moderasyonla kaldırılmamış,
  sahibi askıda değil: `private.api_visible_listings`); tarihler örtüşmelidir; kişi kendi ilanıyla eşleşmez.
- **Gizlilik:** eşleşme yanıtı karşı tarafın kimliğini ya da telefonunu açmaz; telefon yalnız mevcut telefon görüntüleme
  ucu ve sınırıyla (30/saat, 100/gün) alınır.
- **Test:** sınır değerleri (kapasite = ağırlık eşleşir, 0,001 ton eksik eşleşmez), ters yön, görünmeyen ilan, kendi ilanı ve
  v0 ile girilmiş hassas eski değerler otomatik testle sınanır.

## Şikâyet (mobil hazırlık)

Migration: `20261118100000_listing_reports.sql`. Testler: `tests/db/reports.test.cjs` (PGlite, PG16, PG17),
`tests/db/reports-http.test.cjs` (yerel PostgREST), `tests/unit/report-api.test.js`; kasıtlı bozma: `tools/report-mutations.cjs`.

| Uç | Argümanlar | Yanıt |
|---|---|---|
| `report_create_v1` (authenticated) | `p_listing_id`, `p_subject` (`listing` ya da `account`), `p_reason` (`fake`, `fraud`, `inappropriate`, `wrong_info`, `other`), `p_note` (isteğe bağlı, ≤200) | `{data:{report:{id,subject,listing_id,reason,status,created_at}, created}}` |

- **Kimlik:** şikâyet eden oturumdan; argüman olarak alınmaz. Misafir, anonim oturum, doğrulanmamış ve askıdaki hesap
  gönderemez (`auth_required`, `account_unverified`, `account_suspended`).
- **Bağ:** ilan bugün herkese görünür olmalı (`private.api_visible_listings`); değilse `not_found`. Kendi ilanı ya da kendi
  hesabı `not_allowed`. Hesap şikâyeti (`account`) bir ilan üzerinden yapılır; hesap kimliği istemciden alınmaz, ilanın
  sahibinden sunucuda okunur (v1 sahip kimliği vermez).
- **Tekrar:** aynı kişinin aynı ilan (ya da aynı hesap) için açık/incelenen tek şikâyeti olur; ikinci gönderim aynı kaydı
  döner (`created:false`), sebep ya da not değişmez. Karar verilen (çözüldü/reddedildi) şikâyetten sonra yeni kayıt açılır.
- **Sınır:** kişi başına 10 yeni şikâyet/saat ve 30/24 saat (`limit_reached`); tekrar gönderimler sayılmaz. Aynı kişinin
  eşzamanlı istekleri kişi kilidiyle sıraya girer.
- **Gizlilik:** kayıtlar `private.listing_reports` tablosunda; istemci rollerine kapalı, hiçbir ilan/profil ucu döndürmez.
  İlan sahibi şikâyeti göremez. Yanıt yalnız şikâyet edenin kendi kaydının kimliği ve durumu; not ve hesap kimliği dönmez.
  Not kırpılır, kontrol karakterleri boşluk olur.
- **Yönetici (v0, mevcut yönetici modeli):** `nakgo_admin_reports(p_status,p_offset)` ve
  `nakgo_admin_report_set(p_id,p_status,p_reason,p_revision)`; yetki `private.is_nakgo_admin()`, gerekçe 3–500 karakter,
  her karar `private.admin_audit` kaydı (`target='report:<id>'`, `action='report_<durum>'`), eşzamanlı karar `PT409`.
- **Saklama:** şikâyetler otomatik silinmez. İlan silinse de kayıt ve ilan numarası kalır; şikâyet eden ya da şikâyet edilen
  hesap silinince yalnız o hesap kimliği boşaltılır.
- **v0:** `nakgo_report_listing` aynı çekirdeği (`private.report_create`) çağırır; api şeması canlıda açılana kadar uygulama
  bunu kullanır (`via()`). Uygulama demo modunda şikâyeti eskisi gibi yalnız cihazda tutar; gerçek hesapta sunucuya gönderir ve
  başarı/tekrar/sınır/hata mesajını gösterir.

### Şikâyet kararları (onay bekleyen, değiştirilebilir)

1. Sınır değerleri (10/saat, 30/24 saat).
2. Yalnız bugün görünür ilan şikâyet edilebilir; kapanmış ilan için şikâyet yolu yok.
3. Saklama süresi: şimdilik süresiz. KVKK saklama süresi ve şikâyet notunun hesap silmede ne olacağı #125 (yasal arşiv)
   ile birlikte kararlaştırılmalı.
4. Yönetici paneli ekranı bu aşamada yok; uçlar ve istemci fonksiyonları (`adminReports`, `adminReportSet`) hazır.

## İl/ilçe kataloğu

`catalog/locations-v1.json`, `tools/location-catalog.cjs` ile `src/js/config.js`'ten (LL: 81 il, DISTRICTS: 973 ilçe)
üretilir; elle düzenlenmez. `tests/unit/location-catalog.test.js` dosyanın kaynakla, veritabanı il kısıtıyla
(`listings.from_city/to_city`), uygulama filtreleriyle ve WhatsApp kataloğuyla aynı olduğunu denetler.

```json
{"version":"<içerik özeti, 16 hane>","schema":1,"source":"src/js/config.js",
 "cities":[{"code":"34","name":"İstanbul","districts":[{"code":"34-kadikoy","name":"Kadıköy"}]}]}
```

- **Kodlar:** il = plaka kodu (`01`–`81`); ilçe = il kodu + Türkçe karaktersiz ad (`34-kadikoy`). `name` veritabanına yazılan
  ve filtrelerde kullanılan değerin kendisidir; istemci API'ye `name` gönderir.
- **Sürüm:** içerik değişmeden `version` değişmez; mobil istemci önbelleğini bununla yeniler. Biçim değişirse `schema` artar
  ve dosya `locations-v2.json` olur.
- **Veritabanı:** yeni tablo yok. İl, ilan tablosu kısıtıyla doğrulanır (değişmedi); ilçe serbest metin kalır (1–40
  karakter). v0 filtreleri değişmedi.
- **Yayın (onay bekliyor):** dosya şu an yalnız depoda. Web çıktısına (`/catalog/locations-v1.json`) eklenmesi canlı
  yayını değiştirir ve statik çıktı testinin güncellenmesini gerektirir; ayrı onayla yapılacak.

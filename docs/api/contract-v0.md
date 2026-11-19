# API sözleşmesi v0

Bu belge, yayındaki web istemcisinin (`src/js/cloud.js`) Supabase'e doğrudan kullandığı yüzeyi tanımlar. Makinece okunan karşılığı `supabase/contract/v0.json` dosyasıdır; ikisi birlikte güncellenir.

Kural: v0 yalnız geriye uyumlu biçimde değişebilir. Yeni isteğe bağlı argüman, yeni dönüş alanı ve yeni RPC eklenebilir. Bir RPC'yi, argümanı, kolonu ya da hata kodunu kaldırmak veya adını değiştirmek v1 ile yapılır, eski istemciler emekliye ayrıldıktan sonra.

## Denetimler

| Komut | Ne yakalar |
|---|---|
| `node tools/schema-check.cjs` | Migration'lardan kurulan şemanın `supabase/schema/snapshot.txt` ile her farkı (tablo, kolon, kısıt, indeks, politika, tetikleyici, fonksiyon gövdesi, yetki, varsayılan yetki). |
| `node tools/api-contract.cjs` | İstemcinin çağırdığı RPC/argüman/tablo/kolonların sözleşmeyle; sözleşmenin veritabanıyla uyumu. Sözleşme dışında anon/authenticated'a açılan fonksiyon veya tablo. |
| `supabase/tests/api-contract.sql` | Rol bazlı davranış: dönüş şekilleri, ret kodları, istemcinin dayandığı hata metinleri. `admin-db-check` ile çalışır. |
| `node tools/contract-mutations.cjs` | Yukarıdaki üç denetimin gerçekten bozulmayı yakaladığını 22 kasıtlı bozmayla kanıtlar. |
| `npm run test:db` | Hepsi. `NAKGO_PG_HOST` verilirse gerçek PostgreSQL'de, verilmezse PGlite'ta. |

Production karşılaştırması salt okunurdur: `node tools/schema-check.cjs --fingerprint-sql` çıktısı production'da çalıştırılır ve `--fingerprint` çıktısıyla satır satır karşılaştırılır. Bilinen farklar `supabase/schema/known-drift.txt` dosyasındadır.

## RPC'ler

| RPC | Argümanlar | Dönüş | Çağırabilen |
|---|---|---|---|
| `nakgo_public_listings` | `p_before bigint` (isteğe bağlı) | İlan satırları; sahip, telefon, not ve fotoğraf yok | anon, authenticated |
| `nakgo_listing_contact` | `p_id bigint`, `p_channel text` (isteğe bağlı: `call`/`whatsapp`) | `text` telefon; hesap başına görüntüleme sınırı aşıldıysa `null` (60 dk'da 30, 24 saatte 100 farklı ilan; daha önce görülen ilan sayılmaz) | authenticated |
| `nakgo_set_favorite` | `p_listing_id bigint`, `p_saved boolean` | `{listing_id, saved}` | authenticated |
| `nakgo_save_route_alert` | `p_kind`, `p_from`, `p_to`, `p_vehicle`, `p_body` (text) | `route_alerts` satırı | authenticated |
| `nakgo_set_route_alert` | `p_id bigint`, `p_active boolean` | `route_alerts` satırı | authenticated |
| `nakgo_remove_route_alert` | `p_id bigint` | `{id, removed}` | authenticated |
| `nakgo_route_alerts_seen` | — | `integer` | authenticated |
| `nakgo_delete_my_account` | — | `{deleted}` | authenticated |
| `nakgo_admin_role` | — | `boolean` | authenticated |
| `nakgo_admin_page` | `p_section text`; isteğe bağlı `p_offset`, `p_search`, `p_filter`, `p_query jsonb`. `security` bölümü güvenlik olaylarını verir (`p_filter`: boş, `contact_limit_hour`, `contact_limit_day`); `health` bölümü sistem sağlığını verir (yalnız okuma) | `jsonb` | authenticated (sunucu yönetici denetler) |
| `nakgo_admin_live` | `p_kind text` (isteğe bağlı) | `jsonb` | authenticated (sunucu yönetici denetler) |
| `nakgo_admin_moderate` | `p_kind`, `p_target`, `p_action`, `p_reason` (text), `p_revision bigint` | `jsonb` | authenticated (sunucu yönetici denetler) |
| `nakgo_report_listing` | `p_listing_id bigint`, `p_subject` (`listing`/`account`), `p_reason` (`fake`/`fraud`/`inappropriate`/`wrong_info`/`other`), `p_note` (isteğe bağlı, ≤200) | `{report:{id,subject,listing_id,reason,status,created_at}, created}` | authenticated |
| `nakgo_admin_reports` | `p_status` (isteğe bağlı: boş/`open`/`reviewing`/`resolved`/`rejected`), `p_offset` | `jsonb` dizi (20 + 1) | authenticated (sunucu yönetici denetler) |
| `nakgo_admin_report_set` | `p_id bigint`, `p_status`, `p_reason` (3–500), `p_revision bigint` | `{revision, changed}` | authenticated (sunucu yönetici denetler) |

Her RPC'nin tek tanımı olmalıdır; aynı adla ikinci tanım PostgREST çağrısını belirsizleştirir.

## Tablolar (yalnız authenticated; satırlar RLS ile sınırlı)

| Tablo | Okuma | Ekleme | Güncelleme | Kapalı olması gereken |
|---|---|---|---|---|
| `profiles` | id, display_name, account_type, city, about, phone (yalnız kendi satırı) | id, display_name, account_type | display_name, account_type, city, about, phone | — |
| `listings` | `cloud.js` `listingColumns` listesi | `listingFields` + kind, owner_label | `listingFields` + status | Okuma: contact_phone, redacted_at, owner_suspended. Ekleme: id, owner_id, status, expires_at, created_at, redacted_at, owner_suspended. Güncelleme: id, owner_id, kind, expires_at, created_at, redacted_at, owner_suspended |
| `listing_favorites` | listing_id (+ `listing:listings(...)` gömülü okuma) | — | — | Doğrudan yazma ve silme (yalnız RPC) |
| `route_alerts` | id, kind, from_city, to_city, vehicle, body, active, seen_at, created_at | — | — | Doğrudan yazma ve silme (yalnız RPC) |

anon hiçbir tabloyu doğrudan okuyamaz ve yazamaz.

## İç yetkiler

Bunlar istemci çağrısı değildir; veritabanının kendi işleyişi için authenticated rolüne açıktır:

- `nakgo_listing_items_valid(jsonb)`: listings CHECK kısıtı.
- `private.document_account_verified()`, `private.document_object_access(text,text)`, `private.is_document_reviewer()`: eski taşıyıcı belge tablolarının RLS ve Storage politikaları.

## İstemcinin dayandığı hatalar

| Kod / metin | Nerede | İstemci davranışı |
|---|---|---|
| `23505` | profiles ilk ekleme yarışı | Profili yeniden okur |
| `54000` | ilan sınırı (10 yayında ilan) | Özel mesaj gösterir |
| `PT409` (HTTP 409) | `nakgo_admin_moderate` sürüm çakışması (`Moderation changed; refresh`) ya da 5 sn'yi aşan kilit (`Moderation busy; refresh`) | "Başka yönetici değiştirdi; güncel durumu yükle"; tekrar gönderilmez. Eski sunucunun `40001`'i de aynı karşılanır |
| `PT409` (HTTP 409) | `nakgo_admin_report_set` sürüm çakışması | Listeyi yeniden okur. 40001 kullanılmaz: PostgREST 40001'i yeniden dener ve değişmeyen revision'da yanıt dönmez |
| `54000` | `nakgo_report_listing` şikâyet sınırı (10/saat, 30/24 saat) | "Çok fazla şikayet" mesajı |
| `42501` + `Listing unavailable` / `Own listing` / `Account suspended` | `nakgo_report_listing` | Şikâyet ekranında ilgili mesaj; ekran açık kalır |
| `42501` + `Owner account` / `Last administrator` | `nakgo_delete_my_account` | "Yönetici hesabı uygulamadan silinemez" |
| `42501` | oturumsuz, doğrulanmamış veya yetkisiz çağrı | Genel hata / yeniden deneme |
| `22023` | geçersiz argüman | Genel hata |

## HTTP uçları (Vercel)

- `GET /api/auth/config`: istemciye Supabase URL'si ve publishable anahtar.
- `POST /api/whatsapp/webhook`: imza doğrular ve ayrıştırır, kalıcı kayıt yapmaz.

Bu iki uç bu sözleşmenin veritabanı denetimleri dışındadır. Mevcut birim ve WhatsApp testleri bunları kapsar.

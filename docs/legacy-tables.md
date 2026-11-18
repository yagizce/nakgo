# Eski özellik tabloları: durum raporu (B2)

> Karar belgesi değildir. B2 kararı gereği **hiçbir tablo silinmez ya da arşivlenmez**; silme veya arşivleme ayrıca
> onaylanır. Bu rapor yalnız depodaki migration'lardan çıkarılmıştır. Production satır sayıları bu çalışmada
> **ölçülmedi** (production'a dokunulmadı); karar öncesi salt okunur bir sayım gerekir.

Kaldırılan üç özellik (uygulama içi mesajlaşma, taşıma işleri, taşıyıcı belgeleri) 15 Kasım'da veritabanında da
kapatıldı (`20261115184145_close_legacy_features.sql`): fonksiyonları silindi, istemcinin okuma yetkisi kaldırıldı.
Tablolar ve içindeki veriler duruyor.

## Tablolar

| Tablo | Özellik | İstemci erişimi | Bağlı olduğu (silinince) | Ona bağlı olan | Bugünkü temizlik |
|---|---|---|---|---|---|
| `public.listing_conversations` | Mesajlaşma | Yok | `listings` (bağ boşalır), `auth.users` ×2 (silinir) | `conversation_messages` (silinir) | Gece temizliği **her gece hepsini siler** |
| `public.conversation_messages` | Mesajlaşma | Yok | `listing_conversations` (silinir) | — | Konuşmayla birlikte silinir |
| `public.transport_jobs` | Taşıma işleri | Yok | `listings`, `auth.users` ×2 (silinir) | — | 30 gün sonra isim ve yük metni silinir; satır kalır |
| `public.carrier_applications` | Taşıyıcı belgeleri | Yok | `auth.users` (sahip silinince silinir; **inceleyen** için kural yok) | `carrier_document_files`, `carrier_document_audit` (silinir) | Hesap silinince |
| `public.carrier_document_files` | Taşıyıcı belgeleri | Yok | `carrier_applications`, `auth.users` (silinir) | Storage nesnesi (kuyrukla silinir) | Silinen satırın dosyası Storage temizlik kuyruğuna girer |
| `public.carrier_document_audit` | Taşıyıcı belgeleri | Yok | `carrier_applications` (silinir) | — | Başvuruyla birlikte |
| `private.document_reviewers` | Taşıyıcı belgeleri | Yok | `auth.users` (silinir) | — | Hesap silinince |
| Storage `carrier-documents` kovası | Taşıyıcı belgeleri | Yok (politikalar kaldırıldı) | — | — | Elle çalışan temizlik aracı; 16 Kasım'da 0 dosya |

## Saklama gereksinimi (hukukçu onayı bekleyen öneri)

- **Mesajlaşma:** Zaten her gece siliniyor; saklanan bir şey yok. Tabloların kalmasının tek nedeni temizlik kodunun
  onlara başvurması.
- **Taşıma işleri:** Kişisel alanlar 30 günde siliniyor. Kalan satırlar (ilan, taraflar, durum) olası bir uyuşmazlıkta
  kanıt değeri taşıyabilir; saklama süresi hukukçu listesine eklenmeli. Karar gelene kadar dokunulmaz.
- **Taşıyıcı belgeleri:** Özellik canlıda hiç dosya almadı (16 Kasım: 0 dosya). Kişisel belge türleri (`src`, `kb`,
  `ruh`) içerdiği için veri varsa en kısa sürede silinmesi KVKK açısından doğru olur; yoksa tablolar kaldırılabilir.

## Bulunan risk

`carrier_applications.reviewed_by` sütunu `auth.users`'a `on delete` kuralı olmadan bağlı. Bir belge inceleyicisinin
hesabı gece temizliğinde kalıcı silinirse (`accounts_purged` adımı) bu bağ silmeyi **engeller** ve gece işi o gün
hata verir. Bugün inceleyici yoksa risk yok; tablolar kaldırılırsa ya da bağ `on delete set null` yapılırsa ortadan
kalkar. Bu da tabloların geleceğiyle birlikte karara bağlanmalı.

## Karar için gerekenler

1. Production'da bu tabloların satır sayıları ve en yeni kayıt tarihleri (salt okunur sayım, ayrı onay).
2. Hukukçunun taşıma işleri için saklama süresi görüşü.
3. Sonra seçenekler: (a) olduğu gibi bırakmak, (b) taşıyıcı belgelerini kaldırmak, mesajlaşmayı kaldırmak, taşıma
   işlerini süre dolunca silmek, (c) hepsini şifreli bir arşive alıp kaldırmak. Her biri ayrı PR ve geri dönüş betiğiyle.

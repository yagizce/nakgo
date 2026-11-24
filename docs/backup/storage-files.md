# Storage dosyalarının yedeği: tasarım (B7-A5)

**Durum: yalnız tasarım.** Kod, anahtar ve kova yoktur. Bugün `storage.objects` boştur ve boş değilse veritabanı yedeği
durur (`guard_exact_zero`). Storage'ın dosyaya bağlı yardımcı tablolarında (önekler, analitik/vektör kovaları, kova
yaşam döngüsü durumu ve silme bekleyen dosya kuyruğu) satır görünürse de yedek durur; `storage` şemasında sınıflandırılmamış yeni bir tablo görülürse kapsam denetimi durdurur.
Böylece dosya oluşmaya başladığında sessiz veri kaybı olmaz: yedek durur ve alarm üretir. Uygulama dosya saklamaya başlamadan önce bu tasarım uygulanmalı ve B7-B'deki gibi
doğrulanmalıdır. Uygulama ayrı onay ister.

## Neden ayrı

Storage dosyaları veritabanında değildir. Veritabanı yedeği yalnız meta veriyi alır (`storage.buckets`,
`storage.objects` satırları; dışa aktarma fonksiyonlarıyla). Dosyanın kendisi Supabase Storage'ın arkasındaki nesne
deposundadır. Meta veri ile dosya ayrı yedeklenirse ikisinin aynı anı göstermesi gerekir; aşağıdaki bağlama bunu sağlar.

## Seçilen yöntem

| Konu | Karar |
|---|---|
| Okuma yolu | Supabase Storage'ın S3 uyumlu API'si; **yalnız okuma** izni olan ayrı bir S3 erişim anahtarı (K8). `service_role` anahtarı kullanılmaz. |
| Hedef | Aynı R2 kovası, `storage/` öneki; kova kilidi bu öneke de uygulanır (V3 ile aynı kanıt). |
| Şifreleme | Her dosya veritabanı yedeğiyle aynı iki çevrim dışı alıcıya (A, B) `age` ile şifrelenir. Nesne anahtarı içerik özetidir: `storage/sha256/<ilk2>/<sha256>.age`. Dosya adı ve kova adı depoda açık metin olarak görünmez. |
| Tekrar yükleme | İçerik adresli: aynı içerik bir kez yüklenir. Koşullu PUT (`If-None-Match: *`, V1). |
| Manifest | Her çalışmada `storage-manifest.json`: kova, nesne adı, boyut, sha256, Storage'ın `etag`/sürüm bilgisi, şifreli nesne anahtarı. Manifest şifrelenir, K1 ile imzalanır ve **aynı çalışmanın** veritabanı manifestine sha256'sıyla bağlanır. |
| Tutarlılık | Önce veritabanı dışa aktarımı (S1), ardından dosya kopyası. Uzlaştırma: S1'deki her `storage.objects` satırının dosyası kopyalanmış olmalı. Kopya sırasında silinmiş dosya `missing_after_snapshot` olarak işaretlenir (hata değil, sayı manifestte). S1'den sonra eklenen dosyalar bir sonraki çalışmaya kalır. |
| Silme | Veritabanı yedeğiyle aynı kapılı silme kuralları: yalnız hiçbir doğrulanmış manifestin başvurmadığı `storage/` nesneleri, kapı açıksa. Varsayılan kapalı. |
| Kapsam dışı | Herkese açık önbellek/dönüştürülmüş görseller; yalnız özgün nesneler. |

## Doğrulama

Her çalışmada:
1. Manifestteki her dosya için şifreli nesne depoda var ve boyutu tutuyor (HEAD).
2. Rastgele seçilen bir örnek (en az 1, en çok %1) indirilir ve sha256 kaynakla karşılaştırılır (şifreli halin sha256'sı;
   çözme CI'da yapılmaz).
3. Uzlaştırma: `storage.objects` satır sayısı = manifest kayıt sayısı + `missing_after_snapshot`.

Ayda bir çevrim dışı tatbikat: örnek dosyalar A anahtarıyla çözülür ve sha256'ları manifestle karşılaştırılır.

## Geri yükleme

1. Veritabanı yedeği geri yüklenir (Auth dahil); `storage.objects` satırları gelir.
2. Dosyalar çevrim dışı çözülür ve yeni projenin Storage'ına S3 API ile, satırlardaki `bucket_id`/`name` ile yüklenir.
3. Uzlaştırma: her satırın dosyası var; sha256 tutuyor.
4. Bu, S2a tatbikatına eklenir (iki geçici proje arasında).

## Anahtarlar

| Anahtar | Yer | Yetki |
|---|---|---|
| K8: Storage S3 okuma anahtarı | GitHub ortam gizlisi (onaylı ortam) | Yalnız okuma; mümkünse yalnız ilgili kovalar |
| R2 yazma anahtarı | Mevcut (B7-B) | Yalnız `db/`, `storage/`, `manifests/` öneklerine yazma |
| A, B | Çevrim dışı | Çözme |

## Açık sorular (B7-B/C kararı)

- Supabase Storage S3 erişim anahtarının yalnız okuma ve kova bazında sınırlanabildiği doğrulanmalı (V9 önerisi).
- Dosya başına `age` başlığı küçük dosyalarda yük getirir; dosya sayısı büyürse parçalı arşiv (tar + age) seçeneği.
- Kişisel veri içeren belgelerin (taşıyıcı belgeleri) saklama süresi yasal saklama kurallarıyla (A3) birlikte belirlenmeli.

## Garanti verilemeyenler

- Supabase Storage S3 API'sinin `etag`'inin içerik özeti olup olmadığı ve listeleme tutarlılığı bilinmiyor; bu yüzden
  sha256 her dosya için ayrıca hesaplanır.
- Kopya sırasında değiştirilen bir dosya (aynı ad, yeni içerik) S1 meta verisiyle uyuşmayabilir; manifest Storage'dan
  okunan sha256'yı kaydeder ve uzlaştırma boyut/sürüm farkını `changed_after_snapshot` olarak raporlar.

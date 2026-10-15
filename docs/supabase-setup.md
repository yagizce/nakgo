# Supabase: geliştirme ortamında e-posta ile giriş

Bu aşama e-posta/şifre ile kayıt, giriş, çıkış, şifre sıfırlama ve özel kullanıcı
profilidir. Bağlantı yalnız seçilen önizlemede etkinleştirilir; ilanlar, işler,
mesajlar ve Premium hâlâ yerel demodur. Demo kayıtları hesaba aktarılmaz.

Geliştirme projesi: `nakgo-dev` (`axkotffqrsddbrazhcwj`), Central EU
(Frankfurt). Bu proje geliştirme içindir; uygulamanın Production domaini
`https://nakgo.vercel.app` olarak kalır.

## SQL Editor ile uygulama

1. Yeni geliştirme projesinde SQL Editor > New query aç.
2. `supabase/migrations/20261014000000_profiles.sql` dosyasının tamamını yapıştır.
3. Run ile bir kez çalıştır. Sonuç `rls_enabled = true`, `policy_count = 3` olmalı.
4. Hata varsa dur; tablo silerek veya RLS'yi kapatarak çözmeye çalışma.

Dosya mevcut `profiles` tablosunu değiştirmez veya silmez. Tablo zaten varsa
işlem hata verir ve transaction geri alınır. SQL Editor ile uygulanan dosya
Supabase CLI migration geçmişine kendiliğinden eklenmez. CLI tabanlı dağıtıma
geçerken mevcut şema doğrulanıp bu migration uygulanmış olarak işaretlenmeli;
aynı dosya yeniden çalıştırılmamalı.

## Erişim modeli

- Profil kimliği `auth.users.id` ile eşleşir; sahte kullanıcı kimliği oluşturulamaz.
- Giriş yapmamış istemcinin tablo erişimi yoktur.
- Giriş yapan kullanıcı yalnız kendi satırını okuyabilir, oluşturabilir ve
  ad/hesap türü alanlarını güncelleyebilir. Başkasının profiline erişemez.
- İstemci kimlik, oluşturulma zamanı veya profil silme işlemini değiştiremez.
- `account_type` (`carrier` / `owner`) ürün tercihidir; Premium veya yönetici
  yetkisi değildir. Tablo telefon, ödeme, doğrulama veya üyelik yetkisi içermez.
- Kayıt tetikleyicisi yoktur. Doğrulanmış girişten sonra istemci eksik profili
  oluşturur. İsimler düz metindir; arayüzde kaçışlanır.

## Doğrulama ve sonraki adım

SQL'in son sorgusu yalnız tablo/RLS yapısını gösterir. SQL Editor yönetici
yetkisiyle çalışır; kullanıcılar arası erişim izolasyonunu kanıtlamaz.
Gerçek giriş bağlantısından önce iki ayrı test kullanıcısıyla kendi profilini
okuma/yazma, başka profile erişememe ve anonim erişimin reddi doğrulanmalıdır.

`supabase/tests/profiles.sql` bu kontrolleri SQL Editor'da PostgreSQL rolleriyle
çalıştırır. Rastgele kimlikli, giriş bilgisi olmayan iki geçici auth kaydı
oluşturur; işlem sonunda `ROLLBACK` ile tüm kayıtları geri alır. Başkasını
okuma/yazma/oluşturma, kimlik ve tarih değişikliği, silme, geçersiz hesap türü,
çok uzun ad ve anonim okuma girişimlerini de denetler. Bir kontrol başarısız
olursa sorgu hata verir. Bu test Auth API ve e-posta teslimat testinin yerine
geçmez.

14 Ekim 2026: var olan `profiles` tablosu yeniden oluşturulmadan incelendi;
RLS, üç sahiplik politikası ve sütun izinleri migration ile eşleşti.
Yukarıdaki SQL testi geliştirme projesinde PASS sonucu verdi.

İlan, görüşme, iş ve Premium yetkileri sonraki migrationlarda
mevcut ürün kurallarıyla eşleştirilecektir. Şifre ve gizli API anahtarı bu
dosyaya, sohbete veya frontend'e eklenmez.

İlk giriş yöntemi e-posta ve şifre olarak seçildi; telefon/SMS sonraki aşama.
Projede Email sağlayıcısı ve Confirm email açık, anonymous sign-ins kapalı.
Özel SMTP henüz bağlı değil. Supabase'in varsayılan e-posta hizmeti yalnız
organizasyon üyelerine gönderim yapar ve düşük gönderim sınırı vardır;
genel kullanıcı kaydı öncesinde özel SMTP kurulmalıdır. Kullanıcı doğrulamasını
kapatmak bu sınırın çözümü değildir. Auth dönüş adresleri, test önizlemesinin
kesin adresi belli olduğunda yapılandırılmalı; geniş wildcard eklenmemelidir.

## Önizleme yapılandırması

Vercel'de yalnız `codex/nakgo-email-auth` dalının Preview ortamına:

| Değişken | Değer |
| --- | --- |
| `NAKGO_AUTH_ENABLED` | `true` |
| `SUPABASE_URL` | `https://axkotffqrsddbrazhcwj.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Projenin `sb_publishable_...` açık istemci anahtarı |

`api/auth/config.mjs` yalnız bu açık yapılandırmayı döndürür, önbelleklemez.
`VERCEL_ENV=production` olduğunda değişkenler yanlışlıkla eklense bile bağlantı
kapalıdır. Service role, secret key, veritabanı şifresi ve erişim tokenı bu
endpoint'e veya bundle'a konmaz. `npm start` statik sunucusunda endpoint yoktur;
uygulama demo olarak çalışır.

`cloud.js` yalnız etkin yapılandırmada resmi Supabase JS 2.117.3 UMD istemcisini
jsDelivr'dan SRI doğrulamasıyla yükler. PKCE, token yenileme ve oturum işlemleri
SDK tarafından yönetilir. Oturum `ng-auth-<proje>` anahtarında, demo `yy2`
kaydından ayrı tutulur. Profil sorgusundan önce `getUser()` ile kimlik sunucuda
doğrulanır. Şifre sıfırlama ekranı yalnız SDK'nin `PASSWORD_RECOVERY` olayıyla
açılır; URL parametresi tek başına yetki vermez. Başarılı sıfırlama çıkış yapar.

Supabase Authentication > URL Configuration'da Site URL ve izinli dönüş URL'si
test edilecek kesin Preview origininin `/` adresi olmalıdır. Uygulama kayıt ve
sıfırlama isteklerinde aynı origini kullanır. PKCE bağlantısını isteği başlatan
tarayıcıda aç. Preview değişirse izin listesini kontrol et; eski izinleri temizle.

## Test kapsamı

### Google girişi (yalnız geliştirme önizlemesi)

Google Auth Platform'da `nakgo1` projesinin Web application istemcisi kullanılır.
Yetkili JavaScript kaynağı:
`https://nakgo-git-codex-nakgo-email-auth-yagizces-projects.vercel.app`
Yetkili Google yönlendirmesi:
`https://axkotffqrsddbrazhcwj.supabase.co/auth/v1/callback`.
Client ID ve Client Secret yalnız Supabase Authentication > Google sağlayıcısına
girilir. Secret koda, frontend yapılandırmasına veya Vercel değişkenlerine eklenmez.
Skip nonce checks ve Allow users without an email kapalı tutulur. Google Audience
Testing durumundayken test hesabını Test users listesine ekle.

Giriş düğmesi resmi SDK'nin `signInWithOAuth` çağrısını ve mevcut PKCE oturumunu
kullanır; dönüş adresi mevcut originin `/` adresidir. Google dönüşünde hesap
ekranı açılır. Sekmeye özel `ng-google-return` işareti yalnız ekranı seçer;
oturum veya yetki sağlamaz. Profil `getUser()` ile doğrulanır, hesap türü otomatik
tahmin edilmez. İptal edilen giriş tekrar denenebilir; ham sağlayıcı hata metni
gösterilmez. Apple henüz bağlı değildir.

`python tests/auth_google_browser.py` gerçek sabitlenmiş SDK ile sahte OAuth
yönlendirmesi, PKCE challenge/verifier eşleşmesi, iptal/tekrar deneme, çift tıklama,
profil, oturum yenileme ve demo izolasyonunu iki temada 360/390/430 pikselde sınar.
Gerçek Google hesabıyla giriş kullanıcı tarafından ayrıca doğrulanmalıdır.

### E-posta ve ortak oturum testleri

`npm test` yeni `tests/unit/auth.test.js` dosyasını otomatik çalıştırır.
`python tests/auth_browser.py` mevcut Playwright kurulumu ile 360/390/430 pikselde
iki temayı test eder. Gerçek, SRI doğrulanmış SDK kullanır; Auth HTTP yanıtları
mock'tur, e-posta göndermez veya gerçek hesap oluşturmaz. SDK dosyası önceden
indirilmişse `NAKGO_AUTH_SDK_FILE` ile verilebilir; hash yine doğrulanır.
`NAKGO_AUTH_TEST_URL` uzak önizleme üzerinde aynı mock senaryolarını çalıştırabilir.

Kayıt, hatalı giriş, oturum yenileme, profil güncelleme, çıkış, PKCE şifre
sıfırlama, kaçışlama ve demo izolasyonu denetlenir. SQL RLS testi gerçek
geliştirme veritabanında ayrıca geçti. Gerçek e-posta teslimatı, doğrulama
bağlantısı ve kullanıcı girişi önizlemede kullanıcıyla tamamlanmalıdır; mock
tarayıcı testinin geçmesi bunların doğrulandığı anlamına gelmez.

Kaynaklar: [Supabase kullanıcı verisi](https://supabase.com/docs/guides/auth/managing-user-data),
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[SMTP kurulumu ve varsayılan servis sınırları](https://supabase.com/docs/guides/auth/auth-smtp).

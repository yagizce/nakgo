# Cloudflare DEV kabulü — 29 Ekim 2026

Durum: **kısmen hazır**. Meta bağlantısı kapsam dışı; Production geçiş izni yok.
Taban yerel commit `4683484`, dal `codex/nakgo-cloudflare-dev`.

## Google OAuth

DEV Supabase URL Configuration listesine yalnız
`https://nakgo-app-dev.yagizyedek8.workers.dev/` eklendi; kullanıcı Save URLs ile
kaydetti. Site URL ve mevcut Vercel redirect korunuyor. DEV provider zaten açıktı;
Google callback `https://axkotffqrsddbrazhcwj.supabase.co/auth/v1/callback` aynı.
Google Cloud Console erişimi kullanılmadı ve Production OAuth değiştirilmedi.
Kullanıcı gerçek Google hesabını seçerek giriş yaptı; Cloudflare hostunda yönetici
profili ve oturum yenileme görüldü. Gerçek çıkışta panel ve hesap ilanları temizlendi.
Hesap seçiminde var olan Google oturumu etkiliydi; uygulama refactor edilmedi.

## Normal hesap ve güvenlik

Gerçek DEV normal test hesabı Cloudflare hostunda açıldı. Profil yönetici düğmesi
ve WhatsApp taslağı göstermedi; yönetici hesabının kapalı ilanı yerine normal
hesabın kendi iki kapalı ilanı görüldü. Gerçek ilanlar değiştirilmedi.
Anonim doğrudan DEV RPC `nakgo_wa_page`, `nakgo_wa_claim`, `nakgo_wa_purge`: 401;
Cloudflare worker yetkisiz HTTP: 401; sunucu/secret dosya yolları: 404.
42 izole PostgreSQL kontrolü normal kullanıcı, RLS, izin, lease, stale worker,
retry/backoff ve audit sınırlarını geçti. Bunlar gerçek HTTP kabulünün yerine geçmez.

**Eksik:** normal hesabın gerçek JWT'si ile doğrudan WhatsApp/admin/özel dosya
HTTP RPC saldırı matrisi ve başka hesaba ait özel dosya/favori/mesaj erişim testi
bu turda çalıştırılmadı. Tarayıcı aracı oturumdan bağımsız yetkili HTTP istemcisi
sunmuyor; oturum token'ı çıkarılmadı veya yeni erişim token'ı üretilmedi. Sonraki
kabulde aynı normal oturumdan çalıştırılan güvenli test harness veya yetkili
Playwright test oturumu gerekir. UI gizliliği sunucu testi diye sunulmaz.

## Kontrollü kuyruk / CPU

Gerçek DEV'e tek sentetik pakette 5 adet 4096 karakterlik mesaj gönderildi; aynı
paket tekrar teslim edildi. İki yetkili worker eşzamanlı çağrıldı: sonuçlar
5 tamamlanan/0 hata ve 0 tamamlanan/0 hata. Tam olarak 5 taslak oluştu; bekleyen
mesaj 0, hata 0. Duplicate ve eşzamanlı claim sınırı gerçek DEV'de doğrulandı.
Cron ile bir önceki tek mesaj kabulü geçti. Yeni deneyde tam Cron/HTTP çakışması
zamanı zorlanmadı. Gerçek backoff/hata enjeksiyonu uygulanmadı; 42 DB fixture ve
workerd hata testleri bu davranışı izole ortamda doğruluyor.
131073 bayt gövde 413 aldı. Gerçek WhatsApp mesajı veya ilan yayını yapılmadı.

İstemciden ölçülen wall time: webhook ilk/tekrar 1264/892 ms; iki worker
962/1112 ms; büyük gövde reddi 288 ms. Bu değerler ağ dahil uçtan uca süredir.
Cloudflare DEV son 24 saat metrikleri: CPU P50 1,73 / P90 3,05 / P99 4,21 ms;
wall P50 659 ms, P90/P99 yaklaşık 2 s; bellek P50 2,63 / P90 2,66 / P99 2,72 MB.
CPU/bellek aşımı ve uncaught exception 0. Ölçümler tüm dönem trafiğinin dağılımı,
yalnız beş mesajlık çağrının kesin CPU maliyeti değildir; request bazlı trace kapalı.

[Resmi sınırlar](https://developers.cloudflare.com/workers/platform/limits/):
Free 100000 istek/gün, 10 ms CPU/çağrı, 128 MB. Ücretli kaynak/limit değişmedi.
Şimdiki P99 limitin altında; bu bir maksimum yük garantisi değildir. CPU P99
7 ms'yi aşarsa veya limit aşımı oluşursa ilk güvenli öneri batch'i 5'ten 2'ye
indirmek ve aynı kontrollü testi tekrar etmektir; otomatik ücretli plana geçilmez.
Bu öneri mevcut ortak Vercel worker'ını değiştirecek şekilde uygulanmadı.

## Temizlik ve teslim sınırları

Beş sentetik taslak UI üzerinden kaynak metni doğrulanarak reddedildi; önceki
tek taslak da reddedilmiş durumda. Kaynak/audit kayıtları DB retention kapsamında
kaldı, fiziksel silme yapılmadı. Dolayısıyla temizlik yayın kuyruğunu kapatma
seviyesindedir; tüm test satırlarının fiziksel silinmesi tamamlandı denmez.
Geçici META_APP_SECRET kaldırıldı. Kalıcı DEV service/worker secret'ları çalışmayı
sürdürmek için gerekli; sırlar, geçici dosyalar, resimler ve raw sonuçlar Git'e girmez.

Git dalı için `vercel.json` içinde yalnız bu dalın `git.deploymentEnabled=false`
kuralı eklendi; push/PR mevcut Vercel yayını başlatmamalı. Main, PR #38, canlı DNS,
Production ve mevcut Vercel deployment ayarlarına uzak yazma yapılmadı.
GitHub teslimi ayrı Draft PR, base WhatsApp dalı olacak; PR #38 merge edilmez.

Production ön koşulları: normal hesap gerçek HTTP matrisi, fiziksel test verisi
silme, çağrı bazlı yoğun batch CPU kanıtı ve karar verilmiş rollback/kota izleme.
Meta bağlantısı kısıtlama kalkana kadar ayrıca bekler. Bu eksiklerle Production'a
hazır sonucu verilmez; DEV teknik geçişi çalışır ve **kısmen hazır** kabul edilir.

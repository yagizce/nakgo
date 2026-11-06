# 6 Kasım — arşiv ve veri hakları çalışması

Yerel, henüz commit/deploy edilmedi. PR44 dalı `codex/nakgo-group-capacity`.

- İlan RLS'si sahibine de 6 saat sınırı uygular. 198 saatlik arşiv RPC'si,
  ayrı arşiv/iletişim yetkileri, detay erişim kaydı, sayfalama ve kalan süre eklendi.
- Eski yönetici liste/WhatsApp detay yollarından süresi dolan yayına erişim kapatıldı.
- KVKK başvuruları özel tabloda, hesap bazında ve 30 günlük yanıt süresiyle tutulur.
  Ayrı yetkili kuyruk ve uygulama içi başvuru ekranı var. Sonuçlandırma RPC/UI eklendi. Ayrı kapalı anahtar açılırsa yalnız ilişkisi
  bulunmayan hesap silinir; bilinmeyen FK/Storage ve yönetici hesabı korunur.
- Süreli gerekçeli koruma RPC'si ve içerik taşımayan, 3 yıl korunan silme olayları var.
  Eski belirsiz korumalar ve iş/uyuşmazlık bağları otomatik kaldırılmaz.
- Tarih/kaynak/tür/şikâyet filtreleri ve revizyon kontrollü inceleme formu eklendi.
  Süreli koruma formu ayrı KVKK yetkisi ister; mevcut koruma kısaltılamaz.
- Tamamlanmış kaynakların 72 saatlik geçici saklama penceresi ve süresi dolan
  ilanların taslak/audit içerik kopyalarını temizleyen RPC yerelde eklendi.
  Bekleyen/hatalı işler ve hukuki korumalar korunur; purge etkinleştirilmedi.
- Yerel testler: uygulama 677, WhatsApp 63; Guard 70/71. Yeni hesap silme
  sayfası için korumalı V1 çıktı testi değiştiğinden bağımsız kontrol kabulü gerekir;
  kural gevşetilmedi. arşiv/başvuru SQL ve önceki
  storage migration provası geçti. PGlite gerçek Supabase kabulü değildir.

Tamamlanan ekler: mobil/masaüstü arşiv tarayıcı kabulü, gerçek silmenin yalnız
izole fixture'da denenmesi, hesap silme dış web sayfası (taslak), gizlilik ve mağaza
veri envanteri taslağı, restore sonrası yeniden temizleme prosedürü. İlan tombstone'u
telefon/rota/araç/tonaj/hesap bağını temizler; geçmiş bilinmeyen tombstone'lar korunur.

Kalan zorunlu kabul: bağımsız korumalı test incelemesi, güncel DEV salt okunur
census, yeni migration'ların gerçek yedek/restore provası, gerçek DEV HTTP/RLS/CPU,
8 günlük gerçek depolama ölçümü, tam Auth/Storage silme/restore ve imzalı güncel silme
manifesti aktarımı. İlişkili hesaplar otomatik silinmez; tek tek hukuki/veri incelemesi
bekler. Veri sorumlusu unvanı/adresi belli değil; hukuki metin taslak.
DEV census aracı Git dışında `DEV-ARSIV-on-kontrol.cmd`; yalnız okur. Yeni paketi
uygulamaz. Yeni DEV geçişi bu kayıtla onaylanmış sayılmaz.

Durdurulan eski yük testinin Storage aşamasında 2 sentetik bucket temizlenmiş.
Kuyruk temizliğinin son sonucu yok; eski yük testini yeniden başlatmayın. Bilinen
fixture'ı doğrulayarak ayrı temizlik gerekir. Eski test paketleri yeni kaynakla uyuşmaz.
Cron/purge kapalı. Production/main/DNS, mevcut yedekler ve uzak veriler değişmedi.

Son DEV salt okunur census doğrulandı: 14.538.419 bayt; yeni arşiv migrationları
uygulanmamış. Durdurulan fixture: 104 kaynak/103 taslak, izin kaydı 0. Temizlik
henüz yapılmadı. Sıralı migration SHA-256 geçiş planı Git dışı yerel araçlarda.

Yeni taze DEV yedeği şifreli. Native PostgreSQL restore: 60 tablo/465 satır,
60 FK/16 politika envanteri ve eski içerikler eşleşti. Altı migration sıralı
yerel provası geçti, eski değerler korundu. Auth/Storage servis restore kabulü
yapılmadı. Yerel sunucu durmuş; şifresiz geçici restore klasörünün kaldırılması
otomatik komut denetimi nedeniyle kullanıcı işlemi bekliyor. Uzak değişiklik yok.

Geçici restore klasörü kullanıcı tarafından kaldırıldı, yokluğu doğrulandı; şifreli
yedek korunuyor. Ek 20261106080000 migration eski admin users RPC erişimini
privacy_cases yetkisine bağlar; normal/genel admin reddi yerel SQL testinden geçti.
Bu ek native altı-migration provasına dahil değildi; son paket provası bekler.

Bakım RPC/store hata kaydı ve 1–60 dakika retry/backoff eklendi; ham hata
metni kaydedilmez. Yetkili KVKK ekranında başarısız bakım uyarısı gösterilir.
Yeni 20261106090000 yalnız yerel testte: hata, backoff, toparlanma ve yetkisiz
erişim reddi geçti. Tam yerel/native paket provası ve gerçek DEV kabulü bekler.

Son paket native prova aracı mevcut şifreli yedeği kullanacak şekilde hazırlandı;
yeni DEV bağlantısı gerektirmez. Sonuç bekleniyor. Guard tek V1 çıktı allowlist
farkı için 70/71; ayrı inceleme patch/hash paketi yerel release-artifacts altında.
Kontroller atlanmadı. Son KVKK bakım uyarısı tarayıcı testi çalıştırıldı, sonuç bekler.

Sekiz migration son provası şifre çözmede InvalidTag ile durdu; migration
başlamadı. Şifreli kaynaklar korundu, geçici giriş/restore kopyaları kaldırıldı.
Altılı native prova geçerli; sekizli paket doğrulanmadı. Doğru yedek şifreleme
parolasıyla yeniden deneme veya taze DEV yedeği gerekir.

Sekizli son native prova başarılı: eski veriler/özel izinler korundu; geçici
restore ve giriş kopyaları kaldırıldı; şifreli kaynak korundu. Plan SHA-256
eşleşmesi doğrulandı. PR44 uzakta Draft, eski 13df62b paketinde; yeni kaynak
henüz push edilmedi. Guard bağımsız kabulü ve gerçek DEV erişim testleri bekler.

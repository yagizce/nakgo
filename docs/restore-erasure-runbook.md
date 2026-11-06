# Yedek saklama ve geri yükleme sonrası yeniden temizleme

Bu prosedür canlı ortamda otomatik çalışmaz. Mevcut şifreli Production yedekleri
ve bilinmeyen dosyalar silinmez. Yedek saklama süresi henüz hukuk/işletme onayında;
varsayılan bir süre uydurup mevcut yedekleri silmeyin.

1. Yeni yedek tek tutarlı snapshot ile alınır, yerelde şifrelenir, kullanıcı/SYSTEM
   erişimiyle Git dışında saklanır. Şema, RLS, FK, satır içerik hash'leri ve Storage
   envanteri ayrı doğrulanır. Şifreleme parolası parola yöneticisinde tutulur.
2. Silme işlem defterinin son sürümü ve hesap silme sonuçları, geri yüklenecek
   yedekten bağımsız güncel şifreli kopyada korunur. Yedeğin kendi eski silme
   defteri yeterli değildir. Kimlik referansları da kişisel veridir, public rapora girmez.
3. Restore yalnız izole test veritabanına, dış ağ/worker/posta/Meta kapalı yapılır.
   Yedek hash'leri, FK/RLS ve migration uyumu doğrulanır; otomatik bakım açılmaz.
4. Güncel silme defteri ile restore edilen kimlikler karşılaştırılır. Önceden silinen
   ilan ve hesap verileri yeni kopyada yeniden işlem kuyruğuna alınır. Kayıt artık
   hukuki korumadaysa çelişki görevli incelemesine gider; sessizce yayınlanmaz.
5. İlanların 6 saat/198 saat sunucu sınırları ve tüm rutin kopyaları, hesap ilişkileri,
   Storage nesneleri ve eski audit JSON'ları kontrol edilir. Bir tek kopya veya
   açıklanamayan fark varsa kopya kullanıcılara açılmaz.
6. Sentetik restore provasında silinen telefonun/mesajın yeniden okunamadığı,
   normal hesabın özel deftere ulaşamadığı ve tekrar çalışmanın ek zarar vermediği
   doğrulanır. Supabase Auth/Storage servis kabulü düz PostgreSQL testinden ayrıdır.
7. Canlı restore/migration/deploy/DNS ve gerçek veri temizliği ayrıca kullanıcı
   onayı gerektirir. Eski yedeği yeni canlı yazıların üstüne geri yüklemeyin.

Açık teknik iş: hesap silme sonrası bağımsız, şifreli ve imzalı güncel silme
manifesti aktarımı ile tam Auth/Storage restore kabulü. Bu belge bu testlerin
geçtiğini veya otomatik restore güvenliğini iddia etmez.

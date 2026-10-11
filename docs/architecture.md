# Mimari

NakGo bağımlılıksız HTML/CSS/JavaScript uygulamasıdır; React Native değildir. Betikler klasik tek kapsamda çalışır. `tools/project.js` yükleme sırasının tek kaynağıdır: yapılandırma, durum, çekirdek, özellikler, UI, ekranlar, başlatma.

`src/js/features/` ilan/filtre/karşılaştırma, taşıma talebi/mesaj/yükleme onayı, hesap/belge ve Premium kurallarını içerir. `src/js/screens/` ilanlar, oluşturma, işler, profil/mesaj geçmişi ve detayları içerir; main.js yönlendirir. `src/js/ui/` tema/paylaşma/mazot hesabı ve pencere/gezintiyi yönetir. `src/css/` ortak token/bileşen/özellik/hareket/ekran stillerini içerir.

`yy2` mevcut ilan, teklif, sohbet, belge, favori ve üyelik durumunu saklar. `yy-role`, `yy-onb`, `yy-theme`, `yy-seen` korunmuştur. Yeni `ng-post-drafts` ilan formunu ayrı saklar; yayınlanınca ilgili taslak temizlenir. `ng-post-mode` son form türünü korur. `ng-splash` oturum içindir. Mevcut veriyi sıfırlayan şema geçişi yoktur.

Host ortamında `window.claude.use("db")` ve `use("user")` varsa mevcut ortak veri akışı kullanılır. Koleksiyonlar: loads, trucks, offers, msgs, carriers, approvals, ratings, reports. Normal Vercel/PWA bu servisleri sağlamaz; yerel demo çalışır. Ön yüzdeki kurallar sunucu güvenliği yerine geçmez.

Üretilen çıktılar ve kaynak ayrımı kök README'deki dosya tablosunda açıklanır.

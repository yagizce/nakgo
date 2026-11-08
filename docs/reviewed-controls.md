# Test değişiklikleri ve güvenilir kontroller

Ürün testleri düzenlenebilir ve eklenebilir. Guard mevcut test dosyalarının
silinmesini, boş bırakılmasını ve sembolik bağlantıyla değiştirilmesini engeller.
Test sonuçlarını mevcut CI komutları belirler. Ayrı SHA-256 defteri kullanılmaz.

Guard, test çalıştırıcısı, statik ve bağımsız tarayıcı kontrolleri ile GitHub
yapılandırması güvenilir main tabanından korunur. Tarayıcı seçicisi yalnızca
bilinen iki uygulama sözleşmesini kabul eder ve seçilen test dosyasını güvenilir
checkout'taki commit ile doğrular. Test değişiklikleri otomatik birleşmez.

Bu politika main'e alınana kadar CI mevcut main Guard'ını kullanır ve bu
bakım değişikliğini reddeder. Güvenilir kontrol tabanının güncellenmesi ayrı
bakım işlemidir.

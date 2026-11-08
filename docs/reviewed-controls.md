# Test değişiklikleri ve güvenilir kontroller

Ürün testleri düzenlenebilir ve eklenebilir. Guard mevcut test dosyalarının
silinmesini, boş bırakılmasını ve sembolik bağlantıyla değiştirilmesini engeller.
Aday testler çalışır. Ayrı bir CI job'ı main'deki birim, tarayıcı ve SQL
regresyonlarını aday uygulama üzerinde yeniden çalıştırır. Böylece test
dosyasındaki bir düzenleme mevcut regresyonun yerini almaz. Güvenilir bir
regresyonun beklentisini değiştiren ürün değişiklikleri ayrıca incelenir.
Ayrı SHA-256 defteri kullanılmaz.

Guard, test çalıştırıcısı, statik ve bağımsız tarayıcı kontrolleri ile GitHub
yapılandırması güvenilir main tabanından korunur. Bağımsız kontroller ayrı
bir GitHub-hosted job'da yeniden checkout yapar ve aday job'dan yalnız sonucu
alır. Tarayıcı seçicisi yalnızca
bilinen iki uygulama sözleşmesini kabul eder ve seçilen test dosyasını güvenilir
checkout'taki sabit base SHA ile doğrular. Test değişiklikleri otomatik birleşmez.

Bu politika main'e alınana kadar CI mevcut main Guard'ını kullanır ve bu
bakım değişikliğini reddeder. Güvenilir kontrol tabanının güncellenmesi ayrı
bakım işlemidir.

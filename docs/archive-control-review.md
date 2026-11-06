# PR44 kontrol kabul önerisi

Bu dal uygulama veya migration değiştirmez. İnsan incelemesi ve ayrı main onayı bekler.

Kaynak: bd73c9250aff5f1ab224caaa5be1dad4e6acc999, taban: 4d472e994edab239159a62ba66230d179dc16917.

- Yönetici browser fixture'ına yalnız sentetik privacy_cases yetkisi eklenir.
- Kapalı ilan içeriğinin kullanıcı önbelleğinden çıkması ve tekrar düzenlenememesi sınanır.
- Kapatma RPC'si, özel alan whitelist'i, karma kapatma/düzenleme reddi ve hesap değişiminde geç yanıt reddi korunur. İsim göndermeme ürün kuralı doğrulanır.
- Statik allowlist'e yalnız account-deletion.html eklenir; kaynak byte eşitliği ve server/API/.env dışlaması korunur.

Ledger yalnız dört before/after SHA-256 çiftini kabul eder. Başka sürümler veya Guard/workflow değişiklikleri kapsamda değildir. Bu PR açılması incelemenin onaylandığı anlamına gelmez. Koruma ayarları değiştirilmez; otomatik merge açılmaz. Main birleşmesi mevcut Vercel yayını tetikleyebileceğinden ayrı kullanıcı onayı gerekir.

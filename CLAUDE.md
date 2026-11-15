# NakGo

Çalışma kuralları [AGENTS.md](AGENTS.md) ve `.agents/skills/` altındadır; bu dosya yalnızca kısa ektir.

- Kullanıcıyla Türkçe, kısa ve net konuş.
- Dallar `nakgo/` önekiyle açılır.
- Commit mesajlarına ve PR açıklamalarına araç/yapay zekâ imzası, ortak yazar satırı veya oturum bağlantısı eklenmez. Kodda ve belgelerde de bu tür izler bırakılmaz.
- Production veritabanı, main'e birleştirme, canlı yayın ve korumalı test değişiklikleri için ayrı onay alınır.
- Arayüz işlerinde `.claude/skills/ui-ux-pro-max` erişilebilirlik ve tutarlılık kontrol listesi olarak kullanılır; NakGo'nun kendi tasarım dili önceliklidir (bkz. o klasördeki `SOURCE.md`).
- Kod yazma, inceleme ve düzenlemede `.claude/skills/karpathy-guidelines` uygulanır: önce varsayımları söyle, en az kod, yalnız istenen satırlara dokun, başarıyı testle doğrula.

# Kaynak

- Depo: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Yol: `.claude/skills/ui-ux-pro-max`
- Sürüm (commit): `d643997c82e94742dd3bee43210b0198e8bbba3d` (2026-11-14)
- Lisans: MIT (`LICENSE`)
- Alınmayan: `scripts/tests` (yeteneğin kendi geliştirme testleri)

Tek uyarlama: `SKILL.md` içindeki betik yolları `${CLAUDE_PLUGIN_ROOT:-.}` oldu; eklenti
olarak değil proje yeteneği olarak kurulduğunda depo kökünden çalışır. Diğer dosyalar değiştirilmeden alındı. Betikler yalnız yerel veriyi okur; ağa çıkmaz.
`--persist` verilmedikçe dosya yazmaz.

NakGo'da kullanım: Uygulamanın kendi tasarım dili önceliklidir (uygulama turkuaz/sarı
marka, açık/koyu tema; yönetici paneli beyaz zemin, siyah vurgu). Bu yetenek
erişilebilirlik, dokunma alanı, yerleşim ve tutarlılık kontrolü için kullanılır;
hazır palet veya yazı tipi önerileri NakGo kararlarının yerine geçmez.
`--persist` ile depoya tasarım dosyası yazılmaz.

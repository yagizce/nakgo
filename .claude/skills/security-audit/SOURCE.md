# Kaynak

- Depo: https://github.com/cloudflare/security-audit-skill
- Yol: `.claude/skills/security-audit` (depodaki `skills/security-audit`)
- Sürüm (commit): `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14)
- Lisans: MIT (`LICENSE`, deponun kökünden)
- Alınmayan: `validate-findings.test.cjs`, `validate-coverage-ledger.test.cjs` (yeteneğin kendi geliştirme testleri)

Dosyalar değiştirilmeden alındı.

NakGo'da kullanım: Tam denetim yalnız açıkça istendiğinde çalışır. Kod yalnız okunur;
canlı site, production veritabanı ve Supabase/Vercel/Cloudflare hesapları denetimde
sınanmaz. Rapor depo dışına yazılır (`~/security-audit-skill/nakgo/run-<N>`), depoya
denetim dosyası eklenmez. Bulguların düzeltmeleri her zamanki gibi ayrı PR ile ve
onayla yapılır.

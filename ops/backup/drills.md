# Tatbikat ve elle yedek kayıtları

Kural: [docs/backup/runbooks/drills.md](../../docs/backup/runbooks/drills.md). Her satır: tarih, tatbikat ya da işlem,
yedek adı/sıra no, sonuç, süre, notlar. Gizli değer, parola ya da kişisel veri yazılmaz. Elle yedekte (bootstrap, K6b)
notlara kayıttaki `offline` özeti yazılır: seviye (L1/L2), çözen anahtar (A/B), geri yükleme rolü, `reference`
(match/bounds/not_measured), sözleşme durumu; ayrıca paket SHA-256'sı ve K9 anahtar kimliği.

| Tarih | Tatbikat / işlem | Yedek | Sonuç | Süre | Notlar |
|---|---|---|---|---|---|

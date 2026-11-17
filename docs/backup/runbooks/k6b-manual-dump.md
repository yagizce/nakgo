# Runbook: K6b — istisnai elle döküm

> K6 (muafiyet) elle döküm DEĞİLDİR. Bu runbook gerçek bir elle döküm içindir ve **her seferinde ayrı onay** ister.
> `postgres` rolüyle ya da güvenlik denetimini atlayarak döküm alınmaz.

## Ne zaman
Otomatik yedek uzun süre (ör. 24 saati aşan) alınamıyor ve beklemek kabul edilemez bir veri kaybı riski yaratıyorsa.

## Koşullar
1. Yazılı onay: neden, kapsam, süre, kim yapacak.
2. Kimlik bilgisi: yalnız `nakgo_backup` rolü; parola tek kullanımlık olarak yenilenir ve iş bitince tekrar yenilenir.
   Parola sohbete, dosyaya ya da kabuk geçmişine yazılmaz (ortam değişkeni, `HISTCONTROL=ignorespace`).
3. Makine: tam disk şifreli, güncel, yalnız bu iş için kullanılan oturum.
4. Bağlantı: Supavisor oturum modu (5432), `sslmode=verify-full` ve kök sertifika.

## Adımlar
1. A1 yetki denetimini elle çalıştır; `ok` değilse dur.
2. Aynı araçla (`tools/backup/pipeline.cjs`) döküm + S1 + şifreleme. Şifresiz dosya diske yalnız geçici klasörde yazılır.
3. Şifreli dosya ve imzasız (K1 CI'da olduğu için) manifest, `manual/` önekiyle ayrı yüklenir; otomatik kapsama sayılmaz.
4. Geçici klasör silinir; parola yenilenir.
5. Kayıt `ops/backup/drills.md`'ye: tarih, onaylayan, neden, dosya hash'i.

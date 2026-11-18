# Runbook: tatbikatlar

| Tatbikat | Sıklık | Kim | Geçme ölçütü |
|---|---|---|---|
| Çözme + S1 (A anahtarıyla) | Ayda bir | Sahip | Son doğrulanmış yedek çözülür, yerel PG'ye yüklenir, S1 denetimleri geçer |
| Çözme (B anahtarıyla) | Üç ayda bir | İkinci yetkili | Aynı |
| S2b | Ayda bir (yedek sistemi canlıya geçince) | Sahip | `restore-dr.md` adımları, durdurma koşulu yok |
| K2 serbest bırakma | Üç ayda bir, test ortamında | Sahip | Test olayı açılır, belge imzalanır, olay kapanır; aynı belge ikinci kez reddedilir |
| Alarm | Üç ayda bir | Sahip | İzleme Worker'ı test bildirimini ve kalp atışı kesintisini üretir |
| Çatal/geri sarma | Yılda bir, test kovasında | Sahip | Çapa farkı çalışmayı durdurur |

## Kayıt
Her tatbikat `ops/backup/drills.md`'ye bir satır olarak işlenir: tarih, tatbikat, yedek adı/sıra no, sonuç, süre, notlar.
Gizli değer, parola ya da kişisel veri yazılmaz. Kaçırılan tatbikat bir sonraki aşama raporunda açık sorun olarak yer alır.

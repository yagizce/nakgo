# Migration güvenliği: otomatik geri alma yerine ileri düzeltme

Veri kaybı riski olan migration'larda otomatik geri alma (down migration) kullanılmaz.

Sebep: bir sütunu ya da tabloyu silen veya daraltan geri alma, migration'dan sonra yazılmış veriyi de yok eder. Hata çoğu zaman yayından saatler sonra fark edilir. O ana kadar gelen ilanlar, profiller ve yasal kayıtlar geri alma ile kaybolur.

Bunun yerine şema her adımda bir önceki uygulama sürümüyle uyumlu tutulur. Sorun çıkarsa yeni bir migration ile ileri düzeltilir.

## Sınıflandırma

Her migration PR'ında sınıfı yazılır:

| Sınıf | Örnek | Kural |
|---|---|---|
| Ekleyici (güvenli) | Yeni tablo, boş veya varsayılanlı yeni kolon, yeni fonksiyon, yeni indeks (`concurrently`) | Normal inceleme |
| Riskli | Yeni NOT NULL/CHECK kısıtı, tip değişikliği, tabloyu yeniden yazan işlem, büyük güncelleme, politika değişikliği | Son yedeğin geri yüklenmiş kopyasında prova; süre ve kilit ölçümü |
| Yıkıcı | Kolon/tablo silme, daraltma, veri silme | Ayrı onay; taze ve doğrulanmış yedek; en az bir sürüm bekleme |

## Genişlet → taşı → daralt

1. **Genişlet:** Yeni yapı eskisinin yanına eklenir. Eski kod çalışmaya devam eder. API sözleşmesi v0 bozulmaz (`api-contract` bunu denetler).
2. **Taşı:** Uygulama yeni yapıya hem yazar hem okur.
   - Eski veriler küçük partilerle taşınır: parti başına sınırlı satır, `lock_timeout` ve `statement_timeout` ile.
   - Taşıma tekrar çalıştırılabilir (idempotent) olur.
3. **Daralt:** Eski yapı ancak ayrı onayla kaldırılır, ve şu koşullar sağlandıktan sonra:
   - yeni yapı en az bir yayın döngüsü sorunsuz çalıştı;
   - yedek saklama süresi (14 gün) eski veriyi kapsıyor;
   - eski istemciler emekliye ayrıldı.
   - Önce silmek yerine kullanım dışı adlandırma (`_deprecated`) ve yetki kaldırma yapılır, silme sonraki adımdır.

## Sorun çıkarsa

- **Uygulama hatası:** Kod bir önceki sürüme döner. Şema genişletme aşamasında olduğundan eski kod çalışır. Migration geri alınmaz.
- **Migration hatası:** Uygulanmış migration dosyası asla düzenlenmez. Düzeltme yeni bir migration'dır. Bu migration yerel PostgreSQL'de şunlardan geçtikten sonra uygulanır:
  - `schema-check`;
  - `api-contract`;
  - kasıtlı bozma testleri;
  - SQL fixture'ları.
- **Bozulmuş veri:** Zarar gören satırlar düzeltme migration'ı ile onarılır. Gerekirse son doğrulanmış yedek yalıtılmış ortama geri yüklenir ve oradan seçili veri taşınır. Production'ın tamamen yedekten dönmesi en son çare olur; 24 saate kadar veri kaybı demektir ve ayrı onay gerektirir.

## Her migration için kontrol listesi

1. Yerel PostgreSQL'de ve PGlite'ta `npm run test:db` geçer.
2. Şema değiştiyse `node tools/schema-check.cjs --update`. Oluşan fark PR'da satır satır incelenir.
3. Sözleşme değişikliği yalnız ekleyiciyse `supabase/contract/v0.json` ve `docs/api/contract-v0.md` güncellenir. Değilse v1 planlanır.
4. Riskli veya yıkıcı migration'da son yedeğin yalıtılmış kopyasında prova yapılır; süre ve kilitler rapora yazılır
   (araç ve ölçütler: [backup/runbooks/migration-rehearsal.md](backup/runbooks/migration-rehearsal.md)).
5. Migration başında `set lock_timeout = '5s'` ve uygun bir `statement_timeout` bulunur.
6. Production'a uygulama her zaman ayrı onayla yapılır.

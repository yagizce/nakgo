# CI: HTTP, supabase-js ve Workers testleri

İş akışı: `.github/workflows/db-http.yml` (`NakGo HTTP and Workers`). Mevcut iş akışları değişmedi; bu ayrı bir iştir.
Dal koruma kurallarına zorunlu kontrol olarak eklenmesi GitHub ayarıdır ve ayrı onay ister.

## Bu işle CI'a eklenenler
| Test | Neden koşmuyor | Önerideki çözüm |
|---|---|---|
| `tests/db/*-http.test.cjs` (PostgREST üzerinden v1 uçları) | CI'da PostgREST yok | PostgREST 12.2.3 sabit sürüm, SHA-256 doğrulamalı indirme |
| `tests/db/api-v1-client-http.test.cjs` (gerçek supabase-js + uygulama kodu) | supabase-js ve PostgREST yok | `@supabase/supabase-js@2.117.3` (uygulamanın sabitlediği sürüm) geçici dizine |
| `tests/db/worker-role.test.cjs` PostgREST/workerd adımları | PostgREST ve Miniflare yok | aynı iş |
| `tests/server/workerd.test.mjs` | Miniflare yok | `miniflare@4.20260730.0` geçici dizine |

## Güvenlik
- Gizli anahtar, GitHub Secret, Environment, canlı hesap ya da production/DEV bağlantısı **yok**. Veritabanı CI içindeki
  geçici `postgres:17` servisidir; PostgREST JWT sırrı ve `authenticator` parolası test sırasında rastgele üretilir ve
  süreç bitince yok olur.
- İzinler: yalnız `contents: read`. Ek GitHub izni gerekmez.
- Dış indirmeler sabit sürümlü; PostgREST arşivi SHA-256 ile doğrulanır
  (`9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c`, yerelde indirilip doğrulandı). npm paketleri
  sürüm sabitli ve depo dışına (`$RUNNER_TEMP`) kurulur; depo bağımlılık eklemez.
- Miniflare, workerd ikili dosyasını npm'in platform paketinden alır; `--ignore-scripts` kullanılmadı. İlk koşuda kurulum
  süresi ve ikilinin doğru indirildiği görülmeli.


## Yerelde aynı koşu
```
NAKGO_PG_HOST=... NAKGO_PG_PASSWORD=... NAKGO_POSTGREST_BIN=/yol/postgrest \
NAKGO_MINIFLARE=/yol/node_modules/miniflare/dist/src/index.js NODE_PATH=/yol/node_modules \
node --test tests/db/*-http.test.cjs tests/db/worker-role.test.cjs && node --test tests/server/*.test.mjs
```

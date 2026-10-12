# Kalite kapısı ve otomatik birleşme

`quality-gate.yml` main hedefli tüm PR'larda çalışır. Mevcut `npm test`, 305 kontrol ve mevcut Chromium E2E paketi korunmuştur. `checks.yml` de çalışmaya devam eder. Yeni bağımsız paket 390×844 ve 393×852 ekranlarda iki tema, gezinti/sheet, form ve çift tıklama, filtre/boş sonuç, tutarsız taşıma talebi, kabul/red/süre, storage ve refresh, deep-link, PWA varlıkları ve kullanıcı metni güvenliğini sınar.

Yerelde:

```sh
npm ci --ignore-scripts
npm test
npm run test:guard
npm run test:gate
npm run test:static
npm run test:e2e
npm run test:browser
npm audit --omit=dev --audit-level=high
```

Browser kurulumu [geliştirme belgesindedir](development.md). Guard'ın karşılaştırma tabanı `origin/main`dir; başka tabanı yalnızca kontrollü bakım doğrulamasında `node tests/guard.js --base-ref <sha>` ile seçin. Actionlint 1.7.12 GitHub Actions YAML/ifade denetimini yapar; CI indirdiği dosyanın sabit SHA-256 değerini doğrular. Uygulamaya runtime bağımlılığı eklenmemiştir.

## Güven sınırı

CI kontrol kodunu PR'dan değil olayın base commit'indeki main kopyasından çalıştırır. Mevcut tests/run.js, birim/E2E dosyaları ve kontrol araçlarının değiştirilmesi/silinmesi guard'ı başarısız kılar; test komutları kaldırılamaz veya başka komutla değiştirilemez. Ek test dosyaları test edilebilir, fakat tests/ veya .github/ değişikliği içeren PR otomatik birleşmez. Koruma ve test tabanını güncellemek ayrı, insan tarafından incelenen bakım işidir; olağan uygulama değişiklikleri bu dosyaları değiştirmez.

İlk kurulumda main üzerinde kontrol dosyaları henüz yoktur. Yalnızca `1a626359026a08f2e5658ba28fb8ed4eb6d9ee00` tabanında bootstrap istisnası vardır; bu kurulum PR'ı tüm kontroller geçtikten sonra incelemeyle birleştirilir. Sonraki PR'larda main kopyası zorunludur. İlk kurulum PR'ı kendi kendini otomatik birleştiremez.

`run-name` PR numarası, head SHA ve base SHA'yı çalışma kaydına bağlar. Yeni commit geldiğinde eski başarılı sonuç kullanılamaz; main ilerlerse dal güncellenmeli ve testler yeniden çalışmalıdır. Skipped, cancelled, neutral, timed-out veya eksik adımlar başarı sayılmaz. Kurulum sonrası main dalı için `quality-gate` ve mevcut `verify` sonuçları, güncel taban ve PR şartı zorunlu olmalıdır; kural yöneticiler için de uygulanmalıdır.

## Otomatik birleşme

`auto-merge.yml`, yalnızca kalite ve mevcut kontrol iş akışlarının tamamlanmasını dinler. Yazma izni olan job PR kodu, PR cache'i veya PR artefaktı çalıştırmaz; main üzerindeki küçük API denetçisi kullanılır. [GitHub'ın workflow_run güvenlik sınırı](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) bu ayrımı gerektirir.

Birleşme için aynı repository içinde `codex/` ile başlayan head, main hedefi, draft olmayan açık PR, çakışmasız/güncel dal, aynı son head/base için başarılı quality-gate ve NakGo checks, tüm gerekli adımlarda success ve başka bekleyen/başarısız kontrol olmaması gerekir. Fork ve diğer dal adları kapsam dışıdır. Main dal koruması veya zorunlu kontrol adları bulunmazsa denetçi birleşmez. Son API çağrısı beklenen head SHA ile squash yapar; [GitHub dal koruması](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) eşzamanlı main değişikliğini ve başarısız zorunlu kontrolleri engeller.

Başarısız PR main'e birleşmez; böylece mevcut Vercel Git entegrasyonunun Production yayını tetiklenmez. Başarılı uygun PR otomatik squash birleşir ve Vercel main yayını mevcut şekilde sürdürür. Manuel doğrudan main gönderimleri de PR/zorunlu kontrol korumasına tabidir. Runtime veritabanı, kimlik doğrulama ve ödeme bu görevin kapsamı değildir.

## Sınırlar

Bu paket statik uygulamanın yerel/demo davranışını ve güvenli render'ını doğrular; gerçek backend, gerçek ödeme, iki ayrı gerçek kullanıcı veya fiziksel telefon/Safari doğrulaması değildir. npm audit yalnızca production bağımlılıklarında high/critical bulguda fail eder; ağ/registry hatasında da sonuç bilinmediği için kapı kapalı kalır. Güvenlik metin denemeleri script, img onerror, svg onload, attribute kırma ve javascript: dizgilerini açıklama/ad/not/mesaj çiziminde kullanır. Bu kontroller güvenlik incelemesinin yerine geçmez.

## Kurulum doğrulaması — 12 Ekim 2026

PR #9, iki workflow başarılı olduktan sonra squash ile birleştirildi. Kaydedilmiş main kuralı quality-gate ve verify kontrollerini yalnızca GitHub Actions kaynağından kabul ediyor; PR ve güncel taban şartı ile yönetici bypass engeli etkin. Kontrol devam ederken GitHub birleşme isteğini 405 ile reddetti; eski başarılı çalışma yeni çalışmanın yerine geçmedi.

Kurulum sürümünde npm test 309/309, mevcut E2E 406/406, bağımsız browser 184 kontrol/10 senaryo, guard 29/29, statik 50/50 ve otomasyon 16/16 geçti. HTML ve actionlint temiz; npm audit sıfır bulgu. Bağımsız testler 390×844 ve 393×852, iki temada çalıştı. Çift yayın click sonrasında eski formun yeniden okunması testte yakalandı ve iki küçük düğme korumasıyla düzeltildi.

Bu belge güncellemesi, kontrol kodunu değiştirmeden kurulum sonrası main tabanlı kalite kapısı ve otomatik birleşmenin gerçek PR akışını doğrular.

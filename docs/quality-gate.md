# Kalite kapısı

`quality-gate.yml` main hedefli PR'larda çalışır. `npm test`, mevcut Chromium E2E ve `checks.yml` korunur. Bağımsız paket iki temada gezinti, form, filtre, storage, deep-link, PWA ve kullanıcı metni güvenliğini sınar.

Yerelde:

```sh
npm ci --ignore-scripts
npm test
npm run test:gate
npm run test:static
npm run test:e2e
npm run test:browser
npm audit --omit=dev --audit-level=high
```

Browser kurulumu [geliştirme belgesindedir](development.md). Actionlint 1.7.12 GitHub Actions YAML/ifade denetimini yapar; CI indirdiği dosyanın sabit SHA-256 değerini doğrular. Uygulamaya runtime bağımlılığı eklenmemiştir.

## Güven sınırı

CI bağımsız kontrol kodunu olayın base commit'indeki main kopyasından çalıştırır. `tests/` veya `.github/` değişikliği içeren PR otomatik birleşmez. Aday testleri ayrı çalışır ve zorunlu güvenilir regresyonların yerine geçmez.

`pull_request_target`, kalite workflow'unu güvenilir `main` commit'inden yükler. Önce GitHub API'sinden açık PR ve iki ebeveynli test birleşim commit'i doğrulanır. Aday testleri, geri yüklenmiş güvenilir regresyonlar ve bağımsız kontroller üç ayrı GitHub-hosted runner'da çalışır. Test işlerinde yazma izni, App sırrı, aday artefaktı veya paylaşılan cache yoktur. Bağımlılık denetimi aday `.npmrc` dosyasından bağımsız bir geçici dizinde yapılır.

Sonuç yalnız taze bir runner'daki `publish` işi tarafından yayımlanır. Bu iş yalnız güvenilir ref'i alır, aday kodu çalıştırmaz ve PR'ın hâlâ aynı base/head/test birleşim SHA'larında olduğunu tekrar doğrular. `nakgo/trusted-ci` sonucunun kaynağı, yalnız bu depoya kurulu ayrı GitHub App'tir. `verify` mevcut adıyla zorunlu kalır. Eski `quality-gate` check adı yerine App sonucu zorunlu olur. App sonucu Quality Gate'in üç işini birlikte gerektirir. Aday test sonucu güvenilir regresyonun yerine geçmez.

Sonuç test birleşim SHA'sına yazılır. Head veya base değiştiğinde yeni test birleşim SHA'sı gerekir. Atlanan, iptal edilen veya başarısız işlerde App başarısı yayımlanmaz. Main ilerlerse PR dalını güncelleyip yeni çalışmayı tetikleyin.

## İlk geçiş ve geri dönüş

Bu işlemler ayrı yönetici onayı gerektirir. Uygulama ve veritabanı PR'ları ayrı kalır. Bakım dalı `codex/nakgo-trusted-ci` ve `main` için Vercel Git deploy kapalıdır. İki ref'i ve Vercel proje ayarını işlemden önce doğrulayın.

1. Depo sahibi yalnız `nakgo` için özel bir GitHub App kurar. Yetki `Checks: Read and write` ve GitHub'ın zorunlu `Metadata: Read` erişimiyle sınırlıdır. Webhook ve kullanıcı yetkisi gerekmez. App anahtarı yalnız `nakgo-ci-publisher` GitHub ortam sırrı `NAKGO_CI_APP_KEY` olarak saklanır. Ortam değişkenleri `NAKGO_CI_APP_ID` ve `NAKGO_CI_INSTALLATION_ID` değerlerini içerir. Ortamda yalnız `main` ve ilk kurulum için kilitli `codex/nakgo-trusted-ci` dalı seçilir. Tag ve wildcard eklenmez. App anahtarı repo seviyesinde tanımlanmaz.
2. Main tabanlı bakım PR'ını Draft açın. Tam head SHA'yı doğrulayın, bakım dalını yazma/silme/force-push'a karşı kilitleyin ve ancak bundan sonra ortam kuralına ekleyin. Geçiş sırasında açık başka main PR'larının birleşmesini durdurun. Vercel dal kontrolünü ve gerekli dal korumasını gözden geçirin.
3. İncelenen kaynağı `gh workflow run quality-gate.yml -R yagizce/nakgo --ref codex/nakgo-trusted-ci -f pr=<numara>` ile çalıştırın. Bu dosyanın yolu mevcut main'de de bulunur. GitHub dispatch'i kabul etmiyorsa eski kontrolü kaldırmayın. Run'ın kaynak SHA'sı, PR head SHA'sı ve kilitli ref eşleşmeli. `gh run watch <run-id> -R yagizce/nakgo --exit-status` ile tamamlanmasını bekleyin. Aynı adlı GitHub Actions check'inin App kimliğine sahip olmadığını ve sonucun PR'ın güncel test birleşim SHA'sında doğru App'ten geldiğini kontrol edin.
4. Önce mevcut kuralı yedekleyin. Eski zorunlu `quality-gate` bağlamını yalnız doğrulanmış App sonucu hazırsa, aynı API çağrısında App bağlamıyla değiştirin. `verify`, strict güncellik, yönetici uygulaması, PR şartı ve diğer korumalar sürer. Yanlış App, yanlış SHA, eksik/atlanmış iş veya yeni main/PR commit'i varsa durun.

```bash
repo=yagizce/nakgo
checks="repos/$repo/branches/main/protection/required_status_checks"
gh api "$checks" > old-checks.json
gh api "repos/$repo/branches/main/protection/enforce_admins" --jq .enabled
gh api "repos/$repo/commits/$merge_sha/check-runs" \
  --jq '.check_runs[] | select(.name=="nakgo/trusted-ci") | [.head_sha,.app.id,.conclusion,.details_url]'
# app_id ve merge_sha değerlerini yukarıdaki kanıtla doğrulayın.
jq -e --argjson id "$app_id" '
  select(.strict and ([.checks[] | [.context,.app_id]] | sort) ==
    [["quality-gate",15368],["verify",15368]]) |
  {strict,checks:[.checks[] | if .context=="quality-gate" then
    {context:"nakgo/trusted-ci",app_id:$id} else . end]}' old-checks.json > new-checks.json
# jq başarılıysa ve head/base/merge tekrar eşleşiyorsa yetkili yönetici uygular.
gh api -X PATCH "$checks" --input new-checks.json
gh api "$checks"
# Ayrı birleşme onayından sonra, Draft durumunu kaldırıp yalnız doğrulanan SHA'yı squash edin.
gh pr ready "$pr" -R "$repo"
gh pr merge "$pr" -R "$repo" --squash --match-head-commit "$head_sha"
```

Birleşmeden önce hata oluşursa eski kuralı `jq '{strict,checks}' old-checks.json | gh api -X PATCH "$checks" --input -` ile geri yükleyin ve yeniden okuyun. Birleşme sonrasında önce main tabanlı bir deneme PR'ında yeni workflow'u ve App kaynağını doğrulayın, ardından ortamdan bootstrap dalını çıkarın. Yeni main üzerinde hata varsa App zorunluluğu birleşmeleri kapalı tutar. Geri dönüş için eski güvenilir CI dosyalarını bir geri alma PR'ında doğrulayın. Önceki kaynak ve kuralın yeniden kurulması ayrı yönetici işlemi gerektirir.

## Otomatik birleşme

Eski `auto-merge.yml` ve denetçisi `pull_request` kaynaklı kalite koşulunu beklediğinden App geçişinden sonra otomatik birleşmeye izin vermez. Birleşmeler GitHub'ın zorunlu App kontrolü altında yapılır. Eski otomasyonun ayrı güvenlik testleri korunur.

## Sınırlar

Güvenilir regresyon işi adayın sabit head SHA'sındaki `tools/project.js`
dosyasından mevcut bağımsız tarayıcı seçicisiyle ürün sözleşmesini belirler.
Test ve araçlar PR'ın sabit base SHA'sından geri yüklenir. Eski ürünün
kontrolleri aynen çalışır. Eski tabandan Ara/WhatsApp sözleşmesine geçişte
yalnızca güvenilir base commit'teki `tests/gate/product-replay.patch` uygulanır.
Güncel ürün tabana girdikten sonra kendi güvenilir testleri doğrudan çalışır.
Bu fark eski arayüz beklentilerini günceller ve RLS/Storage için yalnız PGlite içinde
`service_role` oluşturur. Kaydedilen ilanların ham telefon alanını istememesi
denetimi iki sözleşmede de korunur. Bakım PR'ı eski güvenilir tabana karşı
çalışırken bu tabanın regresyon paketi olduğu gibi çalışır. Uyuşmayan manifest,
base veya test farkı işi başarısız kılar.

Bu paket statik uygulamanın yerel/demo davranışını ve güvenli render'ını doğrular; gerçek backend, gerçek ödeme, iki ayrı gerçek kullanıcı veya fiziksel telefon/Safari doğrulaması değildir. npm audit yalnızca production bağımlılıklarında high/critical bulguda fail eder; ağ/registry hatasında da sonuç bilinmediği için kapı kapalı kalır. Güvenlik metin denemeleri script, img onerror, svg onload, attribute kırma ve javascript: dizgilerini açıklama/ad/not/mesaj çiziminde kullanır. Bu kontroller güvenlik incelemesinin yerine geçmez.

## Kurulum doğrulaması — 12 Ekim 2026

PR #9, iki workflow başarılı olduktan sonra squash ile birleştirildi. Kaydedilmiş main kuralı quality-gate ve verify kontrollerini yalnızca GitHub Actions kaynağından kabul ediyor; PR ve güncel taban şartı ile yönetici bypass engeli etkin. Kontrol devam ederken GitHub birleşme isteğini 405 ile reddetti; eski başarılı çalışma yeni çalışmanın yerine geçmedi.

Kurulum sürümünde npm test 309/309, mevcut E2E 406/406, bağımsız browser 184 kontrol/10 senaryo, guard 29/29, statik 50/50 ve otomasyon 16/16 geçti. HTML ve actionlint temiz; npm audit sıfır bulgu. Bağımsız testler 390×844 ve 393×852, iki temada çalıştı. Çift yayın click sonrasında eski formun yeniden okunması testte yakalandı ve iki küçük düğme korumasıyla düzeltildi.

Bu belge güncellemesi, kontrol kodunu değiştirmeden kurulum sonrası main tabanlı kalite kapısı ve otomatik birleşmenin gerçek PR akışını doğrular.

## Güncel DEV geçiş engeli — 26 Ekim 2026

DEV `b0df3bdf987daed91b952ccbd92b3da6313f798f`, main
`5b46c28f03528a3ae9e4ada25bb6405a268a8a5a` tabanına karşı 35/40 guard sonucu
verdi. Ayrı güvenilir inceleme gereken beş fark: `tests/e2e.py`, `tests/forms.py`,
`tests/reliability.py`, `tests/gate/browser.py` ve `tools/project.js`.
Son dosya yönetici ekranını yükleme sırasına ekler. Başarılı uygulama/admin CI
bu engeli kaldırmaz. Kontrol tabanını değiştirerek veya guard/workflow'u
gevşeterek main'e geçilmez.

Aynı tarihte Production Vercel yayını yukarıdaki main commit'inde READY idi;
Supabase Production projesi duraklatılmıştı. Hesap bağlantısı değişkenleri yalnız
Preview dallarında vardı; kaynak Auth config'i Production'da bağlantıyı kapatır.
Geçişten önce PROD şeması/migration geçmişi, Auth/SMTP/OAuth dönüş adresleri,
private Storage, tek yönetici ataması ve geri dönüş planı ayrı doğrulanmalıdır.
DEV verileri/üyelikleri PROD'a otomatik taşınmaz. Bu kayıt yayıma geçiş onayı
değildir; yeni oturumda ortam durumu tekrar kontrol edilir.

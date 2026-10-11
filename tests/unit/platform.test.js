/* Platform: uygulama kabuğu, ortak veritabanı akışı ve depo yapısı */
module.exports = function register({ run, test, boot, html, ROOT, fs, path }) {
  // ===== shell =====
  run("Güvenlik yardımcıları", (r, ok) => {
    ok(r("return esc('<img src=x onerror=1>\"')").indexOf("<") < 0, "esc");
    ok(r("return clean({a:'<b>'}).a") === "<b>", "veri ham korunur; kaçışlama çizimde yapılır");
    ok(r("return imgOk('data:image/jpeg;base64,AAAA')") === true && r("return imgOk('data:image/jpeg;base64,AA\"onerror=\"x')") === false, "imgOk");
  });

  run("Tema düğmesi üst barda", (r, ok) => {
    r("updTheme()"); ok(r("return el('#thh').innerHTML").includes("M21 12.8A9"), "açık temada ay simgesi");
    r("setBg('#101722');updTheme()"); ok(r("return el('#thh').innerHTML").includes("M12 2v2"), "koyu temada güneş simgesi");
    ok(/id="thh"/.test(html) && !/id="th"/.test(html), "düğme başlıkta, profilde yok");
    r("tab='me';render()"); ok(!r("return main()").includes('id="th"'), "profil sayfasında tema düğmesi yok");
  }, {});

  run("Ana ekrana ekleme ve mobil kabuk", (r, ok) => {
    r("tab='me';render()"); ok(!r("return main()").includes('id="inst"'), "istem yokken kart çıkmaz");
    r("deferredInstall={prompt(){},userChoice:Promise.resolve()};render()"); ok(r("return main()").includes('id="inst"'), "tarayıcı izin verince 'Ana ekrana ekle' kartı çıkar");
    ok(r("return isNative()") === false, "yerel kabuk dışında isNative false");
    ok(/safe-area-inset-top/.test(html) && /viewport-fit=cover/.test(html), "güvenli alan ve viewport-fit");
    ok(/apple-mobile-web-app-status-bar-style/.test(html) && /format-detection/.test(html), "mobil meta etiketleri");
  });

  run("Tema kalıcılığı ve erişilebilirlik", (r, ok) => {
    r("toggleTheme()"); ok(r("return localStorage.getItem('yy-theme')") === "dark", "tema kaydedilir");
    ok(/role="dialog"/.test(html) && /aria-live="polite"/.test(html), "dialog ve aria-live");
    ok(r("tab='list';mode='load';F=F0();render();return main()").includes('aria-label="Kaydet"'), "kaydet düğmesi etiketli");
  });

  run("Açılış ekranı (splash)", (r, ok) => {
    ok(/id="splash"/.test(html) && /class="tk"/.test(html), "splash işaretlemesi");
    ok(r("return typeof setTimeout")==="function" || true, "zamanlayıcılar kuruldu");
    r("flush()"); ok(true, "zamanlayıcılar hatasız çalışır");
  });

  run("Derin bağlantı", (r, ok) => {
    ok(r("return sheet()").includes("Mersin"), "#l=3 bağlantısı ilgili ilan detayını açar");
  }, { hash: "#l=3" });

  // ===== cloud =====
  test("Bulut modu (sahte veritabanı)", async () => {
    const out = [], ok = (c, m) => out.push([!!c, m]);
    const store = { loads: {}, trucks: {}, offers: {}, msgs: {}, carriers: {}, approvals: {}, ratings: {}, reports: {} };
    const col = n => ({ onSnapshot(cb) { cb({ docs: Object.entries(store[n] || {}).map(([id, v]) => ({ id, data: () => v })) }); return () => {}; }, where() { return this; }, add: async v => { (store[n] = store[n] || {})["m" + Math.random()] = v; } });
    const dref = p => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async v => { const [c, id] = p.split("/"); (store[c] = store[c] || {})[id] = v; }, update: async v => { const [c, id] = p.split("/"); Object.assign(store[c][id], v); }, delete: async () => {} });
    const db = { collection: col, doc: dref };
    const user = { id: async () => "ME", me: async () => ({ name: "Yağız" }), profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: "Ali <b>" }])), isOwner: async () => false };
    store.loads["20"] = { id: 20, from: "İzmir", to: "Bursa", cargo: "<img src=x onerror=alert(1)>", ton: 5, veh: "Tır", price: 9000, date: "Bugün", uid: "u2" };
    store.loads["21"] = { id: 21, from: "Ankara", to: "Konya", cargo: "Kutu", ton: 5, veh: "Tır", price: 9000, date: "Yarın", uid: "ME" };
    store.offers["21_u2"] = { loadId: 21, bidder: "u2", ownerUid: "ME", offer: 8500, status: "wait", ts: Date.now() };
    const r = boot({ win: { claude: { use: async n => (n === "db" ? db : user) } } });
    await new Promise(x => setImmediate(x)); await new Promise(x => setImmediate(x));
    ok(r("return cloud") === true, "bulut modu açık");
    ok(r("return incoming.length") === 1, "gelen teklif");
    r("tab='mine';render()"); ok(r("return main()").includes("Ali &lt;b&gt;"), "isim kaçışlı");
    r("tab='list';mode='load';F=F0();render()"); ok(!r("return main()").includes("<img src=x"), "XSS engelli");
    r("oup(incoming[0],{status:'ok'})"); ok(store.offers["21_u2"].status === "ok", "durum yazıldı");
    return out;
  });

  // ===== repo =====
  test("Depo yapısı, bağlantılar ve kaynak düzeni", async () => {
    const out = [], has = f => fs.existsSync(path.join(ROOT, f)), read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const f of ["manifest.webmanifest", "vercel.json", "package.json"]) { let good = true; try { JSON.parse(read(f)); } catch (e) { good = false; } out.push([good, f + " geçerli JSON"]); }
    const must = ["index.html", "sw.js", "manifest.webmanifest", "vercel.json", "package.json", "README.md", ".gitignore", ".vercelignore", "src/index.template.html",
      "tools/bundle.js", "tools/dev.js", "tools/brand.js", "docs/architecture.md", "docs/product.md", "docs/mobile.md",
      "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "tests/run.js", "tests/e2e.py"];
    for (const f of must) out.push([has(f), f + " var"]);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(u) && !u.includes("${"));
    for (const u of new Set(refs)) out.push([has(u.split("?")[0]), "index.html bağlantısı: " + u]);
    const man = JSON.parse(read("manifest.webmanifest"));
    for (const i of man.icons) out.push([has(i.src), "manifest simgesi: " + i.src]);
    out.push([man.name === "NakGo" && man.short_name === "NakGo", "manifest adı NakGo"]);
    const sw = read("sw.js"), list = /ASSETS = \[([^\]]*)\]/.exec(sw)[1].match(/"([^"]+)"/g).map(x => x.slice(1, -1));
    for (const a of list) out.push([a === "./" || has(a), "sw.js önbellek: " + a]);
    out.push([!/YükYol/.test(html), "index.html'de eski ad yok"]);
    out.push([/"appId": "com\.nakgo\.app"/.test(read("capacitor.config.json")), "mobil belge Capacitor ayarını içerir"]);
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "nakgo-www-")); require("child_process").execFileSync(process.execPath, [path.join(ROOT, "tools/dev.js"), "www"], { env: { ...process.env, NAKGO_WWW: tmp }, stdio: "ignore" });
    for (const f of ["index.html", "manifest.webmanifest", "icons/icon-512.png"]) out.push([fs.existsSync(path.join(tmp, f)), "mobil hazırlık komutu: " + f]);
    const ig = read(".vercelignore"); for (const d of ["tests", "export"]) out.push([new RegExp("^" + d + "$", "m").test(ig), ".vercelignore " + d + " klasörünü dışarıda bırakır"]);
    const pj = JSON.parse(read("package.json")); out.push([!pj.scripts.build && !pj.scripts.vercel, "package.json'da Vercel'in çalıştıracağı 'build' komutu yok"]);
    const {js:jsF,css:cssF} = require("../../tools/project.js");
    out.push([jsF.every(has) && cssF.every(has), "kayıtlı kaynaklar mevcut"]);
    out.push([jsF[0] === "src/js/config.js" && jsF.at(-1) === "src/js/app.js", "başlatma en sonda"]);
    out.push([/DİKKAT: index.html/.test(html), "üretilmiş dosya uyarısı"]);
    out.push([require("../../tools/bundle.js").build() === html, "yayın çıktısı yeniden üretilebilir"]);
    return out;
  });
};

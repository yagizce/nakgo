/* NakGo hızlı testleri (Node, tarayıcı gerekmez): sahte DOM ile index.html içindeki betiği çalıştırır.
   Çalıştır:  npm test   (önce bundle ve lint kontrolü, sonra bu dosya)  veya  node tests/run.js
   Gerçek tarayıcı için: npm run test:e2e. Gerçek telefon ve gerçek veritabanı testinin yerini tutmaz.

   Yeni test için tests/unit/ altına şu biçimde bir dosya ekle (adı *.test.js olmalı):
     module.exports = function register({ run, test, boot, html, ROOT, fs, path }) {
       run("Ad", (r, ok) => { ok(r("return 1") === 1, "açıklama"); });
     };
   r("kod") uygulama kapsamında kod çalıştırır (durum korunur), ok(koşul, açıklama) bir kontrol kaydeder. */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname,"..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function boot({ win, hash = "", onboarded = true, initialStore = {} } = {}) {
  const els = {};
  const mk = () => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, value: "", innerHTML: "", textContent: "", className: "", scrollTop: 0, children: [], querySelectorAll() { return []; }, querySelector() { return mk(); }, focus() {}, appendChild() {}, setSelectionRange() {} });
  const document = { querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], documentElement: { dataset: {} }, createElement: () => mk() };
  const store = { ...(onboarded ? { "yy-onb": "1" } : {}), ...initialStore };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } };
  let bg = ""; const timers = [];
  const ctx = {
    document, localStorage, getComputedStyle: () => ({ getPropertyValue: () => bg }), setTimeout: f => { timers.push(f); return 0; },
    navigator: {}, location: { hash, host: "test", origin: "https://test", pathname: "/" }, window: win, claude: win && win.claude,
    setBg: v => { bg = v; }, flush: () => { while (timers.length) timers.shift()(); }, main: () => (els["#main"] || mk()).innerHTML, sheet: () => (els["#sheetBody"] || mk()).innerHTML, el: s => els[s] || (els[s] = mk()),
  };
  // Uygulama betiği bir kez çalıştırılır; r("kod") aynı kapsamda kod çalıştırır (durum korunur).
  new Function("ctx", "const {document,localStorage,getComputedStyle,setTimeout,navigator,location,window,claude,setBg,flush,main,sheet,el}=ctx;\n" + script + "\nctx.ev=c=>eval(c);")(ctx);
  return code => ctx.ev("(()=>{" + code + "})()");
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Gövde içinde: r("kod") -> uygulama kapsamında kod çalıştırır ve sonucunu döndürür.
const run = (name, steps, opts) => test(name, async () => {
  const out = [], ok = (c, m) => out.push([!!c, m]), r = boot(opts);
  await steps(r, ok); return out;
});

const H = { fs, path, ROOT, html, script, boot, test, run, tests };
for (const f of fs.readdirSync(path.join(__dirname,"unit")).filter(x => x.endsWith(".test.js")).sort()) require("./unit/" + f)(H);

(async () => {
  let fail = 0, total = 0;
  for (const [name, fn] of tests) {
    try { const res = await fn(); const bad = res.filter(x => !x[0]); total += res.length; fail += bad.length;
      console.log((bad.length ? "✗ " : "✓ ") + name + (bad.length ? "  -> " + bad.map(b => b[1]).join("; ") : ""));
    } catch (e) { fail++; total++; console.log("✗ " + name + "  -> HATA: " + e.message + (process.env.DEBUG ? "\n" + e.stack : "")); }
  }
  console.log(`\n${total - fail}/${total} kontrol geçti`);
  process.exit(fail ? 1 : 0);
})();

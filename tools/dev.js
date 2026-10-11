#!/usr/bin/env node
/* Geliştirme araçları (bağımlılıksız). Kullanım:  node dev.js <komut>
     lint                      kaynak denetimi: dosya adları, başlıklar, ad çakışmaları, yasaklı ifadeler, sözdizimi
     map [--write]             dosya ve işlev haritasını yazdırır (--write: docs/CODEMAP.md, git dışında tutulur)
     www                       web dosyalarını mobil kabuk için www/ klasörüne kopyalar (NAKGO_WWW ile değiştirilir)
   npm kısayolları package.json içindedir (npm run lint, map, mobile:prepare). */
const fs = require("fs"), path = require("path"), vm = require("vm");
const {root, js:jsFiles, css:cssFiles} = require("./project.js");
const read = f => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const list = e => e === ".js" ? jsFiles : cssFiles;

// ---------- lint ----------
function lint() {
  const errors = [], warns = [];
  const RUNNING = new Set(["src/js/state.js", "src/js/core.js", "src/js/app.js"]);   // üst düzeyde çalışan kod yazılabilen modüller

  const js = list(".js"), css = list(".css");
  if (js.length < 5) errors.push("Depo kökünde modül bulunamadı");
  const names = {};
  for (const f of js) {
    const s = read(f), where = f;

    if (!/^\/\*\*\n \* .+\n \* .+\n \*\//.test(s)) errors.push(`${where}: başlık yorumu yok (/** Başlık, Açıklama */)`);
    if (/<\/script/i.test(s)) errors.push(`${where}: </script> içeremez`);
    if (/\bdebugger\b|\bconsole\.(log|debug)\(/.test(s)) errors.push(`${where}: debugger/console.log kalmış`);
    if (/Yük[Yy]ol/.test(s)) errors.push(`${where}: eski ad (YükYol) kalmış`);
    s.split("\n").forEach((line, i) => {
      const m = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|var)\s+([A-Za-z0-9_$]+)/.exec(line);
      if (m) { const n = m[1] || m[2]; if (names[n]) errors.push(`${where}:${i + 1}: "${n}" zaten ${names[n]} içinde tanımlı (aynı betik kapsamında çakışır)`); else names[n] = `${f}:${i + 1}`; }
      if (!RUNNING.has(f) && /^(try\b|if\s*\(|for\s*\(|while\s*\(|\$\(|document\.|window\.)/.test(line)) warns.push(`${where}:${i + 1}: üst düzeyde çalışan kod. Yalnızca ${[...RUNNING].join(", ")} içinde olmalı`);
    });
    if (s.split("\n").length > 900) warns.push(`${where}: ${s.split("\n").length} satır, bölmeyi düşün`);
  }
  for (const f of css) {
    const s = read(f), where = f;
    if (!/^\/\* .+ \*\/\n/.test(s)) errors.push(`${where}: başlık yorumu yok (/* Açıklama */)`);
    if ((s.match(/\{/g) || []).length !== (s.match(/\}/g) || []).length) errors.push(`${where}: süslü parantezler dengesiz`);
    if (/!important/.test(s) && !/motion|system/.test(f)) warns.push(`${where}: !important kullanılmış`);
  }
  if (!fs.existsSync(path.join(root, "src/index.template.html"))) errors.push("index.template.html yok");
  try { new vm.Script(js.map(f => read(f)).join("\n\n"), { filename: "bundle.js" }); } catch (e) { errors.push("Birleşik betikte sözdizimi hatası: " + e.message); }

  warns.slice(0, 15).forEach(w => console.warn("uyarı: " + w));
  if (warns.length > 15) console.warn(`... ve ${warns.length - 15} uyarı daha`);
  if (errors.length) { errors.forEach(e => console.error("hata: " + e)); console.error(`\n${errors.length} hata`); return 1; }
  console.log(`lint temiz: ${js.length} JS ve ${css.length} CSS modülü, ${Object.keys(names).length} üst düzey ad${warns.length ? ", " + warns.length + " uyarı" : ""}`);
}

// ---------- map ----------
function map() {
  let out = "# Kod haritası\n\nBu çıktı `npm run map` ile üretilir. Mimari için `docs/architecture.md`.\n\n## JavaScript modülleri (yükleme sırasıyla)\n\n";
  const keys = new Set(), colls = new Set();
  for (const f of list(".js")) {
    const s = read(f), h = /^\/\*\*\n \* (.+)\n \* (.+)\n \*\//.exec(s);
    out += `### \`${f}\`: ${h ? h[1] : ""}\n\n${h ? h[2] : ""}\n\n`;
    const fns = [], vars = [];
    s.split("\n").forEach(line => {
      let m = /^(async\s+)?function\s+([A-Za-z0-9_$]+)\(([^)]*)\)/.exec(line);
      if (m) fns.push(`\`${m[2]}(${m[3].replace(/\s+/g, " ").trim()})\``);
      m = /^(const|let)\s+([A-Za-z0-9_$]+)\b/.exec(line);
      if (m) vars.push(`\`${m[2]}\``);
    });
    if (fns.length) out += `İşlevler: ${fns.join(", ")}\n\n`;
    if (vars.length) out += `Değişken ve sabitler: ${vars.join(", ")}\n\n`;
    for (const m of s.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\("([^"]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/db\.(?:doc|collection)\("([A-Za-z]+)/g)) colls.add(m[1]);
  }
  out += "## Tarayıcı depolama anahtarları\n\n" + [...keys].sort().map(k => `- \`${k}\``).join("\n") + "\n\n";
  out += "## Veritabanı koleksiyonları (bulut modu)\n\n" + [...colls].sort().map(k => `- \`${k}\``).join("\n") + "\n\n## CSS dosyaları\n\n";
  for (const f of list(".css")) { const m = /^\/\* (.+) \*\//.exec(read(f)); out += `- \`${f}\`: ${m ? m[1] : ""}\n`; }
  if (process.argv.includes("--write")) { fs.mkdirSync(path.join(root, "docs"), { recursive: true }); fs.writeFileSync(path.join(root, "docs/CODEMAP.md"), out); console.log("docs/CODEMAP.md yazıldı"); }
  else process.stdout.write(out);
}

// ---------- www ----------
function www() {
  const out = process.env.NAKGO_WWW || path.join(root, "www");
  fs.mkdirSync(out, { recursive: true });
  for (const f of ["index.html", "manifest.webmanifest"]) fs.copyFileSync(path.join(root, f), path.join(out, f));
  fs.cpSync(path.join(root, "icons"), path.join(out, "icons"), { recursive: true });
  console.log("Hazır:", out);
}

const cmd = process.argv[2];
if (cmd === "lint") process.exit(lint() || 0);
else if (cmd === "map") map();

else if (cmd === "www") www();
else { console.error("Komutlar: lint | map [--write] | www"); process.exit(1); }

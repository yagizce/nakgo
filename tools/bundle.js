#!/usr/bin/env node
/* tools/project.js sırasındaki kaynakları src/index.template.html ile birleştirir. */
const fs = require("fs"), path = require("path");
const {root, js:jsFiles, css:cssFiles} = require("./project.js");
const read = f => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const list = ext => ext === ".js" ? jsFiles : cssFiles;

function build() {
  const tpl = read("src/index.template.html");
  for (const k of ["/*@CSS@*/", "/*@JS@*/"]) if (!tpl.includes(k)) throw new Error("Şablonda " + k + " yok");
  const {slogan} = JSON.parse(read("assets/brand/layout.json"));
  if (typeof slogan !== "string" || /[<>&"]/.test(slogan)) throw new Error("Geçersiz marka sloganı");
  const brand = '<img class="tk" src="icons/icon-192.png" width="50" height="50" alt="" decoding="async">';
  const logo = '<img class="tk" src="icons/brand-logo.png" width="576" height="538" alt="NakGo" fetchpriority="high">';
  const css = list(".css").map(f => read(f).trim()).join("\n\n");
  const js = list(".js").map(f => read(f).trim()).join("\n\n");
  if (/<\/script/i.test(js)) throw new Error("JS içinde </script> geçemez");
  return tpl.replaceAll("/*@BRAND@*/", () => brand).replaceAll("/*@LOGO@*/", () => logo).replaceAll("/*@SLOGAN@*/", () => slogan).replace("/*@CSS@*/", () => css).replace("/*@JS@*/", () => js);
}

if (require.main === module) {
  const out = build(), target = path.join(root, "index.html");
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (cur !== out) { console.error("index.html kaynaklarla uyumsuz. `npm run bundle` çalıştır."); process.exit(1); }
    console.log("index.html güncel");
  } else {
    fs.writeFileSync(target, out);
    console.log("index.html üretildi (" + Math.round(out.length / 1024) + " KB, " + list(".js").length + " JS + " + list(".css").length + " CSS modülü)");
  }
}
module.exports = { build };

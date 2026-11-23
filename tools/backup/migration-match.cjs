/** Production migration geçmişinin repodaki migration dosyalarıyla eşleştirilmesi (R1–R3).
 *
 * Neden: Supabase'in apply_migration aracı schema_migrations'a KENDİ zaman damgasını (uygulama anı) ve verilen adı yazar;
 * repodaki dosya adı sonradan bu sürüme göre yeniden adlandırılır (docs/PROJECT_HANDOFF.md). Yeniden adlandırma
 * unutulursa sürüm ile dosya adı ayrışır. Kurallar:
 *   - Tam eşleşme: dosya "<sürüm>_<ad>.sql" ve geçmişteki ad (varsa) dosyanın ad kısmıyla aynı.
 *   - Takma ad: ops/backup/migration-aliases.json'da (PR ile incelenmiş) {production_version, file}; ad yine aynı olmalı.
 *     Takma ad yalnız AÇIKÇA listelenmişse kabul edilir; ada göre tahmin YAPILMAZ.
 *   - Geçmişte adı boş satır yalnız tam sürüm eşleşmesiyle kabul edilir (sayısı kayda girer).
 *   - Eşleşmeyen sürüm (bilinmeyen), iki satırın aynı dosyaya eşlenmesi ya da son uygulanandan eski bekleyen dosya (boşluk)
 *     → kapalı. İçerik farkı (aynı ad, farklı SQL) burada değil, R4 şema karşılaştırmasında yakalanır. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const ALIASES_FILE=path.join(root,'ops/backup/migration-aliases.json');

const nameOfFile=f=>f.replace(/\.sql$/,'').slice(15);
function loadAliases(file=ALIASES_FILE){
  let doc;try{doc=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return [];}
  if(!doc||doc.version!==1||!Array.isArray(doc.aliases))throw Error('migration takma ad dosyası bozuk');
  for(const a of doc.aliases)if(!a||!/^\d{14}$/.test(a.production_version)||!/^\d{14}_[a-z0-9_]+\.sql$/.test(a.file))throw Error('migration takma adı bozuk');
  return doc.aliases;
}

/** history: [{version, name}], list: [{version, file}] (sıralı). */
function matchHistory(history,list,{aliases=loadAliases()}={}){
  const byVersion=new Map(list.map(m=>[m.version,m]));const byFile=new Map(list.map(m=>[m.file,m]));
  const used=new Map();const unknown=[],nameMismatch=[],duplicate=[];let aliasCount=0,nameless=0;
  const rows=[...history].map(h=>({version:String(h.version),name:h.name===undefined?null:h.name}));
  const seenV=new Set();
  for(const h of rows){
    if(seenV.has(h.version)){duplicate.push(h.version);continue;}seenV.add(h.version);
    let m=byVersion.get(h.version),via='exact';
    if(!m){const a=aliases.find(x=>x.production_version===h.version);if(a&&byFile.has(a.file)){m=byFile.get(a.file);via='alias';}}
    if(!m){unknown.push(h.version);continue;}
    if(h.name===null||h.name===''){if(via!=='exact'){unknown.push(h.version);continue;}nameless++;}
    else if(h.name!==nameOfFile(m.file)){nameMismatch.push(h.version);continue;}
    if(used.has(m.file)){duplicate.push(h.version);continue;}
    used.set(m.file,{version:h.version,name:h.name,file:m.file,via});if(via==='alias')aliasCount++;
  }
  const applied=list.filter(m=>used.has(m.file));
  const lastFile=applied.length?applied[applied.length-1].file:'';
  const pending=list.filter(m=>!used.has(m.file));
  const gaps=pending.filter(m=>m.file<lastFile).map(m=>m.file);
  const ok=!unknown.length&&!nameMismatch.length&&!duplicate.length&&!gaps.length;
  return {ok,applied:applied.map(m=>used.get(m.file)),appliedFiles:applied,pending:pending.map(m=>m.file),pendingFiles:pending,
    unknown,nameMismatch,duplicate,gaps,aliases:aliasCount,nameless,last:rows.length?rows.map(r=>r.version).sort().slice(-1)[0]:''};
}

module.exports={matchHistory,loadAliases,nameOfFile,ALIASES_FILE};

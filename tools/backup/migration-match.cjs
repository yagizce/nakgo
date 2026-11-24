/** Production migration geçmişinin repodaki migration dosyalarıyla eşleştirilmesi (R1–R3).
 *
 * Neden: Supabase'in apply_migration aracı schema_migrations'a KENDİ zaman damgasını (uygulama anı) ve verilen adı yazar;
 * repodaki dosya adı sonradan bu sürüme göre yeniden adlandırılır (docs/PROJECT_HANDOFF.md). Yeniden adlandırma
 * unutulursa sürüm ile dosya adı ayrışır. Kurallar:
 *   - Tam eşleşme: dosya "<sürüm>_<ad>.sql" ve geçmişteki ad (varsa) dosyanın ad kısmıyla aynı.
 *   - Takma ad: ops/backup/migration-aliases.json'da (PR ile incelenmiş) {production_version, file}; ad yine aynı olmalı.
 *     Takma ad yalnız AÇIKÇA listelenmişse kabul edilir; ada göre tahmin YAPILMAZ.
 *   - Geçmişte adı boş satır yalnız tam sürüm eşleşmesiyle kabul edilir (sayısı kayda girer).
 *   - Ad biçimi (Production'da ölçüldü, 23.11.2026: 32 satırın 17'si yalın ad, 15'i "<14 hane>_<ad>.sql"):
 *     yalnız iki biçim kabul edilir: yalın ad (/^[a-z0-9_]+$/) ya da TAM dosya adı biçimi (/^\d{14}_[a-z0-9_]+\.sql$/).
 *     Dosya adı biçiminde ad kısmı çıkarılır (normalize) ve dosyanın ad kısmıyla BİREBİR aynı olmalıdır. Eşleştirme
 *     anahtarı yine sürümdür; addaki zaman damgası eşleştirmede kullanılmaz.
 *       · Addaki zaman damgası eşleşen dosyanın sürümünden farklıysa ve BAŞKA bir repo dosyasının sürümüyse → belirsiz,
 *         kapalı (ambiguous).
 *       · Aksi hâlde yalnız PR'la incelenmiş sabit izin listesindeki satır kabul edilir (migration-aliases.json →
 *         timestamp_exceptions: {version, slug, production_name}; üçü birlikte birebir). Kabul edilen satır sessiz
 *         değildir: timestampMismatch listesine ve kayda (sayı) girer. Listede olmayan YENİ fark, listedeki satırın
 *         farklı adı ya da farklı slug'ı → kapalı (timestampUnapproved). İzin listesi alanı yoksa liste boştur (kapalı).
 *       · Başka her biçim (büyük harf, boşluk, yalnız ".sql", eksik/fazla hane, yol, metin olmayan değer) → kapalı
 *         (malformedName). Tahmin yapılmaz.
 *   - Eşleşmeyen sürüm (bilinmeyen), iki satırın aynı dosyaya eşlenmesi ya da son uygulanandan eski bekleyen dosya (boşluk)
 *     → kapalı. İçerik farkı (aynı ad, farklı SQL) burada değil, R4 şema karşılaştırmasında yakalanır. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const ALIASES_FILE=path.join(root,'ops/backup/migration-aliases.json');

const nameOfFile=f=>f.replace(/\.sql$/,'').slice(15);
const SLUG_RE=/^[a-z0-9_]+$/,FILE_NAME_RE=/^(\d{14})_([a-z0-9_]+)\.sql$/;
/** Geçmişteki ad: {form:'slug',slug} | {form:'file',slug,ts} | null (bozuk; kapalı). */
function parseName(name){
  if(typeof name!=='string')return null;
  const f=FILE_NAME_RE.exec(name);if(f)return {form:'file',slug:f[2],ts:f[1]};
  return SLUG_RE.test(name)?{form:'slug',slug:name}:null;
}
function loadAliases(file=ALIASES_FILE){
  let doc;try{doc=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return [];}
  if(!doc||doc.version!==1||!Array.isArray(doc.aliases))throw Error('migration takma ad dosyası bozuk');
  for(const a of doc.aliases)if(!a||!/^\d{14}$/.test(a.production_version)||!/^\d{14}_[a-z0-9_]+\.sql$/.test(a.file))throw Error('migration takma adı bozuk');
  return doc.aliases;
}

/** Zaman damgası izin listesi (aynı dosyada, araç paketi özetine giren). Alan yoksa [] (yeni fark kabul edilmez).
 * Her satır: {version, slug, production_name}; production_name "<14 hane>_<slug>.sql" ve addaki damga sürümden farklı. */
const EXCEPTION_KEYS=['production_name','slug','version'];
function loadNameExceptions(file=ALIASES_FILE){
  let doc;try{doc=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return [];}
  if(!doc||doc.version!==1)throw Error('migration takma ad dosyası bozuk');
  if(doc.timestamp_exceptions===undefined)return [];
  const list=doc.timestamp_exceptions;
  if(!Array.isArray(list)||list.length>256)throw Error('migration zaman damgası izin listesi bozuk');
  const seen=new Set();
  for(const e of list){
    const ok=e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join()===EXCEPTION_KEYS.join()&&
      typeof e.version==='string'&&/^\d{14}$/.test(e.version)&&typeof e.slug==='string'&&SLUG_RE.test(e.slug)&&typeof e.production_name==='string';
    const p=ok?FILE_NAME_RE.exec(e.production_name):null;
    if(!p||p[2]!==e.slug||p[1]===e.version||seen.has(e.version))throw Error('migration zaman damgası izni bozuk');
    seen.add(e.version);
  }
  return list;
}

/** İzin listesinin kanonik kimliği: sürüme göre sıralı [{version, slug, production_name}] (yalnız bu üç alan). */
const H_EXCEPTIONS='nakgo-migration-timestamp-exceptions/v1';
const canonicalExceptions=list=>[...list].map(e=>({version:e.version,slug:e.slug,production_name:e.production_name}))
  .sort((a,b)=>a.version<b.version?-1:a.version>b.version?1:0);
/** Kanonik içeriğin SHA-256'sı (açıklama metni ve dosya biçimi dahil değil; satır sırası önemsiz). */
function exceptionsSha256(list){
  const body=canonicalExceptions(list).map(e=>JSON.stringify([e.version,e.slug,e.production_name])).join('\n');
  return require('node:crypto').createHash('sha256').update(H_EXCEPTIONS+'\n'+body+'\n','utf8').digest('hex');
}
const exceptionKey=e=>e.version+'\u0000'+e.slug+'\u0000'+e.production_name;
/** Kullanılan istisnalar ↔ izin listesi: birebir aynı küme mi? Dönüş: sorun kodları (boşsa geçerli).
 *  hash: verilen hash listeninkiyle aynı değil · malformed: satır biçimi · duplicate: aynı sürüm iki kez ·
 *  unknown: listede birebir karşılığı yok (değiştirilmiş ya da yabancı satır) · missing: listede olup kullanılmamış. */
function exceptionSetProblems({entries,list,sha256}){
  const problems=[];
  if(sha256!==exceptionsSha256(list))problems.push('hash');
  if(!Array.isArray(entries))return [...problems,'malformed'];
  const allowed=new Map(list.map(e=>[e.version,exceptionKey(e)]));const seen=new Set();
  for(const e of entries){
    const ok=e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join()===EXCEPTION_KEYS.join()&&
      [e.version,e.slug,e.production_name].every(x=>typeof x==='string');
    if(!ok){problems.push('malformed');continue;}
    if(seen.has(e.version)){problems.push('duplicate');continue;}seen.add(e.version);
    if(allowed.get(e.version)!==exceptionKey(e))problems.push('unknown');
  }
  for(const v of allowed.keys())if(!seen.has(v))problems.push('missing');
  return [...new Set(problems)];
}

/** history: [{version, name}], list: [{version, file}] (sıralı).
 *  requireAllExceptions: izin listesindeki her satır geçmişte birebir görülmeli (görülmeyen → exceptionsMissing, kapalı).
 *  Yedek doğrulamasında (run, offline-sign) açık; genel geçmiş karşılaştırmalarında kapalı. */
function matchHistory(history,list,{aliases=loadAliases(),nameExceptions=loadNameExceptions(),requireAllExceptions=false}={}){
  const byVersion=new Map(list.map(m=>[m.version,m]));const byFile=new Map(list.map(m=>[m.file,m]));
  const used=new Map();const unknown=[],nameMismatch=[],duplicate=[],malformedName=[],ambiguous=[],normalized=[],timestampMismatch=[],timestampUnapproved=[];
  let aliasCount=0,nameless=0;
  const rows=[...history].map(h=>({version:String(h.version),name:h.name===undefined?null:h.name}));
  const seenV=new Set();
  for(const h of rows){
    if(seenV.has(h.version)){duplicate.push(h.version);continue;}seenV.add(h.version);
    let m=byVersion.get(h.version),via='exact';
    if(!m){const a=aliases.find(x=>x.production_version===h.version);if(a&&byFile.has(a.file)){m=byFile.get(a.file);via='alias';}}
    if(!m){unknown.push(h.version);continue;}
    let p=null;
    if(h.name===null||h.name===''){if(via!=='exact'){unknown.push(h.version);continue;}nameless++;}
    else{
      p=parseName(h.name);
      if(!p){malformedName.push(h.version);continue;}
      if(p.slug!==nameOfFile(m.file)){nameMismatch.push(h.version);continue;}
      // Addaki zaman damgası başka bir repo dosyasını gösteriyorsa ad ile sürüm iki ayrı dosyaya işaret eder: belirsiz.
      if(p.form==='file'&&p.ts!==m.version&&byVersion.has(p.ts)){ambiguous.push(h.version);continue;}
      // Damga farkı yalnız izin listesindeki satırla (sürüm + slug + Production adı birebir) kabul edilir.
      if(p.form==='file'&&p.ts!==m.version){
        const ex=nameExceptions.find(e=>e.version===h.version);
        if(!ex||ex.slug!==nameOfFile(m.file)||ex.production_name!==h.name){timestampUnapproved.push(h.version);continue;}
      }
    }
    if(used.has(m.file)){duplicate.push(h.version);continue;}
    used.set(m.file,{version:h.version,name:h.name,file:m.file,via});if(via==='alias')aliasCount++;
    if(p&&p.form==='file'){
      normalized.push(h.version);
      if(p.ts!==m.version)timestampMismatch.push({version:h.version,name_timestamp:p.ts,file:m.file,slug:p.slug,production_name:h.name});
    }
  }
  const usedEx=new Set(timestampMismatch.map(t=>t.version));
  const exceptionsMissing=requireAllExceptions?nameExceptions.filter(e=>!usedEx.has(e.version)).map(e=>e.version):[];
  const applied=list.filter(m=>used.has(m.file));
  const lastFile=applied.length?applied[applied.length-1].file:'';
  const pending=list.filter(m=>!used.has(m.file));
  const gaps=pending.filter(m=>m.file<lastFile).map(m=>m.file);
  const ok=!unknown.length&&!nameMismatch.length&&!duplicate.length&&!malformedName.length&&!ambiguous.length&&!timestampUnapproved.length&&!exceptionsMissing.length&&!gaps.length;
  return {ok,applied:applied.map(m=>used.get(m.file)),appliedFiles:applied,pending:pending.map(m=>m.file),pendingFiles:pending,
    unknown,nameMismatch,duplicate,malformedName,ambiguous,timestampUnapproved,exceptionsMissing,gaps,
    /** İmzalı kayda giren kimlikler (kanonik sıra) ve doğrulamada kullanılan izin listesinin hash'i. */
    timestampExceptions:canonicalExceptions(timestampMismatch),exceptionsSha256:exceptionsSha256(nameExceptions),aliases:aliasCount,nameless,normalized,timestampMismatch,
    last:rows.length?rows.map(r=>r.version).sort().slice(-1)[0]:''};
}

module.exports={matchHistory,loadAliases,loadNameExceptions,exceptionsSha256,canonicalExceptions,exceptionSetProblems,H_EXCEPTIONS,
  nameOfFile,parseName,ALIASES_FILE};

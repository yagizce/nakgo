/** Yönetim verisinin (zamanlanmış işler ve migration geçmişi) denetimi ve kurtarma betiği.
 *
 * Yedek paketi bu verileri meta/<ad>.jsonl olarak taşır (ops/backup/scope.json → meta). Düz PostgreSQL doğrulamasında
 * tablo olarak geri yüklenmez; burada repodaki migration'larla karşılaştırılır:
 *   historyStatus  geçmişteki her sürüm repoda olmalı; repoda olup geçmişte olmayan ve en son uygulanandan ESKİ bir
 *                  migration (boşluk) olmamalı. Bekleyenler = repoda olup geçmişte olmayanlar (dosya sırasıyla).
 *   cronStatus     her iş, uygulanmış bir migration'daki cron.schedule çağrısıyla (ad, zaman, komut) aynı olmalı;
 *                  uygulanmış migration'ların zamanladığı her iş yedekte bulunmalı; aynı ad iki kez olmamalı.
 *                  Sorun metinleri yedekteki komutu ve zamanı İÇERMEZ (yalnız repo değerleri; güvenli olmayan ad özetlenir).
 *
 * renderRestoreSql işleri YEDEKTEKİ komuttan değil, repodaki doğrulanmış tanımdan (ad, zaman, komut) üretir. Yedekteki iş
 * repo tanımıyla birebir uyuşmuyorsa SQL üretilmez (hata; yedekteki komutla devam edilmez). Yedekten yalnız işin
 * etkinliği (active, boolean) alınır.
 *
 * Gerçek kurtarmada (yeni Supabase projesi) renderRestoreSql incelenip ELLE uygulanır: migration geçmişini ve işleri yeniden
 * kurar. Bu araç hiçbir veritabanına bağlanmaz; yalnız dosya okur ve yazar.
 *
 *   node tools/backup/restore-meta.cjs --bundle <çözülmüş paket klasörü> [--sql <yeni dosya>] [--pg-install <PostgreSQL sunucu kurulumu>]
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readMeta}=require('./scope-export.cjs');
const MM=require('./migration-match.cjs');
const root=path.resolve(__dirname,'../..');

const repoMigrations=(dir=path.join(root,'supabase/migrations'))=>fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()
  .map(f=>({version:f.slice(0,14),file:f,sql:fs.readFileSync(path.join(dir,f),'utf8')}));
const norm=s=>String(s).replace(/\s+/g,' ').trim();

/** Migration'lardaki cron.schedule('ad','zaman',komut) çağrıları. Komut '...' ya da $etiket$...$etiket$ olabilir. */
function repoCronJobs(list=repoMigrations()){
  const re=/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(?:'((?:[^']|'')*)'|\$(\w*)\$([\s\S]*?)\$\4\$)\s*\)/g;
  const jobs=Object.create(null);// "__proto__" gibi adlar prototipten değer döndürmesin
  for(const m of list)for(const x of m.sql.matchAll(re))
    jobs[x[1]]={schedule:x[2],command:x[3]!==undefined?x[3].replace(/''/g,"'"):x[5],version:m.version,file:m.file};
  return jobs;
}

/** R1–R3 (migration-match.cjs): tam sürüm + ad eşleşmesi ya da PR'la incelenmiş takma ad; bilinmeyen, ad uyuşmazlığı,
 * yineleme ve boşluk kapalı. unknown listesi ad uyuşmazlığını, yinelemeyi, bozuk adı ve belirsiz eşleşmeyi de kapsar
 * (sürüm metni). normalized: dosya adı biçimindeki ad sayısı; timestamp_mismatch: addaki zaman damgası farklı sürümler. */
function historyStatus(history,list=repoMigrations(),{aliases,requireAllExceptions=false}={}){
  const m=MM.matchHistory(history,list,{...(aliases?{aliases}:{}),requireAllExceptions});
  return {ok:m.ok,applied:m.applied.length,last:m.last,unknown:[...new Set([...m.unknown,...m.nameMismatch,...m.duplicate,...m.malformedName,...m.ambiguous,...m.timestampUnapproved,...m.exceptionsMissing])],
    gaps:m.gaps,pending:m.pending,aliases:m.aliases,nameless:m.nameless,normalized:m.normalized.length,
    timestamp_mismatch:m.timestampMismatch.map(t=>t.version)};
}
/** Uygulanmış migration dosyaları (sırayla); geçmiş eşleşmiyorsa null. */
function appliedList(history,list=repoMigrations(),{aliases}={}){
  const m=MM.matchHistory(history,list,aliases?{aliases}:{});
  return m.ok?m.appliedFiles:null;
}

/** Sorun metninde yedekteki iş adı: yalnız güvenli karakterlerse olduğu gibi, değilse kısa özet (ham değer yazılmaz). */
const nameOf=n=>typeof n==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(n)?n:'#'+require('node:crypto').createHash('sha256').update(String(n)).digest('hex').slice(0,12);

/** Beklenen işler: expected verilirse (referans derlemesi: uygulanmış migration'ların GERÇEK sonucu) o; verilmezse
 * YALNIZ uygulanmış migration'lardaki cron.schedule çağrıları (bekleyen migration'lar beklenen durumu değiştirmez). */
function cronStatus(jobs,{history=null,list=repoMigrations(),expected=null,aliases}={}){
  let repo;
  if(expected){repo=Object.create(null);for(const e of expected)repo[e.jobname]={schedule:e.schedule,command:e.command,version:null};}
  else{
    const applied=history?appliedList(history,list,{aliases}):list;
    if(history&&!applied)return {ok:false,jobs:Array.isArray(jobs)?jobs.length:0,problems:['migration geçmişi eşleşmediği için beklenen işler hesaplanamadı']};
    repo=repoCronJobs(applied);
  }
  const problems=[];
  if(!Array.isArray(jobs))return {ok:false,jobs:0,problems:['zamanlanmış iş listesi okunamadı']};
  const seen=new Set();
  for(const j of jobs){
    if(!j||typeof j.jobname!=='string'||typeof j.schedule!=='string'||typeof j.command!=='string'){problems.push('geçersiz iş kaydı');continue;}
    if(seen.has(j.jobname)){problems.push('yinelenen iş: '+nameOf(j.jobname));continue;}
    seen.add(j.jobname);
    const r=repo[j.jobname];
    if(!r){problems.push('repoda olmayan iş: '+nameOf(j.jobname));continue;}
    if(r.schedule!==j.schedule)problems.push(`zaman farklı: ${j.jobname} (beklenen ${r.schedule})`);
    if(norm(r.command)!==norm(j.command))problems.push('komut farklı: '+j.jobname);
  }
  if(history||expected){
    for(const name of Object.keys(repo))if(!seen.has(name))problems.push('uygulanmış migration\'ın işi yedekte yok: '+name);
  }
  return {ok:!problems.length,jobs:jobs.length,problems};
}

/** Pakettaki meta verinin durumu. Dönüş: {history, cron} (veri yoksa null). Hash ya da satır sayısı tutmazsa hata. */
function bundleStatus(bundleDir,{list=repoMigrations()}={}){
  const source=JSON.parse(fs.readFileSync(path.join(bundleDir,'source.json'),'utf8'));
  const meta=readMeta(bundleDir,source.meta_files||{});
  const history=meta['supabase_migrations.schema_migrations']||null;
  const cron=meta['cron.job']||null;
  return {meta,external:source.external_triggers||[],history:history?historyStatus(history,list):null,cron:cron?cronStatus(cron,{history,list}):null};
}

const dollar=(s,base='nakgo')=>{let t=base,i=0;while(String(s).includes('$'+t+'$'))t=base+(++i);return '$'+t+'$'+s+'$'+t+'$';};
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'";

const normDef=s=>String(s).replace(/\s+/g,' ').trim();
const IDENT=/^[a-z_][a-z0-9_]{0,62}$/;
/** Yedekteki dış tetikleyici listesi (source.external_triggers) GÜVENİLMEZ: yalnız güvenilir beklenen listeyle
 * (referans derlemesi: uygulanmış migration'ların gerçek sonucu) karşılaştırılır. Fark → hata (O5). */
function triggerStatus(observed,expected){
  const problems=[];
  if(!Array.isArray(observed)||!Array.isArray(expected))return {ok:false,problems:['tetikleyici listesi okunamadı']};
  const key=x=>x&&typeof x.table==='string'&&typeof x.name==='string'?x.table+'.'+x.name:null;
  const exp=new Map(expected.map(x=>[key(x),normDef(x.def)])),seen=new Set();
  for(const o of observed){
    const k=key(o);
    if(!k||typeof o.def!=='string'){problems.push('geçersiz tetikleyici kaydı');continue;}
    if(seen.has(k)){problems.push('yinelenen tetikleyici');continue;}seen.add(k);
    if(!exp.has(k)){problems.push('beklenmeyen tetikleyici: '+(IDENT.test(o.name)?o.name:'#'));continue;}
    if(exp.get(k)!==normDef(o.def))problems.push('tetikleyici tanımı farklı: '+o.name);
  }
  for(const k of exp.keys())if(!seen.has(k))problems.push('beklenen tetikleyici yedekte yok: '+k.split('.').pop());
  return {ok:!problems.length,problems};
}
/** Kurtarma ve prova için tetikleyici SQL'i: YALNIZ güvenilir beklenen tanımlardan (yedekten gelen tanım çalıştırılmaz). */
function externalTriggerSql(expected){
  return (expected||[]).map(x=>{
    const [s,t]=x.table.split('.');
    if(!IDENT.test(s)||!IDENT.test(t)||!IDENT.test(x.name))throw Object.assign(Error('geçersiz tetikleyici adı'),{code:'trigger_invalid'});
    if(!/^CREATE (CONSTRAINT )?TRIGGER /.test(x.def)||/;/.test(x.def))throw Object.assign(Error('geçersiz tetikleyici tanımı'),{code:'trigger_invalid'});
    return `do $$ begin if to_regclass(${lit(x.table)}) is not null and not exists(select 1 from pg_trigger where tgname=${lit(x.name)} and tgrelid=${lit('"'+s+'"."'+t+'"')}::regclass) then execute ${dollar(x.def,'tg')}; end if; end $$;`;});
}
/** Yedekteki X.pre.sql (Supabase'in kurduğu Auth/Storage tablolarının YAPISI) çalıştırılmadan önce katı biçim denetimi:
 * yalnız "create sequence if not exists auth|storage.x;" ve "create table auth|storage.x (...);" deyimleri. */
function validateExternalDDL(sql){
  const text=String(sql);
  // Deyim yalnız satır sonundaki ";" ile biter: başka yerde ";" ya da ters eğik çizgi (psql meta komutu) yok.
  if(/\\/.test(text))throw Object.assign(Error('X.pre.sql izin verilmeyen ifade içeriyor'),{code:'xpre_invalid'});
  const parts=text.split(/;[ \t]*(?:\n|$)/).map(x=>x.trim()).filter(Boolean);
  if(parts.some(p=>p.includes(';')))throw Object.assign(Error('X.pre.sql izin verilmeyen ifade içeriyor'),{code:'xpre_invalid'});
  const forbidden=/\$|\bdo\b|\bfunction\b|\bprocedure\b|\bexecute\b|\bcopy\b|\bprogram\b|\bgrant\b|\brole\b|\blanguage\b|\bextension\b|\btrigger\b|\brule\b|\bpolicy\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b|\bdelete\b|\bselect\b|\bset\b|\bvalues\b|\bas\s+\(|\bschema\b|\buser\b|\btablespace\b|\blo_\w*|\bpg_\w*|\bdblink\w*|\bfile\w*|\bcreate\b|\binherits\b|\bpartition\b|\bwith\s*\(|\busing\b/i;
  for(const p of parts){
    if(/^create sequence if not exists (auth|storage)\.[a-z_][a-z0-9_]*$/.test(p))continue;
    const m=/^create table "?(auth|storage)"?\."?[a-z_][a-z0-9_]*"? \(\n([\s\S]*)\n\)$/.exec(p);
    if(!m)throw Object.assign(Error('X.pre.sql beklenen biçimde değil'),{code:'xpre_invalid'});
    if(forbidden.test(m[2].replace(/\bnextval\('[a-z_.]+'::regclass\)/g,'')))throw Object.assign(Error('X.pre.sql izin verilmeyen ifade içeriyor'),{code:'xpre_invalid'});
  }
  return true;
}

/** Yeni (yalıtılmış) Supabase projesinde, veri geri yüklendikten SONRA incelenip elle çalıştırılacak SQL. */
function renderRestoreSql(meta,{externalTriggers=[],list=repoMigrations(),expected=null,aliases}={}){
  // Önce doğrula: yedekteki işler güvenilir tanımlarla (referans derlemesi ya da uygulanmış migration'lar) birebir aynı
  // değilse SQL üretilmez. Tetikleyiciler YALNIZ güvenilir beklenen listeden; yedekteki tanım çalıştırılmaz.
  const h0=meta['supabase_migrations.schema_migrations']||null,j0=meta['cron.job'];
  if(j0!==undefined&&j0!==null){
    const st=cronStatus(j0,{history:h0,list,expected:expected&&expected.cron,aliases});
    if(!st.ok)throw Object.assign(Error('zamanlanmış işler güvenilir tanımlarla uyuşmuyor; kurtarma SQL\'i üretilmedi: '+st.problems.join('; ')),{code:'cron_mismatch',problems:st.problems});
  }
  if((externalTriggers||[]).length||(expected&&expected.triggers&&expected.triggers.length)){
    if(!expected||!expected.triggers)throw Object.assign(Error('dış tetikleyiciler için referans derlemesi gerekli (yedekteki tanım kullanılmaz); kurtarma SQL\'i üretilmedi'),{code:'trigger_reference_required'});
    const ts=triggerStatus(externalTriggers,expected.triggers);
    if(!ts.ok)throw Object.assign(Error('dış tetikleyiciler güvenilir tanımlarla uyuşmuyor; kurtarma SQL\'i üretilmedi: '+ts.problems.join('; ')),{code:'trigger_mismatch',problems:ts.problems});
  }
  const repoJobs=expected&&expected.cron?Object.fromEntries(expected.cron.map(e=>[e.jobname,{schedule:e.schedule,command:e.command}])):repoCronJobs(h0?(appliedList(h0,list,{aliases})||[]):list);
  const out=['-- NakGo kurtarma: migration geçmişi ve zamanlanmış işler. tools/backup/restore-meta.cjs üretti.',
    '-- YALNIZ yalıtılmış hedef projede, veri geri yüklendikten sonra, incelenerek çalıştırılır. Production ya da DEV\'de çalıştırılmaz.',
    '-- Zamanlanmış işler hedefte hemen çalışmaya başlar; hedef canlıya alınmayacaksa işleri pasif bırakın (aşağıdaki active=false).',
    'begin;'];
  const h=meta['supabase_migrations.schema_migrations'];
  if(h){
    out.push('create schema if not exists supabase_migrations;',
      'create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);');
    for(const r of h)out.push(`insert into supabase_migrations.schema_migrations(version,name) values(${lit(r.version)},${r.name===null||r.name===undefined?'null':lit(r.name)}) on conflict (version) do nothing;`);
  }else out.push('-- Yedekte migration geçmişi yok.');
  const j=meta['cron.job'];
  if(j&&j.length){
    // pg_cron'un kullanılan API'si (cron.schedule ad ile ekler ya da günceller; cron.alter_job etkinliği ayarlar) yoksa
    // hiçbir şey uygulanmaz: tek işlem olduğu için migration geçmişi de yazılmaz.
    out.push("do $$ begin if to_regprocedure('cron.schedule(text,text,text)') is null or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then raise exception 'pg_cron yok: önce eklentiyi etkinleştirin'; end if; end $$;");
    for(const r of j){
      // Ad, zaman ve komut REPODAN (doğrulandı: yedektekiyle aynı); yedekten yalnız etkinlik.
      const d=repoJobs[r.jobname];
      out.push(`select cron.schedule(${lit(r.jobname)},${lit(d.schedule)},${dollar(d.command)});`);
      out.push(`select cron.alter_job((select jobid from cron.job where jobname=${lit(r.jobname)}),active:=${r.active===true?'true':'false'});`);
    }
  }else out.push('-- Yedekte zamanlanmış iş yok.');
  if((externalTriggers||[]).length){out.push('-- Supabase\'in kurduğu tablolardaki NakGo tetikleyicileri (güvenilir referans tanımlarından):',...externalTriggerSql(expected.triggers));}
  out.push('commit;','');
  return out.join('\n');
}

module.exports={repoMigrations,repoCronJobs,historyStatus,appliedList,cronStatus,triggerStatus,bundleStatus,renderRestoreSql,externalTriggerSql,validateExternalDDL};

if(require.main===module)(async()=>{
  const args=process.argv.slice(2);const arg=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
  const bundle=arg('--bundle');
  if(!bundle){console.error('kullanım: --bundle <klasör> [--sql <yeni dosya>] [--pg-install <PostgreSQL sunucu kurulumu>]');process.exit(2);}
  const st=bundleStatus(bundle);
  // --pg-install: güvenilir beklenen durum (zamanlanmış işler ve dış tetikleyiciler) uygulanmış migration'ların ağsız,
  // atılabilir kümedeki gerçek sonucundan (reference-build.cjs). Verilmezse dış tetikleyici içeren pakette SQL üretilmez.
  let expected=null;
  const inst=arg('--pg-install');
  if(inst){
    const h=st.meta['supabase_migrations.schema_migrations'];
    const applied=h?appliedList(h):null;
    if(!applied){console.error('migration geçmişi repo ile eşleşmiyor; referans derlenmedi');process.exit(1);}
    const ref=await require('./reference-build.cjs').buildReference({installDir:inst,list:applied,scope:JSON.parse(fs.readFileSync(path.join(root,'ops/backup/scope.json'),'utf8'))});
    expected={cron:ref.cron,triggers:ref.triggers};
    if(st.meta['cron.job'])st.cron=cronStatus(st.meta['cron.job'],{history:h,expected:expected.cron});
  }
  console.log(JSON.stringify({history:st.history,cron:st.cron},null,1));
  const out=arg('--sql');
  if(out){
    // Önce üret (uyuşmazlıkta hata), sonra yaz: başarısızlıkta boş ya da yarım dosya kalmaz.
    let sql;try{sql=renderRestoreSql(st.meta,{externalTriggers:st.external,expected});}catch(e){console.error(e.message);process.exit(1);}
    const fd=fs.openSync(out,'wx',0o600);try{fs.writeSync(fd,sql);}finally{fs.closeSync(fd);}console.log('yazıldı: '+out);
  }
  process.exit((st.history&&!st.history.ok)||(st.cron&&!st.cron.ok)?1:0);
})().catch(e=>{console.error('restore-meta durdu: '+e.message);process.exit(1);});

/** Bekleyen migration'ların, yedekten geri yüklenmiş YEREL kopyada provası (docs/migration-safety.md "Riskli" sınıfı).
 *
 * Yedeğin migration geçmişinden (meta) bekleyen migration'lar hesaplanır ve dosya sırasıyla, her biri kendi işleminde
 * uygulanır. Her migration için:
 *   - oturumda lock_timeout ve statement_timeout (Production'da kullanılacak değerler) açıkken süre ölçülür;
 *   - işlem kapanmadan hemen önce bu oturumun tuttuğu ilişki kilitleri okunur (tam envanter: kilitler işlem sonuna kadar
 *     tutulur). Önceden var olan tablolardaki güçlü kilitler (ACCESS EXCLUSIVE vb.) ayrıca listelenir;
 *   - hata olursa işlem geri alınır ve prova durur.
 * Önce, Supabase'in hedefte kuracağı ama yedekte olmayan tabloların yapısı (X.pre.sql, veri yok) ve bizim o tablolardaki
 * tetikleyicilerimiz kurulur (kurtarma SQL'iyle aynı: restore-meta.cjs); böylece yerel kopya hedefe benzer.
 * Sonra: şema özeti supabase/schema/snapshot.txt ile, API sözleşmesi (v0+v1) ve depodaki SQL fixture'ları (her biri geri
 * alınır; satır sayıları değişmemeli) geri yüklenmiş verinin üstünde çalıştırılır.
 * Fixture'ların HEPSİ geçmelidir; biri bile başarısızsa prova başarısızdır. Fixture'lar boş test veritabanı için yazılmıştır;
 * bazıları gerçek veride bulunabilecek durumları (ör. önceden var olan ana yönetici, askıdaki başka sahip) "olmamalı"
 * diye denetler. Gerçek yedekte böyle bir başarısızlık durdurma koşuludur ve insan inceler (runbook: migration-rehearsal.md).
 * Seçenekler: expected (karşılaştırılacak şema özeti; varsayılan supabase/schema/snapshot.txt), list (repodaki migration
 * listesi), beforeFixtures(db) (migration'lardan sonra, fixture'lardan önce veri denetimleri; testler).
 * Migration dosyaları değiştirilmez; yalnız en dıştaki "commit;" satırı kilitleri okumak için bu araç tarafından verilir.
 * Yalnız yerel ve geçici veritabanında çalışır (restore-verify kancası). */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {root,FULL_SNAPSHOT_SQL,diff}=require('../db-lib.cjs');
const {repoMigrations,historyStatus}=require('./restore-meta.cjs');

const STRONG=['AccessExclusiveLock','ExclusiveLock','ShareRowExclusiveLock','ShareLock'];

async function existingRelations(db){
  return new Set((await db.query(`select n.nspname||'.'||c.relname r from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private','auth','storage','api') and c.relkind in ('r','p','v','m')`)).rows.map(x=>x.r));
}

/** Tek migration: dosyanın tek "begin;" ve tek "commit;" satırı olmalı. */
async function applyOne(db,m,{lockTimeout,statementTimeout}){
  const lines=m.sql.split('\n');
  const b=lines.flatMap((l,i)=>/^begin;\s*$/i.test(l)?[i]:[]),c=lines.flatMap((l,i)=>/^commit;\s*$/i.test(l)?[i]:[]);
  if(b.length!==1||c.length!==1||b[0]>c[0])throw Error(m.file+': tek begin;/commit; çifti bekleniyor');
  if(lines.slice(c[0]+1).some(l=>l.trim()&&!l.trim().startsWith('--')))throw Error(m.file+': commit; sonrasında komut var');
  const before=await existingRelations(db);
  await db.exec(`set lock_timeout='${lockTimeout}'; set statement_timeout='${statementTimeout}'`);
  const t0=process.hrtime.bigint();
  try{
    await db.exec(lines.slice(0,c[0]).join('\n'));
    const locks=(await db.query(`select coalesce(n.nspname||'.'||c.relname,l.relation::text) rel,l.mode from pg_locks l left join pg_class c on c.oid=l.relation
      left join pg_namespace n on n.oid=c.relnamespace
      where l.pid=pg_backend_pid() and l.granted and l.locktype='relation' order by 1,2`)).rows;
    await db.exec('commit');
    const ms=Number(process.hrtime.bigint()-t0)/1e6;
    const strong=locks.filter(l=>STRONG.includes(l.mode)&&before.has(l.rel)).map(l=>l.rel+' '+l.mode);
    return {file:m.file,ok:true,ms:Math.round(ms*10)/10,locks:locks.length,strong_on_existing:[...new Set(strong)]};
  }catch(e){
    await db.exec('rollback').catch(()=>{});
    return {file:m.file,ok:false,error:e.code?e.code+' '+e.message:e.message};
  }finally{await db.exec('reset lock_timeout; reset statement_timeout').catch(()=>{});}
}

async function runFixtures(db){
  const inventory=async()=>JSON.stringify((await db.query(`select
    (select count(*) from auth.users) users,(select count(*) from public.profiles) profiles,(select count(*) from public.listings) listings,
    (select count(*) from public.transport_jobs) jobs,(select count(*) from public.listing_favorites) favorites,
    (select count(*) from public.listing_conversations) conversations,(select count(*) from public.conversation_messages) messages,
    (select count(*) from public.carrier_applications) applications,(select count(*) from public.carrier_document_files) files,
    (select count(*) from storage.objects) objects,(select count(*) from private.admin_members where active) active_admins,
    (select count(*) from private.legal_records) legal_records,(select count(*) from private.legal_holds) legal_holds`)).rows[0]);
  const out=[];
  for(const f of fs.readdirSync(path.join(root,'supabase/tests')).filter(f=>f.endsWith('.sql')).sort()){
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
    const before=await inventory();
    try{await db.exec(fs.readFileSync(path.join(root,'supabase/tests',f),'utf8'));}
    catch(e){await db.exec('rollback;reset role').catch(()=>{});out.push({file:f,ok:false,error:e.message});continue;}
    const after=await inventory();
    out.push(after===before?{file:f,ok:true}:{file:f,ok:false,error:'satır sayıları değişti'});
  }
  return out;
}

/** restore-verify kancası: bekleyenleri uygular ve denetler. Dönüş {ok, detail}. */
/** expectedTriggers: güvenilir dış tetikleyici tanımları (reference-build.cjs; uygulanmış migration'ların gerçek sonucu). */
function rehearsalHook({lockTimeout='5s',statementTimeout='60s',list=repoMigrations(),expected=null,expectedTriggers=null,beforeFixtures=null,onReport}={}){
  return async(db,source,{bundleDir}={})=>{
    const {readMeta}=require('./scope-export.cjs');
    const report={lock_timeout:lockTimeout,statement_timeout:statementTimeout};
    const fail=detail=>{report.error=detail;if(onReport)onReport(report);return {ok:false,detail:report};};
    if(!source.meta_files||!source.meta_files['supabase_migrations.schema_migrations']?.present)return fail('yedekte migration geçmişi yok');
    const history=readMeta(bundleDir,source.meta_files)['supabase_migrations.schema_migrations'];
    const st=historyStatus(history,list);
    report.history={applied:st.applied,last:st.last,unknown:st.unknown,gaps:st.gaps};
    if(!st.ok)return fail('migration geçmişi repoyla tutarsız');
    const pending=list.filter(m=>st.pending.includes(m.file));
    // O5: yedekteki SQL güvenilmez. X.pre.sql (Auth/Storage tablolarının yapısı) yalnız katı biçim denetiminden sonra;
    // tetikleyiciler yedekteki tanımdan DEĞİL, güvenilir referanstan (reference-build.cjs) kurulur ve yedektekiyle aynı olmalı.
    const {externalTriggerSql,validateExternalDDL,triggerStatus}=require('./restore-meta.cjs');
    const ext=source.external_triggers||[];
    if(ext.length&&!expectedTriggers)return fail('dış tetikleyiciler için referans derlemesi (expectedTriggers) gerekli');
    if(expectedTriggers){const ts=triggerStatus(ext,expectedTriggers);if(!ts.ok)return fail('dış tetikleyiciler referansla uyuşmuyor: '+ts.problems.join('; '));}
    const xpre=path.join(bundleDir,'X.pre.sql');
    if(fs.existsSync(xpre)){
      const ddl=fs.readFileSync(xpre,'utf8');
      try{validateExternalDDL(ddl);}catch(e){return fail(e.message);}
      await db.exec(ddl);
    }
    for(const q of externalTriggerSql(expectedTriggers||[]))await db.exec(q);
    report.external_triggers=(expectedTriggers||[]).map(x=>x.table+'.'+x.name);
    report.migrations=[];
    for(const m of pending){
      const r=await applyOne(db,m,{lockTimeout,statementTimeout});report.migrations.push(r);
      if(!r.ok)return fail('migration başarısız: '+m.file);
    }
    const want=expected||fs.readFileSync(path.join(root,'supabase/schema/snapshot.txt'),'utf8').split('\n').map(x=>x.replace(/\r$/,'')).filter(x=>x&&!x.startsWith('#'));
    const actual=(await db.query(FULL_SNAPSHOT_SQL)).rows.map(r=>r.line);
    const d=diff(want,actual);
    report.schema={lines:actual.length,missing:d.missing,extra:d.extra};
    const {check}=require('../api-contract.cjs');
    const c=await check({client:false,db});
    report.contract={checks:c.checks,fails:c.fails.slice(0,20)};
    if(beforeFixtures)report.data=await beforeFixtures(db);
    report.fixtures=await runFixtures(db);
    if(onReport)onReport(report);
    const ok=!d.missing.length&&!d.extra.length&&!c.fails.length&&report.fixtures.every(f=>f.ok);
    return {ok,detail:ok?`${pending.length} migration uygulandı; şema 0 fark; sözleşme ${c.checks}; fixture ${report.fixtures.length}/${report.fixtures.length}`:report};
  };
}

module.exports={applyOne,runFixtures,rehearsalHook,STRONG};

/* Komut satırı (gerçek yedeğin çevrim dışı makinede çözülmüş paketiyle):
 *   NAKGO_PG_HOST=localhost node tools/backup/migration-rehearsal.cjs --bundle KLASÖR --report YENİ_DOSYA --pg-install SUNUCU_KURULUMU */
if(require.main===module)(async()=>{
  const args=process.argv.slice(2);const arg=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const bundle=arg('--bundle'),out=arg('--report');
  if(!bundle||!out)throw Error('kullanım: --bundle KLASÖR --report YENİ_DOSYA');
  const {restoreAndVerify}=require('./restore-verify.cjs');
  // Dış tetikleyiciler için güvenilir referans: uygulanmış migration'lar ağsız atılabilir kümede (--pg-install).
  let expectedTriggers=null;
  if(arg('--pg-install')){
    const {readMeta}=require('./scope-export.cjs');const {appliedList}=require('./restore-meta.cjs');
    const src=JSON.parse(fs.readFileSync(path.join(bundle,'source.json'),'utf8'));
    const applied=appliedList(readMeta(bundle,src.meta_files||{})['supabase_migrations.schema_migrations']||[]);
    if(!applied)throw Error('migration geçmişi repo ile eşleşmiyor');
    expectedTriggers=(await require('./reference-build.cjs').buildReference({installDir:arg('--pg-install'),list:applied,scope:JSON.parse(fs.readFileSync(path.join(root,'ops/backup/scope.json'),'utf8'))})).triggers;
  }
  let report=null;
  const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,hooks:{rehearsal:rehearsalHook({expectedTriggers,onReport:r=>{report=r;}})}});
  const fd=fs.openSync(out,'wx',0o600);try{fs.writeSync(fd,JSON.stringify({status:v.status,checks:v.checks.map(c=>({code:c.code,ok:c.ok})),notes:v.notes,rehearsal:report},null,1));}finally{fs.closeSync(fd);}
  console.log('prova: '+v.status+' → '+out);
  for(const f of (report&&report.fixtures||[]).filter(f=>!f.ok))console.log('  fixture başarısız (DUR, incelenmeli): '+f.file+': '+f.error);
  process.exitCode=v.status==='ok'?0:1;
})().catch(e=>{console.error('prova durdu: '+e.message);process.exitCode=1;});

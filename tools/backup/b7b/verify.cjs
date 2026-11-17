/** B7-B kabul testleri (docs/backup/b7b-acceptance.md): V1–V8 ve #125 senaryo yalıtımı.
 *
 * Her fonksiyon {code, status, detail} döndürür: status 'pass' | 'fail' | 'stop' | 'review'.
 *   fail   = kabul ölçütü sağlanmadı;  stop = insan incelemesi gerekir, sonraki teste geçilmez;
 *   review = ölçüm yapıldı, sonucu insan değerlendirir (ör. mesaj tüketen yuva var mı).
 * Bu dosya bağlantı KURMAZ; çağıran verdiği istemcileri (pg Client ya da db-lib) ve depoyu kullanır. Canlı çalıştırma
 * yalnız tools/backup/b7b/run.cjs üzerinden, güvenlik kapılarından sonra yapılır. Çıktıda parola, belirteç, bağlantı
 * adresi ya da kullanıcı verisi bulunmaz: yalnız durum kodları, sayılar ve adlar. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const BR=require('../backup-role.cjs');
const PA=require('../privilege-audit.cjs');
const root=path.resolve(__dirname,'../../..');

const r=(code,status,detail)=>({code,status,detail});
const q=async(c,sql,args)=>(await c.query(sql,args)).rows;
const errCode=async(p)=>{try{await p;return null;}catch(e){return e.code||'error';}};

// #125 (yasal arşiv) migration'ının sabitlenmiş kopyası: #125 PR'ına dokunulmaz, yalnız bu dosya uygulanır.
const LEGAL125={file:path.join(root,'tests/backup/fixtures/legal_archive.b25013e.sql'),name:'20261117000000_legal_archive.sql',
  sha256:'a32d8e90e9fadb1bcbb439c3473946df49c20a060b34804aad3d4f5b6cf3d099',marker:'private.legal_records'};

/* ---------- Senaryo yalıtımı ve migration'lar (yalnız test projesinde, yönetici istemcisiyle) ---------- */

/** Uygulanan dosyalar test projesinde b7b_test.applied tablosunda tutulur (ad + sha256). Aynı ad farklı içerikle gelirse
 * durur. Bu şema yedek kapsamında değildir (public/private dışı) ve yedek rolünün orada yetkisi yoktur. */
async function applyMigrations(admin,{list,dir=path.join(root,'supabase/migrations')}={}){
  const files=list||fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort().map(f=>({name:f,sql:fs.readFileSync(path.join(dir,f),'utf8')}));
  await admin.query(`create schema if not exists b7b_test; revoke all on schema b7b_test from public;
    create table if not exists b7b_test.applied(name text primary key,sha256 text not null,applied_at timestamptz not null default now())`);
  const done=new Map((await q(admin,`select name,sha256 from b7b_test.applied`)).map(x=>[x.name,x.sha256]));
  const applied=[];
  for(const m of files){
    const sha=crypto.createHash('sha256').update(m.sql).digest('hex');
    if(done.has(m.name)){if(done.get(m.name)!==sha)throw Error('uygulanmış migration değişmiş: '+m.name);continue;}
    try{await admin.query(m.sql);}catch(e){throw Error(m.name+': '+e.message);}
    await admin.query(`insert into b7b_test.applied(name,sha256) values($1,$2)`,[m.name,sha]);
    applied.push(m.name);
  }
  return applied;
}

/** Projenin hangi senaryoda olduğu: #125 tabloları varsa 'legal125', yoksa 'base'. */
async function scenarioOf(admin){
  return (await q(admin,`select to_regclass($1) is not null x`,[LEGAL125.marker]))[0].x?'legal125':'base';
}

/** Senaryo kapısı. base: #125 nesnesi OLMAMALI (varsa bu proje temel senaryo için kullanılamaz; yeni proje gerekir).
 * legal125: önce bütün depo migration'ları, sonra yalnız sabitlenmiş #125 kopyası (sha256 eşleşmeli). Geri dönüş yok:
 * bir proje legal125'e geçtikten sonra temel senaryo o projede tekrar koşulamaz. */
async function prepareScenario(admin,scenario){
  if(!['base','legal125'].includes(scenario))return r('scenario','stop','bilinmeyen senaryo');
  const before=await scenarioOf(admin);
  if(scenario==='base'&&before==='legal125')return r('scenario','stop','proje #125 senaryosuna geçmiş; temel senaryo için yeni geçici proje gerekir');
  const applied=await applyMigrations(admin);
  if(scenario==='legal125'){
    const sql=fs.readFileSync(LEGAL125.file,'utf8');
    const sha=crypto.createHash('sha256').update(sql).digest('hex');
    if(sha!==LEGAL125.sha256)return r('scenario','stop','#125 kopyasının sha256\'sı sabit değerle uyuşmuyor');
    applied.push(...await applyMigrations(admin,{list:[{name:LEGAL125.name,sql}]}));
  }
  const after=await scenarioOf(admin);
  return after===scenario?r('scenario','pass',{scenario,applied}):r('scenario','fail',{expected:scenario,found:after});
}

/* ---------- R2: V1–V3 (store: S3Store; testte yerel taklit) ---------- */

/** Belirteç kapsamı: hesap düzeyinde kova listeleme reddedilmeli (yalnız test kovasına bağlı "Object Read & Write"). */
async function r2Scope(store){
  const s=await store.listBucketsStatus();
  return r('R2-scope',[401,403].includes(s)?'pass':s===200?'fail':'stop',{list_buckets_status:s});
}

async function v1(store,{prefix,n=20}){
  const bad=[];
  for(let i=0;i<n;i++){
    const k=`${prefix}v1/${i}`;
    const a=await store.put(k,Buffer.from('ilk'),{ifNoneMatch:true});
    const b=await store.put(k,Buffer.from('ikinci'),{ifNoneMatch:true});
    const g=await store.get(k);
    if(!a.ok||b.status!==412||!g||g.toString()!=='ilk')bad.push({i,first:a.status,second:b.status});
    if(b.status&&![200,412].includes(b.status))return r('V1','stop',{i,status:b.status});
  }
  let won=0;
  for(let i=0;i<n;i++){
    const k=`${prefix}v1c/${i}`;
    const rs=await Promise.all([store.put(k,Buffer.from('a'),{ifNoneMatch:true}),store.put(k,Buffer.from('b'),{ifNoneMatch:true})]);
    if(rs.filter(x=>x.ok).length===1)won++;else bad.push({concurrent:i,statuses:rs.map(x=>x.status)});
  }
  return bad.length?r('V1','fail',{bad:bad.slice(0,5),count:bad.length}):r('V1','pass',{sequential:n,concurrent_single_winner:won});
}

async function v2(store,{prefix,n=50}){
  const bad=[];
  for(let i=0;i<n;i++){
    const k=`${prefix}v2/${i}`,body=crypto.randomBytes(64);
    const p=await store.put(k,body,{ifNoneMatch:true});
    if(!p.ok){if([401,403].includes(p.status))return r('V2','stop',{status:p.status});bad.push({i,put:p.status});continue;}
    const g=await store.get(k),h=await store.head(k),l=await store.list(`${prefix}v2/`);
    if(!g||!g.equals(body)||!h||h.size!==64||!l.some(o=>o.key===k))bad.push({i});
  }
  return bad.length?r('V2','fail',{bad:bad.slice(0,5),count:bad.length}):r('V2','pass',{tries:n});
}

/** Kilitli önekte silme ve üzerine yazma reddedilmeli; kilitsiz önekte izin verilmeli. Kilidin süre sonunda kalktığı ve
 * yazma belirtecinin kilit kuralını değiştiremediği elle doğrulanır (S3 API'si kilit kuralına erişmez). */
async function v3(store,{lockedPrefix,openPrefix}){
  const k=lockedPrefix+'v3/x',o=openPrefix+'v3/x';
  const p=await store.put(k,Buffer.from('kilitli'),{ifNoneMatch:true});
  if(!p.ok)return r('V3','stop',{put:p.status});
  const del=await store.delete(k),over=await store.put(k,Buffer.from('değişti'));
  const g=await store.get(k);
  await store.put(o,Buffer.from('açık'),{ifNoneMatch:true});
  const del2=await store.delete(o);
  const ok=!del.ok&&!over.ok&&g&&g.toString()==='kilitli'&&del2.ok;
  return r('V3',ok?'pass':'fail',{locked_delete:del.status,locked_overwrite:over.status,unlocked_delete:del2.status,
    manual:['kilit süresi dolunca silme başarılı','yazma belirteci kilit kuralını değiştiremiyor']});
}

/* ---------- Supabase: V4–V7 ---------- */

/** Rolü (yeniden) kurar: test projesinde varsa önce kaldırılır. Parola çalışmaya özgü ve rastgele; hiçbir yere yazılmaz. */
async function v4(admin,{role,password}){
  const ex=(await q(admin,`select 1 from pg_roles where rolname=$1`,[role])).length;
  if(ex)await admin.query(BR.dropLiteral(role));
  const code=await errCode(admin.query(BR.renderLiteral({role,password,validUntil:new Date(Date.now()+864e5).toISOString()})));
  if(code)return r('V4',code==='42501'?'stop':'fail',{error:code});
  const a=(await q(admin,`select rolbypassrls,rolsuper,(select count(*)::int from pg_auth_members m where m.member=r.oid) memberships,
      (select rolbypassrls from pg_roles where rolname=current_user) admin_bypassrls,(select rolsuper from pg_roles where rolname=current_user) admin_super
    from pg_roles r where rolname=$1`,[role]))[0];
  const own=(await q(admin,`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname like 'nakgo\\_backup\\_%' and p.proowner<>n.nspowner`))[0].n;
  const ok=a&&a.rolbypassrls&&!a.rolsuper&&a.memberships===0&&own===0;
  return r('V4',ok?'pass':'fail',{bypassrls:a&&a.rolbypassrls,superuser:a&&a.rolsuper,memberships:a&&a.memberships,
    functions_not_owned_by_schema_owner:own,admin_bypassrls:a&&a.admin_bypassrls,admin_superuser:a&&a.admin_super});
}

const FORBIDDEN_READS=['auth.sessions','auth.refresh_tokens','auth.users','storage.objects'];
const TOKEN_COLUMNS=()=>BR.loadScope().export_token_columns['auth.users'];

async function v5(admin,backup,{role,scope=BR.loadScope()}){
  const problems=await BR.verifyRole((s,a)=>admin.query(s,a),{role,scope});
  const reads={};
  for(const t of FORBIDDEN_READS){
    if(!(await q(admin,`select to_regclass($1) is not null x`,[t]))[0].x){reads[t]='yok';continue;}
    reads[t]=await errCode(backup.query(`select 1 from ${t} limit 1`))||'OKUNDU';
  }
  const counts={},mismatch=[];
  for(const t of scope.tables){
    if(!(await q(admin,`select to_regclass($1) is not null x`,[t.name]))[0].x)continue;
    const c=await errCode(backup.query(`select 1 from ${t.export}() limit 1`));
    if(c){if(c==='P0001')return r('V5','fail',{rls_active:t.name});mismatch.push({t:t.name,error:c});continue;}
    const viaFn=Number((await q(backup,`select count(*) n from ${t.export}()`))[0].n);
    const direct=Number((await q(admin,`select count(*) n from ${t.name}`))[0].n);
    counts[t.name]={export:viaFn,direct};
    if(viaFn!==direct)mismatch.push({t:t.name,export:viaFn,direct});
  }
  const leaked=Number((await q(backup,`select count(*) n from private.nakgo_backup_auth_users() j
    where exists(select 1 from unnest($1::text[]) k where j ? k and coalesce(j->>k,'')<>'')`,[TOKEN_COLUMNS()]))[0].n);
  const readOk=Object.values(reads).every(v=>v==='42501'||v==='yok');
  const reasons=[problems.length&&'verify_role',!readOk&&'direct_read',mismatch.length&&'count_mismatch',leaked&&'token_values'].filter(Boolean);
  return r('V5',reasons.length?'fail':'pass',{reasons,verify_role:problems,reads,counts,mismatch,users_with_token_values:leaked});
}

/** Rolün kendisiyle çalışan yetki denetimi (production'daki ön kontrolün aynısı). */
async function v6(backup,{role,allowlist=PA.loadAllowlist()}){
  const a=await PA.audit({query:(s,x)=>backup.query(s,x)},{role});
  const e=PA.evaluate(a,{allowlist});
  const usage=a.schemas.filter(s=>s.usage).map(s=>s.schema).filter(s=>!['public','private','pg_catalog','information_schema'].includes(s));
  const status=e.decision==='ok'&&!usage.length?'pass':e.decision==='stop_waivable'?'stop':'fail';
  return r('V6',status,{decision:e.decision,nonwaivable:e.nonwaivable,waivable:e.waivable.map(w=>({code:w.code,id:w.id})),
    extra_schema_usage:usage,callable_definers:a.definer_functions.map(f=>f.id),audit_sha256:e.audit_sha256});
}

// side-channels.md bölüm 2: kabul edilmiş (kapatılamayan) PUBLIC yollar. Fazlası "kalır".
const DOCUMENTED_RESIDUALS=/^(TEMP|pg_catalog\.(lo_create|lo_creat|lo_from_bytea|lo_put|lowrite|lo_truncate|lo_truncate64|lo_unlink|lo_import|pg_logical_emit_message)\()/;
// Uygulamanın kullandığı danışma kilidi anahtarı: yönetici hesap işlemleri (20261112050000_accounts_admins.sql).
const ADVISORY_KEY=7291;

/** V7 (a)–(g). backup: yedek rolü oturumu (varsayılan ayarlarıyla). admin: postgres. (g) sonunda backup oturumu
 * sonlandırılır; çağıran yeni oturum açmalıdır. */
async function v7(admin,backup,{role}){
  const d={};let status='pass';const fail=(k,v)=>{d[k]=v;status=status==='stop'?'stop':'fail';};
  // (a) varsayılan oturumda büyük nesne, (b) geçici tablo: salt okunur işlem hatası (25006) beklenir.
  d.a_lo_create_default=await errCode(backup.query(`select lo_create(0)`));
  if(d.a_lo_create_default!=='25006')fail('a_lo_create_default',d.a_lo_create_default||'BAŞARILI');
  d.b_temp_default=await errCode(backup.query(`create temp table zz_b7b(x int)`));
  if(d.b_temp_default!=='25006')fail('b_temp_default',d.b_temp_default||'BAŞARILI');
  // (c) oturum ayarı kapatılınca büyük nesne oluşur (belgelenen kalan risk) ve yedek korumasının okuduğu sayı > 0 olur.
  // Büyük nesne her durumda (ölçüm hata verse de) silinir: önce yedek oturumu, olmazsa yönetici oturumu.
  let lo=null,seen=0,after=null;
  try{
    await backup.query(`set default_transaction_read_only = off`);
    lo=await backup.query(`select lo_create(0) oid`).then(x=>x.rows[0].oid,e=>({error:e.code}));
    seen=Number((await q(backup,`select count(*) n from pg_catalog.pg_largeobject_metadata`))[0].n);
  }finally{
    if(lo&&!lo.error){
      const u=await errCode(backup.query(`select lo_unlink($1)`,[lo]));
      if(u)await admin.query(`select lo_unlink($1)`,[lo]);
    }
    after=Number((await q(admin,`select count(*) n from pg_catalog.pg_largeobject_metadata where oid=$1`,[lo&&!lo.error?lo:0]))[0].n);
    await errCode(backup.query(`set default_transaction_read_only = on`));
  }
  d.c_lo_after_override={created:!!(lo&&!lo.error),guard_sees:seen>0,cleaned:after===0};
  if(after!==0)fail('c_lo_not_cleaned',lo);
  if(lo&&!lo.error&&!(seen>0))fail('c_guard_blind',true);
  // (d) ağ: net.* / http* / dblink* çağrılabilir olmamalı (çağrı YAPILMAZ, yalnız yetki okunur).
  const net=(await q(backup,`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='net' or (n.nspname<>'pg_catalog' and p.proname ~ '^(http|dblink)'))
      and has_schema_privilege(current_user,n.oid,'USAGE') and has_function_privilege(current_user,p.oid,'EXECUTE')`)).map(x=>x.f);
  d.d_network_callable=net;if(net.length)status='stop';
  // (e) WAL mesajı: çağrı başarılı beklenir; mesajları okuyabilecek yuvalar insan incelemesi için listelenir.
  d.e_emit_message=(await errCode(backup.query(`select pg_logical_emit_message(false,'nakgo-b7b-test','ölçüm')`)))||'BAŞARILI';
  d.e_slots=await q(admin,`select slot_name,plugin,slot_type,active from pg_replication_slots order by 1`);
  d.e_publications=(await q(admin,`select pubname from pg_publication order by 1`)).map(x=>x.pubname);
  // (f) denetimin "kabul edilmiş" listesi belgeyle aynı olmalı.
  const e=PA.evaluate(await PA.audit({query:(s,x)=>backup.query(s,x)},{role}),{allowlist:PA.loadAllowlist()});
  const residual=e.info.filter(x=>x.code==='accepted_residual').map(x=>x.id);
  d.f_residual=residual;const extra=residual.filter(x=>!DOCUMENTED_RESIDUALS.test(x));
  if(extra.length)fail('f_undocumented_residual',extra);
  // (g) danışma kilidi: yedek oturumu uygulama anahtarını tutar; uygulama tarafı (yönetici oturumu, aynı xact kilidi)
  // 2 sn içinde alamamalı; postgres yedek oturumunu sonlandırınca hemen alabilmeli.
  const pid=(await q(backup,`select pg_backend_pid() p`))[0].p;
  if(typeof backup.on==='function')backup.on('error',()=>{});// sonlandırılan oturumun hatası beklenen sonuçtur
  await backup.query(`select pg_advisory_lock($1)`,[ADVISORY_KEY]);
  const tryLock=async()=>{await admin.query('begin');try{await admin.query(`set local lock_timeout='2s'`);await admin.query(`select pg_advisory_xact_lock($1)`,[ADVISORY_KEY]);return null;}
    catch(x){return x.code;}finally{await admin.query('rollback').catch(()=>{});}};
  const blocked=await tryLock();
  const term=await admin.query(`select pg_terminate_backend($1) ok`,[pid]).then(x=>x.rows[0].ok,x=>x.code);
  let released='denenmedi';
  for(let i=0;i<10;i++){released=await tryLock();if(released===null)break;await new Promise(z=>setTimeout(z,300));}
  d.g_advisory={key:ADVISORY_KEY,blocked_code:blocked,app_blocked:blocked==='55P03',terminate:term,app_after_terminate:released===null?'alındı':released};
  const gv=advisoryVerdict(d.g_advisory);if(gv)fail('g_verdict',gv);
  if(status==='pass'&&d.e_slots.length)status='review';
  return r('V7',status,d);
}

/** (g) yorumu: uygulama tarafı kilidi alamamalı (55P03, risk belgelendiği gibi) VE postgres yedek oturumunu
 * sonlandırıp kilidi hemen alabilmeli (müdahale yolu). Hata yoksa null. */
function advisoryVerdict(g){
  if(g.blocked_code!=='55P03')return 'uygulama kilidi beklemedi: '+g.blocked_code;
  if(g.terminate!==true)return 'postgres yedek oturumunu sonlandıramadı: '+g.terminate;
  if(g.app_after_terminate!=='alındı')return 'sonlandırmadan sonra kilit alınamadı: '+g.app_after_terminate;
  return null;
}

/** Test rolünün temizliği (başarıda da hatada da çağrılır): oturumları kapatılır, sahip olduğu her şey (büyük nesneler
 * dahil) DROP OWNED ile kaldırılır, rol silinir; sonra yokluğu doğrulanır. */
async function cleanupRole(admin,{role}){
  const exists=async()=>(await q(admin,`select 1 from pg_roles where rolname=$1`,[role])).length>0;
  if(!await exists())return r('cleanup','pass',{role_present:false,large_objects_owned:0});
  const owned=Number((await q(admin,`select count(*) n from pg_largeobject_metadata where lomowner=(select oid from pg_roles where rolname=$1)`,[role]))[0].n);
  await errCode(admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where usename=$1 and pid<>pg_backend_pid()`,[role]));
  const e=await errCode(admin.query(require('../backup-role.cjs').dropLiteral(role)));
  const still=await exists();
  return r('cleanup',still?'fail':'pass',{role_present:still,large_objects_owned_before:owned,error:e});
}

module.exports={r2Scope,cleanupRole,advisoryVerdict,LEGAL125,ADVISORY_KEY,DOCUMENTED_RESIDUALS,applyMigrations,scenarioOf,prepareScenario,v1,v2,v3,v4,v5,v6,v7};

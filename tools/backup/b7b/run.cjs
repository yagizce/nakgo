/** B7-B canlı test çalıştırıcısı. YALNIZ .github/workflows/b7b-test.yml içinden, elle tetiklenen çalışmada kullanılır.
 *
 * Sıra: güvenlik kapıları (bağlantıdan ÖNCE) → seçilen takım → kanıt özeti (yalnız durumlar ve sayılar).
 *   r2                : V1 → V2 → V3 (test kovası)
 *   supabase-base     : senaryo "base" (#125 yok) → V4 → V5 → V6 → V7 → V8
 *   supabase-legal125 : senaryo "legal125" (sabitlenmiş #125 kopyası) → V4 → V5 → V6 → V8 (yasal tablolar beklenir)
 * Bir test "pass" (ya da V7'de "review") değilse sonraki teste geçilmez.
 *
 * Anahtarlar: K1, K2, K7 ve iki age alıcısı her çalışmada bellekte/geçici klasörde ÜRETİLİR ve çalışma bitince yok olur
 * (K-3: yalnız geçici test). Hiçbir anahtar gizli değişkenden okunmaz ya da saklanmaz. Yedek rolünün parolası da her
 * çalışmada rastgeledir; rol bir günlük "valid until" ile oluşturulur. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const G=require('./guards.cjs');
const V=require('./verify.cjs');

const ROLE='nakgo_backup';

async function v8({conn,store,anchorStore,pgBin,expectLegal,allowLocal=false,Client=require('pg').Client,runId,workRoot=os.tmpdir()}){
  const {runAll}=require('../run.cjs');
  const {StoreAnchor}=require('../anchor.cjs');
  const {testKeyPair}=require('../crypto.cjs');
  const {recipientsSha256}=require('../encrypt.cjs');
  const {loadScope}=require('../backup-role.cjs');
  const PA=require('../privilege-audit.cjs');
  const dir=fs.mkdtempSync(path.join(workRoot,'nakgo-b7b-keys-'));
  try{
    // Geçici age alıcıları: kimlik dosyaları bu klasörde kalır ve çalışma sonunda silinir.
    const pubs=[0,1].map(i=>{const f=path.join(dir,'id'+i);execFileSync('age-keygen',['-o',f],{stdio:'pipe'});return /# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1];});
    const recipientsFile=path.join(dir,'recipients.txt');fs.writeFileSync(recipientsFile,pubs.join('\n')+'\n',{mode:0o600});
    const k1=testKeyPair(),k2=testKeyPair();
    const config={version:1,recipients_sha256:recipientsSha256(recipientsFile),trusted_k1:{[k1.keyId]:k1.publicKey},trusted_k2:{[k2.keyId]:k2.publicKey},
      deletion:{enabled:false,retention_days:15,min_verified_remaining:4,max_verified_age_hours:24},
      store_capabilities:{verified:false,conditional_put:'unverified',consistent_read:'unverified',evidence:null},
      k6_waiver:{enabled:false,allowed_environments:[]},expect_legal_tables:expectLegal};
    const s=await runAll({config,environment:'test',runId,store,anchors:[new StoreAnchor('b7b-test-anchor',anchorStore)],k1,k7:crypto.randomBytes(32),
      conn,scope:loadScope(),recipientsFile,allowLocal,pgBin,allowlist:PA.loadAllowlist(),Client,workRoot:dir});
    // İlk yasal çalışma "genesis_baseline" olayını açar (K2 serbest bırakması bekler; tasarım gereği). Test projesinde bu
    // tek açık olay kabul edilir; başka her açık olay ya da çapa/silme hatası "kalır".
    const legalOk=s.legal&&s.legal.ok&&s.legal.anchors_ok&&(s.legal.open_events===0||(expectLegal&&s.legal.open_events===1&&
      JSON.stringify(s.legal.blocking)===JSON.stringify(['genesis_baseline'])));
    const ok=s.preflight&&s.preflight.decision==='ok'&&s.backup&&s.backup.verified===true&&legalOk&&s.deletion&&s.deletion.errors===0;
    const stop=s.backup&&s.backup.stages&&s.backup.stages.dump==='failed'&&/snapshot|sertifika|certificate/i.test(JSON.stringify(s.backup));
    return {code:'V8',status:ok?'pass':stop?'stop':'fail',detail:{exit:s.exit,config_problems:s.config_problems,preflight:s.preflight,
      stages:s.backup&&s.backup.stages,verified:s.backup&&s.backup.verified,legal:s.legal&&{ok:s.legal.ok,blocking:s.legal.blocking,open_events:s.legal.open_events,anchors_ok:s.legal.anchors_ok}}};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

/** Bağlantı reddi testleri: production bağlantı kuralları test projesinde de geçerli (6543 ve sslmode=require). */
function v8ConnectionRules(conn){
  const {validateConn}=require('../dump.cjs');
  const p6543=validateConn({...conn,port:6543}),req=validateConn({...conn,sslmode:'require'});
  return {port_6543_rejected:p6543.length>0,sslmode_require_rejected:req.length>0};
}

async function suiteR2({store,prefix}){
  const out=[];
  for(const [fn,args] of [[V.v1,{prefix:'tmp/'+prefix}],[V.v2,{prefix:'tmp/'+prefix}],[V.v3,{lockedPrefix:'db/'+prefix,openPrefix:'tmp/'+prefix}]]){
    const x=await fn(store,args);out.push(x);if(x.status!=='pass')break;
  }
  return out;
}

async function suiteSupabase({scenario,admin,connectBackup,conn,store,anchorStore,pgBin,runId}){
  const out=[];const push=x=>{out.push(x);return x.status==='pass'||x.status==='review';};
  if(!push(await V.prepareScenario(admin,scenario)))return out;
  const password=crypto.randomBytes(24).toString('hex');
  if(!push(await V.v4(admin,{role:ROLE,password})))return out;
  let backup=await connectBackup(password);
  try{
    if(!push(await V.v5(admin,backup,{role:ROLE})))return out;
    if(!push(await V.v6(backup,{role:ROLE})))return out;
    if(scenario==='base'&&!push(await V.v7(admin,backup,{role:ROLE})))return out;
  }finally{await backup.end().catch(()=>{});}
  const rules=v8ConnectionRules({...conn,password});
  const x=await v8({conn:{...conn,password},store,anchorStore,pgBin,expectLegal:scenario==='legal125',runId});
  x.detail.connection_rules=rules;
  if(!rules.port_6543_rejected||!rules.sslmode_require_rejected)x.status='fail';
  push(x);
  return out;
}

module.exports={v8,v8ConnectionRules,suiteR2,suiteSupabase,ROLE};

if(require.main===module)(async()=>{
  const env=process.env;
  const ctx=G.checkRunContext(env);
  if(ctx.length)throw Error('çalışma bağlamı reddedildi: '+ctx.join('; '));
  const runId=`${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  if(!/^[0-9]+-[0-9]+$/.test(runId))throw Error('çalışma kimliği geçersiz');
  const {S3Store}=require('../store.cjs');
  const r2={endpoint:env.NAKGO_TEST_R2_ENDPOINT,bucket:env.NAKGO_TEST_R2_BUCKET};
  const r2p=G.checkR2Target(r2);
  if(r2p.length)throw Error('R2 hedefi reddedildi: '+r2p.join('; '));
  const store=new S3Store({...r2,accessKeyId:env.NAKGO_TEST_R2_ACCESS_KEY_ID,secretAccessKey:env.NAKGO_TEST_R2_SECRET_ACCESS_KEY});
  let results;
  if(env.NAKGO_TEST_SUITE==='r2')results=await suiteR2({store,prefix:`b7b-test/${runId}/`});
  else{
    const target={ref:env.NAKGO_TEST_DB_PROJECT_REF,host:env.NAKGO_TEST_DB_HOST,port:5432,adminUser:env.NAKGO_TEST_DB_ADMIN_USER,rootCertFile:env.NAKGO_TEST_DB_ROOT_CERT_FILE};
    const sp=G.checkSupabaseTarget(target);
    if(sp.length)throw Error('Supabase hedefi reddedildi: '+sp.join('; '));
    const {Client}=require('pg');
    const ssl={rejectUnauthorized:true,ca:fs.readFileSync(target.rootCertFile,'utf8'),servername:target.host};
    const base={host:target.host,port:5432,database:'postgres',ssl,application_name:'nakgo-b7b-test'};
    const admin=new Client({...base,user:target.adminUser,password:env.NAKGO_TEST_DB_ADMIN_PASSWORD});await admin.connect();
    try{
      const connectBackup=async pw=>{const c=new Client({...base,user:`${ROLE}.${target.ref}`,password:pw});await c.connect();return c;};
      const conn={host:target.host,port:5432,user:`${ROLE}.${target.ref}`,database:'postgres',sslmode:'verify-full',sslrootcert:target.rootCertFile};
      results=await suiteSupabase({scenario:env.NAKGO_TEST_SUITE==='supabase-base'?'base':'legal125',admin,connectBackup,conn,store,anchorStore:store,pgBin:env.NAKGO_PG_BIN,runId});
    }finally{await admin.end().catch(()=>{});}
  }
  const text=JSON.stringify({suite:env.NAKGO_TEST_SUITE,run:runId,results},null,1);
  console.log(text);
  if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,'```json\n'+text+'\n```\n');
  process.exitCode=results.every(x=>x.status==='pass'||x.status==='review')?0:1;
})().catch(e=>{console.error('B7-B testi durdu: '+e.message);process.exitCode=1;});

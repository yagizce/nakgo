/** B7-A4: yedek orkestratörü — A1 ön kontrolü, K6 muafiyeti, A2 boru hattı, A3 yasal kanıt zinciri ve silme kapısını
 * tek çalışmada birleştirir. Kendisi hiçbir eşiği gevşetmez; her parçanın fail-closed kararını taşır.
 *
 * Akış
 *  1. Yapılandırma denetimi (ops/backup/config.json + ortam gizlileri). Eksik alan → çalışma başlamaz.
 *  2. A1 yetki denetimi → karar: ok | stop_waivable | stop_nonwaivable (denetim hatası = başarısız).
 *  3. stop_waivable ve K6 bu ortamda açık ise: gelen kutusundaki muafiyet A1 kurallarıyla doğrulanır ve yedekten ÖNCE
 *     zincirde tek kullanımlık olarak tüketilir (gözlemsiz kontrol noktası). Tüketilemezse yedek yok.
 *     Production ortamında K6 her koşulda kapalıdır.
 *  4. A2 boru hattı. Yasal durum geri yüklenen (tutarlı anlık görüntüden gelen) veritabanından okunur.
 *  5. A3 adımı: geçiş doğrulaması, olaylar, K2 belgeleri, kontrol noktası, dış çapalar. Döküm yoksa gözlemsiz nokta.
 *  6. Silme kapısı: config'te açık + depo davranışı kanıtlı + açık olay 0 + çapalar doğrulanmış + kapsama yeterli.
 *     Sonuç K1 ile imzalanıp audit/deletions/ altına yazılır; sonraki kontrol noktası bu kaydı bağlar.
 *  7. Özet (gizli bilgi içermez) ve çıkış kodu: 0 yalnız yedek doğrulandı, zincir yazıldı ve açık olay yoksa.
 *
 * Gelen kutusu: audit/inbox/releases/*.json (K2 serbest bırakma), audit/inbox/waivers/*.json (K6). */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const PA=require('./privilege-audit.cjs');
const {validateWaiver}=require('./waiver.cjs');
const {runBackup:realRunBackup}=require('./pipeline.cjs');
const {extractState}=require('./legal-evidence.cjs');
const {advance}=require('./legal-run.cjs');
const D=require('./deletion.cjs');
const {verifyManifest}=require('./manifest.cjs');
const {sign,sha256}=require('./crypto.cjs');
const {clientConfig}=require('./dump.cjs');

const DELETION_NS='nakgo-backup-deletion/v1';
const root=path.join(__dirname,'..','..');

function loadConfig(file=path.join(root,'ops/backup/config.json')){
  const c=JSON.parse(fs.readFileSync(file,'utf8'));
  if(c.version!==1)throw Error('config sürümü geçersiz');
  return c;
}

/** Çalışmayı başlatmadan önceki eksiksizlik denetimi. Dönen liste boş değilse çalışma yapılmaz. */
function configProblems(config,{environment,k1,k7,anchors}){
  const p=[];
  if(!/^[0-9a-f]{64}$/.test(config.recipients_sha256||''))p.push('alıcı listesi hash\'i sabitlenmemiş (anahtar töreni yapılmadı)');
  if(!Object.keys(config.trusted_k1||{}).length)p.push('güvenilir K1 açık anahtarı yok');
  if(!Object.keys(config.trusted_k2||{}).length)p.push('güvenilir K2 açık anahtarı yok');
  if(!k1||!k1.privateKey||!k1.keyId)p.push('K1 gizli anahtarı yok');
  else if(!config.trusted_k1[k1.keyId])p.push('K1 anahtarı güvenilir listede değil');
  if(!Buffer.isBuffer(k7)||k7.length!==32)p.push('K7 (32 bayt) yok');
  if(!environment)p.push('ortam adı yok');
  if(!anchors||!anchors.length)p.push('dış çapa tanımlı değil');
  if(config.deletion&&config.deletion.enabled&&!(config.store_capabilities&&config.store_capabilities.verified&&config.store_capabilities.evidence))
    p.push('silme açık ama depo davranışı kanıtı (K3) yok');
  return p;
}

const k6Allowed=(config,environment)=>environment!=='production'&&config.k6_waiver&&config.k6_waiver.enabled===true&&
  Array.isArray(config.k6_waiver.allowed_environments)&&config.k6_waiver.allowed_environments.includes(environment);

async function readInbox(store,prefix){
  const out=[],bad=[];
  for(const o of await store.list(prefix)){
    try{out.push(JSON.parse(String(await store.get(o.key))));}catch{bad.push(o.key);}
  }
  return {docs:out,bad};
}

/** A1 denetimini kaynak veritabanına yedek rolüyle bağlanarak yapar. */
async function preflightAudit({conn,Client,allowlist}){
  const c=new Client(clientConfig(conn));
  await c.connect();
  try{return PA.evaluate(await PA.audit({query:(s,a)=>c.query(s,a)},{role:conn.user}),{allowlist});}
  finally{await c.end();}
}

async function coverageOf(store,trustedK1){
  const verified=[],invalid=[];
  for(const o of await store.list('manifests/')){
    let m;try{m=JSON.parse(String(await store.get(o.key)));}catch{invalid.push(o.key);continue;}
    if(!verifyManifest(m,trustedK1).ok){invalid.push(o.key);continue;}
    if(m.verified===true&&m.object_key)verified.push(m.object_key);
  }
  return {verified,invalid};
}

async function runAll(cfg){
  const {config,store,anchors,k1,k7,environment,runId,now=new Date(),conn,scope,recipientsFile,pgBin,ageBin,allowLocal=false,
    allowlist,Client,workRoot,dumpOptions,ageRecipientsFile,
    runBackupImpl=realRunBackup,preflightImpl=preflightAudit}=cfg;
  const trustedK1=config.trusted_k1,trustedK2=config.trusted_k2;
  const summary={run_id:runId,environment,started_at:now.toISOString(),config_problems:[],preflight:null,waiver:null,backup:null,legal:null,deletion:null,exit:1};
  summary.config_problems=configProblems(config,{environment,k1,k7,anchors});
  if(summary.config_problems.length){summary.reason='yapılandırma eksik';return summary;}
  // Depo yetenekleri yalnız incelenmiş yapılandırmadan gelir.
  store.capabilities={verified:config.store_capabilities.verified===true,conditionalPut:config.store_capabilities.conditional_put,consistentRead:config.store_capabilities.consistent_read};
  const chainArgs={store,trustedK1,k1,k7,trustedK2,anchors,environment,runId,ageRecipientsFile};

  // 2. A1
  let evaluation=null,preflight;
  try{evaluation=await preflightImpl({conn,Client,allowlist});}
  catch(e){preflight={status:'failed',code:'audit_error',reason:e.message};}
  if(evaluation){
    if(evaluation.decision==='ok')preflight={status:'ok'};
    else if(evaluation.decision==='stop_nonwaivable')preflight={status:'failed',code:'stop_nonwaivable',reason:evaluation.nonwaivable.map(x=>x.code).join(',')};
    else preflight={status:'failed',code:'stop_waivable',reason:'izin listesi dışı ya da değişmiş fonksiyon'};
  }
  summary.preflight={decision:evaluation&&evaluation.decision,status:preflight.status,code:preflight.code};

  // 3. K6: önce olayı aç, sonra muafiyeti zincirde tüket; ikisi de yedekten önce.
  if(evaluation&&evaluation.decision==='stop_waivable'&&k6Allowed(config,environment)){
    const inbox=await readInbox(store,'audit/inbox/waivers/');
    const opened=await advance({...chainArgs,now,state:'carry',evaluation});
    let consumed=null;
    if(opened.ok){
      for(const doc of inbox.docs){
        const validation=validateWaiver(doc,{enabled:true,environment,trustedKeys:trustedK2,now,evaluation});
        if(!validation.ok)continue;
        const r=await advance({...chainArgs,now,state:'carry',evaluation,waiver:{doc,validation}});
        if(r.ok&&r.waiver&&r.waiver.ok){consumed=doc.waiver_id;break;}
      }
    }
    summary.waiver={considered:inbox.docs.length,consumed};
    if(consumed){preflight={status:'ok',waived:true,waiver_id:consumed};summary.preflight={...summary.preflight,status:'ok',waived:true};}
  }

  // 4. A2
  let state=null,legalError=null;
  const expectLegal=config.expect_legal_tables===true;
  const backup=await runBackupImpl({conn,scope,store,recipientsFile,pinnedRecipientsSha256:config.recipients_sha256,k1,runId,now,pgBin,ageBin,allowLocal,workRoot,dumpOptions,
    hooks:{
      preflight:async()=>preflight,
      legal:async db=>{
        try{state=await extractState((s,a)=>db.query(s,a));}catch(e){legalError=e.message;return {ok:false,detail:'yasal durum okunamadı'};}
        if(state.absent)return expectLegal?{ok:false,detail:'yasal tablolar bekleniyordu ama yok'}:{na:true};
        return {ok:true,detail:'yasal durum okundu'};
      },
    }});
  const manifestKey=backup.extra&&backup.extra.manifest_upload&&backup.extra.manifest_upload.key||null;
  summary.backup={verified:backup.verified===true,stages:Object.fromEntries(Object.entries(backup.stages||{}).map(([k,v])=>[k,v.status])),manifest:manifestKey,legal_error:legalError};

  // 5. A3
  const observed=state&&!(state.absent&&expectLegal)?state:'carry';
  const releases=await readInbox(store,'audit/inbox/releases/');
  const adv=await advance({...chainArgs,now,state:observed,evaluation:evaluation||undefined,releaseDocs:releases.docs,attachmentPrefix:'audit/deletions/',
    backup:{run_id:runId,manifest_key:manifestKey,manifest_sha256:backup.manifest?sha256(JSON.stringify(backup.manifest)):null,verified:backup.verified===true}});
  summary.legal=adv.ok?{ok:true,seq:adv.seq,observed:observed!=='carry',open_events:adv.openEvents,blocking:adv.blocking.map(f=>f.code),anchors_ok:adv.anchorsOk,
    single_use_guaranteed:adv.singleUseGuaranteed,releases:adv.releases.map(r=>r.state),bad_inbox:releases.bad.length}:{ok:false,stage:adv.stage,reason:adv.reason};

  // 6. Silme kapısı
  const objects=(await store.list('db/')).map(o=>({key:o.key,last_modified:o.last_modified}));
  const cov=await coverageOf(store,trustedK1);
  const dc=config.deletion||{};
  const gate={enabled:dc.enabled===true,capabilityVerified:store.capabilities.verified===true,openEvents:adv.ok?adv.openEvents:undefined,anchorsOk:adv.ok&&adv.anchorsOk};
  const plan=D.plan({objects,now,retentionDays:dc.retention_days??15,gate,coverage:{verified:cov.verified,minRemaining:dc.min_verified_remaining??4,maxAgeHours:dc.max_verified_age_hours??24}});
  let log=[];
  if(plan.allowed&&backup.verified===true)log=await D.execute(store,plan);
  const record=sign(DELETION_NS,{version:1,run_id:runId,at:now.toISOString(),allowed:plan.allowed&&backup.verified===true,blockers:plan.blockers,due:plan.due.length,results:log,
    checkpoint_seq:adv.ok?adv.seq:null,invalid_manifests:cov.invalid.length},k1.privateKey,k1.keyId);
  let recordWrite;
  try{recordWrite=await store.put('audit/deletions/'+runId+'.json',Buffer.from(JSON.stringify(record)),{ifNoneMatch:true});}catch(e){recordWrite={ok:false,status:e.message};}
  summary.deletion={allowed:record.allowed,blockers:plan.blockers,due:plan.due.length,deleted:log.filter(x=>x.status==='deleted').length,
    errors:log.filter(x=>x.status==='error'||x.status==='refused').length,record_written:Boolean(recordWrite&&recordWrite.ok)};

  // Çıkış 0 yalnız: yedek doğrulandı, zincir yazıldı, açık olay yok, dış çapalar doğrulandı, silme hatası yok ve kayıt yazıldı.
  summary.exit=summary.backup.verified&&summary.legal.ok&&summary.legal.open_events===0&&summary.legal.anchors_ok&&summary.deletion.errors===0&&summary.deletion.record_written?0:1;
  return summary;
}

module.exports={runAll,loadConfig,configProblems,k6Allowed,coverageOf,preflightAudit,DELETION_NS};

/* Komut satırı: yalnız GitHub Actions yedek iş akışından çağrılır. Gizliler ortamdan okunur ve hiçbir yere yazılmaz. */
if(require.main===module)(async()=>{
  const {S3Store}=require('./store.cjs');
  const {StoreAnchor}=require('./anchor.cjs');
  const {keyIdOf}=require('./crypto.cjs');
  const {loadScope}=require('./backup-role.cjs');
  const env=process.env,need=k=>{if(!env[k])throw Error('eksik ortam değişkeni: '+k);return env[k];};
  const config=loadConfig();
  const s3=(p)=>new S3Store({endpoint:need(p+'_ENDPOINT'),bucket:need(p+'_BUCKET'),accessKeyId:need(p+'_ACCESS_KEY_ID'),secretAccessKey:need(p+'_SECRET_ACCESS_KEY')});
  const k1pem=need('NAKGO_K1_PRIVATE_KEY');
  const k1pub=require('node:crypto').createPublicKey(k1pem).export({type:'spki',format:'pem'});
  const summary=await runAll({
    config,environment:need('NAKGO_BACKUP_ENVIRONMENT'),runId:need('NAKGO_RUN_ID'),
    store:s3('NAKGO_R2'),anchors:[new StoreAnchor('anchor-bucket',s3('NAKGO_ANCHOR'))],
    k1:{privateKey:k1pem,keyId:keyIdOf(k1pub)},k7:Buffer.from(need('NAKGO_K7'),'base64'),
    conn:{host:need('NAKGO_DB_HOST'),port:Number(need('NAKGO_DB_PORT')),user:need('NAKGO_DB_USER'),password:need('NAKGO_DB_PASSWORD'),
      database:env.NAKGO_DB_NAME||'postgres',sslmode:'verify-full',sslrootcert:need('NAKGO_DB_ROOT_CERT_FILE')},
    scope:loadScope(),recipientsFile:path.join(root,'ops/backup/recipients.txt'),allowlist:PA.loadAllowlist(),Client:require('pg').Client,
    pgBin:env.NAKGO_PG_BIN,
  });
  const text=JSON.stringify(summary,null,2);
  console.log(text);
  if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,'```json\n'+text+'\n```\n');
  process.exitCode=summary.exit;
})().catch(e=>{console.error('yedek çalışması durdu: '+e.message);process.exitCode=1;});

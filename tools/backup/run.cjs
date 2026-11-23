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
 *  6. Silme kapısı: config'te açık + depo davranışı kanıtlı + açık olay 0 + çapalar doğrulanmış + kapsama yeterli +
 *     silme günlüğü temiz + bu çalışmanın yedeği doğrulanmış. Silmeden ÖNCE K1 imzalı niyet yazılır ve geri okunarak
 *     doğrulanır; silmeden SONRA ayrı imzalı sonuç yazılır (tools/backup/deletion-journal.cjs). Her çalışmanın kararı da
 *     audit/deletions/decisions/ altına yazılır; sonraki kontrol noktası hepsini bağlar.
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
const {sign,sha256,keyIdOf}=require('./crypto.cjs');
const {clientConfig,newClient,validateConn}=require('./dump.cjs');
const {recipientsSha256}=require('./encrypt.cjs');
const C=require('./checkpoint.cjs');
const J=require('./deletion-journal.cjs');
const SM=require('./state-machine.cjs');

const DELETION_NS='nakgo-backup-deletion/v1';
const root=path.join(__dirname,'..','..');

function loadConfig(file=path.join(root,'ops/backup/config.json')){
  const c=JSON.parse(fs.readFileSync(file,'utf8'));
  if(c.version!==1)throw Error('config sürümü geçersiz');
  return c;
}

/** Çalışmayı başlatmadan önceki eksiksizlik denetimi. Dönen liste boş değilse çalışma yapılmaz. */
function configProblems(config,{environment,k1,k7,anchors,recipientsFile}){
  const p=[];
  if(!/^[0-9a-f]{64}$/.test(config.recipients_sha256||''))p.push('alıcı listesi hash\'i sabitlenmemiş (anahtar töreni yapılmadı)');
  else if(!recipientsFile)p.push('age alıcı dosyası yok (yedekler ve kontrol noktası gövdeleri için zorunlu)');
  else{try{if(recipientsSha256(recipientsFile)!==config.recipients_sha256)p.push('age alıcı dosyası sabitlenmiş hash ile uyuşmuyor');}catch(e){p.push('age alıcı dosyası okunamadı');}}
  const t1=config.trusted_k1||{},t2=config.trusted_k2||{};
  if(!Object.keys(t1).length)p.push('güvenilir K1 açık anahtarı yok');
  if(!Object.keys(t2).length)p.push('güvenilir K2 açık anahtarı yok');
  // Görev ayrılığı: CI anahtarı (K1) sahip anahtarı (K2) yerine geçemez, tersi de.
  const ids=o=>new Set(Object.entries(o).map(([id,pem])=>{try{return keyIdOf(pem);}catch{return id;}}).concat(Object.keys(o)));
  const i1=ids(t1),i2=ids(t2);
  if([...i1].some(x=>i2.has(x)))p.push('K1 ve K2 aynı anahtarı paylaşıyor (görev ayrılığı ihlali)');
  // K9 (elle yedeğin çevrim dışı imza anahtarı) ne K1 ne K2 olabilir; B7 K9 istemez, yalnız ayrılığı denetler.
  const t9=config.trusted_k9&&typeof config.trusted_k9==='object'&&!Array.isArray(config.trusted_k9)?config.trusted_k9:{};
  const i9=ids(t9);
  if([...i9].some(x=>i1.has(x)||i2.has(x)))p.push('K9, K1 ya da K2 ile aynı anahtarı paylaşıyor (görev ayrılığı ihlali)');
  for(const [id,pem] of Object.entries({...t1,...t2})){try{if(keyIdOf(pem)!==id)p.push('anahtar kimliği açık anahtarla uyuşmuyor: '+id);}catch{p.push('açık anahtar okunamadı: '+id);}}
  if(!k1||!k1.privateKey||!k1.keyId)p.push('K1 gizli anahtarı yok');
  else if(!t1[k1.keyId])p.push('K1 anahtarı güvenilir listede değil');
  const ring=Array.isArray(k7)?k7:[k7];
  if(!ring.length||ring.some(k=>!Buffer.isBuffer(k)||k.length!==32))p.push('K7 (32 bayt) yok ya da anahtar halkası bozuk');
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

/** A1 denetimini kaynak veritabanına yedek rolüyle bağlanarak yapar. Bağlantı kuralları (verify-full, kök sertifika,
 * Supavisor sunucu adı, 5432) bağlantı AÇILMADAN denetlenir; ihlalde hiç bağlanılmaz (hata → ön kontrol başarısız).
 * Ortamdaki PGOPTIONS bu bağlantıya aktarılmaz (newClient). */
async function preflightAudit({conn,Client,allowlist,allowLocal=false}){
  const rules=validateConn(conn,{allowLocal});
  if(rules.length)throw Error('bağlantı kuralları: '+rules.join('; '));
  const c=newClient(Client,clientConfig(conn));
  c.on('error',()=>{});// kopan bağlantı süreci çökertmez; sorgu hatası denetim hatası sayılır
  await c.connect();
  try{return PA.evaluate(await PA.audit({query:(s,a)=>c.query(s,a)},{role:conn.user}),{allowlist});}
  finally{await c.end();}
}

/** Doğrulanmış yedek kapsamı: imzası geçerli, verified=true manifestler; manifestin gösterdiği nesne depoda olmalı ve
 * boyutu manifestteki şifreli boyutla aynı olmalı (yer değiştirmiş ya da eksik nesne kapsama sayılmaz). */
async function coverageOf(store,trustedK1,objects){
  const verified=[],invalid=[],refs={};
  const byKey=new Map((objects||[]).map(o=>[o.key,o]));
  for(const o of await store.list('manifests/')){
    let m;try{m=JSON.parse(String(await store.get(o.key)));}catch{invalid.push(o.key);continue;}
    if(!verifyManifest(m,trustedK1).ok){invalid.push(o.key);continue;}
    if(m.verified!==true||!m.object_key)continue;
    const obj=byKey.get(m.object_key);
    if(!obj||obj.size!==m.size){invalid.push(o.key);continue;}
    verified.push(m.object_key);
    refs[m.object_key]={manifest_key:o.key,ciphertext_sha256:m.ciphertext_sha256};
  }
  return {verified,invalid,refs};
}

async function runAll(cfg){
  const {config,store,anchors,k1,k7,environment,runId,now=new Date(),conn,scope,recipientsFile,pgBin,ageBin,allowLocal=false,
    allowlist,Client,workRoot,dumpOptions,hooks={},
    runBackupImpl=realRunBackup,preflightImpl=preflightAudit}=cfg;
  const trustedK1=config.trusted_k1,trustedK2=config.trusted_k2;
  const summary={run_id:runId,environment,started_at:now.toISOString(),config_problems:[],preflight:null,waiver:null,backup:null,legal:null,deletion:null,exit:1};
  summary.config_problems=configProblems(config,{environment,k1,k7,anchors,recipientsFile});
  if(summary.config_problems.length){summary.reason='yapılandırma eksik';return summary;}
  // Depo yetenekleri yalnız incelenmiş yapılandırmadan gelir.
  store.capabilities={verified:config.store_capabilities.verified===true,conditionalPut:config.store_capabilities.conditional_put,consistentRead:config.store_capabilities.consistent_read};
  // Kontrol noktası gövdeleri K7'ye ek olarak çevrim dışı age alıcılarına (A, B) da sarılır: K7 kaybında kurtarma.
  const chainArgs={store,trustedK1,k1,k7,trustedK2,anchors,environment,runId,ageRecipientsFile:recipientsFile};

  // 2. A1
  let evaluation=null,preflight;
  try{evaluation=await preflightImpl({conn,Client,allowlist,allowLocal});}
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

  // 5. Silme günlüğü denetimi + A3. Sonuçsuz ya da geçersiz silme niyeti bulgudur ve olay açar.
  let journal={findings:[],unresolved:[],intents:0},journalError=null;
  const chainNow=await C.readChain(store,{trustedK1});
  if(chainNow.ok){try{journal=await J.audit(store,{trustedK1,headers:chainNow.headers});}catch(e){journalError=e.message;}}
  const observed=state&&!(state.absent&&expectLegal)?state:'carry';
  const releases=await readInbox(store,'audit/inbox/releases/');
  const adv=await advance({...chainArgs,now,state:observed,evaluation:evaluation||undefined,releaseDocs:releases.docs,attachmentPrefix:'audit/deletions/',
    extraFindings:journal.findings,
    backup:{run_id:runId,manifest_key:manifestKey,manifest_sha256:backup.manifest?sha256(JSON.stringify(backup.manifest)):null,verified:backup.verified===true}});
  summary.legal=adv.ok?{ok:true,seq:adv.seq,observed:observed!=='carry',open_events:adv.openEvents,blocking:adv.blocking.map(f=>f.code),anchors_ok:adv.anchorsOk,
    single_use_guaranteed:adv.singleUseGuaranteed,releases:adv.releases.map(r=>r.state),bad_inbox:releases.bad.length}:{ok:false,stage:adv.stage,reason:adv.reason};

  // 5b. İnsan incelemesi ve K2 ile kabul edilmiş sonuçsuz niyetler eşleştirilir: nesnelerin gerçek durumu okunur ve
  // "reconciled" sonuç yazılır. Eski niyet YÜRÜTÜLMEZ.
  const accepted=adv.ok?SM.acceptedKeys({events:adv.events}):new Set();
  const keyOf=f=>`${f.code}|${f.table}|${f.id}`;
  let reconciled=0;
  for(const intent of journal.unresolved){
    if(!accepted.has(`deletion_result_missing|deletions|${J.findingId(intent.checkpoint_seq)}`))continue;
    const r=await J.reconcile(store,{k1,intent,now});
    if(r.ok)reconciled++;
  }
  const pendingJournal=journal.findings.filter(f=>!accepted.has(keyOf(f)));
  const journalClean=chainNow.ok&&!journalError&&pendingJournal.length===0;

  // 6. Silme kapısı ve günlüklü silme.
  const objects=(await store.list('db/')).map(o=>({key:o.key,last_modified:o.last_modified,size:o.size}));
  const cov=await coverageOf(store,trustedK1,objects);
  const dc=config.deletion||{};
  const gate={enabled:dc.enabled===true,capabilityVerified:store.capabilities.verified===true,openEvents:adv.ok?adv.openEvents:undefined,anchorsOk:adv.ok&&adv.anchorsOk};
  const plan=D.plan({objects,now,retentionDays:dc.retention_days??15,gate,coverage:{verified:cov.verified,minRemaining:dc.min_verified_remaining??4,maxAgeHours:dc.max_verified_age_hours??24}});
  const blockers=[...plan.blockers];
  if(!journalClean)blockers.push('silme günlüğünde çözülmemiş niyet ya da geçersiz kayıt var'+(journalError?' ('+journalError+')':''));
  if(backup.verified!==true)blockers.push('bu çalışmanın yedeği doğrulanmadı');
  const del={allowed:plan.allowed&&blockers.length===0,intent_written:null,result_written:null,alarm:null};
  let log=[];
  if(del.allowed&&plan.delete.length){
    // Niyetin dayandığı kontrol noktası hâlâ zincirin başı olmalı.
    if(hooks.beforeHeadCheck)await hooks.beforeHeadCheck();
    const again=await C.readChain(store,{trustedK1});
    if(!again.ok||!again.head||again.head.seq!==adv.seq||C.headerSha(again.head)!==adv.sha){blockers.push('zincir başı değişti; niyet yazılmadı');del.allowed=false;}
    else{
      const intent=await J.writeIntent(store,{k1,runId,checkpoint:{seq:adv.seq,sha:adv.sha},keys:plan.delete,refs:cov.refs,now});
      del.intent_written=intent.ok;
      if(!intent.ok){blockers.push('silme niyeti yazılamadı ya da doğrulanamadı: '+intent.error);del.allowed=false;}
      else{
        if(hooks.afterIntent)await hooks.afterIntent();
        log=await D.execute(store,{delete:intent.doc.objects.map(o=>o.key)});
        if(hooks.afterExecute)await hooks.afterExecute();
        const result=await J.writeResult(store,{k1,intent:intent.doc,results:log,now});
        del.result_written=result.ok;
        // Silme gerçekleşti ama sonuç kaydı yok: güvenli duruş. Sonraki çalışma bu niyeti bulgu sayar ve silmeyi durdurur.
        if(!result.ok)del.alarm='deletion_result_missing';
      }
    }
  }
  const decision=sign(DELETION_NS,{version:1,run_id:runId,at:now.toISOString(),allowed:del.allowed,blockers,due:plan.due.length,
    intent_seq:del.intent_written?adv.seq:null,checkpoint_seq:adv.ok?adv.seq:null,invalid_manifests:cov.invalid.length,reconciled},k1.privateKey,k1.keyId);
  let recordWrite;
  try{recordWrite=await store.put('audit/deletions/decisions/'+runId+'.json',Buffer.from(JSON.stringify(decision)),{ifNoneMatch:true});}catch(e){recordWrite={ok:false,status:e.message};}
  summary.deletion={allowed:del.allowed,blockers,due:plan.due.length,deleted:log.filter(x=>x.status==='deleted').length,
    errors:log.filter(x=>x.status==='error'||x.status==='refused').length,record_written:Boolean(recordWrite&&recordWrite.ok),
    intent_written:del.intent_written,result_written:del.result_written,alarm:del.alarm,unresolved_intents:journal.unresolved.length-reconciled,reconciled};

  // Çıkış 0 yalnız: yedek doğrulandı, zincir yazıldı, açık olay yok, çapalar doğrulandı, silme hatası yok, karar kaydı
  // yazıldı ve (silme yapıldıysa) niyet ile sonuç kaydı ikisi de yazıldı.
  summary.exit=summary.backup.verified&&summary.legal.ok&&summary.legal.open_events===0&&summary.legal.anchors_ok&&summary.deletion.errors===0
    &&summary.deletion.record_written&&del.alarm===null&&del.intent_written!==false?0:1;
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
    k1:{privateKey:k1pem,keyId:keyIdOf(k1pub)},
    // K7 halkası: güncel anahtar + rotasyondan kalan eski anahtarlar (virgülle, base64). Yazma yalnız güncel anahtarla.
    k7:[need('NAKGO_K7'),...(env.NAKGO_K7_PREVIOUS?env.NAKGO_K7_PREVIOUS.split(','):[])].map(x=>Buffer.from(x.trim(),'base64')),
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

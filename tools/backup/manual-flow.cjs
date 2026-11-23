/** Elle yedek akışı (bootstrap, K6b): run → offline-sign → finalize. Ortak şemalar, hash'ler, imza zinciri ve finalize.
 *
 *   run           (çevrim içi, K9 yok)  şifreli paket + imzasız manifest gövdesi + imza isteği (manual/pending/<run>/)
 *   offline-sign  (çevrim dışı, K9)     çapa + araç paketi + L1/L2 + R1–R7 + T8 → izin listeli kayıt + iki imza (yanıt)
 *   finalize      (çevrim içi)          bekleyen istek + yanıt + paket → imzalı manifest ve kayıt, atomik, üzerine yazmadan
 *
 * Bu modül offline-sign, finalize ve dr-fetch'in KULLANDIĞI TEK doğrulama kodudur (test kaynakta denetler).
 * Hiçbir yerde özel anahtar okumaz ya da imza atmaz (imza yalnız offline-sign.cjs'te). */
'use strict';
const C=require('./crypto.cjs');
const SJ=require('./strict-json.cjs');
const {objectKeys}=require('./pipeline.cjs');
const {DATA_STAGES}=require('./manifest.cjs');

const NS_MANIFEST='nakgo-manual-manifest/v1';
const NS_RECORD='nakgo-manual-record/v1';
const H_REQUEST='nakgo-manual-request/v1';
const H_MANIFEST_BODY='nakgo-manual-manifest-body/v1';
const H_ANCHOR='nakgo-anchor/v1';
const H_REFERENCE='nakgo-reference/v1';
const KINDS=['bootstrap','k6b'];
const LIMITS={request:1<<20,response:1<<16,manifest:1<<16,record:1<<16,failed:1<<14,anchor:1<<16,reference:4<<20,config:1<<16};
const SIG_FIELDS=['signature','sig_alg','key_id','namespace'];

const bad=(code,msg)=>{throw Object.assign(Error(msg||code),{code});};

/* ---------- küçük şema yardımcıları ---------- */
const RE={
  run_id:/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  iso:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  isoUs:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/,
  hex64:/^[0-9a-f]{64}$/,hex40:/^[0-9a-f]{40}$/,keyid:/^[0-9a-f]{16}$/,
  code:/^[a-z][a-z0-9_]{0,39}$/,
  approval:/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,119}$/,
  txid:/^\d{1,20}:\d{1,20}:(\d{1,20}(,\d{1,20})*)?$/,
  version:/^\d{1,3}(\.\d{1,3}){0,2}( .{0,40})?$/,
  sig:/^[A-Za-z0-9+/]{86}==$/,
};
const STATUS=['ok','failed','skipped','pending','n/a','deferred'];
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function exactKeys(o,keys,where){
  if(!isObj(o))bad('schema',where+': nesne değil');
  const k=Object.keys(o).sort(),w=[...keys].sort();
  if(k.length!==w.length||k.some((x,i)=>x!==w[i]))bad('schema',where+': alanlar izin listesiyle aynı değil');
}
const want=(cond,where)=>{if(!cond)bad('schema',where+': geçersiz değer');};
const int=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const str=(v,re)=>typeof v==='string'&&re.test(v);
const nullOr=(v,f)=>v===null||f(v);

/* ---------- anahtarlar ---------- */
function keysFor(runId,createdAt){
  want(str(runId,RE.run_id)&&!runId.includes('..'),'run_id');want(str(createdAt,RE.iso)&&!isNaN(Date.parse(createdAt))&&new Date(createdAt).toISOString()===createdAt,'created_at');
  const k=objectKeys(runId,new Date(createdAt),'manual/');
  return {data_key:k.data,manifest_key:k.manifest,record_key:k.manifest.replace(/^manual\/manifests\//,'manual/records/'),
    request_key:`manual/pending/${runId}/request.json`,reference_key:`manual/pending/${runId}/reference.json`,failed_key:`manual/pending/${runId}/failed.json`};
}

/* ---------- manifest gövdesi (izin listesi; neden metni YOK, yalnız kod) ---------- */
function manualManifestBody({kind,runId,createdAt,pipelineManifest,txidSnapshot}){
  const m=pipelineManifest;const s=m.source;
  const body={version:1,kind,run_id:runId,created_at:createdAt,
    stages:Object.fromEntries(DATA_STAGES.map(k=>{const v=m.stages[k]||{status:'skipped'};return [k,{status:v.status,...(v.code?{code:String(v.code).replace(/[^a-z0-9_]/g,'_').slice(0,40).replace(/^[^a-z]/,'x')}:{})}];})),
    verified:m.verified===true,object_key:m.object_key||null,ciphertext_sha256:m.ciphertext_sha256||null,size:m.size||null,recipients_sha256:m.recipients_sha256||null,
    source:s?{taken_at:s.taken_at,server_version:String(s.server_version),auth_version:s.auth_version===undefined?null:s.auth_version,table_count:s.table_count,
      fingerprint_sha256:s.fingerprint_sha256,s1_open_ms:Math.round(s.s1_open_ms||0),mode:s.mode||'functions',txid_snapshot:txidSnapshot||null}:null};
  validateManifestBody(body);
  return body;
}
function validateManifestBody(b){
  exactKeys(b,['version','kind','run_id','created_at','stages','verified','object_key','ciphertext_sha256','size','recipients_sha256','source'],'manifest');
  want(b.version===1&&KINDS.includes(b.kind)&&str(b.run_id,RE.run_id)&&str(b.created_at,RE.iso),'manifest kimliği');
  exactKeys(b.stages,DATA_STAGES,'manifest.stages');
  for(const k of DATA_STAGES){const v=b.stages[k];if(!isObj(v))bad('schema','manifest.stages');
    const keys=Object.keys(v);want(keys.every(x=>x==='status'||x==='code')&&STATUS.includes(v.status)&&(v.code===undefined||str(v.code,RE.code)),'manifest.stages.'+k);}
  want(typeof b.verified==='boolean','manifest.verified');
  want(nullOr(b.object_key,x=>typeof x==='string')&&nullOr(b.ciphertext_sha256,x=>str(x,RE.hex64))&&nullOr(b.size,x=>int(x))&&nullOr(b.recipients_sha256,x=>str(x,RE.hex64)),'manifest bağları');
  if(b.source!==null){
    exactKeys(b.source,['taken_at','server_version','auth_version','table_count','fingerprint_sha256','s1_open_ms','mode','txid_snapshot'],'manifest.source');
    const s=b.source;
    want(str(s.taken_at,RE.isoUs)&&str(s.server_version,RE.version)&&nullOr(s.auth_version,x=>str(x,/^\d{1,20}$/))&&int(s.table_count,100000)&&str(s.fingerprint_sha256,RE.hex64)
      &&int(s.s1_open_ms)&&['functions','bootstrap'].includes(s.mode)&&nullOr(s.txid_snapshot,x=>str(x,RE.txid)),'manifest.source');
  }
  return b;
}
const manifestBodySha256=body=>SJ.domainHash(H_MANIFEST_BODY,validateManifestBody(body));

/* ---------- çevrim içi beyanlar (yalnız sayılar ve kodlar) ---------- */
function validateClaims(c){
  exactKeys(c,['backup_verified','run_complete','contract','checks','extra','notes'],'claims');
  want(typeof c.backup_verified==='boolean'&&typeof c.run_complete==='boolean','claims');
  want(['passed','skipped','failed','not_run'].includes(c.contract),'claims.contract');
  want(Array.isArray(c.checks)&&c.checks.length<=64&&c.checks.every(x=>isObj(x)&&Object.keys(x).length===2&&str(x.code,RE.code)&&typeof x.ok==='boolean'),'claims.checks');
  exactKeys(c.extra,['manifest_signature','manifest_upload','plaintext_cleanup'],'claims.extra');
  for(const v of Object.values(c.extra))want(STATUS.includes(v),'claims.extra');
  exactKeys(c.notes,['migration_history','cron_jobs','external_triggers'],'claims.notes');
  const n=c.notes;
  want(nullOr(n.migration_history,x=>isObj(x)&&Object.keys(x).sort().join()==='applied,gaps,ok,pending,unknown'&&typeof x.ok==='boolean'&&['applied','gaps','pending','unknown'].every(k=>int(x[k],100000))),'claims.notes.migration_history');
  want(nullOr(n.cron_jobs,x=>isObj(x)&&Object.keys(x).sort().join()==='jobs,ok,problems'&&typeof x.ok==='boolean'&&int(x.jobs,10000)&&int(x.problems,10000)),'claims.notes.cron_jobs');
  want(int(n.external_triggers,10000),'claims.notes.external_triggers');
  return c;
}
/** Çevrim içi sonuçtan beyanlar: serbest metin, sürüm adı, iş adı YOK (O3). */
function claimsFrom({verified,runComplete,contractStatus,checks,extra,notes}){
  const note=code=>(notes||[]).find(n=>n.code===code);
  const mh=note('migration_history'),cj=note('cron_jobs'),et=note('external_triggers');
  const len=v=>Array.isArray(v)?v.length:int(v)?v:0;
  return validateClaims({backup_verified:verified===true,run_complete:runComplete===true,contract:contractStatus,
    checks:(checks||[]).map(c=>({code:String(c.code).replace(/[^a-z0-9_]/g,'_').slice(0,40),ok:c.ok===true})).slice(0,64),
    extra:Object.fromEntries(['manifest_signature','manifest_upload','plaintext_cleanup'].map(k=>[k,extra&&extra[k]&&STATUS.includes(extra[k].status)?extra[k].status:'failed'])),
    notes:{migration_history:mh?{ok:mh.ok===true,applied:len(mh.applied),pending:len(mh.pending),unknown:len(mh.unknown),gaps:len(mh.gaps)}:null,
      cron_jobs:cj?{ok:cj.ok===true,jobs:len(cj.jobs),problems:len(cj.problems)}:null,external_triggers:et?len(et.triggers):0}});
}

/* ---------- imza isteği ---------- */
function validateRequest(r){
  exactKeys(r,['version','kind','run_id','created_at','approval_ref','data_key','manifest_key','record_key','reference_sha256','manifest','claims'],'request');
  want(r.version===1&&KINDS.includes(r.kind)&&str(r.approval_ref,RE.approval)&&nullOr(r.reference_sha256,x=>str(x,RE.hex64)),'request kimliği');
  const k=keysFor(r.run_id,r.created_at);
  want(r.data_key===k.data_key&&r.manifest_key===k.manifest_key&&r.record_key===k.record_key,'request anahtarları');
  validateManifestBody(r.manifest);
  want(r.manifest.run_id===r.run_id&&r.manifest.created_at===r.created_at&&r.manifest.kind===r.kind,'request ↔ manifest');
  want(r.manifest.object_key===r.data_key,'request ↔ paket anahtarı');
  validateClaims(r.claims);
  return r;
}
const requestSha256=r=>SJ.domainHash(H_REQUEST,validateRequest(r));
// Kısa kod 80 bit (20 hex): USB'yi değiştirebilen biri aynı öneki taşıyan başka istek üretemesin.
const shortCode=h=>h.slice(0,20).match(/.{4}/g).join('-');
/** Dosya: kanonik({request,request_sha256}). Hash yalnız "request" nesnesinden; alanın kendisi hesaba girmez. */
function encodeRequestFile(request){const h=requestSha256(request);return {bytes:SJ.toBytes({request,request_sha256:h}),request_sha256:h};}
function decodeRequestFile(buf){
  const w=SJ.parseCanonical(buf);exactKeys(w,['request','request_sha256'],'request dosyası');
  const h=requestSha256(w.request);
  if(w.request_sha256!==h)bad('request_hash','istek hash\'i içerikle uyuşmuyor');
  return {request:w.request,request_sha256:h};
}
/** İmzalanabilirlik: çevrim içi beyanlar (yalnız ön koşul; KANIT DEĞİL — kanıt çevrim dışı L1/L2). */
function requestSignable(r){
  const c=r.claims,m=r.manifest;
  if(!m.verified||!c.backup_verified||!c.run_complete)return 'not_verified';
  if(!DATA_STAGES.every(k=>m.stages[k].status==='ok'||(k==='legal'&&m.stages[k].status==='n/a')))return 'stage_not_ok';
  if(!['passed','skipped'].includes(c.contract))return 'contract_unknown';
  if(c.extra.plaintext_cleanup!=='ok')return 'cleanup_failed';
  if(!c.checks.every(x=>x.ok))return 'check_failed';
  if(!m.object_key||!m.ciphertext_sha256||!m.size||!m.recipients_sha256||!m.source)return 'binding_missing';
  return null;
}

/* ---------- başarısızlık raporu (yalnız sabit kodlar) ---------- */
const FAILED_STAGES=['storage_probe','config','preflight','dump','restore_test','legal','encryption','upload','manifest','request','signal','exception'];
function failedReport({kind,runId,createdAt,failedStage,codes=[],stages={},exitCode}){
  const r={version:1,kind,run_id:runId,created_at:createdAt,failed_stage:FAILED_STAGES.includes(failedStage)?failedStage:'exception',
    codes:[...new Set(codes.map(c=>String(c).replace(/[^a-z0-9_]/g,'_').slice(0,40)).filter(c=>RE.code.test(c)))].slice(0,32),
    stages:Object.fromEntries(DATA_STAGES.map(k=>[k,stages[k]&&STATUS.includes(stages[k].status)?stages[k].status:'skipped'])),exit_code:exitCode};
  return validateFailed(r);
}
function validateFailed(r){
  exactKeys(r,['version','kind','run_id','created_at','failed_stage','codes','stages','exit_code'],'failed');
  want(r.version===1&&KINDS.includes(r.kind)&&str(r.run_id,RE.run_id)&&str(r.created_at,RE.iso)&&FAILED_STAGES.includes(r.failed_stage),'failed kimliği');
  want(Array.isArray(r.codes)&&r.codes.length<=32&&r.codes.every(c=>str(c,RE.code)),'failed.codes');
  exactKeys(r.stages,DATA_STAGES,'failed.stages');for(const v of Object.values(r.stages))want(STATUS.includes(v),'failed.stages');
  want(int(r.exit_code,255),'failed.exit_code');
  return r;
}

/* ---------- imzalı kayıt (çevrim dışında kurulur; izin listesi) ---------- */
const OFFLINE_KEYS=['level','ciphertext_ok','header_ok','decrypted_with','restore','restore_role','checks','migrations','cron','triggers','schema','reference','contract'];
function validateRecordBody(b){
  exactKeys(b,['version','kind','run_id','created_at','request_sha256','manifest_key','manifest_sha256','data_key','ciphertext_sha256','size','recipients_sha256',
    'k9_key_id','anchor_sha256','reference_sha256','toolset_sha256','repo_commit','approval_ref','claims','offline','signed_at'],'record');
  want(b.version===1&&KINDS.includes(b.kind)&&str(b.run_id,RE.run_id)&&str(b.created_at,RE.iso),'record kimliği');
  const k=keysFor(b.run_id,b.created_at);
  want(b.manifest_key===k.manifest_key&&b.data_key===k.data_key,'record anahtarları');
  for(const f of ['request_sha256','manifest_sha256','ciphertext_sha256','recipients_sha256','anchor_sha256','toolset_sha256'])want(str(b[f],RE.hex64),'record.'+f);
  want(nullOr(b.reference_sha256,x=>str(x,RE.hex64)),'record.reference_sha256');
  want(int(b.size)&&b.size>0&&str(b.k9_key_id,RE.keyid)&&str(b.repo_commit,RE.hex40)&&str(b.approval_ref,RE.approval)&&str(b.signed_at,RE.iso),'record');
  validateClaims(b.claims);
  const o=b.offline;exactKeys(o,OFFLINE_KEYS,'record.offline');
  want(['L1','L2'].includes(o.level)&&o.ciphertext_ok===true&&o.header_ok===true,'record.offline L1');
  if(o.level==='L2'){
    // decrypted_with: A, B ya da AB (iki kimlik ayrı ayrı çözdü ve düz metin baytları aynı). Geri yükleme yalnız süper kullanıcı olmayan rolle.
    want(['A','B','AB'].includes(o.decrypted_with)&&o.restore==='ok'&&o.restore_role==='non_superuser','record.offline L2');
    want(Array.isArray(o.checks)&&o.checks.length<=64&&o.checks.every(c=>str(c,RE.code)),'record.offline.checks');
    exactKeys(o.migrations,['applied','pending','aliases','nameless'],'record.offline.migrations');
    for(const v of Object.values(o.migrations))want(int(v,100000),'record.offline.migrations');
    exactKeys(o.cron,['jobs','inactive'],'record.offline.cron');for(const v of Object.values(o.cron))want(int(v,10000),'record.offline.cron');
    want(int(o.triggers,10000)&&o.schema==='match','record.offline');
    want(['match','bounds','not_measured'].includes(o.reference),'record.offline.reference');
    // Ölçüm dosyası bağlıysa L2 onu karşılaştırmış olmalı; bağlı değilse "ölçüldü" denemez (T8 kanıt gibi sunulmaz).
    want((b.reference_sha256===null)===(o.reference==='not_measured'),'record.offline.reference ↔ reference_sha256');
    exactKeys(o.contract,['status','exception'],'record.offline.contract');
    // claimed_passed: çevrim içi beyan (imza makinesinde yeniden çalıştırılmaz); exception: çapada izinli istisna kodu.
    want((o.contract.status==='claimed_passed'&&o.contract.exception===null)||(o.contract.status==='exception'&&str(o.contract.exception,RE.code)),'record.offline.contract');
  }else{
    want(o.decrypted_with===null&&o.restore===null&&o.restore_role===null&&Array.isArray(o.checks)&&o.checks.length===0&&o.migrations===null&&o.cron===null&&o.triggers===null&&o.schema===null&&o.reference==='not_measured'&&o.contract===null,'record.offline L1');
  }
  return b;
}

/* ---------- yanıt (USB ile döner) ---------- */
function validateResponse(r){
  exactKeys(r,['version','run_id','request_sha256','manifest_signature','record','record_signature'],'response');
  want(r.version===1&&str(r.run_id,RE.run_id)&&str(r.request_sha256,RE.hex64),'response');
  for(const s of [r.manifest_signature,r.record_signature]){exactKeys(s,['key_id','signature'],'response imzası');want(str(s.key_id,RE.keyid)&&str(s.signature,RE.sig),'response imzası');}
  validateRecordBody(r.record);
  want(r.record.run_id===r.run_id&&r.record.request_sha256===r.request_sha256,'response ↔ kayıt');
  want(r.manifest_signature.key_id===r.record_signature.key_id&&r.record.k9_key_id===r.record_signature.key_id,'response anahtar kimliği');
  return r;
}
const attach=(ns,body,s)=>({...body,sig_alg:'ed25519',key_id:s.key_id,namespace:ns,signature:s.signature});
const stripSig=doc=>{const b={};for(const [k,v] of Object.entries(doc))if(!SIG_FIELDS.includes(k))b[k]=v;return b;};

/* ---------- yapılandırma (main; USB'deki DEĞİL) ---------- */
function trustedSets(config){
  const t9=isObj(config&&config.trusted_k9)?config.trusted_k9:{};
  const anchors=isObj(config&&config.trusted_anchors)?config.trusted_anchors:{};
  return {t9,anchors,active9:config&&config.active_k9,activeAnchor:config&&config.active_anchor_sha256,recipients:config&&config.recipients_sha256};
}

/* ---------- zincir doğrulaması (finalize ve dr-fetch) ---------- */
/** manifestDoc ve recordDoc imzalı belgeler; packageBytes paket baytları; pending: {request,request_sha256}|null. */
function verifyChain({manifestDoc,recordDoc,config,packageBytes,pending=null,requireRequest=false,forNewSignature=false}){
  const T=trustedSets(config);
  const mBody=validateManifestBody(stripSig(manifestDoc));
  const rBody=validateRecordBody(stripSig(recordDoc));
  // İmzalar: K9 ve ayrı amaç etiketleri (manifest imzası kayda, kayıt imzası manifeste kullanılamaz).
  const vm=C.verify(NS_MANIFEST,manifestDoc,T.t9);if(!vm.ok)bad('manifest_signature','manifest imzası geçersiz');
  const vr=C.verify(NS_RECORD,recordDoc,T.t9);if(!vr.ok)bad('record_signature','kayıt imzası geçersiz');
  if(manifestDoc.key_id!==recordDoc.key_id||rBody.k9_key_id!==recordDoc.key_id)bad('key_mismatch','imza anahtarları uyuşmuyor');
  if(forNewSignature&&rBody.k9_key_id!==T.active9)bad('k9_not_active','imza etkin K9 ile atılmamış');
  // Güven çapası.
  if(!Object.prototype.hasOwnProperty.call(T.anchors,rBody.anchor_sha256))bad('anchor_untrusted','kayıttaki güven çapası güvenilir listede değil');
  if(forNewSignature&&rBody.anchor_sha256!==T.activeAnchor)bad('anchor_not_active','yeni imza eski (etkin olmayan) çapaya dayanıyor');
  // Kayıt ↔ manifest ↔ paket.
  if(rBody.manifest_sha256!==manifestBodySha256(mBody))bad('manifest_hash','manifest gövdesi kayıttaki hash ile uyuşmuyor');
  const same=(a,b,code)=>{if(a!==b)bad(code,code);};
  same(rBody.run_id,mBody.run_id,'run_id');same(rBody.created_at,mBody.created_at,'created_at');same(rBody.kind,mBody.kind,'kind');
  same(rBody.data_key,mBody.object_key,'data_key');same(rBody.ciphertext_sha256,mBody.ciphertext_sha256,'ciphertext_sha256');
  same(rBody.size,mBody.size,'size');same(rBody.recipients_sha256,mBody.recipients_sha256,'recipients_sha256');
  if(rBody.recipients_sha256!==T.recipients)bad('recipients','alıcı hash\'i yapılandırmayla uyuşmuyor');
  if(mBody.verified!==true||rBody.claims.backup_verified!==true||rBody.claims.run_complete!==true)bad('not_verified','doğrulanmamış yedek');
  // İlk yedek (bootstrap) politikası imzadan bağımsız da denetlenir: L2 ve bağlı T8 ölçümü.
  if(rBody.kind==='bootstrap'&&(rBody.offline.level!=='L2'||rBody.reference_sha256===null))bad('bootstrap_policy','ilk yedek kaydı L2 ve T8 ölçümü içermeli');
  if(!Buffer.isBuffer(packageBytes))bad('package_missing','şifreli paket yok');
  if(packageBytes.length!==rBody.size||SJ.sha256Hex(packageBytes)!==rBody.ciphertext_sha256)bad('package_hash','şifreli paket hash\'i ya da boyutu uyuşmuyor');
  // İstek bağı.
  let requestBinding='not_checked';
  if(pending){
    if(pending.request_sha256!==rBody.request_sha256)bad('request_hash','bekleyen istek kayıttaki hash ile uyuşmuyor');
    if(manifestBodySha256(pending.request.manifest)!==rBody.manifest_sha256)bad('request_manifest','bekleyen istekteki manifest uyuşmuyor');
    if(pending.request.run_id!==rBody.run_id||pending.request.approval_ref!==rBody.approval_ref||pending.request.reference_sha256!==rBody.reference_sha256)bad('request_fields','bekleyen istek alanları uyuşmuyor');
    if(SJ.canonical(pending.request.claims)!==SJ.canonical(rBody.claims))bad('request_claims','bekleyen istekteki beyanlar kayıtla uyuşmuyor');
    requestBinding='verified';
  }else if(requireRequest)bad('request_missing','bekleyen istek yok (--require-request)');
  return {ok:true,manifest:mBody,record:rBody,request_binding:requestBinding};
}

/* ---------- finalize ---------- */
async function readCanonical(store,key,max){
  const buf=await store.get(key);if(!buf)return null;
  if(buf.length>max)bad('size','dosya boyut sınırını aşıyor');
  return SJ.parseCanonical(buf);
}
async function putSameOrNew(store,key,bytes){
  const p=await store.put(key,bytes,{ifNoneMatch:true});
  if(p.ok)return 'written';
  if(p.status!==412)bad('write','yazılamadı ('+p.status+')');
  const cur=await store.get(key);
  if(cur&&cur.equals(bytes))return 'unchanged';
  bad('conflict','hedefte farklı içerik var; üzerine yazılmaz');
}
/** Yarım kalmışsa tekrar çalıştırılabilir; aynı baytlar geçilir, farklıysa çakışma. Sıra: manifest, sonra kayıt. */
async function finalize({store,config,responseBytes}){
  if(!Buffer.isBuffer(responseBytes)||responseBytes.length>LIMITS.response)bad('response_size','yanıt boyutu geçersiz');
  const resp=validateResponse(SJ.parseCanonical(responseBytes));
  const keys0=keysFor(resp.record.run_id,resp.record.created_at);
  const reqBuf=await store.get(keys0.request_key);
  if(!reqBuf)bad('request_missing','bekleyen istek yok');
  if(reqBuf.length>LIMITS.request)bad('size','istek çok büyük');
  const pending=decodeRequestFile(reqBuf);
  if(resp.request_sha256!==pending.request_sha256)bad('request_hash','yanıt başka bir isteğe ait');
  const req=pending.request;
  const manifestDoc=attach(NS_MANIFEST,req.manifest,resp.manifest_signature);
  const recordDoc=attach(NS_RECORD,resp.record,resp.record_signature);
  const pkg=await store.get(req.data_key);
  const chain=verifyChain({manifestDoc,recordDoc,config,packageBytes:pkg,pending,forNewSignature:true});
  const mBytes=SJ.toBytes(manifestDoc),rBytes=SJ.toBytes(recordDoc);
  const wm=await putSameOrNew(store,req.manifest_key,mBytes);
  const wr=await putSameOrNew(store,req.record_key,rBytes);
  // Geri okuma ve yeniden doğrulama (dr-fetch ile aynı yol).
  const back=await verifyStored({store,config,manifestKey:req.manifest_key,requireRequest:true});
  return {completed:true,manifest_key:req.manifest_key,record_key:req.record_key,writes:{manifest:wm,record:wr},request_binding:back.request_binding,chain:chain.ok};
}

/** dr-fetch ve finalize: yalnız AÇIKÇA verilen nihai manifest anahtarı; bekleyen dosya aday sayılmaz, yalnız bağ için okunur. */
async function verifyStored({store,config,manifestKey,requireRequest=false}){
  const m=/^manual\/manifests\/(\d{4})\/(\d{2})\/(\d{2})\/nakgo-(\d{8}T\d{6}Z)-([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.json$/.exec(manifestKey||'');
  if(!m||manifestKey.includes('/pending/'))bad('manifest_key','manifest anahtarı nihai manuel biçimde değil');
  const manifestDoc=await readCanonical(store,manifestKey,LIMITS.manifest);
  if(!manifestDoc)bad('manifest_missing','manifest yok');
  const body=stripSig(manifestDoc);validateManifestBody(body);
  const keys=keysFor(body.run_id,body.created_at);
  if(keys.manifest_key!==manifestKey)bad('manifest_key','manifest anahtarı içerikle uyuşmuyor');
  const recordDoc=await readCanonical(store,keys.record_key,LIMITS.record);
  if(!recordDoc)bad('record_missing','imzalı onay kaydı yok (elle yedekte zorunlu)');
  let pending=null;
  const reqBuf=await store.get(keys.request_key);
  if(reqBuf){if(reqBuf.length>LIMITS.request)bad('size','istek çok büyük');pending=decodeRequestFile(reqBuf);}
  const pkg=await store.get(keys.data_key);
  return {...verifyChain({manifestDoc,recordDoc,config,packageBytes:pkg,pending,requireRequest}),keys,packageBytes:pkg};
}

/* ---------- yapılandırma denetimi (run ve finalize; bağlantıdan önce) ---------- */
function k9ConfigProblems(config){
  const p=[];const T=trustedSets(config);
  const obj=v=>isObj(v);
  if(!obj(config&&config.trusted_k9))p.push('güvenilir K9 listesi bozuk');
  else if(!Object.keys(T.t9).length)p.push('güvenilir K9 açık anahtarı yok (anahtar töreni ve PR gerekli)');
  if(!str(T.active9,RE.keyid)||!Object.prototype.hasOwnProperty.call(T.t9,T.active9))p.push('etkin K9 (active_k9) güvenilir listede değil');
  for(const [id,pem] of Object.entries(T.t9)){try{if(C.keyIdOf(pem)!==id)p.push('K9 girdisinin kimliği açık anahtarıyla uyuşmuyor');}catch{p.push('K9 açık anahtarı okunamadı');}}
  if(!obj(config&&config.trusted_anchors))p.push('güvenilir çapa listesi bozuk');
  else{
    if(!Object.keys(T.anchors).length)p.push('güvenilir çapa yok (anahtar töreni ve PR gerekli)');
    if(Object.keys(T.anchors).some(h=>!RE.hex64.test(h)))p.push('çapa hash\'i biçimi bozuk');
  }
  if(!str(T.activeAnchor,RE.hex64)||!Object.prototype.hasOwnProperty.call(T.anchors,T.activeAnchor))p.push('etkin çapa güvenilir listede değil');
  // Görev ayrılığı: K1, K2, K9 ikişer ikişer kesişemez.
  const ids=o=>{const s=new Set();for(const [id,pem] of Object.entries(isObj(o)?o:{})){s.add(id);try{s.add(C.keyIdOf(pem));}catch{}}return s;};
  const s1=ids(config&&config.trusted_k1),s2=ids(config&&config.trusted_k2),s9=ids(T.t9);
  if([...s9].some(x=>s1.has(x)))p.push('K1 ve K9 aynı anahtarı paylaşıyor (görev ayrılığı ihlali)');
  if([...s9].some(x=>s2.has(x)))p.push('K2 ve K9 aynı anahtarı paylaşıyor (görev ayrılığı ihlali)');
  if([...s1].some(x=>s2.has(x)))p.push('K1 ve K2 aynı anahtarı paylaşıyor (görev ayrılığı ihlali)');
  return [...new Set(p)];
}

module.exports={NS_MANIFEST,NS_RECORD,H_REQUEST,H_MANIFEST_BODY,H_ANCHOR,H_REFERENCE,KINDS,LIMITS,RE,
  keysFor,manualManifestBody,validateManifestBody,manifestBodySha256,claimsFrom,validateClaims,
  validateRequest,requestSha256,shortCode,encodeRequestFile,decodeRequestFile,requestSignable,
  failedReport,validateFailed,validateRecordBody,validateResponse,attach,stripSig,verifyChain,finalize,verifyStored,k9ConfigProblems,putSameOrNew};

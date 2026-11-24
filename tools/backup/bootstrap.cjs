/** Elle yedek, çevrim içi aşamalar: "run" ve "finalize" (K9 akışı; offline-sign ayrı, çevrim dışı makinede).
 * Runbook: docs/backup/runbooks/bootstrap-first-backup.md, docs/backup/runbooks/offline-signing.md.
 *
 *   run       Production'dan (yalnız okuma) tek anlık görüntüyle döküm, yerel geri yükleme doğrulaması, age ile A ve B'ye
 *             şifreleme; şifreli paket manual/db/… altına, İMZASIZ manifest gövdesi ve imza isteği manual/pending/<run>/
 *             altına yazılır. Nihai manifest ve kayıt YAZILMAZ. Çıkış: 2 = imza bekliyor, 1 = başarısız.
 *   finalize  Çevrim dışından gelen yanıtı (K9 imzaları + izin listeli kayıt) bekleyen istek, paket ve main'deki
 *             yapılandırmayla (trusted_k9, active_k9, trusted_anchors, active_anchor_sha256, recipients_sha256) doğrular;
 *             imzalı manifesti ve kaydı atomik, üzerine yazmadan yayımlar. Çıkış: 0 = tamamlandı, 1 = reddedildi.
 *
 * Bu dosyada ÖZEL ANAHTAR OKUYAN YA DA İMZA ATAN HİÇBİR YOL YOKTUR (test kaynakta denetler). K9 yalnız offline-sign'da.
 * Kip "bootstrap": yedek rolü ve dışa aktarma fonksiyonları Production'da yokken; Auth/Storage/meta satırları fonksiyon
 * gövdeleriyle aynı sorgularla doğrudan okunur. K6b aynı akışı fonksiyon kipinde kullanır (k6b.cjs).
 * Kimlik bilgisi yalnız ortamdan okunur; hiçbir çıktıya ve dosyaya yazılmaz. CI'da çalışmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runBackup,objectKeys}=require('./pipeline.cjs');
const {FileStore}=require('./store.cjs');
const {loadScope}=require('./backup-role.cjs');
const {clientConfig,newClient,validateConn,enforceReadOnly,toolMajor}=require('./dump.cjs');
const {recipientsOf,recipientsSha256}=require('./encrypt.cjs');
const MF=require('./manual-flow.cjs');
const SF=require('./safe-fs.cjs');
const ABORT=require('./abort.cjs');
const RMS=require('./reference-measure.cjs');
const SJ=require('./strict-json.cjs');

const CONFIG_FILE=path.join(__dirname,'../../ops/backup/config.json');
const REQUIRED_RECIPIENTS=2;// A ve B (key-ceremony.md)
function loadBackupConfig(file=CONFIG_FILE){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}

/** Yapılandırma denetimi (bağlantıdan ÖNCE). Mesajlar anahtar, hash, alıcı ya da yol İÇERMEZ.
 *  Y2: recipients_sha256 sabitlenmiş; verilen değer ve dosyanın gerçek hash'i aynı; tam iki farklı alıcı (A, B).
 *  K9: trusted_k9 dolu ve tutarlı, active_k9 listede; trusted_anchors dolu, active_anchor_sha256 listede;
 *      K1, K2, K9 ikişer ikişer kesişemez. */
function bootstrapConfigProblems({config,recipientsFile,pinnedRecipientsSha256}){
  const p=[];
  if(!config||typeof config!=='object'||config.version!==1)return ['yedek yapılandırması okunamadı ya da bozuk'];
  const pinned=config.recipients_sha256;
  if(typeof pinned!=='string'||!/^[0-9a-f]{64}$/.test(pinned))p.push('alıcı listesi hash\'i yapılandırmada sabitlenmemiş (anahtar töreni ve PR gerekli)');
  else{
    if(pinnedRecipientsSha256!==pinned)p.push('verilen alıcı hash\'i yapılandırmadaki değerle uyuşmuyor');
    let recips=null;
    try{recips=recipientsOf(recipientsFile);}catch{p.push('alıcı dosyası okunamadı ya da geçersiz');}
    if(recips){
      if(recips.length!==REQUIRED_RECIPIENTS)p.push(`alıcı dosyası tam ${REQUIRED_RECIPIENTS} farklı alıcı (A, B) içermeli`);
      if(recipientsSha256(recipientsFile)!==pinned)p.push('alıcı dosyası yapılandırmadaki hash ile uyuşmuyor');
    }
  }
  const obj=o=>o&&typeof o==='object'&&!Array.isArray(o);
  if(!obj(config.trusted_k1))p.push('güvenilir K1 listesi bozuk');
  if(!obj(config.trusted_k2))p.push('güvenilir K2 listesi bozuk');
  p.push(...MF.k9ConfigProblems(config));
  return [...new Set(p)];
}

const APPROVAL_RE=MF.RE.approval;

/** Ön koşullar (hiçbiri muaf tutulamaz). Bağlantı kuralları ve TLS bağlantı AÇILMADAN denetlenir; bağlanınca ilk iş
 * oturumu salt okunur yapıp doğrulamaktır; sonra yalnız katalog okunur. */
async function preflight({conn,approval,allowLocal=false,Client=require('pg').Client,kind='bootstrap'}){
  const no=reason=>({status:'failed',reason});
  if(!APPROVAL_RE.test(approval||''))return no('yazılı onay kaydı (--approval) eksik ya da geçersiz');
  const host=process.env.NAKGO_PG_HOST;
  if(!host||!(host.startsWith('/')||['localhost','127.0.0.1','::1'].includes(host)))return no('geri yükleme denetimi için yerel PostgreSQL (NAKGO_PG_HOST) gerekli');
  const rules=validateConn(conn,{allowLocal});
  if(rules.length)return no('bağlantı kuralları: '+rules.join('; '));
  let cfg;
  try{cfg=clientConfig(conn);}catch(e){return no('bağlantı kuralları: '+e.message);}
  let c;
  try{c=newClient(Client,cfg);}catch(e){return no('bağlantı kuralları: '+e.message);}
  c.on('error',()=>{});
  try{
    await c.connect();
    try{await enforceReadOnly(c);}catch(e){return no('salt okunurluk: '+e.message);}
    const r=(await c.query(`select to_regprocedure('private.nakgo_backup_guard_counts()') is not null b7,current_setting('server_version_num')::int/10000 major,
      current_setting('default_transaction_read_only') ro`)).rows[0];
    if(r.ro!=='on')return no('oturum salt okunur açılmadı');
    if(kind==='bootstrap'&&r.b7)return no('yedek rolünün fonksiyonları veritabanında var: bootstrap yerine K6b yolu kullanılır');
    if(kind==='k6b'&&!r.b7)return no('yedek rolünün fonksiyonları veritabanında yok: K6b yerine bootstrap yolu kullanılır');
    for(const t of ['pg_dump','pg_restore']){const m=await toolMajor(t,process.env.NAKGO_PG_BIN);if(!m||m<r.major)return no(`${t} sürümü sunucudan (${r.major}) eski`);}
    return {status:'ok',reason:kind+' ön koşulları'};
  }catch(e){return no('bağlantı: '+e.message.replace(/postgres(ql)?:\/\/\S+/g,'<bağlantı>'));}
  finally{await c.end().catch(()=>{});}
}

/** API sözleşmesi durumu (çevrim içi): passed | failed | skipped | not_run. Kontrol ve atlama notu birlikte → failed. */
function contractStatusOf(checks,notes){
  const c=(checks||[]).filter(x=>x&&x.code==='contract'),n=(notes||[]).filter(x=>x&&x.code==='contract');
  if(c.length>1||n.length>1||(c.length&&n.length))return {status:'failed',rehearsal_required:true,reason:'tutarsız sözleşme sonucu'};
  if(c.length)return c[0].ok===true?{status:'passed',rehearsal_required:false}:{status:'failed',rehearsal_required:true};
  if(n.length&&n[0].skipped===true)return {status:'skipped',rehearsal_required:true,pending:n[0].pending,reason:n[0].reason};
  return {status:'not_run',rehearsal_required:true};
}

/** run aşamasının tamamlanması (imza isteği yazılabilir mi): doğrulanmış veri, paket yazılmış, şifresiz temizlik tamam,
 * sözleşme sonucu bilinir, manifest imzası ve yüklemesi BİLEREK ertelenmiş. */
const CONTRACT_KNOWN=['passed','skipped'];
function runCompletionOf(r){
  const failed=[];
  if(!r||r.verified!==true)failed.push('verified');
  if(!r||!r.contract||!CONTRACT_KNOWN.includes(r.contract.status))failed.push('contract');
  if(!r||!r.extra||!r.extra.plaintext_cleanup||r.extra.plaintext_cleanup.status!=='ok')failed.push('plaintext_cleanup');
  for(const k of ['manifest_signature','manifest_upload'])if(!r||!r.extra||!r.extra[k]||r.extra[k].status!=='deferred')failed.push(k);
  if(!r||!r.stages||!r.stages.upload||r.stages.upload.status!=='ok')failed.push('upload');
  return {ok:!failed.length,failed};
}

/** Terminal teşhisi: başarısız aşamaların HAM nedeni (operatör ekranı). Hiçbir dosyaya yazılmaz. */
function terminalLines(r){
  const out=[];
  for(const [k,v] of Object.entries((r&&r.stages)||{}))if(v&&v.status==='failed')out.push(`aşama ${k} başarısız (${v.code||'?'}): ${String(v.reason||'').slice(0,4000)}`);
  return out;
}

/** T8 referans ölçümü (yalnız bootstrap kipi; doğrudan okuma). Ayrı, salt okunur oturum; bağlantı kuralları preflight'ta
 * denetlendikten SONRA çağrılır. Hata metni bağlantı bilgisi içermez. */
async function measureSource({conn,Client=require('pg').Client,scope}){
  const c=newClient(Client,clientConfig(conn));c.on('error',()=>{});
  const unreg=ABORT.register('referans ölçümü bağlantısı',()=>c.end().catch(()=>{}));
  try{await c.connect();await enforceReadOnly(c);return await RMS.measure(c,scope);}
  finally{unreg();await c.end().catch(()=>{});}
}

const skippedStages=(first,code,reason)=>{const s={preflight:{status:'failed',code,reason}};for(const k of ['dump','restore_test','legal','encryption','upload'])s[k]={status:'skipped'};return s;};
const early=(state,failed,stages,extra={})=>({phase:'run',state,failed,backup_verified:false,run_complete:false,stages,extra:{},keys:null,request_key:null,failed_key:null,notes:[],restore_checks:null,contract:{status:'not_run'},...extra});

/** run (programatik; testler ve CLI). Dönüş: {phase:'run', state:'signature_pending'|'failed', ...}. */
async function runManual({kind='bootstrap',conn,outDir,recipientsFile,pinnedRecipientsSha256,approval,runId,now=new Date(),
  pgBin=process.env.NAKGO_PG_BIN,ageBin,allowLocal=false,workRoot=os.tmpdir(),scope=loadScope(),Client,config,preflightHook}){
  if(!MF.KINDS.includes(kind))throw Error('geçersiz kip');
  const store=new FileStore({dir:outDir});
  // Sinyal alındıysa (abort.cjs) hiçbir yazım yapılmaz: başarı ya da imza isteği oluşamaz.
  const put=store.put.bind(store);
  store.put=async(...a)=>{if(ABORT.isAborting())throw Error('sinyal alındı ('+ABORT.abortSignal()+'): yazım reddedildi');return put(...a);};
  const createdAt=now.toISOString();
  const keys=MF.keysFor(runId,createdAt);
  // Depo ön kontrolü (hard link, aynı aygıt) HER gerçek yazım klasöründe; hiçbir bağlantıdan önce.
  const probe=store.probe([keys.data_key,keys.manifest_key,keys.record_key,keys.request_key]);
  if(!probe.ok)return early('failed',['storage_probe'],skippedStages('preflight','storage_probe',probe.reason),{probe});
  const cfgProblems=bootstrapConfigProblems({config,recipientsFile,pinnedRecipientsSha256});
  if(cfgProblems.length)return early('failed',['config'],skippedStages('preflight','config','yapılandırma: '+cfgProblems.join('; ')),{config_problems:cfgProblems});
  // T8: bootstrap'ta dökümden hemen önce (ön kontrol geçtikten sonra) ve hemen sonra salt okunur ölçüm (K6b: ölçülmez).
  const measured=kind==='bootstrap';let before=null;
  const pre=preflightHook||(()=>preflight({conn,approval,allowLocal,kind,...(Client?{Client}:{})}));
  const hookPreflight=async()=>{
    const p=await pre();
    if(p.status!=='ok'||!measured)return p;
    try{before=await measureSource({conn,scope,...(Client?{Client}:{})});}catch(e){return {status:'failed',code:'reference_before',reason:'referans ölçümü (önce) alınamadı: '+(e.code||'hata')};}
    return p;
  };
  const r=await ABORT.trackRun(runBackup({conn,scope,store,recipientsFile,pinnedRecipientsSha256,k1:null,runId,now,pgBin,ageBin,allowLocal,workRoot,
    keyPrefix:'manual/',requiredRecipients:REQUIRED_RECIPIENTS,deferSign:true,
    dumpOptions:{mode:kind==='bootstrap'?'bootstrap':'functions',...(Client?{Client}:{})},restoreOptions:{requireMeta:true},
    hooks:{preflight:hookPreflight}}));
  // Sinyal alındıysa normal sonuç (başarısızlık raporu dahil) üretilmez; süreç abort.cjs ile 128+sinyal koduyla biter.
  if(ABORT.isAborting())throw Object.assign(Error('sinyal alındı ('+ABORT.abortSignal()+')'),{code:'signal'});
  const contract=contractStatusOf(r.restore_checks,r.restore_notes);
  const completion=runCompletionOf({...r,contract});
  const base={phase:'run',backup_verified:r.verified===true,run_complete:completion.ok,failed:completion.failed,stages:r.stages,extra:r.extra,
    keys,notes:r.restore_notes||[],restore_checks:r.restore_checks,contract};
  const fail=async(stage,codes)=>{
    let failedKey=null;
    try{
      const rep=MF.failedReport({kind,runId,createdAt,failedStage:stage,codes,stages:r.stages,exitCode:1});
      const w=await store.put(keys.failed_key,Buffer.from(require('./strict-json.cjs').toBytes(rep)),{ifNoneMatch:true});
      if(w.ok)failedKey=keys.failed_key;
    }catch{/* başarısızlık raporu yazılamadıysa durum yine "failed" */}
    return {...base,state:'failed',request_key:null,failed_key:failedKey};
  };
  if(!completion.ok){
    const st=Object.entries(r.stages).find(([,v])=>v.status==='failed');
    return fail(st?st[0]:'manifest',[...completion.failed,...(st&&st[1].code?[st[1].code]:[])]);
  }
  // T8 (sonra) ve referans dosyası: istekten ÖNCE yazılır; hash'i isteğe girer.
  let referenceSha=null;
  if(measured){
    let after;
    try{after=await measureSource({conn,scope,...(Client?{Client}:{})});}catch(e){return fail('request',['reference_after']);}
    if(ABORT.isAborting())throw Object.assign(Error('sinyal alındı ('+ABORT.abortSignal()+')'),{code:'signal'});
    let refDoc;
    try{refDoc={version:1,before,after};referenceSha=RMS.referenceSha256(refDoc);}catch(e){return fail('request',[e.code||'reference_schema']);}
    const wr=await store.put(keys.reference_key,SJ.toBytes(refDoc),{ifNoneMatch:true});
    if(!wr.ok)return fail('request',['reference_write_'+wr.status]);
  }
  let request;
  try{
    const manifest=MF.manualManifestBody({kind,runId,createdAt,pipelineManifest:r.manifest,txidSnapshot:r.txid_snapshot});
    const claims=MF.claimsFrom({verified:r.verified,runComplete:completion.ok,contractStatus:contract.status,checks:r.restore_checks,extra:r.extra,notes:r.restore_notes});
    request={version:1,kind,run_id:runId,created_at:createdAt,approval_ref:approval,data_key:keys.data_key,manifest_key:keys.manifest_key,record_key:keys.record_key,
      reference_sha256:referenceSha,manifest,claims};
    const why=MF.requestSignable(MF.validateRequest(request));
    if(why)return fail('request',[why]);
  }catch(e){return fail('request',[e.code||'schema']);}
  const {bytes,request_sha256}=MF.encodeRequestFile(request);
  const w=await store.put(keys.request_key,bytes,{ifNoneMatch:true});
  if(!w.ok)return fail('request',['request_write_'+w.status]);
  return {...base,state:'signature_pending',request_key:keys.request_key,request_sha256,short_code:MF.shortCode(request_sha256),failed_key:null};
}
const runBootstrap=opts=>runManual({...opts,kind:'bootstrap'});

/** finalize (programatik). responseFile: USB'deki yanıt (güvenli okunur). */
async function finalizeManual({outDir,responseDir,responseName='response.json',config}){
  const problems=MF.k9ConfigProblems(config||{});
  if(problems.length)return {phase:'finalize',completed:false,code:'config',reason:'yapılandırma: '+problems.join('; ')};
  const store=new FileStore({dir:outDir});
  const put=store.put.bind(store);
  store.put=async(...a)=>{if(ABORT.isAborting())throw Error('sinyal alındı: yazım reddedildi');return put(...a);};
  let bytes;
  try{bytes=SF.readFileSafe(responseDir,responseName,{maxBytes:MF.LIMITS.response});}catch(e){return {phase:'finalize',completed:false,code:e.code||'response_read',reason:'yanıt okunamadı'};}
  try{const r=await MF.finalize({store,config,responseBytes:bytes});return {phase:'finalize',...r};}
  catch(e){return {phase:'finalize',completed:false,code:e.code||'error',reason:e.message};}
}

/** Çıkış kodları: run → 2 imza bekliyor, 1 başarısız; finalize → 0 tamamlandı, 1 reddedildi. */
function exitCodeOf(r){
  if(r&&r.phase==='run')return r.state==='signature_pending'&&typeof r.request_key==='string'&&r.run_complete===true?2:1;
  if(r&&r.phase==='finalize')return r.completed===true?0:1;
  return 1;
}

module.exports={runBootstrap,runManual,finalizeManual,preflight,loadBackupConfig,bootstrapConfigProblems,REQUIRED_RECIPIENTS,
  installSignalHandlers:ABORT.installSignalHandlers,exitCodeOf,runCompletionOf,contractStatusOf,terminalLines};

async function cli(kind,argv,{preflightHookFor=null}={}){
  if(process.env.CI||process.env.GITHUB_ACTIONS)throw Error(kind+' CI\'da çalışmaz: elle, onaylı makinede');
  ABORT.installSignalHandlers();
  const cmd=argv[0];const args=argv.slice(1);
  if(args.includes('--sign-key'))throw Error('özel anahtar bu makinede kullanılmaz: imza yalnız çevrim dışı (offline-sign)');
  const arg=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const need=k=>{const v=arg(k);if(!v)throw Error('eksik: '+k);return v;};
  let r;
  if(cmd==='run'){
    const e=process.env;
    const conn={host:e.PGHOST,port:Number(e.PGPORT||5432),user:e.PGUSER,password:e.PGPASSWORD,database:e.PGDATABASE||'postgres',sslmode:e.PGSSLMODE,sslrootcert:e.PGSSLROOTCERT};
    const outDir=need('--out');
    fs.mkdirSync(outDir,{recursive:true,mode:0o700});
    const opts={kind,conn,outDir,recipientsFile:need('--recipients'),pinnedRecipientsSha256:need('--recipients-sha256'),
      approval:need('--approval'),runId:arg('--run-id')||kind+'-'+Date.now(),config:loadBackupConfig()};
    r=await runManual({...opts,...(preflightHookFor?{preflightHook:preflightHookFor(opts)}:{})});
    console.log(JSON.stringify({phase:'run',state:r.state,backup_verified:r.backup_verified,run_complete:r.run_complete,failed:r.failed,
      stages:Object.fromEntries(Object.entries(r.stages||{}).map(([k,v])=>[k,v.status+(v.code?':'+v.code:'')])),
      data:r.keys&&r.keys.data_key,request:r.request_key,failed_report:r.failed_key,short_code:r.short_code||null,contract:r.contract&&r.contract.status},null,1));
    for(const l of terminalLines(r))console.error(l);
    if(r.state==='signature_pending')console.error('İMZA BEKLİYOR: kısa kod '+r.short_code+' — isteği ve paketi çevrim dışı makineye taşıyın (offline-signing.md). Yedek henüz TAMAMLANMADI.');
    else console.error(kind+' başarısız: '+r.failed.join(', '));
  }else if(cmd==='finalize'){
    const resp=need('--response');
    r=await finalizeManual({outDir:need('--out'),responseDir:path.dirname(path.resolve(resp)),responseName:path.basename(resp),config:loadBackupConfig()});
    console.log(JSON.stringify({phase:'finalize',completed:r.completed===true,code:r.code||null,manifest:r.manifest_key||null,record:r.record_key||null,request_binding:r.request_binding||null},null,1));
    if(!r.completed)console.error('finalize reddedildi ('+r.code+'): '+r.reason);
  }else throw Error('kullanım: '+kind+' run|finalize …');
  process.exitCode=exitCodeOf(r);
}

if(require.main===module)cli('bootstrap',process.argv.slice(2)).catch(e=>{console.error('bootstrap durdu: '+e.message);process.exitCode=1;});
module.exports.cli=cli;

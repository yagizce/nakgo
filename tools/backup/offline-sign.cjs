/** Elle yedeğin çevrim dışı imzası (K9). Yalnız ağsız, ayrılmış makinede; runbook: docs/backup/runbooks/offline-signing.md.
 *
 * Sıra (biri bile tutmazsa durur; K9 hiçbir durumda okunmaz):
 *   1. Ağ yok (yalnız loopback arayüzü).
 *   2. Güven çapası: USB'deki anchor.json katı kanonik JSON; nakgo-anchor/v1 hash'i kâğıttaki değerle aynı.
 *   3. Yapılandırma (repodaki ops/backup/config.json): çapa güvenilir ve ETKİN; etkin K9 açık anahtarı ve alıcı hash'i
 *      çapadakiyle aynı; K1/K2/K9 ayrık.
 *   4. Araç paketi (toolset-hash.cjs) çapadakiyle aynı.
 *   5. İstek: katı kanonik, hash'i içerikten; kısa kod operatörün çevrim içi ekranda gördüğüyle aynı; imzalanabilir.
 *   6. L1: şifreli paket (USB) boyut ve SHA-256 manifestle aynı; age başlığı tam iki X25519 alıcısı.
 *   7. L2 (bootstrap'ta zorunlu): A ya da B kimliğiyle çözme (kimliğin açık anahtarı alıcı listesinde); tar içeriği izin
 *      listesinde ve yalnız düz dosya; ağsız kümede süper kullanıcı OLMAYAN rolle geri yükleme ve bütün S1 denetimleri;
 *      R1–R3 migration eşleşmesi; referans derlemesiyle (uygulanmış migration'ların gerçek sonucu) zamanlanmış işler,
 *      dış tetikleyiciler ve şema (R4, R6, O5); sözleşme politikası (çapadaki istisna kodları).
 *   8. Şifresiz dosyalar ve küme silinir; araç paketi YENİDEN özetlenir (TOCTOU).
 *   9. Ancak şimdi: parola korumalı K9 (şifreli PKCS#8) okunur; kimliği çapa ve etkin K9 ile aynı olmalı. Bu adımdan sonra
 *      hiçbir alt süreç başlatılmaz.
 *  10. İzin listeli kayıt kurulur; manifest gövdesi ve kayıt ayrı amaç etiketleriyle imzalanır; zincir finalize'ın kullandığı
 *      kodla (manual-flow.verifyChain) yeniden doğrulanır; yanıt USB'ye atomik ve üzerine yazmadan yazılır.
 * Kayıt ve yanıt serbest metin, yol, ad, SQL ya da kişisel veri İÇERMEZ (yalnız kodlar, sayılar, hash'ler). Terminal
 * çıktısı da yalnız kodları gösterir. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const C=require('./crypto.cjs');
const SJ=require('./strict-json.cjs');
const SF=require('./safe-fs.cjs');
const MF=require('./manual-flow.cjs');
const MM=require('./migration-match.cjs');
const RM=require('./restore-meta.cjs');
const TS=require('./toolset-hash.cjs');
const ABORT=require('./abort.cjs');
const {parseHeader}=require('./encrypt.cjs');
const {run}=require('./dump.cjs');

const RECIPIENTS_FILE=path.join(__dirname,'../../ops/backup/recipients.txt');
const CONFIG_FILE=path.join(__dirname,'../../ops/backup/config.json');
const PACKAGE_MAX=2**31-1;
const RESTORE_ROLE='nakgo_restore';
const SAFE_FS_CODES=['EPATH','EROOT','ESYMLINK','ENOTDIR','ENOPROC','ELIMIT','ETYPE','ERACE','EHARDLINK','ESIZE'];

class Stop extends Error{constructor(code,msg){super(msg||code);this.code=code;}}
const stop=(code,msg)=>{throw new Stop(code,msg);};

/* ---------- 1. ağ ---------- */
function networkOffline(){
  const up=Object.entries(os.networkInterfaces()).filter(([,a])=>(a||[]).some(x=>!x.internal));
  return up.length?{ok:false,code:'network_present'}:{ok:true};
}

/* ---------- 2. çapa ---------- */
const ANCHOR_KEYS=['version','created_at','k9_key_id','k9_public_key','recipients_sha256','toolset_sha256','repo_commit','contract_exceptions'];
function validateAnchor(a){
  const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(!isObj(a)||Object.keys(a).sort().join()!==[...ANCHOR_KEYS].sort().join())stop('anchor_schema','çapa alanları izin listesiyle aynı değil');
  const R=MF.RE;
  if(a.version!==1||!R.iso.test(a.created_at)||!R.keyid.test(a.k9_key_id)||typeof a.k9_public_key!=='string'||!/^[A-Za-z0-9+/]{40,120}={0,2}$/.test(a.k9_public_key)
    ||!R.hex64.test(a.recipients_sha256)||!R.hex64.test(a.toolset_sha256)||!R.hex40.test(a.repo_commit)
    ||!Array.isArray(a.contract_exceptions)||a.contract_exceptions.length>8||!a.contract_exceptions.every(c=>R.code.test(c)))stop('anchor_schema','çapa değerleri geçersiz');
  let id;try{id=C.keyIdOf(crypto.createPublicKey({key:Buffer.from(a.k9_public_key,'base64'),format:'der',type:'spki'}));}catch{stop('anchor_key','çapadaki K9 açık anahtarı okunamadı');}
  if(id!==a.k9_key_id)stop('anchor_key','çapadaki K9 kimliği açık anahtarla uyuşmuyor');
  return a;
}
const anchorSha256=a=>SJ.domainHash(MF.H_ANCHOR,validateAnchor(a));

/* ---------- 3. yapılandırma ↔ çapa ---------- */
/** Çapada açık anahtar SPKI DER'in base64'üdür (katı JSON'da satır sonu yok); yapılandırmada PEM. */
const spkiB64=pem=>{try{return crypto.createPublicKey(pem).export({type:'spki',format:'der'}).toString('base64');}catch{return null;}};
function crossCheck(config,anchor,anchorSha){
  const p=MF.k9ConfigProblems(config);
  if(p.length)stop('config','yapılandırma: '+p.join('; '));
  if(config.active_anchor_sha256!==anchorSha)stop('anchor_not_active','çapa yapılandırmada etkin değil');
  if(config.active_k9!==anchor.k9_key_id||spkiB64(config.trusted_k9[anchor.k9_key_id])!==anchor.k9_public_key)stop('anchor_k9','çapadaki K9 etkin K9 değil');
  if(config.recipients_sha256!==anchor.recipients_sha256)stop('anchor_recipients','çapadaki alıcı hash\'i yapılandırmayla uyuşmuyor');
}

/* ---------- 7. tar içeriği ---------- */
const TAR_RE=/^(source\.json|bootstrap\.sql|A\.dump|B\.pre\.sql|B\.post\.sql|X\.pre\.sql|B\/[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.jsonl|meta\/[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.jsonl)$/;
async function checkTarList(tarFile){
  const r=await run('tar',['--numeric-owner','-tvf',tarFile]);
  if(r.code!==0)stop('tar_list','tar listesi okunamadı');
  const names=[];
  for(const line of r.out.split('\n').filter(Boolean)){
    const type=line[0];const name=line.split(/\s+/).slice(5).join(' ');
    if(type!=='-'||!TAR_RE.test(name)||names.includes(name))stop('tar_entry','pakette izin verilmeyen girdi');
    names.push(name);
  }
  for(const need of ['source.json','bootstrap.sql','A.dump'])if(!names.includes(need))stop('tar_entry','pakette zorunlu dosya yok');
  return names;
}
function checkExtracted(dir,names){
  const seen=[];
  const walk=rel=>{for(const e of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){
    const r=rel?rel+'/'+e.name:e.name;const st=fs.lstatSync(path.join(dir,r));
    if(st.isDirectory()&&(r==='B'||r==='meta'))walk(r);
    else if(st.isFile()&&st.nlink===1)seen.push(r);
    else stop('tar_entry','çıkarılan dosya türü beklenmeyen');
  }};
  walk('');
  if(seen.sort().join('\n')!==[...names].sort().join('\n'))stop('tar_entry','çıkarılan dosyalar listeyle aynı değil');
}

/* ---------- 9. K9 ---------- */
function loadK9({keyBytes,passphrase,anchor,config}){
  const pem=keyBytes.toString('utf8');
  if(!/^-----BEGIN ENCRYPTED PRIVATE KEY-----\n/.test(pem))stop('k9_unencrypted','K9 parola korumalı (şifreli PKCS#8) değil');
  let key;try{key=crypto.createPrivateKey({key:pem,format:'pem',passphrase});}catch{stop('k9_passphrase','K9 açılamadı (parola ya da dosya)');}
  if(key.asymmetricKeyType!=='ed25519')stop('k9_type','K9 ed25519 değil');
  const id=C.keyIdOf(crypto.createPublicKey(key));
  if(id!==anchor.k9_key_id||id!==config.active_k9)stop('k9_mismatch','K9 çapadaki ve etkin anahtarla aynı değil');
  return {key,id};
}
const signDoc=(ns,body,key,keyId)=>{
  const doc={...body,sig_alg:'ed25519',key_id:keyId,namespace:ns};
  return crypto.sign(null,Buffer.from(ns+'\n'+C.canonical(doc),'utf8'),key).toString('base64');
};

/** Programatik giriş (testler ve CLI). Dönüş: {ok, code?, response_name?, short_code?, level?, record?}. */
async function offlineSign(o){
  const ctx={tmp:null,cluster:null};
  let res;
  try{res=await signInner(o,ctx);}
  catch(e){
    // Kod ve metin yalnız sabit kaynaklardan (Stop, safe-fs, strict-json, manual-flow); ham sistem hatası metni döndürülmez.
    const fixed=e instanceof Stop||SAFE_FS_CODES.includes(e.code)||(typeof e.code==='string'&&/^[a-z][a-z0-9_]{2,39}$/.test(e.code));
    res=fixed?{ok:false,code:e.code,reason:e.message}
      :{ok:false,code:typeof e.code==='string'&&/^E[A-Z]{2,12}$/.test(e.code)?'file_'+e.code.toLowerCase():'error',reason:'beklenmeyen hata'};
  }
  // Temizlik hatası sonucu gizlemez ve tersine çevirmez: ayrı bildirilir (şifresiz klasör kalmış olabilir: elle silinir).
  try{await cleanupCtx(ctx);}catch{res={...res,cleanup_failed:true};}
  return res;
}
async function cleanupCtx(ctx){
  // Küme durdurulamaz ya da klasörü silinemezse hata yükselir: K9'a geçilmez (signInner bu noktada durur).
  if(ctx.cluster){const c=ctx.cluster;ctx.cluster=null;try{await c.stop();}catch{throw new Stop('cleanup_failed','geçici küme durdurulamadı ya da silinemedi');}}
  if(ctx.tmp){
    try{fs.rmSync(ctx.tmp,{recursive:true,force:true});}catch{}
    if(fs.existsSync(ctx.tmp))throw new Stop('cleanup_failed','şifresiz çalışma klasörü silinemedi (elle silin)');
    ctx.tmp=null;
  }
  if(ctx.unreg){ctx.unreg();ctx.unreg=null;}
}

async function signInner({usbDir,requestName='request.json',packageName,anchorName='anchor.json',referenceName='reference.json',responseName,anchorSha256:paper,confirmCode,
  identityFile,identityLabel,keyDir,keyName,passphrase,config,level='L2',pgInstall,pgBin,pgDirs=[],ageBin='age',nodeModules,workRoot=os.tmpdir(),clusterRoot=os.tmpdir(),
  networkCheck=networkOffline,recipientsFile=RECIPIENTS_FILE,runAs,identityFileB,repoList=RM.repoMigrations(),now=()=>new Date(),
  toolsetOptions={},log=()=>{}},ctx){
  const guard=()=>{if(ABORT.isAborting())stop('signal','sinyal alındı');};
  // 1. Ağ
  const net=networkCheck();if(!net||net.ok!==true)stop('network_present','makinede etkin ağ arayüzü var: imza yalnız çevrim dışı');
  // 2. Çapa
  if(!MF.RE.hex64.test(paper||''))stop('anchor_paper','kâğıttaki çapa hash\'i (--anchor-sha256) gerekli');
  const anchor=SJ.parseCanonical(SF.readFileSafe(usbDir,anchorName,{maxBytes:MF.LIMITS.anchor}));
  const aSha=anchorSha256(anchor);
  if(aSha!==paper)stop('anchor_mismatch','çapa kâğıttaki hash ile uyuşmuyor');
  log('çapa doğrulandı');
  // 3. Yapılandırma
  crossCheck(config,anchor,aSha);
  // 4. Araç paketi
  // Çalıştırılan her ikili araç paketinde olmalı: age ve age-keygen açık yoldan; PostgreSQL sunucu ve istemci klasörleri pgDirs içinde.
  const tsOpts={pgDirs,bins:ageBin.includes('/')?{age:ageBin,'age-keygen':ageBin+'-keygen'}:{},...(nodeModules?{nodeModules}:{}),...toolsetOptions};
  if(level==='L2'){
    if(!pgInstall||!pgBin)stop('pg_paths','L2 için --pg-install ve --pg-bin gerekli');
    const real=p=>{try{return fs.realpathSync(p);}catch{return null;}};
    const roots=pgDirs.map(real).filter(Boolean);
    for(const p of [pgInstall,pgBin])if(!real(p)||!roots.some(r=>real(p)===r||real(p).startsWith(r+path.sep)))stop('pg_paths','PostgreSQL klasörü araç paketinde (--pg-dirs) değil');
  }
  const ts1=TS.computeToolset(tsOpts);
  if(ts1.sha256!==anchor.toolset_sha256)stop('toolset_mismatch','araç paketi çapadakiyle aynı değil');
  log('araç paketi doğrulandı');
  // 5. İstek
  const pending=MF.decodeRequestFile(SF.readFileSafe(usbDir,requestName,{maxBytes:MF.LIMITS.request}));
  const req=pending.request;
  const code=MF.shortCode(pending.request_sha256);
  if(confirmCode!==code)stop('short_code','kısa kod çevrim içi ekrandakiyle aynı değil');
  const why=MF.requestSignable(req);if(why)stop('request_'+why,'istek imzalanabilir değil');
  // Yanıt hedefi baştan denetlenir (asıl koruma yazımdaki O_EXCL): var olan yanıt için iş ve K9 kullanılmaz.
  const respName=responseName||`response-${req.run_id}.json`;
  SF.checkRel(respName);
  if(fs.existsSync(path.join(usbDir,respName))||(()=>{try{fs.lstatSync(path.join(usbDir,respName));return true;}catch{return false;}})())stop('response_exists','yanıt dosyası zaten var; üzerine yazılmaz');
  if(req.manifest.recipients_sha256!==anchor.recipients_sha256)stop('recipients','paketin alıcıları çapadakiyle aynı değil');
  if(!['L1','L2'].includes(level))stop('level','geçersiz seviye');
  if(req.kind==='bootstrap'&&level!=='L2')stop('level','ilk yedekte (bootstrap) L2 zorunlu');
  if(req.kind==='bootstrap'&&req.reference_sha256===null)stop('reference_required','ilk yedekte (bootstrap) T8 ölçümü zorunlu');
  // T8 referans ölçümü (bootstrap): istekteki hash'e bağlı dosya; L2'de paketle karşılaştırılır.
  let refDoc=null;
  if(req.reference_sha256!==null){
    const RMS=require('./reference-measure.cjs');
    refDoc=SJ.parseCanonical(SF.readFileSafe(usbDir,referenceName,{maxBytes:MF.LIMITS.reference}));
    if(RMS.referenceSha256(refDoc)!==req.reference_sha256)stop('reference_hash','referans ölçüm dosyası istekteki hash ile uyuşmuyor');
  }
  // 6. L1
  const expectName=path.posix.basename(req.data_key);
  if((packageName||expectName)!==expectName)stop('package_name','paket adı istekteki anahtarla aynı değil');
  const pkg=SF.readFileSafe(usbDir,expectName,{maxBytes:PACKAGE_MAX});
  if(pkg.length!==req.manifest.size||SJ.sha256Hex(pkg)!==req.manifest.ciphertext_sha256)stop('package_hash','şifreli paket boyutu ya da SHA-256 manifestle uyuşmuyor');
  const hdr=parseHeader(pkg);
  if(!hdr.ok||hdr.stanzas.length!==2||hdr.stanzas.some(s=>s!=='X25519'))stop('package_header','age başlığı tam iki X25519 alıcısı içermiyor');
  log('L1 tamam');
  guard();
  let offline={level,ciphertext_ok:true,header_ok:true,decrypted_with:null,restore:null,restore_role:null,checks:[],migrations:null,cron:null,triggers:null,schema:null,reference:'not_measured',contract:null};
  if(level==='L2')offline=await levelTwo({req,pkg,anchor,refDoc,identityFile,identityLabel,recipientsFile,ageBin,pgInstall,pgBin,workRoot,clusterRoot,runAs,identityFileB,repoList,ctx,guard,log});
  // 8. Temizlik ve araç paketini yeniden özetleme
  await cleanupCtx(ctx);
  guard();
  const ts2=TS.computeToolset(tsOpts);
  if(ts2.sha256!==ts1.sha256)stop('toolset_changed','araç paketi çalışma sırasında değişti');
  // 9. K9 (bundan sonra alt süreç YOK). Ağ K9'dan hemen önce yeniden denetlenir (uzun L2 sırasında arayüz açılmış olabilir).
  const net2=networkCheck();if(!net2||net2.ok!==true)stop('network_present','makinede etkin ağ arayüzü var: imza yalnız çevrim dışı');
  const keyBytes=SF.readFileSafe(keyDir,keyName,{maxBytes:8192});
  const pass=typeof passphrase==='function'?await passphrase():passphrase;
  const {key,id}=loadK9({keyBytes,passphrase:pass,anchor,config});
  // 10. Kayıt, imzalar, zincir, yanıt
  const signedAt=now().toISOString();
  const record=MF.validateRecordBody({version:1,kind:req.kind,run_id:req.run_id,created_at:req.created_at,request_sha256:pending.request_sha256,
    manifest_key:req.manifest_key,manifest_sha256:MF.manifestBodySha256(req.manifest),data_key:req.data_key,ciphertext_sha256:req.manifest.ciphertext_sha256,
    size:req.manifest.size,recipients_sha256:req.manifest.recipients_sha256,k9_key_id:id,anchor_sha256:aSha,reference_sha256:req.reference_sha256,
    toolset_sha256:ts2.sha256,repo_commit:anchor.repo_commit,approval_ref:req.approval_ref,claims:req.claims,offline,signed_at:signedAt});
  const response=MF.validateResponse({version:1,run_id:req.run_id,request_sha256:pending.request_sha256,
    manifest_signature:{key_id:id,signature:signDoc(MF.NS_MANIFEST,req.manifest,key,id)},record,
    record_signature:{key_id:id,signature:signDoc(MF.NS_RECORD,record,key,id)}});
  MF.verifyChain({manifestDoc:MF.attach(MF.NS_MANIFEST,req.manifest,response.manifest_signature),recordDoc:MF.attach(MF.NS_RECORD,record,response.record_signature),
    config,packageBytes:pkg,pending,forNewSignature:true});
  guard();
  const name=respName;
  const w=SF.writeNewAtomic(usbDir,name,SJ.toBytes(response));
  if(!w.ok)stop('response_exists','yanıt dosyası zaten var; üzerine yazılmaz');
  return {ok:true,response_name:name,short_code:code,level,run_id:req.run_id,record};
}

async function levelTwo({req,pkg,anchor,refDoc,identityFile,identityLabel,recipientsFile,ageBin,pgInstall,pgBin,workRoot,clusterRoot,runAs,identityFileB,repoList,ctx,guard,log}){
  if(!['A','B','AB'].includes(identityLabel))stop('identity_label','kimlik etiketi A, B ya da AB olmalı');
  if((identityLabel==='AB')!==Boolean(identityFileB))stop('identity_label','AB için iki kimlik dosyası (A: --identity, B: --identity-b) gerekli');
  if(!pgInstall)stop('pg_install','PostgreSQL sunucu kurulumu gerekli (--pg-install)');
  // Alıcı listesi: repodaki dosya, hash'i çapadakiyle aynı; kimliğin açık anahtarı etikete karşılık gelen alıcı.
  const {recipientsOf,recipientsSha256}=require('./encrypt.cjs');
  if(recipientsSha256(recipientsFile)!==anchor.recipients_sha256)stop('recipients','alıcı dosyası çapadakiyle aynı değil');
  const recips=recipientsOf(recipientsFile);
  // A sıralı alıcı listesinin ilki, B ikincisi (key-ceremony.md); etiket kimlikle aynı olmalı (kayıttaki decrypted_with kanıt).
  const idents=identityLabel==='AB'?[[identityFile,0],[identityFileB,1]]:[[identityFile,identityLabel==='A'?0:1]];
  if(recips.length!==2)stop('recipients','alıcı listesi tam iki alıcı (A, B) içermeli');
  for(const [f,want] of idents){
    const pub=await run(ageBin+'-keygen',['-y',f]);
    const idx=recips.indexOf(pub.out.trim());
    if(pub.code!==0||idx<0)stop('identity','kimlik alıcı listesinde değil');
    if(idx!==want)stop('identity_label','kimlik etiketi alıcı listesindeki yeriyle uyuşmuyor');
  }
  ctx.tmp=fs.mkdtempSync(path.join(workRoot,'nakgo-offline-'));fs.chmodSync(ctx.tmp,0o700);
  const tmp=ctx.tmp;
  ctx.unreg=ABORT.register('çevrim dışı şifresiz çalışma klasörü',()=>fs.rmSync(tmp,{recursive:true,force:true}));
  // Doğrulanmış baytlar kopyalanır; USB'deki dosya bir daha okunmaz (TOCTOU).
  const ct=path.join(tmp,'pkg.age');const fd=fs.openSync(ct,'wx',0o600);try{fs.writeSync(fd,pkg);}finally{fs.closeSync(fd);}
  const tar=path.join(tmp,'pkg.tar');
  // Her kimlik AYRI çözer; AB'de iki düz metnin baytları aynı olmalı (iki alıcının ikisi de aynı paketi açıyor).
  let plainSha=null;
  for(const [i,[f]] of idents.entries()){
    guard();
    const out=i===0?tar:path.join(tmp,'pkg-'+i+'.tar');
    const d=await run(ageBin,['-d','-i',f,'-o',out,ct]);
    if(d.code!==0)stop('decrypt','paket bu kimlikle çözülemedi');
    const h=TS.fileSha256(out);
    if(plainSha!==null&&h!==plainSha)stop('decrypt_mismatch','iki kimliğin çözdüğü içerik farklı');
    plainSha=h;if(i>0)fs.rmSync(out);
  }
  fs.rmSync(ct);
  const names=await checkTarList(tar);
  const bundle=path.join(tmp,'bundle');fs.mkdirSync(bundle,{mode:0o700});
  const x=await run('tar',['--no-same-owner','--no-same-permissions','--no-overwrite-dir','-xf',tar,'-C',bundle]);
  if(x.code!==0)stop('tar_extract','paket açılamadı');
  fs.rmSync(tar);
  checkExtracted(bundle,names);
  log('L2: paket çözüldü ('+identityLabel+')');
  // R1–R3: migration geçmişi ↔ repo (takma adlar PR'la incelenmiş dosyadan).
  const source=JSON.parse(SF.readFileSafe(bundle,'source.json',{maxBytes:MF.LIMITS.reference}).toString('utf8'));
  const {readMeta}=require('./scope-export.cjs');
  let meta;try{meta=readMeta(bundle,source.meta_files||{});}catch{stop('meta','yönetim verisi okunamadı');}
  const history=meta['supabase_migrations.schema_migrations'];
  if(!Array.isArray(history))stop('migration_history','migration geçmişi yedekte yok');
  const mm=MM.matchHistory(history,repoList);
  if(!mm.ok)stop('migration_history','migration geçmişi repo ile eşleşmiyor');
  if(!mm.applied.length)stop('migration_history','migration geçmişi boş: yanlış kaynak ya da eksik yönetim verisi');
  // T8: döküm anlık görüntüsü ve sayıları, çevrim içi önce/sonra ölçümleriyle tutarlı mı (kanıt değil, tutarlılık).
  let reference='not_measured';
  if(refDoc){
    const RMS=require('./reference-measure.cjs');
    reference=RMS.compare(refDoc,{txid_snapshot:source.txid_snapshot,counts:source.counts||{},migrations_sha256:RMS.historySha256(history)}).result;
  }
  // Referans derlemesi: uygulanmış migration'ların gerçek sonucu (yalnız repodaki dosyalar).
  guard();
  const RB=require('./reference-build.cjs');
  const scope=JSON.parse(fs.readFileSync(path.join(__dirname,'../../ops/backup/scope.json'),'utf8'));
  const ref=await RB.buildReference({installDir:pgInstall,list:mm.appliedFiles,scope,workRoot:clusterRoot,runAs});
  log('referans derlendi');
  // Ağsız küme; süper kullanıcı olmayan rol.
  guard();
  const PC=require('./pg-cluster.cjs');
  ctx.cluster=await PC.startCluster({installDir:pgInstall,workRoot:clusterRoot,runAs,settings:{createrole_self_grant:"'set,inherit'"}});
  const a=await PC.adminClient(ctx.cluster);
  try{await a.query(`create role ${RESTORE_ROLE} login createdb createrole; create role service_role nologin bypassrls`);}finally{await a.end();}
  const {restoreAndVerify}=require('./restore-verify.cjs');
  const expected={cron:ref.cron,triggers:ref.triggers,snapshot:ref.snapshot};
  const verify=user=>restoreAndVerify({bundleDir:bundle,pgBin,contractCheck:false,requireMeta:true,expected,target:{host:ctx.cluster.host,port:ctx.cluster.port,user}});
  // Süper kullanıcıyla geri yükleme yolu YOKTUR: paket SQL'i yalnız yetkisiz rolle çalışır (offline-signing.md).
  const v=await verify(RESTORE_ROLE),role='non_superuser';
  if(v.status!=='ok')stop('restore_'+(v.checks.find(c=>!c.ok)||{code:'failed'}).code,'çevrim dışı geri yükleme doğrulaması başarısız');
  // Kayıttaki rol etiketi, geri yüklemeyi yapan oturumun ölçülen yetkisiyle aynı olmalı.
  const tr=v.checks.find(c=>c.code==='target_role');
  if(!tr||tr.detail.superuser!==false)stop('restore_role','geri yükleme rolünün yetkisi beklenenden farklı');
  const need=['target_role','restore','counts','fk_orphans','fingerprint','meta','migration_history','cron_jobs','external_triggers','schema_reference'];
  for(const c of need)if(!v.checks.some(x=>x.code===c&&x.ok))stop('check_missing','zorunlu denetim çalışmadı: '+c);
  log('L2: geri yükleme doğrulandı ('+role+')');
  // Sözleşme politikası: çevrim içi "passed" değilse yalnız çapadaki istisna koduyla.
  let contract;
  if(req.claims.contract==='passed')contract={status:'claimed_passed',exception:null};
  else if(req.claims.contract==='skipped'&&anchor.contract_exceptions.includes('no_contract_at_applied_ref'))contract={status:'exception',exception:'no_contract_at_applied_ref'};
  else stop('contract_policy','sözleşme sonucu çapanın politikasına uymuyor');
  const jobs=meta['cron.job']||[];
  return {level:'L2',ciphertext_ok:true,header_ok:true,decrypted_with:identityLabel,restore:'ok',restore_role:role,
    checks:[...new Set(v.checks.filter(c=>c.ok).map(c=>c.code))].filter(c=>MF.RE.code.test(c)).slice(0,64),
    migrations:{applied:mm.applied.length,pending:mm.pending.length,aliases:mm.aliases,nameless:mm.nameless},
    cron:{jobs:jobs.length,inactive:jobs.filter(j=>j&&j.active===false).length},triggers:ref.triggers.length,schema:'match',reference,contract};
}

module.exports={offlineSign,networkOffline,validateAnchor,anchorSha256,checkTarList,spkiB64,loadK9,ANCHOR_KEYS,TAR_RE};

/* ---------- CLI ---------- */
function readHidden(prompt){
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY)return reject(Error('parola yalnız terminalden okunur'));
    process.stderr.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();let s='';
    const on=b=>{for(const ch of b.toString('utf8')){
      if(ch==='\r'||ch==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',on);process.stderr.write('\n');return resolve(s);}
      if(ch==='\u0003'){process.stdin.setRawMode(false);process.stdin.off('data',on);return reject(Error('iptal'));}
      if(ch==='\u007f')s=s.slice(0,-1);else s+=ch;}};
    process.stdin.on('data',on);
  });
}
if(require.main===module)(async()=>{
  if(process.env.CI||process.env.GITHUB_ACTIONS)throw Error('offline-sign CI\'da çalışmaz');
  if(process.argv.includes('--allow-superuser-isolated'))throw Error('süper kullanıcıyla geri yükleme kaldırıldı');
  ABORT.installSignalHandlers();
  const args=process.argv.slice(2);const arg=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const need=k=>{const v=arg(k);if(!v)throw Error('eksik: '+k);return v;};
  const key=path.resolve(need('--k9-key'));
  const r=await offlineSign({usbDir:need('--usb'),anchorSha256:need('--anchor-sha256'),confirmCode:need('--confirm-code'),
    identityFile:arg('--identity'),identityLabel:arg('--identity-label'),keyDir:path.dirname(key),keyName:path.basename(key),
    passphrase:()=>readHidden('K9 parolası: '),config:SJ.parse(fs.readFileSync(CONFIG_FILE,'utf8')),level:arg('--level')||'L2',
    pgInstall:arg('--pg-install'),pgBin:arg('--pg-bin'),pgDirs:(arg('--pg-dirs')||'').split(',').filter(Boolean),ageBin:arg('--age')||'age',
    identityFileB:arg('--identity-b'),log:m=>console.error(m)});
  console.log(JSON.stringify({ok:r.ok,code:r.code||null,response:r.response_name||null,short_code:r.short_code||null,level:r.level||null,cleanup_failed:r.cleanup_failed===true,repo_commit:r.record?r.record.repo_commit:null},null,1));
  if(r.cleanup_failed)console.error('UYARI: geçici klasör ya da küme silinemedi (nakgo-offline-*, nakgo-pgc-*): şifresiz veri kalmış olabilir, elle silin.');
  if(r.record)console.error('Kayıttaki repo_commit '+r.record.repo_commit+': kâğıttaki çapa kaydıyla karşılaştırın.');
  if(!r.ok)console.error('imza REDDEDİLDİ ('+r.code+'): '+r.reason);
  process.exitCode=r.ok?0:1;
})().catch(e=>{console.error('offline-sign durdu: '+e.message);process.exitCode=1;});

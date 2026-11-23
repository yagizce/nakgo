/** K9 elle yedek akışı: veritabanı gerektirmeyen birim ve negatif testler.
 * Katı JSON, şemalar (izin listesi), imza zinciri (finalize ve dr-fetch'in ortak kodu), çapa, araç paketi, migration
 * eşleşmesi (R1–R3), dosya güvenliği ve offline-sign'ın K9'u yalnız bütün denetimlerden sonra kullanması. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const SJ=require('../../tools/backup/strict-json.cjs');
const SF=require('../../tools/backup/safe-fs.cjs');
const MF=require('../../tools/backup/manual-flow.cjs');
const MM=require('../../tools/backup/migration-match.cjs');
const OS=require('../../tools/backup/offline-sign.cjs');
const TS=require('../../tools/backup/toolset-hash.cjs');
const C=require('../../tools/backup/crypto.cjs');
const {DATA_STAGES}=require('../../tools/backup/manifest.cjs');
const {FileStore}=require('../../tools/backup/store.cjs');

const root=path.resolve(__dirname,'../..');
const OWN=new Set();
const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-b9u-'));OWN.add(d);return d;};
process.on('exit',()=>{for(const d of OWN)try{fs.rmSync(d,{recursive:true,force:true});}catch{}});
const hex=n=>crypto.randomBytes(n).toString('hex');
const throwsCode=(fn,code,label)=>{let e=null;try{fn();}catch(x){e=x;}assert.ok(e,label+': hata bekleniyordu');assert.equal(e.code,code,label+': '+(e&&e.message));};
const rejectsCode=async(p,code,label)=>{let e=null;try{await p;}catch(x){e=x;}assert.ok(e,label+': hata bekleniyordu');assert.equal(e.code,code,label+': '+(e&&e.message));};

/* ---------- sentetik zincir ---------- */
function signDoc(ns,body,key,keyId){
  return crypto.sign(null,Buffer.from(ns+'\n'+C.canonical({...body,sig_alg:'ed25519',key_id:keyId,namespace:ns}),'utf8'),key).toString('base64');
}
function synth({kind='bootstrap',runId='u1',createdAt='2026-11-23T03:00:00.000Z'}={}){
  const refSha=kind==='bootstrap'?hex(32):null;// bootstrap: T8 ölçümü bağlı (politika)
  const k9=crypto.generateKeyPairSync('ed25519');const pub=k9.publicKey.export({type:'spki',format:'pem'});const id=C.keyIdOf(pub);
  const pkg=crypto.randomBytes(4096);const recipients=hex(32);const anchor=hex(32);
  const keys=MF.keysFor(runId,createdAt);
  const manifest={version:1,kind,run_id:runId,created_at:createdAt,
    stages:Object.fromEntries(DATA_STAGES.map(k=>[k,{status:k==='legal'?'n/a':'ok'}])),verified:true,object_key:keys.data_key,
    ciphertext_sha256:SJ.sha256Hex(pkg),size:pkg.length,recipients_sha256:recipients,
    source:{taken_at:'2026-11-23T03:00:01.123456Z',server_version:'17.2',auth_version:null,table_count:10,fingerprint_sha256:hex(32),s1_open_ms:5,mode:'bootstrap',txid_snapshot:'100:105:'}};
  const claims={backup_verified:true,run_complete:true,contract:'skipped',checks:[{code:'restore',ok:true},{code:'counts',ok:true}],
    extra:{manifest_signature:'deferred',manifest_upload:'deferred',plaintext_cleanup:'ok'},
    notes:{migration_history:{ok:true,applied:32,pending:19,unknown:0,gaps:0},cron_jobs:{ok:true,jobs:2,problems:0},external_triggers:1}};
  const request={version:1,kind,run_id:runId,created_at:createdAt,approval_ref:'TEST-ONAY-U1',data_key:keys.data_key,manifest_key:keys.manifest_key,record_key:keys.record_key,reference_sha256:refSha,manifest,claims};
  const enc=MF.encodeRequestFile(request);
  const offline={level:'L2',ciphertext_ok:true,header_ok:true,decrypted_with:'A',restore:'ok',restore_role:'non_superuser',checks:['restore','counts'],
    migrations:{applied:32,pending:19,aliases:0,nameless:0},cron:{jobs:2,inactive:0},triggers:1,schema:'match',reference:refSha?'match':'not_measured',
    contract:{status:'exception',exception:'no_contract_at_applied_ref'}};
  const record={version:1,kind,run_id:runId,created_at:createdAt,request_sha256:enc.request_sha256,manifest_key:keys.manifest_key,
    manifest_sha256:MF.manifestBodySha256(manifest),data_key:keys.data_key,ciphertext_sha256:manifest.ciphertext_sha256,size:pkg.length,
    recipients_sha256:recipients,k9_key_id:id,anchor_sha256:anchor,reference_sha256:refSha,toolset_sha256:hex(32),repo_commit:hex(20),
    approval_ref:request.approval_ref,claims,offline,signed_at:'2026-11-23T05:00:00.000Z'};
  const config={version:1,recipients_sha256:recipients,trusted_k1:{},trusted_k2:{},trusted_k9:{[id]:pub},active_k9:id,
    trusted_anchors:{[anchor]:{created_at:'2026-11-22T10:00:00.000Z'}},active_anchor_sha256:anchor};
  const respond=(rec=record,man=manifest,key=k9.privateKey,kid=id)=>({version:1,run_id:rec.run_id,request_sha256:rec.request_sha256,
    manifest_signature:{key_id:kid,signature:signDoc(MF.NS_MANIFEST,man,key,kid)},record:rec,record_signature:{key_id:kid,signature:signDoc(MF.NS_RECORD,rec,key,kid)}});
  return {k9,pub,id,pkg,keys,manifest,claims,request,enc,record,config,respond};
}
async function storeWith(S,{withRequest=true}={}){
  const dir=tmp();const store=new FileStore({dir});
  await store.put(S.keys.data_key,S.pkg,{ifNoneMatch:true});
  if(withRequest)await store.put(S.keys.request_key,S.enc.bytes,{ifNoneMatch:true});
  return {dir,store};
}

/* ---------- katı JSON ---------- */
test('katı JSON: yinelenen anahtar, kesir, büyük sayı, -0, BOM, kontrol karakteri, NFC dışı, kanonik olmayan bayt REDDEDİLİR',()=>{
  assert.deepEqual({...SJ.parse('{"a":1,"b":[1,2]}')},{a:1,b:[1,2]});
  for(const [label,t] of [['yinelenen','{"a":1,"a":2}'],['kesir','{"a":1.5}'],['üs','{"a":1e3}'],['büyük',`{"a":${2**53}}`],['-0','{"a":-0}'],
    ['başta sıfır','{"a":01}'],['BOM','\ufeff{"a":1}'],['kontrol','{"a":"x\\u0001"}'],['satır sonu','{"a":"x\\ny"}'],['NFC dışı','{"a":"e\u0301"}'],
    ['yalnız vekil','{"a":"\\ud800"}'],['sonda çöp','{"a":1} x'],['derinlik','['.repeat(40)+']'.repeat(40)]])
    throwsCode(()=>SJ.parse(t),'strict_json',label);
  assert.equal(SJ.parse(String(Number.MAX_SAFE_INTEGER)),Number.MAX_SAFE_INTEGER);
  assert.throws(()=>SJ.parse('{"a":1,"b":2,"a":3}'),/yinelenen anahtar/);
  // Kanonik bayt: boşluk, sıra ya da kaçış farkı reddedilir.
  assert.deepEqual({...SJ.parseCanonical(Buffer.from('{"a":1,"b":2}'))},{a:1,b:2});
  for(const t of ['{"b":2,"a":1}','{"a": 1}','{"a":"\\u0041"}','{"a":1}\n'])throwsCode(()=>SJ.parseCanonical(Buffer.from(t)),'strict_json',t);
  throwsCode(()=>SJ.parseCanonical(Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d])),'strict_json','geçersiz UTF-8');
  // __proto__ anahtarı prototipi değiştirmez.
  const o=SJ.parse('{"__proto__":{"x":1}}');assert.equal(Object.getPrototypeOf(o),null);assert.equal(({}).x,undefined);
});

/* ---------- şemalar ---------- */
test('istek ve kayıt şemaları izin listesi: fazladan alan, serbest metin, yanlış tür ve bağsız anahtar reddedilir',()=>{
  const S=synth();
  assert.equal(MF.validateRequest(S.request),S.request);
  assert.equal(MF.validateRecordBody(S.record),S.record);
  const bad=[
    ['istekte e-posta alanı',()=>MF.validateRequest({...S.request,email:'a@b.c'})],
    ['manifestte neden metni',()=>MF.validateRequest({...S.request,manifest:{...S.manifest,stages:{...S.manifest.stages,dump:{status:'ok',reason:'x'}}}})],
    ['manifest başka paket',()=>MF.validateRequest({...S.request,manifest:{...S.manifest,object_key:'manual/db/x.tar.age'}})],
    ['istek anahtarı yönlendirme',()=>MF.validateRequest({...S.request,record_key:'manual/records/2026/11/23/nakgo-20261123T030000Z-baska.json'})],
    ['beyanlarda serbest metin',()=>MF.validateRequest({...S.request,claims:{...S.claims,checks:[{code:'restore',ok:true,detail:'x'}]}})],
    ['beyanlarda kod biçimi',()=>MF.validateRequest({...S.request,claims:{...S.claims,checks:[{code:'Kod Değil',ok:true}]}})],
    ['kayıtta fazladan alan',()=>MF.validateRecordBody({...S.record,note:'x'})],
    ['kayıtta kesir boyut',()=>MF.validateRecordBody({...S.record,size:1.5})],
    ['kayıtta güvensiz tamsayı',()=>MF.validateRecordBody({...S.record,size:2**53})],
    ['L2 süper kullanıcı adı',()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,restore_role:'postgres'}})],
    ['L2 şema farkı',()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,schema:'drift'}})],
    ['L1 ama geri yükleme alanı dolu',()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,level:'L1'}})],
    ['istisnasız sözleşme istisnası',()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,contract:{status:'exception',exception:null}}})],
    ['run_id yol kaçışı',()=>MF.keysFor('../x','2026-11-23T03:00:00.000Z')],
  ];
  for(const [label,fn] of bad)throwsCode(fn,'schema',label);
  // İstek dosyası: hash içerikten; alan değiştirilirse ya da yanlış hash yazılırsa reddedilir.
  assert.equal(MF.decodeRequestFile(S.enc.bytes).request_sha256,S.enc.request_sha256);
  const w=JSON.parse(S.enc.bytes.toString());w.request.approval_ref='TEST-ONAY-BASKA';
  throwsCode(()=>MF.decodeRequestFile(SJ.toBytes(w)),'request_hash','istek değişti');
  assert.match(MF.shortCode(S.enc.request_sha256),/^([0-9a-f]{4}-){4}[0-9a-f]{4}$/);
  // İmzalanabilirlik: çevrim içi beyanlar kanıt değil ön koşul.
  assert.equal(MF.requestSignable(S.request),null);
  assert.equal(MF.requestSignable({...S.request,claims:{...S.claims,contract:'failed'}}),'contract_unknown');
  assert.equal(MF.requestSignable({...S.request,claims:{...S.claims,extra:{...S.claims.extra,plaintext_cleanup:'failed'}}}),'cleanup_failed');
  assert.equal(MF.requestSignable({...S.request,claims:{...S.claims,checks:[{code:'counts',ok:false}]}}),'check_failed');
  // Başarısızlık raporu yalnız sabit kodlar.
  const f=MF.failedReport({kind:'bootstrap',runId:'u1',createdAt:'2026-11-23T03:00:00.000Z',failedStage:'restore_test',codes:['cron_jobs','x"<b>@e.com'],stages:{},exitCode:1});
  assert.ok(!JSON.stringify(f).includes('@'));assert.ok(f.codes.every(c=>/^[a-z][a-z0-9_]*$/.test(c)));
});

/* ---------- zincir ---------- */
test('imza zinciri: geçerli zincir doğrulanır; her bağ ve imza bozulması ayrı kodla reddedilir',()=>{
  const S=synth();const r=S.respond();const P={request:S.request,request_sha256:S.enc.request_sha256};
  const docs=(resp=r,man=S.manifest)=>({manifestDoc:MF.attach(MF.NS_MANIFEST,man,resp.manifest_signature),recordDoc:MF.attach(MF.NS_RECORD,resp.record,resp.record_signature)});
  const ok=MF.verifyChain({...docs(),config:S.config,packageBytes:S.pkg,pending:P,forNewSignature:true});
  assert.equal(ok.request_binding,'verified');
  assert.equal(MF.verifyChain({...docs(),config:S.config,packageBytes:S.pkg}).request_binding,'not_checked');
  throwsCode(()=>MF.verifyChain({...docs(),config:S.config,packageBytes:S.pkg,requireRequest:true}),'request_missing','istek zorunlu');
  const other=crypto.generateKeyPairSync('ed25519');const opub=other.publicKey.export({type:'spki',format:'pem'});const oid=C.keyIdOf(opub);
  const cases=[
    ['manifest_signature','K9 güvenilir değil',{config:{...S.config,trusted_k9:{}}}],
    ['manifest_signature','imzalar yer değiştirmiş (amaç etiketi)',{docs:{manifestDoc:MF.attach(MF.NS_MANIFEST,S.manifest,r.record_signature),recordDoc:docs().recordDoc}}],
    ['record_signature','kayıt değiştirilmiş',{docs:{...docs(),recordDoc:{...docs().recordDoc,approval_ref:'TEST-ONAY-BASKA'}}}],
    ['manifest_signature','manifest değiştirilmiş',{docs:{...docs(),manifestDoc:{...docs().manifestDoc,verified:true,size:S.manifest.size+1}}}],
    ['k9_not_active','eski K9 (güvenilir ama etkin değil)',{config:{...S.config,trusted_k9:{...S.config.trusted_k9,[oid]:opub},active_k9:oid},fresh:true}],
    ['anchor_untrusted','çapa güvenilir değil',{config:{...S.config,trusted_anchors:{}}}],
    ['anchor_not_active','eski çapa',{config:{...S.config,trusted_anchors:{...S.config.trusted_anchors,['f'.repeat(64)]:{}},active_anchor_sha256:'f'.repeat(64)},fresh:true}],
    ['recipients','alıcı hash\'i yapılandırmayla farklı',{config:{...S.config,recipients_sha256:'0'.repeat(64)}}],
    ['package_hash','paket bozulmuş',{pkg:Buffer.concat([S.pkg.subarray(0,-1),Buffer.from([S.pkg[S.pkg.length-1]^1])])}],
    ['package_hash','paket kısaltılmış',{pkg:S.pkg.subarray(1)}],
    ['package_missing','paket yok',{pkg:null}],
    ['request_hash','başka istek',{pending:{...P,request_sha256:'1'.repeat(64)}}],
  ];
  for(const [code,label,o] of cases){
    throwsCode(()=>MF.verifyChain({...(o.docs||docs()),config:o.config||S.config,packageBytes:'pkg' in o?o.pkg:S.pkg,pending:o.pending||P,forNewSignature:!!o.fresh}),code,label);
  }
  // Başka anahtarla imzalanmış, kendi içinde tutarlı yanıt: anahtar güvenilir değil.
  const forged=S.respond({...S.record,k9_key_id:oid},S.manifest,other.privateKey,oid);
  throwsCode(()=>MF.verifyChain({...docs(forged),config:S.config,packageBytes:S.pkg,pending:P}),'manifest_signature','sahte K9');
  // K9 ile geçerli imzalanmış ama bekleyen istekteki beyanlardan farklı beyan taşıyan kayıt (imzacı hatası/yalan): bağ reddeder.
  const r3=S.respond({...S.record,claims:{...S.claims,checks:[{code:'restore',ok:true}]}});
  throwsCode(()=>MF.verifyChain({...docs(r3),config:S.config,packageBytes:S.pkg,pending:P}),'request_claims','beyan farkı');
  const r4=S.respond({...S.record,approval_ref:'TEST-ONAY-BASKA'});
  throwsCode(()=>MF.verifyChain({...docs(r4),config:S.config,packageBytes:S.pkg,pending:P}),'request_fields','onay farkı');
  // Kayıt başka manifest gövdesine işaret ediyor.
  const r2=S.respond({...S.record,manifest_sha256:'2'.repeat(64)});
  throwsCode(()=>MF.verifyChain({...docs(r2),config:S.config,packageBytes:S.pkg,pending:P}),'manifest_hash','manifest hash');
});

test('finalize: yalnız bekleyen istek + yanıt + paket + main yapılandırması; atomik, üzerine yazmaz, yarıda kalırsa tekrar çalışır',async()=>{
  const S=synth();const r=S.respond();const bytes=SJ.toBytes(r);
  const {dir,store}=await storeWith(S);
  const f=await MF.finalize({store,config:S.config,responseBytes:bytes});
  assert.equal(f.completed,true);assert.deepEqual(f.writes,{manifest:'written',record:'written'});assert.equal(f.request_binding,'verified');
  assert.deepEqual((await MF.finalize({store,config:S.config,responseBytes:bytes})).writes,{manifest:'unchanged',record:'unchanged'});
  const v=await MF.verifyStored({store,config:S.config,manifestKey:S.keys.manifest_key,requireRequest:true});assert.equal(v.ok,true);
  // Yarım kalmış: manifest yazılmış, kayıt yok → tekrar çalıştırmak tamamlar.
  {const S2=synth({runId:'half'});const {dir:d2,store:s2}=await storeWith(S2);const b2=SJ.toBytes(S2.respond());
    await s2.put(S2.keys.manifest_key,SJ.toBytes(MF.attach(MF.NS_MANIFEST,S2.manifest,S2.respond().manifest_signature)),{ifNoneMatch:true});
    const x=await MF.finalize({store:s2,config:S2.config,responseBytes:b2});assert.deepEqual(x.writes,{manifest:'unchanged',record:'written'});
    // Hedefte farklı içerik: çakışma, üzerine yazılmaz.
    const S3=synth({runId:'conf'});const {store:s3}=await storeWith(S3);await s3.put(S3.keys.record_key,Buffer.from('{}'),{ifNoneMatch:true});
    await rejectsCode(MF.finalize({store:s3,config:S3.config,responseBytes:SJ.toBytes(S3.respond())}),'conflict','çakışma');
    assert.equal((await s3.get(S3.keys.record_key)).toString(),'{}');void d2;}
  // Bekleyen istek yoksa finalize etmez.
  {const S4=synth({runId:'noreq'});const {store:s4}=await storeWith(S4,{withRequest:false});
    await rejectsCode(MF.finalize({store:s4,config:S4.config,responseBytes:SJ.toBytes(S4.respond())}),'request_missing','istek yok');
    assert.equal(await s4.get(S4.keys.manifest_key),null);}
  // Yanıt biçimi: kanonik değil, büyük, fazladan alan.
  const S5=synth({runId:'fmt'});const {store:s5}=await storeWith(S5);const r5=S5.respond();
  await rejectsCode(MF.finalize({store:s5,config:S5.config,responseBytes:Buffer.from(JSON.stringify(r5,null,1))}),'strict_json','kanonik değil');
  await rejectsCode(MF.finalize({store:s5,config:S5.config,responseBytes:Buffer.alloc(MF.LIMITS.response+1,32)}),'response_size','büyük');
  await rejectsCode(MF.finalize({store:s5,config:S5.config,responseBytes:SJ.toBytes({...r5,extra:1})}),'schema','fazladan alan');
  await rejectsCode(MF.finalize({store:s5,config:S5.config,responseBytes:SJ.toBytes({...r5,record:{...r5.record,claims:{...r5.record.claims,contract:'passed'}}})}),'record_signature','beyan değişti');
  // dr-fetch yolu: bekleyen anahtar nihai manifest yerine verilemez; kayıt zorunlu.
  await rejectsCode(MF.verifyStored({store,config:S.config,manifestKey:S.keys.request_key}),'manifest_key','bekleyen dosya aday değil');
  fs.rmSync(path.join(dir,S.keys.record_key));
  await rejectsCode(MF.verifyStored({store,config:S.config,manifestKey:S.keys.manifest_key}),'record_missing','kayıt zorunlu');
});

test('dr-fetch: elle yedek K1 yoluyla doğrulanmaz; fetchManual yalnız K9 zinciriyle ve yeni dosyaya yazar',async()=>{
  const DR=require('../../tools/backup/dr-fetch.cjs');
  const S=synth({runId:'drf'});const {dir,store}=await storeWith(S);
  await MF.finalize({store,config:S.config,responseBytes:SJ.toBytes(S.respond())});
  assert.equal((await DR.fetchVerified({store,manifestKey:S.keys.manifest_key,trustedK1:S.config.trusted_k9,pinnedRecipientsSha256:S.config.recipients_sha256,outFile:path.join(dir,'o1')})).code,'manual_key');
  const out=path.join(dir,'o2');const ok=await DR.fetchManual({store,manifestKey:S.keys.manifest_key,config:S.config,outFile:out});
  assert.equal(ok.ok,true);assert.ok(fs.readFileSync(out).equals(S.pkg));assert.equal(fs.statSync(out).mode&0o777,0o600);
  await assert.rejects(DR.fetchManual({store,manifestKey:S.keys.manifest_key,config:S.config,outFile:out}),/EEXIST/,'var olan dosyanın üzerine yazmaz');
  const bad=await DR.fetchManual({store,manifestKey:S.keys.manifest_key,config:{...S.config,active_anchor_sha256:null,trusted_anchors:{}},outFile:path.join(dir,'o3')});
  assert.equal(bad.code,'anchor_untrusted');assert.equal(fs.existsSync(path.join(dir,'o3')),false);
});

/* ---------- güvenli dosya ---------- */
test('güvenli dosya: sembolik bağ, yol kaçışı, hard link, boyut, üzerine yazma reddedilir; atomik yazım',()=>{
  const d=tmp();fs.writeFileSync(path.join(d,'a.json'),'x');
  assert.equal(SF.readFileSafe(d,'a.json',{maxBytes:10}).toString(),'x');
  fs.symlinkSync(path.join(d,'a.json'),path.join(d,'l.json'));throwsCode(()=>SF.readFileSafe(d,'l.json',{maxBytes:10}),'ESYMLINK','sembolik bağ');
  fs.linkSync(path.join(d,'a.json'),path.join(d,'h.json'));throwsCode(()=>SF.readFileSafe(d,'h.json',{maxBytes:10}),'EHARDLINK','hard link');
  fs.writeFileSync(path.join(d,'big'),'xxxx');throwsCode(()=>SF.readFileSafe(d,'big',{maxBytes:3}),'ESIZE','boyut');
  for(const rel of ['../a.json','/etc/passwd','a/../b','.gizli','a//b',''])throwsCode(()=>SF.readFileSafe(d,rel,{maxBytes:10}),'EPATH',rel);
  fs.mkdirSync(path.join(d,'real'));fs.symlinkSync(path.join(d,'real'),path.join(d,'dl'));
  throwsCode(()=>SF.writeNewAtomic(d,'dl/x.json','1'),'ESYMLINK','yolda sembolik bağ');
  assert.equal(SF.writeNewAtomic(d,'n/x.json','1').ok,true);
  assert.deepEqual({...SF.writeNewAtomic(d,'n/x.json','2')},{ok:false,status:412});
  assert.equal(fs.readFileSync(path.join(d,'n/x.json'),'utf8'),'1');
  assert.deepEqual(fs.readdirSync(path.join(d,'n')),['x.json'],'geçici dosya kalmadı');
});

/* ---------- çapa ve araç paketi ---------- */
test('çapa: katı alanlar, K9 kimliği açık anahtarla aynı, hash kâğıttakiyle karşılaştırılır; araç paketi değişince hash değişir',()=>{
  const kp=crypto.generateKeyPairSync('ed25519');const pem=kp.publicKey.export({type:'spki',format:'pem'});
  const a={version:1,created_at:'2026-11-22T10:00:00.000Z',k9_key_id:C.keyIdOf(pem),k9_public_key:OS.spkiB64(pem),recipients_sha256:hex(32),
    toolset_sha256:hex(32),repo_commit:hex(20),contract_exceptions:['no_contract_at_applied_ref']};
  const h=OS.anchorSha256(a);assert.match(h,/^[0-9a-f]{64}$/);
  assert.equal(OS.anchorSha256(SJ.parseCanonical(SJ.toBytes(a))),h,'kanonik gidiş-dönüş');
  for(const [label,b] of [['fazladan alan',{...a,note:'x'}],['eksik alan',(({repo_commit,...x})=>x)(a)],['yanlış K9 kimliği',{...a,k9_key_id:'0'.repeat(16)}],
    ['PEM (satır sonlu)',{...a,k9_public_key:pem}],['istisna kodu biçimi',{...a,contract_exceptions:['Serbest metin']}],['commit biçimi',{...a,repo_commit:'main'}]]){
    let e=null;try{OS.anchorSha256(b);}catch(x){e=x;}assert.ok(e&&/^anchor_/.test(e.code)||e&&e.code==='strict_json',label+': '+(e&&e.code));
  }
  assert.notEqual(OS.anchorSha256({...a,toolset_sha256:hex(32)}),h);
  // Araç paketi: aynı girdi aynı hash; bir dosya değişince farklı.
  const d=tmp();const repo=path.join(d,'repo');
  for(const sub of ['tools/backup','supabase/migrations','ops/backup'])fs.mkdirSync(path.join(repo,sub),{recursive:true});
  fs.writeFileSync(path.join(repo,'tools/backup/x.cjs'),'1');fs.writeFileSync(path.join(repo,'supabase/migrations/20260101000000_a.sql'),'select 1;');
  const mods=path.join(d,'nm');fs.mkdirSync(path.join(mods,'pg'),{recursive:true});fs.writeFileSync(path.join(mods,'pg','index.js'),'x');
  const opt={repoRoot:repo,nodeModules:mods,bins:{age:process.execPath,'age-keygen':process.execPath,tar:process.execPath}};
  const t1=TS.computeToolset(opt);assert.equal(TS.computeToolset(opt).sha256,t1.sha256);
  fs.writeFileSync(path.join(repo,'tools/backup/x.cjs'),'2');assert.notEqual(TS.computeToolset(opt).sha256,t1.sha256,'betik değişti');
  fs.writeFileSync(path.join(repo,'tools/backup/x.cjs'),'1');fs.writeFileSync(path.join(mods,'pg','index.js'),'y');assert.notEqual(TS.computeToolset(opt).sha256,t1.sha256,'bağımlılık değişti');
  fs.writeFileSync(path.join(mods,'pg','index.js'),'x');fs.writeFileSync(path.join(repo,'ops/backup/config.json'),'{}');assert.equal(TS.computeToolset(opt).sha256,t1.sha256,'config.json kapsam dışı');
  fs.writeFileSync(path.join(repo,'supabase/migrations/20260102000000_b.sql'),'x');assert.notEqual(TS.computeToolset(opt).sha256,t1.sha256,'migration eklendi');
});

/* ---------- migration eşleşmesi ---------- */
test('migration eşleşmesi (R1–R3): tam, takma ad (yalnız açık liste), adsız, bilinmeyen, ad uyuşmazlığı, yineleme, boşluk',()=>{
  const list=['20260101000000_a.sql','20260102000000_b.sql','20260103000000_c.sql'].map(f=>({version:f.slice(0,14),file:f}));
  const h=(...x)=>x.map(([version,name])=>({version,name}));
  let m=MM.matchHistory(h(['20260101000000','a'],['20260102000000','b']),list,{aliases:[]});
  assert.equal(m.ok,true);assert.deepEqual(m.pending,['20260103000000_c.sql']);
  // apply_migration kendi zaman damgasını yazdı: takma ad yoksa bilinmeyen (tahmin yok), varsa kabul.
  m=MM.matchHistory(h(['20260101000000','a'],['20260102093011','b']),list,{aliases:[]});assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20260102093011']);
  m=MM.matchHistory(h(['20260101000000','a'],['20260102093011','b']),list,{aliases:[{production_version:'20260102093011',file:'20260102000000_b.sql'}]});
  assert.equal(m.ok,true);assert.equal(m.aliases,1);
  // Takma adda ad da aynı olmalı; adsız satır takma adla kabul edilmez.
  assert.equal(MM.matchHistory(h(['20260101000000','a'],['20260102093011','x']),list,{aliases:[{production_version:'20260102093011',file:'20260102000000_b.sql'}]}).ok,false);
  assert.equal(MM.matchHistory(h(['20260101000000','a'],['20260102093011',null]),list,{aliases:[{production_version:'20260102093011',file:'20260102000000_b.sql'}]}).ok,false);
  m=MM.matchHistory(h(['20260101000000',null]),list,{aliases:[]});assert.equal(m.ok,true);assert.equal(m.nameless,1);
  assert.deepEqual(MM.matchHistory(h(['20260101000000','z']),list,{aliases:[]}).nameMismatch,['20260101000000']);
  assert.ok(MM.matchHistory(h(['20260101000000','a'],['20260101000000','a']),list,{aliases:[]}).duplicate.length);
  assert.ok(MM.matchHistory(h(['20260102093011','b'],['20260102000000','b']),list,{aliases:[{production_version:'20260102093011',file:'20260102000000_b.sql'}]}).duplicate.length,'iki satır aynı dosyaya');
  assert.deepEqual(MM.matchHistory(h(['20260101000000','a'],['20260103000000','c']),list,{aliases:[]}).gaps,['20260102000000_b.sql']);
  // Takma ad dosyası: repodaki bugün boş; bozuk biçim reddedilir.
  assert.deepEqual(MM.loadAliases(),[]);
  const d=tmp();const f=path.join(d,'a.json');
  fs.writeFileSync(f,JSON.stringify({version:1,aliases:[{production_version:'x',file:'y'}]}));assert.throws(()=>MM.loadAliases(f),/bozuk/);
  fs.writeFileSync(f,JSON.stringify({version:2,aliases:[]}));assert.throws(()=>MM.loadAliases(f),/bozuk/);
});

/* ---------- offline-sign: K9 en son ---------- */
test('offline-sign kaynağı: K9 yalnız bütün denetimlerden sonra okunur; K9 okunduktan sonra alt süreç başlatılmaz; şifresiz anahtar reddedilir',()=>{
  const src=fs.readFileSync(path.join(root,'tools/backup/offline-sign.cjs'),'utf8');
  const body=src.slice(src.indexOf('async function signInner('),src.indexOf('async function levelTwo('));
  const iKey=body.indexOf('loadK9(');
  for(const step of ['networkCheck()','anchorSha256(anchor)','crossCheck(','TS.computeToolset(tsOpts)','MF.decodeRequestFile(','MF.requestSignable(','parseHeader(pkg)','levelTwo(','cleanupCtx(ctx)','ts2.sha256!==ts1.sha256'])
    assert.ok(body.indexOf(step)>0&&body.indexOf(step)<iKey,step+' K9\'dan önce');
  const after=body.slice(iKey);
  for(const re of [/\brun\(/,/spawn/,/exec/,/startCluster/,/buildReference/,/restoreAndVerify/])assert.doesNotMatch(after,re,'K9 sonrası alt süreç yok: '+re);
  // Şifresiz PKCS#8 ve yanlış parola: kod, metinde anahtar yok.
  const kp=crypto.generateKeyPairSync('ed25519');
  const plain=Buffer.from(kp.privateKey.export({type:'pkcs8',format:'pem'}));
  const enc=Buffer.from(kp.privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:'dogru-parola'}));
  const id=C.keyIdOf(kp.publicKey);const anchor={k9_key_id:id},config={active_k9:id};
  throwsCode(()=>OS.loadK9({keyBytes:plain,passphrase:'x',anchor,config}),'k9_unencrypted','şifresiz');
  throwsCode(()=>OS.loadK9({keyBytes:enc,passphrase:'yanlis',anchor,config}),'k9_passphrase','yanlış parola');
  throwsCode(()=>OS.loadK9({keyBytes:enc,passphrase:'dogru-parola',anchor:{k9_key_id:'0'.repeat(16)},config}),'k9_mismatch','başka anahtar');
  assert.equal(OS.loadK9({keyBytes:enc,passphrase:'dogru-parola',anchor,config}).id,id);
});

test('offline-sign: tar listesi izin listesi (yalnız düz dosya, bilinen adlar); ağ denetimi arayüzleri okur',async()=>{
  for(const n of ['source.json','A.dump','B/auth.users.jsonl','meta/cron.job.jsonl','X.pre.sql'])assert.match(n,OS.TAR_RE);
  for(const n of ['../x','/etc/passwd','B/../../x.jsonl','B/a.jsonl','meta/x','A.dump/','evil.sh','B/auth.users.jsonl.sh'])assert.doesNotMatch(n,OS.TAR_RE);
  const d=tmp();const src=path.join(d,'src');fs.mkdirSync(src);
  for(const f of ['source.json','bootstrap.sql','A.dump'])fs.writeFileSync(path.join(src,f),'x');
  const {execFileSync}=require('node:child_process');
  const good=path.join(d,'g.tar');execFileSync('tar',['-cf',good,'-C',src,'source.json','bootstrap.sql','A.dump']);
  assert.deepEqual((await OS.checkTarList(good)).sort(),['A.dump','bootstrap.sql','source.json']);
  fs.symlinkSync('/etc/passwd',path.join(src,'X.pre.sql'));
  const link=path.join(d,'l.tar');execFileSync('tar',['-cf',link,'-C',src,'source.json','bootstrap.sql','A.dump','X.pre.sql']);
  await rejectsCode(OS.checkTarList(link),'tar_entry','sembolik bağ girdisi');
  fs.writeFileSync(path.join(src,'evil.sh'),'x');
  const ev=path.join(d,'e.tar');execFileSync('tar',['-cf',ev,'-C',src,'source.json','bootstrap.sql','A.dump','evil.sh']);
  await rejectsCode(OS.checkTarList(ev),'tar_entry','bilinmeyen ad');
  // FIFO (düz dosya değil) izinli bir adla: tür denetimi reddeder.
  const src2=path.join(d,'src2');fs.mkdirSync(src2);for(const f of ['source.json','bootstrap.sql','A.dump'])fs.writeFileSync(path.join(src2,f),'x');
  execFileSync('mkfifo',[path.join(src2,'X.pre.sql')]);
  const fifo=path.join(d,'f.tar');execFileSync('tar',['-cf',fifo,'-C',src2,'source.json','bootstrap.sql','A.dump','X.pre.sql']);
  await rejectsCode(OS.checkTarList(fifo),'tar_entry','FIFO girdisi');
  const miss=path.join(d,'m.tar');execFileSync('tar',['-cf',miss,'-C',src,'source.json']);
  await rejectsCode(OS.checkTarList(miss),'tar_entry','zorunlu dosya yok');
  const n=OS.networkOffline();assert.equal(typeof n.ok,'boolean');if(!n.ok)assert.equal(n.code,'network_present');
});

/* ---------- T8 ---------- */
test('T8 referans ölçümü: anlık görüntü sırası, migration hash\'i ve sayılar; match ya da bounds; tutarsızlık reddedilir',()=>{
  const RMS=require('../../tools/backup/reference-measure.cjs');
  const mh=RMS.historySha256([{version:'20260101000000',name:'a'}]);
  const m=(snap,counts,at)=>({snap,at,migrations_sha256:mh,counts});
  const ref={version:1,before:m('100:110:',{'public.a':5,'auth.users':3},'2026-11-23T03:00:00.000Z'),after:m('100:130:',{'public.a':7,'auth.users':3},'2026-11-23T03:05:00.000Z')};
  assert.match(RMS.referenceSha256(ref),/^[0-9a-f]{64}$/);
  const dump={txid_snapshot:'105:120:111,112',counts:{'public.a':6,'auth.users':3},migrations_sha256:mh};
  assert.deepEqual(RMS.compare(ref,dump),{result:'bounds'});
  assert.deepEqual(RMS.compare({...ref,after:{...ref.after,counts:ref.before.counts}},{...dump,counts:{'public.a':5,'auth.users':3}}),{result:'match'});
  const bad=[
    ['reference_order','döküm önce ölçümünden eski',{...dump,txid_snapshot:'90:99:'}],
    ['reference_order','döküm sonra ölçümünden yeni',{...dump,txid_snapshot:'100:131:'}],
    ['reference_counts','sayı aralık dışında',{...dump,counts:{...dump.counts,'public.a':8}}],
    ['reference_tables','ölçülmemiş tablo',{...dump,counts:{...dump.counts,'public.yeni':0}}],
    ['reference_migrations','migration geçmişi farklı',{...dump,migrations_sha256:RMS.historySha256([])}],
    ['reference_snapshot','anlık görüntü biçimi',{...dump,txid_snapshot:'x'}]];
  for(const [code,label,d] of bad)throwsCode(()=>RMS.compare(ref,d),code,label);
  throwsCode(()=>RMS.referenceSha256({...ref,extra:1}),'reference_schema','fazladan alan');
  throwsCode(()=>RMS.referenceSha256({...ref,before:{...ref.before,counts:{'public.a':-1}}}),'reference_schema','negatif sayı');
  throwsCode(()=>RMS.referenceSha256({...ref,before:ref.after,after:ref.before}),'reference_order','ölçümler sırasız');
  // Kayıt: ölçüm bağlıysa L2 "not_measured" diyemez; bağlı değilse "match" diyemez.
  const S=synth();
  throwsCode(()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,reference:'not_measured'}}),'schema','bağlı ama ölçülmedi');
  throwsCode(()=>MF.validateRecordBody({...S.record,reference_sha256:null}),'schema','bağsız ama ölçüldü');
  assert.ok(MF.validateRecordBody({...S.record,offline:{...S.record.offline,reference:'bounds'}}));
  // verifyChain politikası: bootstrap kaydı L2 ve ölçüm bağlı olmalı (K9 imzalı olsa da).
  const r0=S.respond({...S.record,reference_sha256:null,offline:{...S.record.offline,reference:'not_measured'}});
  throwsCode(()=>MF.verifyChain({manifestDoc:MF.attach(MF.NS_MANIFEST,S.manifest,r0.manifest_signature),recordDoc:MF.attach(MF.NS_RECORD,r0.record,r0.record_signature),config:S.config,packageBytes:S.pkg}),'bootstrap_policy','ölçümsüz bootstrap');
  // Geçersiz takvim tarihi (kanonik olmayan zaman) reddedilir.
  throwsCode(()=>MF.keysFor('u1','2026-02-31T03:00:00.000Z'),'schema','31 Şubat');
});

test('O5 tetikleyici karşılaştırması: yedekteki liste güvenilir referansla birebir; tanım, ad, eksik, fazla ve yineleme reddedilir; SQL yalnız referanstan',()=>{
  const RMeta=require('../../tools/backup/restore-meta.cjs');
  const ref=[{table:'auth.sessions',name:'nakgo_access_log',def:'CREATE TRIGGER nakgo_access_log AFTER INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.log_login()'}];
  assert.deepEqual(RMeta.triggerStatus(ref,ref),{ok:true,problems:[]});
  assert.equal(RMeta.triggerStatus([{...ref[0],def:ref[0].def.replace(/\s/g,'  ')}],ref).ok,true,'boşluk farkı aynı sayılır');
  for(const [label,obs] of [['tanım',[{...ref[0],def:ref[0].def.replace('log_login','evil')}]],['eksik',[]],
    ['fazla',[...ref,{table:'auth.users',name:'x',def:'CREATE TRIGGER x AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.x()'}]],
    ['yineleme',[ref[0],ref[0]]],['geçersiz',[{table:'auth.sessions'}]]]){
    const st=RMeta.triggerStatus(obs,ref);assert.equal(st.ok,false,label);assert.ok(!JSON.stringify(st).includes('evil'),label+': tanım metni yok');
  }
  const sql=RMeta.externalTriggerSql(ref).join('\n');assert.ok(sql.includes(ref[0].def));
  assert.throws(()=>RMeta.externalTriggerSql([{...ref[0],def:ref[0].def+'; drop table x'}]),e=>e.code==='trigger_invalid');
  assert.throws(()=>RMeta.renderRestoreSql({},{externalTriggers:ref}),e=>e.code==='trigger_reference_required');
  assert.throws(()=>RMeta.renderRestoreSql({},{externalTriggers:[{...ref[0],def:ref[0].def.replace('log_login','evil')}],expected:{triggers:ref}}),e=>e.code==='trigger_mismatch'&&!e.message.includes('evil'));
  // X.pre.sql katı biçim.
  assert.equal(RMeta.validateExternalDDL('create sequence if not exists auth.s;\ncreate table auth.sessions (\n id uuid,\n n bigint default nextval(\'auth.s\'::regclass),\n t timestamp with time zone default now()\n);\n'),true);
  for(const smuggle of ['create table auth.b (\n x int);create table auth.c as values (lo_export(lo_import(\'/etc/passwd\'),\'/tmp/x\'));create table auth.d (\n y int\n)',
    'create table auth.b (\n x int\n);\n\\! id\n','create table auth.b (\n x int\n) with (oids=false);'])
    assert.throws(()=>RMeta.validateExternalDDL(smuggle),e=>e.code==='xpre_invalid',smuggle);
  for(const bad of ['create table auth.x (\n id int default (select 1)\n);','create function auth.f() returns int as $$select 1$$ language sql;','create table public.x (\n id int\n);','grant all on auth.x to anon;'])
    assert.throws(()=>RMeta.validateExternalDDL(bad),e=>e.code==='xpre_invalid',bad);
});

/* ---------- K6b: ön koşul ve L1 imza yolu (veritabanı gerekmez) ---------- */
const hasPg=()=>{try{require.resolve('pg');return true;}catch{if(process.env.NAKGO_PG_HOST)throw Error('pg gerekli');return false;}};
test('K6b ön koşulu: postgres rolüyle ve A1 denetimi "ok" olmadan durur (bağlanmadan önce)',async t=>{
  const K=require('../../tools/backup/k6b.cjs');
  const r=await K.k6bPreflight({conn:{host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,user:'postgres.abc',password:'yalnız-test'},approval:'TEST-ONAY-K6B'});
  assert.equal(r.status,'failed');assert.match(r.reason,/yalnız yedek rolüyle/);
  if(!hasPg()){t.skip('pg istemcisi yok');return;}
  let built=0;class Never{constructor(){built++;}on(){}async connect(){throw Error('bağlanılmamalıydı');}async end(){}}
  const a=await K.k6bPreflight({conn:{host:'db.example.invalid',port:5432,user:'nakgo_backup',password:'yalnız-test',sslmode:'disable'},approval:'TEST-ONAY-K6B',Client:Never});
  assert.equal(a.status,'failed');assert.match(a.reason,/A1/);assert.equal(built,0,'kural ihlalinde istemci kurulmadı');
});

test('offline-sign L1 (K6b): gerçek age paketiyle, çapa + araç paketi + kısa kod + K9; finalize ve dr-fetch zinciri; bootstrap\'ta L1 reddedilir',async t=>{
  const {execFileSync}=require('node:child_process');
  try{execFileSync('which',['age']);execFileSync('which',['age-keygen']);}catch{if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error('age gerekli');t.skip('age yok');return;}
  if(!hasPg()){t.skip('pg istemcisi yok (araç paketi node-pg klasörünü özetler)');return;}
  const d=tmp();const E=require('../../tools/backup/encrypt.cjs');
  const ids=['a','b'].map(x=>{const f=path.join(d,'id-'+x);execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
  const rf=path.join(d,'recipients.txt');fs.writeFileSync(rf,ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
  const plain=path.join(d,'p.tar');fs.writeFileSync(plain,'sentetik');const ct=path.join(d,'p.age');
  execFileSync('age',['-R',rf,'-o',ct,plain]);const pkg=fs.readFileSync(ct);
  const S=synth({kind:'k6b',runId:'k6bl1'});
  const recipients=E.recipientsSha256(rf);
  const manifest={...S.manifest,ciphertext_sha256:SJ.sha256Hex(pkg),size:pkg.length,recipients_sha256:recipients,source:{...S.manifest.source,mode:'functions'}};
  const request={...S.request,manifest};const enc=MF.encodeRequestFile(request);
  const kp=crypto.generateKeyPairSync('ed25519');const pub=kp.publicKey.export({type:'spki',format:'pem'});const id=C.keyIdOf(pub);
  const pass='test-only-l1';const keyDir=path.join(d,'k9');fs.mkdirSync(keyDir,{mode:0o700});
  fs.writeFileSync(path.join(keyDir,'k9.pem'),kp.privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:pass}),{mode:0o600});
  const ts=TS.computeToolset({pgDirs:[]});
  const anchor={version:1,created_at:'2026-11-22T10:00:00.000Z',k9_key_id:id,k9_public_key:OS.spkiB64(pub),recipients_sha256:recipients,toolset_sha256:ts.sha256,repo_commit:hex(20),contract_exceptions:[]};
  const aSha=OS.anchorSha256(anchor);
  const config={version:1,recipients_sha256:recipients,trusted_k1:{},trusted_k2:{},trusted_k9:{[id]:pub},active_k9:id,trusted_anchors:{[aSha]:{}},active_anchor_sha256:aSha};
  const usb=path.join(d,'usb');fs.mkdirSync(usb,{mode:0o700});
  fs.writeFileSync(path.join(usb,'request.json'),enc.bytes);fs.writeFileSync(path.join(usb,'anchor.json'),SJ.toBytes(anchor));
  fs.writeFileSync(path.join(usb,path.posix.basename(S.keys.data_key)),pkg);
  const sign=o=>OS.offlineSign({usbDir:usb,anchorSha256:aSha,confirmCode:MF.shortCode(enc.request_sha256),keyDir,keyName:'k9.pem',passphrase:pass,config,level:'L1',
    pgDirs:[],recipientsFile:rf,networkCheck:()=>({ok:true}),...o});
  // Yanlış parola: bütün denetimlerden sonra K9 açılamaz; yanıt yok.
  assert.equal((await sign({passphrase:'yanlis'})).code,'k9_passphrase');assert.deepEqual(fs.readdirSync(usb).filter(f=>f.startsWith('response')),[]);
  // Alıcıları farklı paket (üç alıcı ya da parola bölümü) L1'de reddedilir.
  const r=await sign({});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.record.offline.level,'L1');assert.equal(r.record.offline.decrypted_with,null);assert.equal(r.record.offline.reference,'not_measured');
  // Finalize ve dr-fetch (yalnız K9 zinciri).
  const out=path.join(d,'out');const store=new FileStore({dir:out});
  await store.put(S.keys.data_key,pkg,{ifNoneMatch:true});await store.put(S.keys.request_key,enc.bytes,{ifNoneMatch:true});
  const f=await MF.finalize({store,config,responseBytes:fs.readFileSync(path.join(usb,r.response_name))});
  assert.equal(f.completed,true);
  const DR=require('../../tools/backup/dr-fetch.cjs');
  const got=await DR.fetchManual({store,manifestKey:S.keys.manifest_key,config,outFile:path.join(d,'f.age'),requireRequest:true});
  assert.equal(got.ok,true);assert.equal(got.level,'L1');
  // Aynı anahtarlarla bootstrap isteği L1'de imzalanamaz.
  const S2=synth({runId:'bootl1'});const req2={...S2.request,manifest:{...S2.manifest,ciphertext_sha256:SJ.sha256Hex(pkg),size:pkg.length,recipients_sha256:recipients,object_key:S2.keys.data_key}};
  const enc2=MF.encodeRequestFile(req2);const usb2=path.join(d,'usb2');fs.mkdirSync(usb2);
  fs.writeFileSync(path.join(usb2,'request.json'),enc2.bytes);fs.writeFileSync(path.join(usb2,'anchor.json'),SJ.toBytes(anchor));fs.writeFileSync(path.join(usb2,path.posix.basename(S2.keys.data_key)),pkg);
  assert.equal((await sign({usbDir:usb2,confirmCode:MF.shortCode(enc2.request_sha256)})).code,'level');
  // Tek alıcılı paket: başlık reddedilir.
  const one=path.join(d,'one.age');execFileSync('age',['-r',fs.readFileSync(rf,'utf8').split('\n')[0],'-o',one,plain]);const pk1=fs.readFileSync(one);
  const req3={...request,manifest:{...manifest,ciphertext_sha256:SJ.sha256Hex(pk1),size:pk1.length}};const enc3=MF.encodeRequestFile(req3);
  const usb3=path.join(d,'usb3');fs.mkdirSync(usb3);fs.writeFileSync(path.join(usb3,'request.json'),enc3.bytes);fs.writeFileSync(path.join(usb3,'anchor.json'),SJ.toBytes(anchor));
  fs.writeFileSync(path.join(usb3,path.posix.basename(S.keys.data_key)),pk1);
  assert.equal((await sign({usbDir:usb3,confirmCode:MF.shortCode(enc3.request_sha256)})).code,'package_header');
});

test('süper kullanıcılı geri yükleme yolu yok: kayıt şeması reddeder, CLI bayrağı reddedilir; sözleşme "passed" yalnız beyan olarak yazılır',()=>{
  const S=synth();
  for(const [label,o] of [['superuser_isolated',{restore_role:'superuser_isolated'}],['passed (kanıt gibi)',{contract:{status:'passed',exception:null}}],['decrypted_with C',{decrypted_with:'C'}]])
    throwsCode(()=>MF.validateRecordBody({...S.record,offline:{...S.record.offline,...o}}),'schema',label);
  assert.ok(MF.validateRecordBody({...S.record,offline:{...S.record.offline,contract:{status:'claimed_passed',exception:null},decrypted_with:'AB'}}));
  const src=fs.readFileSync(path.join(root,'tools/backup/offline-sign.cjs'),'utf8');
  assert.doesNotMatch(src.slice(0,src.indexOf('if(require.main===module)')),/cluster\.admin\b[^;]*verify|verify\(ctx\.cluster\.admin/);
  const {spawnSync}=require('node:child_process');
  const r=spawnSync(process.execPath,[path.join(root,'tools/backup/offline-sign.cjs'),'--allow-superuser-isolated'],{encoding:'utf8',env:{...process.env,CI:'',GITHUB_ACTIONS:''}});
  assert.equal(r.status,1);assert.match(r.stderr,/süper kullanıcıyla geri yükleme kaldırıldı/);
});

test('güvenli dosya yarışı: denetimle açılış arasında dosya değiştirilirse (ino) ya da okunurken değişirse ERACE',()=>{
  const d=tmp();const f=path.join(d,'r.json');fs.writeFileSync(f,'ilk');fs.writeFileSync(path.join(d,'other'),'saldırgan');
  const orig=fs.openSync;let swapped=false;
  fs.openSync=function(p,...a){if(!swapped&&p===fs.realpathSync(d)+'/r.json'){swapped=true;fs.renameSync(path.join(d,'other'),f);}return orig.call(fs,p,...a);};
  try{throwsCode(()=>SF.readFileSafe(d,'r.json',{maxBytes:100}),'ERACE','dosya değişti');}finally{fs.openSync=orig;}
  assert.ok(swapped,'yarış gerçekten oluşturuldu');
  // Yazımda hedef önceden (yarışla) oluşturulmuşsa üzerine yazılmaz.
  const origLink=fs.linkSync;
  fs.linkSync=function(a,b){fs.writeFileSync(b,'önce gelen');return origLink.call(fs,a,b);};
  let w;try{w=SF.writeNewAtomic(d,'n.json','benim');}finally{fs.linkSync=origLink;}
  assert.equal(w.ok,false);assert.equal(w.status,412);assert.equal(fs.readFileSync(path.join(d,'n.json'),'utf8'),'önce gelen');
  assert.deepEqual(fs.readdirSync(d).filter(x=>x.startsWith('.nakgo-tmp-')),[],'geçici dosya kalmadı');
});

test('migration eşleşmesi: yanlış kabul/yanlış ret sınırları (yerel, sentetik; gerçek Production geçmişi okunmadı)',()=>{
  const list=['20260101000000_a.sql','20260102000000_b.sql','20260103000000_c.sql'].map(f=>({version:f.slice(0,14),file:f}));
  const m=(rows,aliases=[])=>MM.matchHistory(rows.map(([version,name])=>({version,name})),list,{aliases});
  // Geçerli: son migration'lar henüz uygulanmamış (bekleyen) → kabul.
  assert.equal(m([['20260101000000','a']]).ok,true);
  // Sayı olarak gelen sürüm metne çevrilir; geçmiş sırası önemsizdir.
  assert.equal(MM.matchHistory([{version:20260102000000,name:'b'},{version:'20260101000000',name:'a'}],list,{aliases:[]}).ok,true);
  // Farklı ad: büyük/küçük harf, sondaki boşluk, dosya uzantısı → ret (tahmin yok; düzeltme yalnız PR'lı takma adla değil, incelemeyle).
  for(const n of ['A',' a','a ','a.sql','20260101000000_a'])assert.equal(m([['20260101000000',n]]).ok,false,JSON.stringify(n));
  // Fazla (repoda yok), eksik (ortadaki uygulanmamış), boş geçmiş, takma ad var olmayan dosyaya.
  assert.deepEqual(m([['20260101000000','a'],['20260104000000','d']]).unknown,['20260104000000']);
  assert.deepEqual(m([['20260101000000','a'],['20260103000000','c']]).gaps,['20260102000000_b.sql']);
  const empty=m([]);assert.equal(empty.ok,true);assert.equal(empty.applied.length,0,'boş geçmiş: hepsi bekleyen (bootstrap bunu ayrıca beklemez)');
  assert.equal(m([['20260102093011','b']],[{production_version:'20260102093011',file:'20260109000000_yok.sql'}]).ok,false,'takma ad repoda olmayan dosyaya');
  // Takma ad aynı sürümü zaten tam eşleşen dosyaya ikinci kez bağlayamaz.
  assert.equal(m([['20260102000000','b'],['20260102093011','b']],[{production_version:'20260102093011',file:'20260102000000_b.sql'}]).ok,false);
});

test('araç paketi: klasöre çözülen sembolik bağın arkasındaki dosya değişirse hash değişir; döngü reddedilir',t=>{
  if(!hasPg()){t.skip('pg istemcisi yok');return;}
  const d=tmp();const real=path.join(d,'real');fs.mkdirSync(real);fs.writeFileSync(path.join(real,'x.so'),'1');
  const inst=path.join(d,'inst');fs.mkdirSync(inst);fs.symlinkSync('../real',path.join(inst,'lib'));
  const opt={pgDirs:[inst],bins:{age:process.execPath,'age-keygen':process.execPath,tar:process.execPath}};
  const h1=TS.computeToolset(opt).sha256;
  fs.writeFileSync(path.join(real,'x.so'),'2');assert.notEqual(TS.computeToolset(opt).sha256,h1,'bağın arkası değişti');
  fs.symlinkSync('..',path.join(real,'loop'));
  assert.throws(()=>TS.computeToolset(opt),e=>e.code==='toolset_type');
});

test('T8: paketin sayım tablo kümesi ölçümle birebir aynı olmalı (atlanan ya da eklenen tablo reddedilir)',()=>{
  const RMS=require('../../tools/backup/reference-measure.cjs');
  const mh=RMS.historySha256([]);const m=(snap,counts,at)=>({snap,at,migrations_sha256:mh,counts});
  const ref={version:1,before:m('1:10:',{'public.a':1,'public.b':2},'2026-11-23T03:00:00.000Z'),after:m('1:20:',{'public.a':1,'public.b':2},'2026-11-23T03:01:00.000Z')};
  assert.deepEqual(RMS.compare(ref,{txid_snapshot:'1:15:',counts:{'public.a':1,'public.b':2},migrations_sha256:mh}),{result:'match'});
  throwsCode(()=>RMS.compare(ref,{txid_snapshot:'1:15:',counts:{'public.a':1},migrations_sha256:mh}),'reference_tables','atlanan tablo');
});

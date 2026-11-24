/** K9 elle yedek akışı uçtan uca (gerçek PostgreSQL 17, age, ağsız atılabilir kümeler):
 *   run (çevrim içi) → offline-sign (çevrim dışı; A ve B ile ayrı ayrı L2) → finalize → saklanan zincirin doğrulanması.
 * Hiçbir uzak sisteme bağlanmaz. Production yerine Production biçiminde yerel bir kaynak kullanılır (prod-fixture.cjs).
 * Ağ denetimi bu sanal makinede ağ arayüzü olduğu için test enjeksiyonuyla geçilir; gerçek denetim ayrıca sınanır.
 * Gerekenler: NAKGO_PG_HOST (yerel PG17), NAKGO_PG_BIN (istemci araçları), NAKGO_PG_SERVER (sunucu kurulumu: initdb,
 * pg_ctl, postgres), root ise NAKGO_PG_RUN_AS. Eksikse NAKGO_REQUIRE_DUMP=1 değilken atlanır. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {realPg,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {bootRoleSql,prodShaped}=require('./prod-fixture.cjs');
const B=require('../../tools/backup/bootstrap.cjs');
const OS=require('../../tools/backup/offline-sign.cjs');
const MF=require('../../tools/backup/manual-flow.cjs');
const SJ=require('../../tools/backup/strict-json.cjs');
const TS=require('../../tools/backup/toolset-hash.cjs');
const E=require('../../tools/backup/encrypt.cjs');
const C=require('../../tools/backup/crypto.cjs');
const {FileStore}=require('../../tools/backup/store.cjs');
const {toolMajor}=require('../../tools/backup/dump.cjs');
const MMx=require('../../tools/backup/migration-match.cjs');

const root=path.resolve(__dirname,'../..');
const OWN=new Set();
const tmp=(base=os.tmpdir())=>{const d=fs.mkdtempSync(path.join(base,'nakgo-b9-'));OWN.add(d);return d;};
process.on('exit',()=>{for(const d of OWN)try{fs.rmSync(d,{recursive:true,force:true});}catch{}});
const hasBin=b=>{try{execFileSync('which',[b],{stdio:'ignore'});return true;}catch{return false;}};
const files=d=>{const out=[];const w=r=>{for(const e of fs.readdirSync(path.join(d,r),{withFileTypes:true})){const x=r?r+'/'+e.name:e.name;e.isDirectory()?w(x):out.push(x);}};if(fs.existsSync(d))w('');return out.sort();};
const leftovers=()=>fs.readdirSync(os.tmpdir()).filter(n=>/^nakgo-(pgc|offline)-/.test(n));

function missing(){
  if(!realPg())return 'PGlite: pg_dump/pg_restore ve küme yok';
  const need=[['age','age'],['age-keygen','age-keygen']].filter(([b])=>!hasBin(b)).map(([b])=>b);
  if(!process.env.NAKGO_PG_SERVER||!fs.existsSync(path.join(process.env.NAKGO_PG_SERVER,'bin','initdb')))need.push('NAKGO_PG_SERVER');
  if(process.getuid&&process.getuid()===0&&!process.env.NAKGO_PG_RUN_AS)need.push('NAKGO_PG_RUN_AS');
  if(!need.length)return null;
  if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error('gerekli araç yok: '+need.join(', '));
  return 'gerekli araç yok: '+need.join(', ');
}

/** Anahtar töreninin test karşılığı: A/B (age), K9 (parola korumalı), çapa, yapılandırma. Gerçek anahtar üretilmez. */
function ceremony(dir,{contractExceptions=['no_contract_at_applied_ref']}={}){
  const ids=['A','B'].map(l=>{const f=path.join(dir,'id-'+l+'.txt');execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
  const recipientsFile=path.join(dir,'recipients.txt');
  fs.writeFileSync(recipientsFile,ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
  const recips=E.recipientsOf(recipientsFile);
  // A/B etiketi alıcı listesindeki sıraya göre (sıralı liste: ilk A, ikinci B).
  const byLabel={};for(const f of ids){const pub=execFileSync('age-keygen',['-y',f]).toString().trim();byLabel[recips.indexOf(pub)===0?'A':'B']=f;}
  const pinned=E.recipientsSha256(recipientsFile);
  const passphrase='test-only-k9-'+crypto.randomBytes(4).toString('hex');
  const kp=crypto.generateKeyPairSync('ed25519');
  const k9pub=kp.publicKey.export({type:'spki',format:'pem'});const k9id=C.keyIdOf(k9pub);
  const keyDir=path.join(dir,'k9');fs.mkdirSync(keyDir,{mode:0o700});
  fs.writeFileSync(path.join(keyDir,'k9.pem'),kp.privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase}),{mode:0o600});
  const pgDirs=[process.env.NAKGO_PG_SERVER,process.env.NAKGO_PG_BIN,...(process.env.NAKGO_PG_CLIENT_DIR?[process.env.NAKGO_PG_CLIENT_DIR]:[])];
  const toolset=TS.computeToolset({pgDirs});
  const anchor={version:1,created_at:'2026-11-22T10:00:00.000Z',k9_key_id:k9id,k9_public_key:OS.spkiB64(k9pub),recipients_sha256:pinned,
    toolset_sha256:toolset.sha256,repo_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),contract_exceptions:contractExceptions};
  const anchorSha=OS.anchorSha256(anchor);
  const k1=C.testKeyPair(),k2=C.testKeyPair();
  const config={version:1,recipients_sha256:pinned,trusted_k1:{[k1.keyId]:k1.publicKey},trusted_k2:{[k2.keyId]:k2.publicKey},
    trusted_k9:{[k9id]:k9pub},active_k9:k9id,trusted_anchors:{[anchorSha]:{created_at:anchor.created_at}},active_anchor_sha256:anchorSha};
  return {ids:byLabel,recipientsFile,pinned,passphrase,keyDir,k9id,anchor,anchorSha,config,pgDirs};
}

test('K9 akışı uçtan uca: run → offline-sign (A ve B, L2, süper kullanıcı olmayan geri yükleme) → finalize → zincir',async t=>{
  const why=missing();if(why){t.skip(why);return;}
  const P=await prodShaped();const db=P.db;const boot=uniqueRole('nakgo_b9');let primary=null;const dir=tmp();
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    assert.ok(tool>=major,'pg_dump sürümü');
    await db.exec(bootRoleSql(boot,'test-only-'+boot));
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:boot,password:'test-only-'+boot,database:db.name};
    const K=ceremony(dir);
    const outDir=path.join(dir,'out');fs.mkdirSync(outDir,{mode:0o700});
    const work=path.join(dir,'work');fs.mkdirSync(work);
    const usb=path.join(dir,'usb');fs.mkdirSync(usb,{mode:0o700});
    const before=leftovers();
    const now=new Date('2026-11-23T03:00:00Z');

    // ---- run ----
    const r=await B.runManual({kind:'bootstrap',config:K.config,conn,outDir,recipientsFile:K.recipientsFile,pinnedRecipientsSha256:K.pinned,
      approval:'TEST-ONAY-K9 yerel prova',runId:'k9e2e',now,allowLocal:true,workRoot:work});
    await t.test('run: imza bekliyor (çıkış 2); paket ve istek yazıldı, nihai manifest ve kayıt YOK; şifresiz dosya yok',()=>{
      assert.equal(r.state,'signature_pending',JSON.stringify({failed:r.failed,stages:r.stages}));
      assert.equal(B.exitCodeOf(r),2);
      assert.deepEqual(files(outDir),[r.keys.data_key,r.request_key,r.keys.reference_key].sort());
      assert.match(r.short_code,/^([0-9a-f]{4}-){4}[0-9a-f]{4}$/);
      assert.deepEqual(fs.readdirSync(work),[]);
      const raw=fs.readFileSync(path.join(outDir,r.request_key));
      const dec=MF.decodeRequestFile(raw);assert.equal(dec.request_sha256,r.request_sha256);
      assert.ok(!raw.includes(Buffer.from('test0@example.invalid'))&&!raw.includes(Buffer.from(boot))&&!raw.includes(Buffer.from('test-only-')),'istekte kişisel veri, rol ya da parola yok');
      assert.equal(dec.request.claims.contract,'skipped');
      assert.equal(dec.request.claims.notes.migration_history.applied,32);
      // T8: önce/sonra ölçümü dosyası isteğe hash'iyle bağlı; yalnız sayılar ve hash'ler (içerik yok).
      const ref=fs.readFileSync(path.join(outDir,r.keys.reference_key));
      assert.equal(require('../../tools/backup/reference-measure.cjs').referenceSha256(SJ.parseCanonical(ref)),dec.request.reference_sha256);
      assert.ok(!ref.includes(Buffer.from('@'))&&!ref.includes(Buffer.from(boot)));
    });
    // USB'ye: istek, paket, çapa (çevrim dışı makineye taşınır).
    fs.copyFileSync(path.join(outDir,r.request_key),path.join(usb,'request.json'));
    fs.copyFileSync(path.join(outDir,r.keys.data_key),path.join(usb,path.posix.basename(r.keys.data_key)));
    fs.writeFileSync(path.join(usb,'anchor.json'),SJ.toBytes(K.anchor));
    fs.copyFileSync(path.join(outDir,r.keys.reference_key),path.join(usb,'reference.json'));

    const sign=(over={})=>OS.offlineSign({usbDir:usb,anchorSha256:K.anchorSha,confirmCode:r.short_code,identityFile:K.ids.A,identityLabel:'A',
      keyDir:K.keyDir,keyName:'k9.pem',passphrase:K.passphrase,config:K.config,pgInstall:process.env.NAKGO_PG_SERVER,pgBin:process.env.NAKGO_PG_BIN,
      pgDirs:K.pgDirs,recipientsFile:K.recipientsFile,networkCheck:()=>({ok:true}),now:()=>new Date('2026-11-23T05:00:00Z'),...over});

    // ---- offline-sign (A) ----
    const sA=await sign({responseName:'response-A.json'});
    await t.test('offline-sign A: L2, süper kullanıcı olmayan rol, R1–R6 ve O5 denetimleri; izin listeli kayıt; geçici küme ve şifresiz dosya kalmaz',()=>{
      assert.equal(sA.ok,true,JSON.stringify(sA));
      const o=sA.record.offline;
      assert.equal(o.level,'L2');assert.equal(o.decrypted_with,'A');assert.equal(o.restore_role,'non_superuser');assert.equal(o.schema,'match');
      for(const c of ['target_role','restore','counts','b_content','fk_orphans','fingerprint','auth_version','meta','migration_history','cron_jobs','external_triggers','schema_reference'])assert.ok(o.checks.includes(c),c);
      // Production'daki gerçek ad biçimleri: 15 satır dosya adı biçiminde (normalize), 8'inde addaki zaman damgası farklı (uyarı + kayıt).
      assert.deepEqual(o.migrations,{applied:32,pending:require('../../tools/backup/restore-meta.cjs').repoMigrations().length-32,aliases:0,nameless:0,
        normalized:15,timestamp_mismatch:8,timestamp_exceptions:MMx.canonicalExceptions(MMx.loadNameExceptions()),exceptions_sha256:MMx.exceptionsSha256(MMx.loadNameExceptions())});
      assert.equal(sA.record.version,MF.RECORD_VERSION);
      assert.deepEqual(o.cron,{jobs:2,inactive:0});assert.equal(o.triggers,1);
      assert.deepEqual(o.contract,{status:'exception',exception:'no_contract_at_applied_ref'});
      assert.equal(o.reference,'match','kaynak ölçümler arasında değişmedi: önce = sonra = döküm');
      assert.equal(sA.record.reference_sha256,MF.decodeRequestFile(fs.readFileSync(path.join(usb,'request.json'))).request.reference_sha256);
      assert.equal(sA.record.anchor_sha256,K.anchorSha);assert.equal(sA.record.k9_key_id,K.k9id);
      const resp=fs.readFileSync(path.join(usb,'response-A.json'));
      for(const s of ['test0@example.invalid',boot,'test-only-','select ','/tmp/',dir])assert.ok(!resp.includes(Buffer.from(s)),'yanıtta yok: '+s);
      assert.deepEqual(leftovers().filter(x=>!before.includes(x)),[],'geçici küme ya da şifresiz klasör kalmadı');
    });

    // ---- offline-sign (B): B tek başına da çözer ve doğrular ----
    const sB=await sign({identityFile:K.ids.B,identityLabel:'B',responseName:'response-B.json'});
    await t.test('offline-sign B: B kimliğiyle de L2 tamam',()=>{
      assert.equal(sB.ok,true,JSON.stringify(sB));assert.equal(sB.record.offline.decrypted_with,'B');
      // AYNI paket: A ve B ayrı çalıştırmalarda, her biri kendi çözmesi ve kendi PG17 geri yüklemesiyle.
      assert.equal(sB.record.ciphertext_sha256,sA.record.ciphertext_sha256);assert.equal(sB.record.request_sha256,sA.record.request_sha256);
      for(const c of ['target_role','restore','counts','b_content','fk_orphans','fingerprint','schema_reference'])assert.ok(sB.record.offline.checks.includes(c),'B: '+c);
      assert.equal(sB.record.offline.restore_role,'non_superuser');assert.equal(sB.record.offline.reference,'match');
    });

    // ---- offline-sign (AB): iki kimlik aynı çalıştırmada ayrı ayrı çözer, düz metin baytları aynı olmalı ----
    await t.test('offline-sign AB: A ve B aynı paketi ayrı ayrı çözer, düz metinler birebir aynı; tek geri yükleme; etiket ve kimlik sırası denetlenir',async()=>{
      const sAB=await sign({identityFile:K.ids.A,identityFileB:K.ids.B,identityLabel:'AB',responseName:'response-AB.json'});
      assert.equal(sAB.ok,true,JSON.stringify(sAB));assert.equal(sAB.record.offline.decrypted_with,'AB');assert.equal(sAB.record.offline.restore_role,'non_superuser');
      for(const [label,over] of [['B yerine A',{identityFile:K.ids.A,identityFileB:K.ids.A,identityLabel:'AB'}],['sıra ters',{identityFile:K.ids.B,identityFileB:K.ids.A,identityLabel:'AB'}],
        ['AB ama tek kimlik',{identityLabel:'AB'}],['tek etiket ama iki kimlik',{identityFileB:K.ids.B,identityLabel:'A'}],['geçersiz etiket',{identityLabel:'C'}]]){
        const x=await sign({...over,responseName:'response-x.json',passphrase:()=>{throw Error('K9 okunmamalıydı');}});
        assert.equal(x.ok,false,label);assert.equal(x.code,'identity_label',label+': '+JSON.stringify(x));
      }
      assert.equal(fs.existsSync(path.join(usb,'response-x.json')),false);
      assert.deepEqual(leftovers().filter(x=>!before.includes(x)),[]);
    });

    await t.test('offline-sign temizlik hatası: şifresiz klasör silinemezse K9\'a geçilmez, kod cleanup_failed, yanıt yok; sonuç gizlenmez',async()=>{
      const orig=fs.rmSync;let blocked=null;
      fs.rmSync=function(p,...a){if(String(p).includes(path.sep+'nakgo-offline-')&&!String(p).endsWith('.tar')&&!String(p).endsWith('.age')){blocked=String(p);return;}return orig.call(fs,p,...a);};
      let x;
      try{x=await sign({responseName:'response-cf.json',passphrase:()=>{throw Error('K9 okunmamalıydı');}});}
      finally{fs.rmSync=orig;if(blocked)process.once('exit',()=>{try{fs.rmSync(blocked,{recursive:true,force:true});}catch{}});}
      assert.equal(x.ok,false);assert.equal(x.code,'cleanup_failed',JSON.stringify(x));assert.equal(x.cleanup_failed,true);
      assert.ok(blocked&&fs.existsSync(blocked),'silme gerçekten engellendi (kalan klasör bildirildi)');
      assert.equal(fs.existsSync(path.join(usb,'response-cf.json')),false);
      fs.rmSync(blocked,{recursive:true,force:true});
      assert.deepEqual(leftovers().filter(x=>!before.includes(x)),[]);
    });

    await t.test('offline-sign eksik dosyalar: çapa, istek ya da paket yoksa K9 okunmadan durur',async()=>{
      const pkgName=path.posix.basename(r.keys.data_key);
      for(const missingFile of ['anchor.json','request.json',pkgName,'reference.json']){
        const u=fs.mkdtempSync(path.join(dir,'miss-'));
        for(const f of ['anchor.json','request.json',pkgName,'reference.json'])if(f!==missingFile)fs.copyFileSync(path.join(usb,f),path.join(u,f));
        const x=await sign({usbDir:u,passphrase:()=>{throw Error('K9 okunmamalıydı');}});
        assert.equal(x.ok,false,missingFile);assert.equal(x.code,'file_enoent',missingFile+': '+JSON.stringify(x));
        assert.ok(!/\//.test(x.reason),missingFile+': nedende yol yok');
        fs.rmSync(u,{recursive:true,force:true});
      }
      // Başka (geçerli biçimli) çapa: kâğıttaki hash'le uyuşmaz.
      const u=fs.mkdtempSync(path.join(dir,'anc-'));
      for(const f of ['request.json',pkgName,'reference.json'])fs.copyFileSync(path.join(usb,f),path.join(u,f));
      fs.writeFileSync(path.join(u,'anchor.json'),SJ.toBytes({...K.anchor,repo_commit:'f'.repeat(40)}));
      assert.equal((await sign({usbDir:u})).code,'anchor_mismatch');
      fs.rmSync(u,{recursive:true,force:true});
    });

    await t.test('offline-sign içerik: çevrim içi makinenin ürettiği (hash\'leri tutarlı) ama migration geçmişi boş, bilinmeyen ya da adı farklı paket L2\'de reddedilir',async()=>{
      const pkgName=path.posix.basename(r.keys.data_key);
      const work2=fs.mkdtempSync(path.join(dir,'tamper-'));
      const tarFile=path.join(work2,'p.tar');execFileSync('age',['-d','-i',K.ids.A,'-o',tarFile,path.join(usb,pkgName)]);
      const base=path.join(work2,'b');fs.mkdirSync(base);execFileSync('tar',['-xf',tarFile,'-C',base]);fs.rmSync(tarFile);
      const rq=MF.decodeRequestFile(fs.readFileSync(path.join(usb,'request.json'))).request;
      const variant=async(label,mutate,code)=>{
        const b=path.join(work2,label);fs.cpSync(base,b,{recursive:true});
        const src=JSON.parse(fs.readFileSync(path.join(b,'source.json'),'utf8'));const mf=src.meta_files['supabase_migrations.schema_migrations'];
        const rows=fs.readFileSync(path.join(b,mf.file),'utf8').split('\n').filter(Boolean).map(JSON.parse);
        const out=mutate(rows);const buf=Buffer.from(out.map(x=>JSON.stringify(x)).join('\n')+(out.length?'\n':''));
        fs.writeFileSync(path.join(b,mf.file),buf);mf.sha256=crypto.createHash('sha256').update(buf).digest('hex');mf.rows=out.length;
        fs.writeFileSync(path.join(b,'source.json'),JSON.stringify(src));
        const t2=path.join(work2,label+'.tar');await E.packBundle(b,t2);
        const ct=path.join(work2,label+'.age');execFileSync('age',['-R',K.recipientsFile,'-o',ct,t2]);const pkg=fs.readFileSync(ct);
        const req2={...rq,manifest:{...rq.manifest,ciphertext_sha256:SJ.sha256Hex(pkg),size:pkg.length}};const enc=MF.encodeRequestFile(req2);
        const u=path.join(work2,'usb-'+label);fs.mkdirSync(u,{mode:0o700});
        fs.writeFileSync(path.join(u,'request.json'),enc.bytes);fs.writeFileSync(path.join(u,pkgName),pkg);
        for(const f of ['anchor.json','reference.json'])fs.copyFileSync(path.join(usb,f),path.join(u,f));
        const x=await sign({usbDir:u,confirmCode:MF.shortCode(enc.request_sha256),passphrase:()=>{throw Error('K9 okunmamalıydı');}});
        assert.equal(x.ok,false,label);assert.equal(x.code,code,label+': '+JSON.stringify(x));
      };
      await variant('bos',()=>[],'migration_history');
      await variant('bilinmeyen',rows=>[...rows,{version:'20991231000000',name:'elle'}],'migration_history');
      await variant('ad',rows=>rows.map((x,i)=>i===3?{...x,name:x.name+'_x'}:x),'migration_history');
      await variant('bosluk',rows=>rows.filter((_,i)=>i!==10),'migration_history');
      // Zaman damgası izin listesi: yeni fark (yalın satır ya da aynı damgalı satır) ve bilinen satırın farklı damgası → ret.
      const setName=(v,n)=>rows=>{assert.ok(rows.some(x=>x.version===v),v);return rows.map(x=>x.version===v?{...x,name:n}:x);};
      await variant('yeni_damga_yalin',setName('20261014000000','20261014000001_profiles.sql'),'migration_history');
      await variant('yeni_damga_tam',setName('20261112020000','20261112020059_data_retention.sql'),'migration_history');
      await variant('bilinen_damga_degisti',setName('20261115075953','20261115010001_admin_live.sql'),'migration_history');
      await variant('bilinen_slug_degisti',setName('20261115075953','20261115010000_admin_lives.sql'),'migration_history');
      // İzinli istisna eksik: satır yalın ada dönmüş ya da tamamen yok → katı küme kuralı (aynı ret kodu).
      await variant('izinli_istisna_eksik',setName('20261115075953','admin_live'),'migration_history');
      fs.rmSync(work2,{recursive:true,force:true});
      assert.deepEqual(leftovers().filter(x=>!before.includes(x)),[]);
    });

    await t.test('offline-sign sinyal: SIGTERM ve SIGINT L2 sırasında (geri yükleme kümesi açıkken); küme, şifresiz klasör ve yanıt kalmaz; çıkış 128+sinyal',async()=>{
      for(const signal of ['SIGTERM','SIGINT']){
        const base=fs.mkdtempSync(path.join(dir,'sig-'));const wr=path.join(base,'work');fs.mkdirSync(wr,{mode:0o700});
        const params={usbDir:usb,anchorSha256:K.anchorSha,confirmCode:r.short_code,identityFile:K.ids.A,identityLabel:'A',keyDir:K.keyDir,keyName:'k9.pem',
          passphrase:K.passphrase,config:K.config,pgInstall:process.env.NAKGO_PG_SERVER,pgBin:process.env.NAKGO_PG_BIN,pgDirs:K.pgDirs,recipientsFile:K.recipientsFile,
          responseName:'response-sig.json',workRoot:wr};
        const pf=path.join(base,'p.json');fs.writeFileSync(pf,JSON.stringify(params),{mode:0o600});
        const script=path.join(base,'c.cjs');
        fs.writeFileSync(script,`const OS=require(${JSON.stringify(path.join(root,'tools/backup/offline-sign.cjs'))});const A=require(${JSON.stringify(path.join(root,'tools/backup/abort.cjs'))});
A.installSignalHandlers();const P=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
OS.offlineSign({...P,networkCheck:()=>({ok:true}),log:m=>process.stderr.write('LOG '+m+'\\n')}).then(x=>{process.stdout.write('BITTI '+JSON.stringify(x)+'\\n');});`);
        const before2=leftovers();
        const ch=require('node:child_process').spawn(process.execPath,[script,pf],{env:process.env,stdio:['ignore','pipe','pipe']});
        let so='',se='';ch.stdout.on('data',d=>so+=d);ch.stderr.on('data',d=>se+=d);
        const exited=new Promise(res=>ch.on('exit',(code,sig)=>res({code,sig})));
        try{
          // Referans derlendikten sonra geri yükleme kümesi açılır; şifresiz paket diskte.
          const t0=Date.now();
          while(!/referans derlendi/.test(se)){if(Date.now()-t0>120000)assert.fail('zaman aşımı '+se);await new Promise(x=>setTimeout(x,25));}
          const t1=Date.now();while(!leftovers().some(x=>!before2.includes(x)&&x.startsWith('nakgo-pgc-'))&&Date.now()-t1<20000)await new Promise(x=>setTimeout(x,10));
          assert.ok(fs.readdirSync(wr).some(x=>x.startsWith('nakgo-offline-')),signal+': şifresiz çalışma klasörü var');
          process.kill(ch.pid,signal);
          const res=await Promise.race([exited,new Promise(x=>setTimeout(()=>x({timeout:true}),60000))]);
          assert.ok(!res.timeout,signal+': bitmedi');
          assert.equal(res.code,128+require('../../tools/backup/abort.cjs').SIGNO[signal],signal+': '+JSON.stringify(res)+' '+se);
          assert.doesNotMatch(so,/BITTI.*"ok":true/,signal+': başarı üretilmedi');
          assert.deepEqual(fs.readdirSync(wr),[],signal+': şifresiz klasör silindi');
          assert.deepEqual(leftovers().filter(x=>!before2.includes(x)),[],signal+': geçici küme silindi');
          assert.equal(fs.existsSync(path.join(usb,'response-sig.json')),false,signal+': yanıt yok');
        }finally{try{ch.kill('SIGKILL');}catch{}}
        fs.rmSync(base,{recursive:true,force:true});
      }
    });

    await t.test('offline-sign reddeder (K9 okunmadan): ağ, çapa, araç paketi, kısa kod, paket, seviye, kimlik, yanıt üzerine yazma',async()=>{
      const keyRead=[];const keyDir=path.join(dir,'k9-spy');fs.mkdirSync(keyDir,{mode:0o700});
      fs.copyFileSync(path.join(K.keyDir,'k9.pem'),path.join(keyDir,'k9.pem'));
      const pass=()=>{keyRead.push(1);return K.passphrase;};
      const cases=[
        ['network_present',{networkCheck:OS.networkOffline}],// bu makinede ağ arayüzü var
        ['anchor_mismatch',{anchorSha256:'0'.repeat(64)}],
        ['toolset_mismatch',{toolsetOptions:{bins:{extra:'/bin/true'}}}],
        ['short_code',{confirmCode:'0000-0000-0000-0000-0000'}],
        ['short_code',{confirmCode:r.short_code.slice(0,14)}],
        ['identity_label',{identityFile:K.ids.B,identityLabel:'A'}],
        ['pg_paths',{pgDirs:K.pgDirs.filter(x=>x!==process.env.NAKGO_PG_SERVER),toolsetOptions:{}}],
        ['network_present',{networkCheck:(()=>{let n=0;return ()=>(++n===1?{ok:true}:{ok:false});})()}],// L2'den sonra, K9'dan hemen önce
        ['level',{level:'L1'}],
        ['anchor_not_active',{config:{...K.config,active_anchor_sha256:'1'.repeat(64),trusted_anchors:{...K.config.trusted_anchors,['1'.repeat(64)]:{}}}}],
        ['identity',{identityFile:(()=>{const f=path.join(dir,'wrong-id.txt');if(!fs.existsSync(f))execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;})()}],
        ['response_exists',{responseName:'response-A.json'},'tam'],
      ];
      for(const [code,over] of cases){
        const x=await sign({keyDir,passphrase:pass,...over});
        assert.equal(x.ok,false,code);assert.equal(x.code,code,code+': '+JSON.stringify(x));
        assert.equal(keyRead.length,0,code+': K9 okunmadı');
      }
      // Paket bozulursa (USB'de) L1 reddeder.
      const pkgName=path.posix.basename(r.keys.data_key);const orig=fs.readFileSync(path.join(usb,pkgName));
      const usb2=path.join(dir,'usb2');fs.mkdirSync(usb2,{mode:0o700});
      for(const f of ['request.json','anchor.json','reference.json'])fs.copyFileSync(path.join(usb,f),path.join(usb2,f));
      const bad=Buffer.from(orig);bad[bad.length-5]^=1;fs.writeFileSync(path.join(usb2,pkgName),bad);
      const y=await sign({usbDir:usb2,keyDir,passphrase:pass});
      assert.equal(y.code,'package_hash');assert.equal(keyRead.length,0);
      // Sembolik bağ olarak verilen paket okunmaz.
      fs.rmSync(path.join(usb2,pkgName));fs.symlinkSync(path.join(usb,pkgName),path.join(usb2,pkgName));
      const z=await sign({usbDir:usb2,keyDir,passphrase:pass});
      assert.equal(z.ok,false);assert.equal(z.code,'ESYMLINK');
      assert.deepEqual(files(usb2),['anchor.json',pkgName,'reference.json','request.json'].sort(),'yanıt yazılmadı');
      // Referans dosyası değiştirilirse (USB) reddedilir.
      fs.rmSync(path.join(usb2,pkgName));fs.copyFileSync(path.join(usb,pkgName),path.join(usb2,pkgName));
      const rd=SJ.parseCanonical(fs.readFileSync(path.join(usb,'reference.json')));const t=Object.keys(rd.after.counts)[0];
      fs.rmSync(path.join(usb2,'reference.json'));fs.writeFileSync(path.join(usb2,'reference.json'),SJ.toBytes({...rd,after:{...rd.after,counts:{...rd.after.counts,[t]:rd.after.counts[t]+1}}}));
      const q=await sign({usbDir:usb2,keyDir,passphrase:pass});assert.equal(q.code,'reference_hash');assert.equal(keyRead.length,0);
      // Bootstrap isteğinde T8 ölçümü yoksa (çevrim içi makine atlamış) imzalanmaz.
      const usb3=path.join(dir,'usb3');fs.mkdirSync(usb3,{mode:0o700});
      const rq=MF.decodeRequestFile(fs.readFileSync(path.join(usb,'request.json'))).request;
      const enc3=MF.encodeRequestFile({...rq,reference_sha256:null});fs.writeFileSync(path.join(usb3,'request.json'),enc3.bytes);
      fs.copyFileSync(path.join(usb,'anchor.json'),path.join(usb3,'anchor.json'));fs.copyFileSync(path.join(usb,pkgName),path.join(usb3,pkgName));
      const q3=await sign({usbDir:usb3,keyDir,passphrase:pass,confirmCode:MF.shortCode(enc3.request_sha256)});
      assert.equal(q3.code,'reference_required');assert.equal(keyRead.length,0);
      assert.deepEqual(leftovers().filter(x=>!before.includes(x)),[]);
    });

    // ---- finalize ----
    const respDir=path.join(dir,'resp');fs.mkdirSync(respDir,{mode:0o700});
    fs.copyFileSync(path.join(usb,'response-A.json'),path.join(respDir,'response.json'));
    const f=await B.finalizeManual({outDir,responseDir:respDir,responseName:'response.json',config:K.config});
    await t.test('finalize: imzalı manifest ve kayıt yazıldı; zincir ve istek bağı doğrulandı; tekrar çalıştırmak aynı sonucu verir',async()=>{
      assert.equal(f.completed,true,JSON.stringify(f));assert.equal(B.exitCodeOf(f),0);assert.equal(f.request_binding,'verified');
      assert.deepEqual(files(outDir),[r.keys.data_key,r.request_key,r.keys.reference_key,r.keys.manifest_key,r.keys.record_key].sort());
      const again=await B.finalizeManual({outDir,responseDir:respDir,responseName:'response.json',config:K.config});
      assert.equal(again.completed,true);assert.deepEqual(again.writes,{manifest:'unchanged',record:'unchanged'});
      // B'nin yanıtı farklı kayıt (decrypted_with: B) taşır: aynı hedefe yazılamaz (üzerine yazma yok).
      const rb=path.join(dir,'respB');fs.mkdirSync(rb);fs.copyFileSync(path.join(usb,'response-B.json'),path.join(rb,'response.json'));
      const conflict=await B.finalizeManual({outDir,responseDir:rb,responseName:'response.json',config:K.config});
      assert.equal(conflict.completed,false);assert.equal(conflict.code,'conflict');
      const v=await MF.verifyStored({store:new FileStore({dir:outDir}),config:K.config,manifestKey:r.keys.manifest_key,requireRequest:true});
      assert.equal(v.ok,true);assert.equal(v.request_binding,'verified');assert.equal(v.record.offline.decrypted_with,'A');
    });

    await t.test('dr-fetch (elle yedek): yalnız K9 zinciriyle; kayıt yoksa, K9 güvenilir değilse ya da paket bozuksa reddeder',async()=>{
      const DR=require('../../tools/backup/dr-fetch.cjs');
      const store=new FileStore({dir:outDir});
      const out1=path.join(dir,'fetched.age');
      const ok=await DR.fetchManual({store,manifestKey:r.keys.manifest_key,config:K.config,outFile:out1});
      assert.equal(ok.ok,true,JSON.stringify(ok));
      assert.equal(SJ.sha256Hex(fs.readFileSync(out1)),sA.record.ciphertext_sha256);
      const noK9=await DR.fetchManual({store,manifestKey:r.keys.manifest_key,config:{...K.config,trusted_k9:{}},outFile:path.join(dir,'x1')});
      assert.equal(noK9.ok,false);assert.equal(noK9.code,'manifest_signature');
      assert.ok(!fs.existsSync(path.join(dir,'x1')));
      // Kayıt silinmiş bir kopya: elle yedekte kayıt zorunlu.
      const copy=path.join(dir,'copy');fs.cpSync(outDir,copy,{recursive:true});fs.rmSync(path.join(copy,r.keys.record_key));
      const nr=await DR.fetchManual({store:new FileStore({dir:copy}),manifestKey:r.keys.manifest_key,config:K.config,outFile:path.join(dir,'x2')});
      assert.equal(nr.code,'record_missing');
      // Bekleyen istek yoksa bağ "not_checked"; --require-request ile reddedilir.
      fs.cpSync(outDir,path.join(dir,'copy2'),{recursive:true});fs.rmSync(path.join(dir,'copy2',r.request_key));
      const s2=new FileStore({dir:path.join(dir,'copy2')});
      const nb=await DR.fetchManual({store:s2,manifestKey:r.keys.manifest_key,config:K.config,outFile:path.join(dir,'x3')});
      assert.equal(nb.ok,true);assert.equal(nb.request_binding,'not_checked');
      const rq=await DR.fetchManual({store:s2,manifestKey:r.keys.manifest_key,config:K.config,outFile:path.join(dir,'x4'),requireRequest:true});
      assert.equal(rq.code,'request_missing');
      // Otomatik yedek yolu (K1) elle yedeği seçmez.
      assert.equal((await DR.fetchLatest({store,trustedK1:K.config.trusted_k1,pinnedRecipientsSha256:K.pinned,outFile:path.join(dir,'x5')})).code,'none');
    });

    await t.test('kurtarma: indirilen paket A ile çözülür, tar içeriği izin listesinde',async()=>{
      const out1=path.join(dir,'fetched.age');
      const tarFile=path.join(dir,'restored.tar');
      const d=spawnSync('age',['-d','-i',K.ids.A,'-o',tarFile,out1]);assert.equal(d.status,0);
      const names=await OS.checkTarList(tarFile);assert.ok(names.includes('A.dump')&&names.includes('source.json'));
      // R4/O5 karşılaştırmaları gerçekten çalışıyor: referanstan sapma (şema satırı, tetikleyici tanımı, iş zamanı) reddedilir.
      const bundle=path.join(dir,'rb');fs.mkdirSync(bundle,{mode:0o700});execFileSync('tar',['-xf',tarFile,'-C',bundle]);fs.rmSync(tarFile);
      const RB=require('../../tools/backup/reference-build.cjs');const RMeta=require('../../tools/backup/restore-meta.cjs');
      const ref=await RB.buildReference({installDir:process.env.NAKGO_PG_SERVER,list:RMeta.repoMigrations().slice(0,32),scope:JSON.parse(fs.readFileSync(path.join(root,'ops/backup/scope.json'),'utf8'))});
      const {restoreAndVerify}=require('../../tools/backup/restore-verify.cjs');
      const run=exp=>restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,contractCheck:false,requireMeta:true,expected:exp});
      const base={cron:ref.cron,triggers:ref.triggers,snapshot:ref.snapshot};
      let v=await run(base);assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)).slice(0,3000));
      const failed=x=>x.checks.filter(c=>!c.ok).map(c=>c.code);
      v=await run({...base,snapshot:[...ref.snapshot,'table public.sahte rls=false force=false']});assert.deepEqual(failed(v),['schema_reference']);
      v=await run({...base,snapshot:ref.snapshot.filter(l=>!/^policy /.test(l)||!l.includes('listings'))});
      assert.deepEqual(failed(v),['schema_reference'],'yedekte referansta olmayan satır (ör. elle eklenmiş politika)');
      v=await run({...base,triggers:ref.triggers.map(x=>({...x,def:x.def.replace('log_login','baska')}))});assert.ok(failed(v).includes('external_triggers'),JSON.stringify(failed(v)));
      v=await run({...base,cron:ref.cron.map(j=>j.jobname==='nakgo-retention'?{...j,schedule:'5 0 * * *'}:j)});assert.deepEqual(failed(v),['cron_jobs']);
      fs.rmSync(bundle,{recursive:true,force:true});
    });
    await t.test('run: kaynakta izin listesi dışı yeni zaman damgası farkı varsa geri yükleme doğrulaması (migration_history) düşer, imza isteği yazılmaz',async()=>{
      const tbl='supabase_migrations.schema_migrations';
      for(const [v,n,orig] of [['20261014000000','20261014000001_profiles.sql','profiles'],['20261115075953','20261115010001_admin_live.sql','20261115010000_admin_live.sql'],
        ['20261115075953','admin_live','20261115010000_admin_live.sql']]){
        await db.query(`update ${tbl} set name=$2 where version=$1`,[v,n]);
        try{
          const out2=fs.mkdtempSync(path.join(dir,'out-ts-'));const w2=fs.mkdtempSync(path.join(dir,'work-ts-'));
          const x=await B.runManual({kind:'bootstrap',config:K.config,conn,outDir:out2,recipientsFile:K.recipientsFile,pinnedRecipientsSha256:K.pinned,
            approval:'TEST-ONAY-K9 yerel prova',runId:'k9ts'+v.slice(-4)+(n.endsWith('.sql')?'f':'s'),now,allowLocal:true,workRoot:w2});
          assert.equal(x.state,'failed',v+': '+JSON.stringify({failed:x.failed}));assert.equal(B.exitCodeOf(x),1);
          assert.equal(x.backup_verified,false,v);
          // Düşen doğrulama migration geçmişi; satır ret listesinde (sürüm metni). Zamanlanmış işler beklentisi geçmişe bağlı
          // olduğu için satır reddedildiğinde cron_jobs da kapalı tarafta düşer; başka denetim düşmez.
          const bad=(x.restore_checks||[]).filter(c=>!c.ok);
          const codes=bad.map(c=>c.code);
          assert.ok(codes.includes('migration_history')&&codes.every(c=>['migration_history','cron_jobs'].includes(c)),v+': '+JSON.stringify(bad).slice(0,800));
          // Geçmiş eşleşemiyorsa cron beklentisi de hesaplanamaz (kapalı); yalnız istisna eksikse geçmiş eşleşir, cron geçer.
          assert.equal(codes.includes('cron_jobs'),n.endsWith('.sql'),v+' '+n);
          assert.deepEqual(bad.find(c=>c.code==='migration_history').detail.unknown,[v],v);
          // İmza isteği yazılmaz; yalnız sabit kodlu başarısızlık raporu (ve şifreli paket) kalabilir.
          assert.equal(x.request_key,null,v+': imza isteği yok');assert.ok(x.failed_key,v+': başarısızlık raporu');
          const left=files(out2);assert.ok(left.includes(x.failed_key),v);
          assert.deepEqual(left.filter(f=>f!==x.failed_key&&!(x.keys&&f===x.keys.data_key)),[],v+': '+JSON.stringify(left));
          assert.ok(!fs.readFileSync(path.join(out2,x.failed_key)).includes(Buffer.from('profiles')),v+': raporda ham ad yok');
          assert.deepEqual(fs.readdirSync(w2),[],v+': şifresiz dosya yok');
        }finally{await db.query(`update ${tbl} set name=$2 where version=$1`,[v,orig]);}
      }
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([boot]);fs.rmSync(dir,{recursive:true,force:true});}
});

test('geri yükleme rolü (süper kullanıcı değil) PG17 ağsız kümede yetki yükseltemez: süper kullanıcı rolü, COPY PROGRAM, sunucu dosyası, C fonksiyonu, kendi rolünü yükseltme reddedilir',async t=>{
  const why=missing();if(why){t.skip(why);return;}
  const PC=require('../../tools/backup/pg-cluster.cjs');const {Client}=require('pg');
  const cl=await PC.startCluster({installDir:process.env.NAKGO_PG_SERVER,settings:{createrole_self_grant:"'set,inherit'"}});
  try{
    const a=await PC.adminClient(cl);try{await a.query('create role nakgo_restore login createdb createrole');}finally{await a.end();}
    const c=new Client({host:cl.host,port:cl.port,user:'nakgo_restore',database:'postgres'});c.on('error',()=>{});await c.connect();
    try{
      assert.equal((await c.query('select rolsuper from pg_roles where rolname=current_user')).rows[0].rolsuper,false);
      const denied=async(sql,label)=>{let e=null;try{await c.query(sql);}catch(x){e=x;}assert.ok(e,label+': reddedilmeliydi');assert.match(e.code,/^42501$|^42P17$|^0LP01$/,label+': '+(e&&e.code+' '+e.message));};
      await denied('create role kotu superuser','süper kullanıcı rolü');
      await denied('alter role nakgo_restore superuser','kendini yükseltme');
      await denied("copy (select 1) to program 'id'",'COPY PROGRAM');
      await denied("copy (select 1) to '/tmp/nakgo-x'",'sunucu dosyasına yazma');
      await denied("select pg_read_file('/etc/passwd')",'sunucu dosyası okuma');
      await denied("create function f() returns int as '/lib/x.so','f' language c",'C fonksiyonu');
      await denied('grant pg_execute_server_program to nakgo_restore','yetkili rol üyeliği');
      await denied('create role r2 bypassrls','BYPASSRLS rol');
      await denied('create extension if not exists file_fdw','güvenilmeyen eklenti');
    }finally{await c.end();}
  }finally{await cl.stop();}
});

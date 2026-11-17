/** B7-A4 orkestratör testleri.
 * Birim senaryoları: boru hattı sahtedir (döküm yok) ama ön kontrol kararı, K6 muafiyeti, yasal kanıt zinciri, olaylar,
 * çapalar, kapsama ve silme kapısı gerçek kodla çalışır; yasal durum sentetik #125 şemalı PGlite/PG veritabanından okunur.
 * Uçtan uca senaryo: gerçek PostgreSQL + pg_dump + age ile; yasal durum geri yüklenen veritabanından okunur.
 * Depo ve çapa bellek içidir: R2 davranışını kanıtlamaz. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {openDb,finish}=require('../../tools/db-lib.cjs');
const R=require('../../tools/backup/run.cjs');
const C=require('../../tools/backup/checkpoint.cjs');
const SM=require('../../tools/backup/state-machine.cjs');
const WV=require('../../tools/backup/waiver.cjs');
const {MemoryStore}=require('../../tools/backup/store.cjs');
const {StoreAnchor}=require('../../tools/backup/anchor.cjs');
const {objectKeys}=require('../../tools/backup/pipeline.cjs');
const {buildManifest,signManifest}=require('../../tools/backup/manifest.cjs');
const {testKeyPair,sign,randomUUID,sha256Json}=require('../../tools/backup/crypto.cjs');
const {realPg,migratedDb,uniqueRole,dropRoles}=require('./helpers.cjs');

const FIX=fs.readFileSync(path.join(__dirname,'legal-fixture.sql'),'utf8');
const DAY=86400000,T0=Date.parse('2026-06-01T00:00:00Z');
const at=d=>new Date(T0+d*DAY);

function setup({deletion=false,k6=null,environment='test',anchorFails=false}={}){
  const k1=testKeyPair(),k2=testKeyPair();
  let clock=at(0);
  const store=new MemoryStore({lockDays:14,lockPrefixes:['db/','audit/'],clock:()=>clock});
  const anchorStore=new MemoryStore({clock:()=>clock});
  const anchor=new StoreAnchor('a',anchorStore);
  if(anchorFails)anchor.put=async()=>{throw Error('çapa erişilemiyor');};
  const config={version:1,recipients_sha256:'a'.repeat(64),trusted_k1:{[k1.keyId]:k1.publicKey},trusted_k2:{[k2.keyId]:k2.publicKey},
    deletion:{enabled:deletion,retention_days:15,min_verified_remaining:4,max_verified_age_hours:24},
    store_capabilities:deletion?{verified:true,conditional_put:'verified',consistent_read:'verified',evidence:'test'}:{verified:false,conditional_put:'unverified',consistent_read:'unverified',evidence:null},
    k6_waiver:k6||{enabled:false,allowed_environments:[]},expect_legal_tables:true};
  return {k1,k2,k7:crypto.randomBytes(32),store,anchorStore,anchors:[anchor],config,environment,setClock:d=>{clock=d;},n:0};
}

/** Boru hattının sahtesi: ön kontrolü ve yasal kancayı gerçek sırayla çağırır, nesneyi ve imzalı manifesti yazar. */
function fakePipeline(db,{failDump=false}={}){
  return async o=>{
    const stages={preflight:await o.hooks.preflight(),dump:{status:'pending'},restore_test:{status:'pending'},legal:{status:'pending'},encryption:{status:'pending'},upload:{status:'pending'}};
    const keys=objectKeys(o.runId,o.now);
    const done=async()=>{
      for(const k of Object.keys(stages))if(stages[k].status==='pending')stages[k]={status:'skipped'};
      const m=signManifest(buildManifest({runId:o.runId,createdAt:o.now.toISOString(),stages,objectKey:stages.upload.status==='ok'?keys.data:null}),o.k1);
      await o.store.put(keys.manifest,Buffer.from(JSON.stringify(m)),{ifNoneMatch:true});
      return {verified:m.verified,stages,extra:{manifest_upload:{status:'ok',key:keys.manifest}},manifest:m,keys};
    };
    if(stages.preflight.status!=='ok')return done();
    if(failDump){stages.dump={status:'failed'};return done();}
    stages.dump={status:'ok'};stages.restore_test={status:'ok'};
    const l=await o.hooks.legal(db);
    stages.legal=l.na?{status:'n/a'}:l.ok?{status:'ok'}:{status:'failed'};
    if(stages.legal.status==='failed')return done();
    stages.encryption={status:'ok'};
    const p=await o.store.put(keys.data,Buffer.from('şifreli-test-'+o.runId),{ifNoneMatch:true});
    stages.upload=p.ok?{status:'ok'}:{status:'failed'};
    return done();
  };
}
const OK={decision:'ok',nonwaivable:[],waivable:[]};
async function go(E,db,day,extra={}){
  E.setClock(at(day));
  return R.runAll({config:E.config,store:E.store,anchors:E.anchors,k1:E.k1,k7:E.k7,environment:E.environment,runId:'r'+String(++E.n).padStart(3,'0'),now:at(day),
    runBackupImpl:fakePipeline(db,extra.pipeline),preflightImpl:async()=>extra.evaluation||OK,...extra.args});
}
async function headBody(E){
  const ch=await C.readChain(E.store,{trustedK1:E.config.trusted_k1});
  return {chain:ch,body:await C.loadBody(E.store,ch.head,{k7:E.k7,prevHeader:ch.headers[ch.headers.length-2]||null})};
}
async function releaseOpen(E,day){
  const {body}=await headBody(E);
  for(const ev of body.sm.events.filter(e=>e.status==='open'&&e.type!=='preflight_waivable')){
    const doc=sign(SM.RELEASE_NS,{version:1,release_id:randomUUID(),event_id:ev.event_id,event_binding:ev.binding,scope:{type:ev.type,findings_sha256:ev.findings_sha256},
      reason:'Sahip incelemesi tamamlandı.',environment:E.environment,not_before:ev.opened_at,not_after:new Date(Math.max(Date.parse(ev.opened_at),T0+day*DAY)+24*3600000).toISOString()},E.k2.privateKey,E.k2.keyId);
    await E.store.put('audit/inbox/releases/'+doc.release_id+'.json',Buffer.from(JSON.stringify(doc)));
  }
}
async function legalDb(){const db=await openDb();try{await db.exec(FIX);}catch(e){await finish(db,e);throw e;}return db;}

test('yapılandırma eksikse hiçbir şey yapılmaz',async()=>{
  const db=await legalDb();
  try{
    const E=setup();
    for(const [name,mut] of [['alıcı hash',c=>{c.recipients_sha256=null;}],['K1 güveni',c=>{c.trusted_k1={};}],['K2 güveni',c=>{c.trusted_k2={};}],
      ['silme açık ama K3 kanıtı yok',c=>{c.deletion.enabled=true;}]]){
      const config=JSON.parse(JSON.stringify(E.config));mut(config);
      const s=await go({...E,config},db,1);
      assert.equal(s.exit,1,name);assert.ok(s.config_problems.length,name);
    }
    assert.ok((await go({...E,k7:Buffer.alloc(16)},db,1)).config_problems.some(p=>/K7/.test(p)));
    assert.ok((await go({...E,anchors:[]},db,1)).config_problems.some(p=>/çapa/.test(p)));
    assert.equal(E.store.objects.size,0,'depoya hiçbir şey yazılmadı');
    // Depodaki gerçek yapılandırma şu an bilinçli olarak eksik: iş akışı çalıştırılsa bile durur.
    const real=R.loadConfig();
    assert.ok(R.configProblems(real,{environment:'production',k1:E.k1,k7:E.k7,anchors:E.anchors}).length>=3);
    assert.equal(real.deletion.enabled,false);assert.equal(real.k6_waiver.enabled,false);assert.equal(real.store_capabilities.verified,false);
  }finally{await finish(db);}
});

test('mutlu yol: başlangıç olayı açık → çıkış 1; K2 ile kapanınca çıkış 0; silme kapalı kalır',async()=>{
  const db=await legalDb();
  try{
    const E=setup();
    await db.query(`select private.legal_log('view_record',null,$1)`,[at(0).toISOString()]);
    let s=await go(E,db,1);
    assert.equal(s.backup.verified,true);assert.equal(s.legal.ok,true);assert.equal(s.legal.open_events,1);assert.deepEqual(s.legal.blocking,['genesis_baseline']);
    assert.equal(s.exit,1);
    assert.equal(s.deletion.allowed,false);assert.ok(s.deletion.blockers.some(b=>/kapalı/.test(b)));
    await releaseOpen(E,1);
    s=await go(E,db,1.1);
    assert.equal(s.legal.open_events,0);assert.deepEqual(s.legal.releases,['validated','consumption_pending']);
    assert.equal(s.exit,0,JSON.stringify(s));
    assert.equal(s.legal.single_use_guaranteed,false,'depo davranışı kanıtlanmadan iddia yok');
    assert.ok(!JSON.stringify(s).match(/PRIVATE KEY|BEGIN/),'özet gizli bilgi içermez');
    // Silme kaydı imzalı yazılır ve bir sonraki kontrol noktasına bağlanır.
    s=await go(E,db,1.2);
    const {body}=await headBody(E);
    assert.ok(body.all_attachments.some(a=>a.key==='audit/deletions/r002.json'));
    // Bir kayıt yalnız bir kez bağlanır: sonraki gövdelerin yeni ek listesinde tekrar görünmez.
    await go(E,db,1.3);
    const {body:b2}=await headBody(E);
    assert.ok(!b2.attachments.some(a=>a.key==='audit/deletions/r002.json'),'tekrar bağlanmadı');
    const keys=b2.all_attachments.map(a=>a.key);
    assert.equal(new Set(keys).size,keys.length,'ek listesinde tekrar yok');
  }finally{await finish(db);}
});

test('silme: yalnız bütün koşullar sağlanınca; kapsama korunur; olay ve çapa sorunu durdurur',async()=>{
  const db=await legalDb();
  try{
    const E=setup({deletion:true});
    await go(E,db,0);await releaseOpen(E,0);
    let s=await go(E,db,0.01);assert.equal(s.exit,0);
    for(let d=1;d<=20;d++){s=await go(E,db,d);assert.equal(s.exit,0,'gün '+d+' '+JSON.stringify(s.deletion));}
    const keys=[...E.store.objects.keys()].filter(k=>k.startsWith('db/'));
    // 15 günden eski olanlar silindi; kalanlar en az 4 doğrulanmış.
    assert.ok(keys.length>=4&&keys.length<=17,String(keys.length));
    const oldest=Math.min(...keys.map(k=>E.store.objects.get(k).created.getTime()));
    assert.ok(at(20).getTime()-oldest<=15*DAY+1);
    // Bu çalışmanın yedeği doğrulanmadıysa diğer koşullar sağlansa da silme yapılmaz.
    const before=[...E.store.objects.keys()].filter(k=>k.startsWith('db/')).length;
    s=await go(E,db,20.2,{pipeline:{failDump:true}});
    assert.equal(s.deletion.allowed,false);assert.equal(s.deletion.deleted,0);
    assert.equal([...E.store.objects.keys()].filter(k=>k.startsWith('db/')).length,before);
    s=await go(E,db,20.3);assert.equal(s.exit,0);
    // Açık olay → silme durur.
    await db.query(`select private.legal_log('view_record',null,$1)`,[at(20).toISOString()]);
    s=await go(E,db,20.5);
    await db.exec(`begin; select set_config('nakgo.legal_purge','on',true); delete from private.legal_access_log; commit;`);
    s=await go(E,db,21);
    assert.equal(s.legal.open_events,1);assert.equal(s.deletion.allowed,false);assert.ok(s.deletion.blockers.some(b=>/olay/.test(b)));assert.equal(s.exit,1);
    await releaseOpen(E,21);
    s=await go(E,db,21.1);assert.equal(s.exit,0);
    // Çapa yazılamıyor → silme durur.
    E.anchors[0].put=async()=>{throw Error('çapa erişilemiyor');};
    s=await go(E,db,22);
    assert.equal(s.legal.anchors_ok,false);assert.equal(s.deletion.allowed,false);assert.equal(s.exit,1);
  }finally{await finish(db);}
});

test('kapsama: sahte imzalı manifest sayılmaz; doğrulanmış yedek azsa silinmez',async()=>{
  const db=await legalDb();
  try{
    const E=setup({deletion:true});
    await go(E,db,0);await releaseOpen(E,0);await go(E,db,0.01);
    for(let d=1;d<=3;d++)await go(E,db,d);
    const other=testKeyPair();
    const fake=signManifest(buildManifest({runId:'x',createdAt:at(16).toISOString(),stages:Object.fromEntries(['preflight','dump','restore_test','legal','encryption','upload'].map(k=>[k,{status:'ok'}])),objectKey:'db/fake'}),other);
    await E.store.put('manifests/fake.json',Buffer.from(JSON.stringify(fake)));
    await E.store.put('db/fake',Buffer.from('x'));
    const s=await go(E,db,16.5);
    // r001..r005 (gün 0–3) 15 günden eski; kalan doğrulanmış yedek yalnız bu çalışmanınki → silme yok.
    assert.equal(s.deletion.allowed,false);assert.ok(s.deletion.blockers.some(b=>/doğrulanmış yedek kalır/.test(b)),JSON.stringify(s.deletion));
    const rec=JSON.parse(String(E.store.objects.get('audit/deletions/'+s.run_id+'.json').body));
    assert.equal(rec.invalid_manifests,1);
  }finally{await finish(db);}
});

test('ön kontrol: muaf tutulamayan bulgu ya da denetim hatası yedeği durdurur; zincir yine ilerler',async()=>{
  const db=await legalDb();
  try{
    const E=setup();
    let s=await go(E,db,1,{evaluation:{decision:'stop_nonwaivable',nonwaivable:[{code:'write_privilege'}],waivable:[]}});
    assert.equal(s.backup.verified,false);assert.equal(s.backup.stages.dump,'skipped');assert.equal(s.legal.ok,true);assert.equal(s.legal.observed,false);assert.equal(s.exit,1);
    s=await R.runAll({config:E.config,store:E.store,anchors:E.anchors,k1:E.k1,k7:E.k7,environment:'test',runId:'z1',now:at(2),runBackupImpl:fakePipeline(db),
      preflightImpl:async()=>{throw Error('bağlantı reddedildi');}});
    assert.equal(s.preflight.code,'audit_error');assert.equal(s.backup.verified,false);assert.equal(s.exit,1);
    // Döküm başarısız: gözlemsiz kontrol noktası; sonraki gözlem bütün aralığı doğrular.
    s=await go(E,db,3,{pipeline:{failDump:true}});
    assert.equal(s.legal.observed,false);
    s=await go(E,db,4);assert.equal(s.legal.observed,true);
  }finally{await finish(db);}
});

test('yasal tablolar bekleniyorsa ve yoksa yedek doğrulanmaz',async()=>{
  const db=await openDb();
  try{
    const E=setup();
    const s=await go(E,db,1);
    assert.equal(s.backup.verified,false);assert.equal(s.backup.stages.legal,'failed');assert.equal(s.legal.observed,false);
    const E2=setup();E2.config.expect_legal_tables=false;
    const s2=await go(E2,db,1);
    assert.equal(s2.backup.verified,true);assert.equal(s2.backup.stages.legal,'n/a');
  }finally{await finish(db);}
});

test('K6: production\'da asla; izinli test ortamında olaya bağlı, yedekten önce ve tek kullanımlık',async()=>{
  const db=await legalDb();
  try{
    const waivable=[{id:'private.f()',fingerprint_sha256:'f'.repeat(64)}];
    const evaluation={decision:'stop_waivable',nonwaivable:[],waivable,waivable_diff_sha256:sha256Json(waivable)};
    assert.equal(R.k6Allowed({k6_waiver:{enabled:true,allowed_environments:['production']}},'production'),false,'production her koşulda kapalı');
    const P=setup({environment:'production',k6:{enabled:true,allowed_environments:['production']}});
    let s=await go(P,db,1,{evaluation});
    assert.equal(s.preflight.status,'failed');assert.equal(s.waiver,null);assert.equal(s.backup.verified,false);

    const E=setup({environment:'staging',k6:{enabled:true,allowed_environments:['staging']}});
    await go(E,db,0);await releaseOpen(E,0);await go(E,db,0.01);
    s=await go(E,db,1,{evaluation});
    assert.equal(s.backup.verified,false,'belge yokken yedek yok');assert.deepEqual(s.waiver,{considered:0,consumed:null});
    const {body}=await headBody(E);
    const ev=body.sm.events.find(e=>e.type==='preflight_waivable'&&e.status==='open');
    const mk=o=>sign(WV.NAMESPACE,{version:1,waiver_id:randomUUID(),event_id:ev.event_id,environment:'staging',reason:'İnceleme sürüyor; tek seferlik.',
      diff_sha256:evaluation.waivable_diff_sha256,covers:waivable,issued_at:at(1).toISOString(),not_after:at(2).toISOString(),...o},E.k2.privateKey,E.k2.keyId);
    const doc=mk();
    await E.store.put('audit/inbox/waivers/a.json',Buffer.from(JSON.stringify(doc)));
    await E.store.put('audit/inbox/waivers/bozuk.json',Buffer.from(JSON.stringify(mk({environment:'production'}))));
    s=await go(E,db,1.1,{evaluation});
    assert.equal(s.waiver.consumed,doc.waiver_id);assert.equal(s.preflight.status,'ok');assert.equal(s.backup.verified,true);
    assert.equal(s.exit,1,'ön kontrol olayı açık kaldıkça çıkış 1');
    // Aynı belge ikinci kez işe yaramaz.
    s=await go(E,db,1.2,{evaluation});
    assert.equal(s.waiver.consumed,null);assert.equal(s.backup.verified,false);
    const {body:b2}=await headBody(E);
    assert.equal(b2.sm.waivers.filter(w=>w.waiver_id===doc.waiver_id).length,1);
    // Fark giderilince olay kapanır.
    s=await go(E,db,1.3);
    assert.equal(s.legal.open_events,0);assert.equal(s.exit,0);
  }finally{await finish(db);}
});

// ---------- uçtan uca ----------
function ageMissing(){try{execFileSync('age',['--version'],{stdio:'pipe'});execFileSync('age-keygen',['--version'],{stdio:'pipe'});return null;}catch{return 'age kurulu değil';}}
test('uçtan uca: gerçek döküm, geri yükleme, yasal kanıt ve zincir (gerçek PostgreSQL)',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump ve çoklu bağlantı yok');return;}
  const miss=ageMissing();if(miss){if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error(miss);t.skip(miss);return;}
  const {toolMajor}=require('../../tools/backup/dump.cjs');
  const BR=require('../../tools/backup/backup-role.cjs');
  const PA=require('../../tools/backup/privilege-audit.cjs');
  const {recipientsSha256}=require('../../tools/backup/encrypt.cjs');
  const {seed}=require('./fixtures.cjs');
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_o');let primary=null;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-t-a4-'));
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    if(!tool||tool<major){const msg=`pg_dump ${tool} sunucudan (${major}) eski`;if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(msg);t.skip(msg);return;}
    await seed(db);
    await db.exec(FIX);
    for(const d of [0,1,2])await db.query(`select private.legal_log('view_record',null,$1)`,[at(d).toISOString()]);
    const rid=(await db.query(`select private.t_open('court_order',$1) id`,[at(0).toISOString()])).rows[0].id;
    await db.query(`select private.t_close($1,$2)`,[rid,at(1).toISOString()]);
    const password='test-only-'+role;
    await db.exec(BR.renderLiteral({role,password}));
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password,database:db.name};
    const ids=[0,1].map(i=>{const f=path.join(dir,'id'+i);execFileSync('age-keygen',['-o',f],{stdio:'pipe'});return f;});
    const recipientsFile=path.join(dir,'recipients.txt');
    fs.writeFileSync(recipientsFile,ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
    const E=setup();E.config.recipients_sha256=recipientsSha256(recipientsFile);
    const {Client}=require('pg');
    const args=r=>({config:E.config,store:E.store,anchors:E.anchors,k1:E.k1,k7:E.k7,environment:'test',runId:r,now:new Date(),conn,scope:BR.loadScope(),
      recipientsFile,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN,allowlist:PA.loadAllowlist(),Client,workRoot:dir});
    let s=await R.runAll(args('e1'));
    assert.equal(s.preflight.decision,'ok',JSON.stringify(s.preflight));
    assert.equal(s.backup.verified,true,JSON.stringify(s.backup));
    assert.equal(s.legal.ok,true);assert.deepEqual(s.legal.blocking,['genesis_baseline']);
    const {chain}=await headBody(E);
    assert.equal(chain.head.counts.log,3);assert.equal(chain.head.counts.records,1);assert.equal(chain.head.observed,true);
    await releaseOpen(E,(Date.now()-T0)/DAY);
    s=await R.runAll(args('e2'));
    assert.equal(s.exit,0,JSON.stringify(s));
    // Yetkisiz bir değişiklik (yedek rolüne yazma yetkisi) bir sonraki çalışmayı durdurur.
    await db.exec(`grant insert on private.legal_access_log to ${role}`);
    s=await R.runAll(args('e3'));
    assert.equal(s.preflight.decision,'stop_nonwaivable');assert.equal(s.backup.verified,false);assert.equal(s.exit,1);
    assert.equal(fs.readdirSync(dir).filter(f=>f.startsWith('nakgo-backup-')).length,0,'şifresiz çalışma klasörü kalmadı');
  }catch(e){primary=e;throw e;}
  finally{
    await finish(db,primary);
    await dropRoles([role]);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('yedek iş akışı etkisiz: zamanlama yok, yalnız elle, yalnız main ve onaylı ortam, salt okunur izin',()=>{
  const y=fs.readFileSync(path.join(__dirname,'../../.github/workflows/backup.yml'),'utf8');
  const on=/^on:\n((?: {2}.*\n)+)/m.exec(y)[1];
  assert.equal(on.trim(),'workflow_dispatch:','yalnız elle tetikleme');
  assert.ok(!/^\s*schedule:/m.test(y),'zamanlama yok');
  assert.match(y,/if: github\.ref == 'refs\/heads\/main'/);
  assert.match(y,/environment: backup-production/);
  assert.match(y,/^permissions:\n {2}contents: read\n/m);
  assert.match(y,/cancel-in-progress: false/);
  assert.match(y,/NAKGO_BACKUP_ENVIRONMENT: production/);
  for(const m of y.matchAll(/uses: ([^@\s]+)@(\S+)/g))assert.match(m[2],/^[0-9a-f]{40}$/,'eylem sürümü sabitlenmiş: '+m[1]);
  // Worker örnek yapılandırması gerçek kimlik içermez.
  const w=fs.readFileSync(path.join(__dirname,'../../ops/backup/monitor/wrangler.example.toml'),'utf8');
  assert.match(w,/DOLDURULACAK/);assert.ok(!/account_id|database_id/.test(w));
});

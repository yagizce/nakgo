/** B7 simülasyon ve hata enjeksiyonu: depo istemcisinin geçici hatalarda davranışı, felaket kurtarma indirmesi (dr-fetch)
 * ve gerçek PostgreSQL üzerinde hata altında boru hattı + uçtan uca kurtarma tatbikatı.
 * Hepsi yerel: S3 taklidi (127.0.0.1) ve geçici veritabanı. Gerçek R2 ya da Supabase davranışını KANITLAMAZ;
 * o kanıtlar docs/backup/real-infra-gaps.md listesindedir. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {realPg,migratedDb,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {seed}=require('./fixtures.cjs');
const s3mock=require('./s3-mock.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {toolMajor}=require('../../tools/backup/dump.cjs');
const {restoreAndVerify}=require('../../tools/backup/restore-verify.cjs');
const {S3Store,MemoryStore}=require('../../tools/backup/store.cjs');
const E=require('../../tools/backup/encrypt.cjs');
const M=require('../../tools/backup/manifest.cjs');
const C=require('../../tools/backup/crypto.cjs');
const {runBackup,objectKeys}=require('../../tools/backup/pipeline.cjs');
const DR=require('../../tools/backup/dr-fetch.cjs');

const SECRET='secret-test-only-'+'x'.repeat(8);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-f-'));
const hasBin=b=>{try{execFileSync('which',[b],{stdio:'ignore'});return true;}catch{return false;}};
const ageMissing=()=>{if(hasBin('age')&&hasBin('age-keygen'))return null;if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error('age gerekli ama yok');return 'age kurulu değil';};

async function mockStore(faults,opts={}){
  const mock=await s3mock.start({accessKeyId:'AKTEST',secretAccessKey:SECRET,bucket:'b',faults});
  const store=new S3Store({endpoint:mock.endpoint,bucket:'b',accessKeyId:'AKTEST',secretAccessKey:SECRET,sleep:async()=>{},timeoutMs:300,...opts});
  return {mock,store};
}

test('depo istemcisi: geçici hatalar sınırlı sayıda yeniden denenir; 4xx asla',async t=>{
  await t.test('503, bağlantı kopması ve zaman aşımı sonrası yazma/okuma/listeleme/silme tamamlanır',async()=>{
    const {mock,store}=await mockStore([
      {method:'PUT',kind:'status',status:503,times:2},{method:'GET',prefix:'a/',kind:'reset'},
      {method:'GET',prefix:'',kind:'hang'},{method:'HEAD',kind:'status',status:500},{method:'DELETE',kind:'status',status:429}]);
    try{
      assert.equal((await store.put('a/1',Buffer.from('veri'))).ok,true);
      assert.equal((await store.get('a/1')).toString(),'veri');
      assert.deepEqual((await store.list('a/')).map(o=>o.key),['a/1']);
      assert.equal((await store.head('a/1')).size,4);
      assert.equal((await store.delete('a/1')).ok,true);
      assert.equal(await store.get('a/1'),null);
    }finally{await mock.close();}
  });
  await t.test('yarım gövde yeniden okunur; bozuk gövde sessizce düzeltilmez (çağıran hash ile yakalar)',async()=>{
    const {mock,store}=await mockStore([{method:'GET',prefix:'x',kind:'truncate'},{method:'GET',prefix:'y',kind:'corrupt'}]);
    try{
      const body=Buffer.alloc(4096,7);
      await store.put('x',body);await store.put('y',body);
      assert.ok((await store.get('x')).equals(body),'yarım gövde sonrası tam gövde');
      assert.notEqual(C.sha256(await store.get('y')),C.sha256(body),'bozuk gövde 200 ile gelir; hash denetimi şart');
    }finally{await mock.close();}
  });
  await t.test('403 ve 412 yeniden denenmez',async()=>{
    const {mock,store}=await mockStore([{method:'PUT',prefix:'k',kind:'status',status:403}]);
    try{
      assert.equal((await store.put('k',Buffer.from('1'))).status,403,'tek denemede 403 döner');
      assert.equal(await store.get('k'),null,'ikinci deneme yapılmadı');
      await store.put('z',Buffer.from('1'),{ifNoneMatch:true});
      const r=await store.put('z',Buffer.from('2'),{ifNoneMatch:true});
      assert.equal(r.status,412);assert.equal(r.ambiguous,undefined,'ilk denemede 412 belirsiz değildir');
    }finally{await mock.close();}
  });
  await t.test('yanıtı kaybolan koşullu yazma: tekrar 412 döner ve belirsiz işaretlenir',async()=>{
    const {mock,store}=await mockStore([{method:'PUT',prefix:'db/',kind:'after_write'}]);
    try{
      const r=await store.put('db/o',Buffer.from('ilk'),{ifNoneMatch:true});
      assert.equal(r.ok,false);assert.equal(r.status,412);assert.equal(r.ambiguous,true);
      assert.equal((await store.get('db/o')).toString(),'ilk');
    }finally{await mock.close();}
  });
  await t.test('denemeler tükenince hata; mesajda gizli değer ya da uç nokta yok',async()=>{
    const {mock,store}=await mockStore([{method:'GET',kind:'status',status:503,times:99}],{retries:2});
    let waits=[];store.sleep=async ms=>{waits.push(ms);};store.backoffMs=100;
    try{
      await assert.rejects(store.get('q'),e=>{assert.match(e.message,/GET q: 503/);assert.ok(!e.message.includes(SECRET)&&!e.message.includes('127.0.0.1'));return true;});
      assert.deepEqual(waits,[100,200],'artan bekleme');
    }finally{await mock.close();}
    const {mock:m2,store:s2}=await mockStore([{method:'GET',kind:'hang',times:99}],{retries:1,timeoutMs:100});
    try{await assert.rejects(s2.get('q'),/zaman aşımı/);}finally{await m2.close();}
  });
});

/** Yazmayı yapıp belirsiz 412 döndüren depo (yanıtı kaybolan koşullu yazmanın yeniden denemesi). other: başka içerik yazılmış. */
function ambiguousStore(match,{other=false}={}){
  const s=new MemoryStore();const put=s.put.bind(s);
  s.put=async(key,body,o)=>{if(o&&o.ifNoneMatch&&match(key)){await put(key,other?Buffer.from('başka'):body);return {ok:false,status:412,ambiguous:true};}return put(key,body,o);};
  return s;
}

test('belirsiz 412: kontrol noktası ve silme günlüğü geri okumayla karar verir, sahte çakışma alarmı yok',async()=>{
  const CP=require('../../tools/backup/checkpoint.cjs');const J=require('../../tools/backup/deletion-journal.cjs');
  const k1=C.testKeyPair(),k7=require('node:crypto').randomBytes(32);
  const write=store=>CP.writeCheckpoint(store,{seq:1,prevHeader:null,body:{leaves:{log:[],destructions:[],records:[],holds:[],runs:[]},policies:[],findings:[],sm:{events:[],releases:[],waivers:[]},attachments:[]},k1,k7,createdAt:'2026-11-17T03:00:00Z',runId:'r'});
  for(const [name,match] of [['gövde',k=>k.includes('.body.')],['başlık',k=>k.endsWith('.json')]]){
    const ok=await write(ambiguousStore(match));
    assert.equal(ok.ok,true,name+JSON.stringify(ok));
    const bad=await write(ambiguousStore(match,{other:true}));
    assert.equal(bad.ok,false);assert.equal(bad.conflict,true,'başka içerik gerçek çakışmadır');
  }
  const cp={seq:1,sha:'a'.repeat(64)};
  assert.equal((await J.writeIntent(ambiguousStore(()=>true),{k1,runId:'r',checkpoint:cp,keys:['db/x'],now:new Date()})).ok,true);
  const other=await J.writeIntent(ambiguousStore(()=>true,{other:true}),{k1,runId:'r',checkpoint:cp,keys:['db/x'],now:new Date()});
  assert.equal(other.ok,false);assert.match(other.error,/farklı/);
});

/* --- Felaket kurtarma indirmesi (dr-fetch) --- */
function fakeBackup(store,{k1,runId,now,pinned,body=Buffer.from('şifreli-gibi '+runId),verified=true,mutate=m=>m}){
  const keys=objectKeys(runId,now);
  const stages=Object.fromEntries(M.DATA_STAGES.map(s=>[s,{status:'ok'}]));
  if(!verified)stages.upload={status:'failed',code:'put_503'};
  let m=M.buildManifest({runId,createdAt:now.toISOString(),stages,objectKey:verified?keys.data:null,
    encryption:{ciphertext_sha256:C.sha256(body),size:body.length,recipients_sha256:pinned},source:null});
  m=mutate(m);
  const signed=M.signManifest(m,k1);
  return {keys,body,signed,write:async()=>{if(verified)await store.put(keys.data,body);await store.put(keys.manifest,Buffer.from(JSON.stringify(signed)));}};
}

test('kurtarma indirmesi: imza, bağlama, hash ve boyut denetimleri; şifre çözmez',async t=>{
  const k1=C.testKeyPair(),other=C.testKeyPair();
  const trusted={[k1.keyId]:k1.publicKey};const pinned='a'.repeat(64);
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let n=0;const out=()=>path.join(dir,'o'+(++n)+'.age');
  const now=new Date('2026-11-17T03:00:00Z');
  const run=async(store,manifestKey)=>DR.fetchVerified({store,manifestKey,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:out()});

  await t.test('mutlu yol: dosya 0600 yazılır, içerik manifestle aynı',async()=>{
    const store=new MemoryStore();const b=fakeBackup(store,{k1,runId:'r1',now,pinned});await b.write();
    const f=out();const r=await DR.fetchVerified({store,manifestKey:b.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:f});
    assert.equal(r.ok,true,JSON.stringify(r));assert.ok(fs.readFileSync(f).equals(b.body));
    assert.equal(fs.statSync(f).mode&0o777,0o600);
    await assert.rejects(DR.fetchVerified({store,manifestKey:b.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:f}),/EEXIST/,'var olan dosyanın üzerine yazmaz');
  });
  const cases=[
    ['manifest yok',async s=>({key:objectKeys('yok',now).manifest}),'manifest_missing'],
    ['manifest JSON değil',async s=>{const k=objectKeys('j',now).manifest;await s.put(k,Buffer.from('{bozuk'));return {key:k};},'manifest_parse'],
    ['beklenmeyen anahtar biçimi',async s=>({key:'manifests/../db/x.json'}),'manifest_key'],
    ['güvenilmeyen anahtarla imzalı',async s=>{const b=fakeBackup(s,{k1:other,runId:'u',now,pinned});await b.write();return {key:b.keys.manifest};},'signature'],
    ['imzadan sonra değiştirilmiş',async s=>{const b=fakeBackup(s,{k1,runId:'m',now,pinned});b.signed.size+=1;await b.write();return {key:b.keys.manifest};},'signature'],
    ['doğrulanmamış yedek',async s=>{const b=fakeBackup(s,{k1,runId:'nv',now,pinned,verified:false});await b.write();return {key:b.keys.manifest};},'not_verified'],
    ['alıcı listesi farklı',async s=>{const b=fakeBackup(s,{k1,runId:'rc',now,pinned,mutate:m=>({...m,recipients_sha256:'b'.repeat(64)})});await b.write();return {key:b.keys.manifest};},'recipients'],
    ['başka yedeğe yönlendirme',async s=>{const old=fakeBackup(s,{k1,runId:'old',now:new Date('2026-11-10T03:00:00Z'),pinned});await old.write();
      const b=fakeBackup(s,{k1,runId:'yon',now,pinned,body:old.body,mutate:m=>({...m,object_key:old.keys.data})});await b.write();return {key:b.keys.manifest};},'binding'],
    ['çalışma kimliği farklı',async s=>{const b=fakeBackup(s,{k1,runId:'rid',now,pinned,mutate:m=>({...m,run_id:'baska'})});await b.write();return {key:b.keys.manifest};},'binding'],
    ['şifreli nesne yok',async s=>{const b=fakeBackup(s,{k1,runId:'on',now,pinned});await b.write();await s.delete(b.keys.data);return {key:b.keys.manifest};},'object_missing'],
    ['nesne kısalmış',async s=>{const b=fakeBackup(s,{k1,runId:'tr',now,pinned});await b.write();await s.put(b.keys.data,b.body.subarray(1));return {key:b.keys.manifest};},'size'],
    ['nesnede bit değişmiş',async s=>{const b=fakeBackup(s,{k1,runId:'bf',now,pinned});await b.write();const c=Buffer.from(b.body);c[3]^=1;await s.put(b.keys.data,c);return {key:b.keys.manifest};},'sha256'],
  ];
  for(const [name,setup,code] of cases)await t.test('durur: '+name,async()=>{
    const store=new MemoryStore();const {key}=await setup(store);
    const before=fs.readdirSync(dir).length;
    const r=await run(store,key);
    assert.equal(r.ok,false);assert.equal(r.code,code,JSON.stringify(r));
    assert.equal(fs.readdirSync(dir).length,before,'başarısızlıkta dosya yazılmaz');
  });
  await t.test('sabitlenmiş alıcı hash\'i yoksa durur',async()=>{
    const store=new MemoryStore();const b=fakeBackup(store,{k1,runId:'np',now,pinned});await b.write();
    assert.equal((await DR.fetchVerified({store,manifestKey:b.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:'',outFile:out()})).code,'pin');
  });
  await t.test('en yeni: doğrulanmamış daha yeni çalışma atlanır, en yeni doğrulanmış seçilir',async()=>{
    const store=new MemoryStore();
    const a=fakeBackup(store,{k1,runId:'a',now:new Date('2026-11-15T03:00:00Z'),pinned});await a.write();
    const b=fakeBackup(store,{k1,runId:'b',now:new Date('2026-11-16T03:00:00Z'),pinned});await b.write();
    const c=fakeBackup(store,{k1,runId:'c',now:new Date('2026-11-17T03:00:00Z'),pinned,verified:false});await c.write();
    const r=await DR.fetchLatest({store,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:out()});
    assert.equal(r.ok,true);assert.equal(r.run_id,'b');assert.deepEqual(r.skipped.map(s=>s.code),['not_verified']);
  });
  await t.test('en yeni: daha yeni manifestte bütünlük sorunu varsa eskisine geçmez, durur',async()=>{
    const store=new MemoryStore();
    const a=fakeBackup(store,{k1,runId:'a',now:new Date('2026-11-15T03:00:00Z'),pinned});await a.write();
    const b=fakeBackup(store,{k1,runId:'b',now:new Date('2026-11-16T03:00:00Z'),pinned});await b.write();
    const c=Buffer.from(b.body);c[0]^=1;await store.put(b.keys.data,c);
    const r=await DR.fetchLatest({store,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:out()});
    assert.equal(r.ok,false);assert.equal(r.code,'integrity');assert.match(r.reason,/sha256/);
  });
  await t.test('en yeni: hiç doğrulanmış yedek yoksa durur',async()=>{
    const r=await DR.fetchLatest({store:new MemoryStore(),trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:out()});
    assert.equal(r.code,'none');
  });
  await t.test('S3 üzerinden: geçici 503 ve yarım gövde sonrası doğru dosya',async()=>{
    const {mock,store}=await mockStore([{method:'GET',prefix:'manifests/',kind:'status',status:503},{method:'GET',prefix:'db/',kind:'truncate'}]);
    try{
      const b=fakeBackup(store,{k1,runId:'s3',now,pinned,body:Buffer.alloc(10000,9)});await b.write();
      const f=out();const r=await DR.fetchVerified({store,manifestKey:b.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:f});
      assert.equal(r.ok,true,JSON.stringify(r));assert.ok(fs.readFileSync(f).equals(b.body));
    }finally{await mock.close();}
  });
});

/* --- Gerçek PostgreSQL: hata altında boru hattı ve uçtan uca kurtarma tatbikatı --- */
test('hata altında boru hattı ve kurtarma tatbikatı (gerçek PostgreSQL)',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump/pg_restore yok; PG16/PG17 ile çalışır');return;}
  const miss=ageMissing();if(miss){t.skip(miss);return;}
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_f');let primary=null;const dir=tmp();
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    if(!tool||tool<major){
      const msg=`pg_dump ${tool} sunucudan (${major}) eski`;
      if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(msg);
      t.skip(msg+'; CI bu testi PostgreSQL 17 istemcisiyle çalıştırır');return;
    }
    await seed(db);
    const password='test-only-'+role;
    await db.exec(BR.renderLiteral({role,password}));
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password,database:db.name};
    const ids=[0,1].map(i=>{const f=path.join(dir,'id'+i+'.txt');execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
    const recipientsFile=path.join(dir,'recipients.txt');
    fs.writeFileSync(recipientsFile,ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
    const pinned=E.recipientsSha256(recipientsFile);
    const k1=C.testKeyPair();const trusted={[k1.keyId]:k1.publicKey};
    const work=path.join(dir,'work');fs.mkdirSync(work);
    const base={conn,scope:BR.loadScope(),recipientsFile,pinnedRecipientsSha256:pinned,k1,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN,
      workRoot:work,hooks:{preflight:async()=>({status:'ok'})}};
    let n=0;const rid=()=>'f'+(++n);
    const noPlaintext=()=>assert.deepEqual(fs.readdirSync(work),[],'şifresiz çalışma klasörü kalmadı');

    await t.test('yanıtı kaybolan yükleme: geri okunan hash tutunca yedek doğrulanır',async()=>{
      const {mock,store}=await mockStore([{method:'PUT',prefix:'db/',kind:'after_write'},{method:'PUT',prefix:'manifests/',kind:'after_write'}],{timeoutMs:10000});
      try{
        const r=await runBackup({...base,store,runId:rid()});
        assert.equal(r.verified,true,JSON.stringify(r.stages));assert.equal(r.extra.manifest_upload.status,'ok');noPlaintext();
      }finally{await mock.close();}
    });
    await t.test('kalıcı depo hatası: doğrulanmış sayılmaz, manifest yine yazılır',async()=>{
      const {mock,store}=await mockStore([{method:'PUT',prefix:'db/',kind:'status',status:503,times:99}],{timeoutMs:10000});
      try{
        const r=await runBackup({...base,store,runId:rid()});
        assert.equal(r.verified,false);assert.equal(r.stages.upload.code,'exception');
        assert.equal(r.extra.manifest_upload.status,'ok');assert.deepEqual(await store.list('db/'),[]);noPlaintext();
      }finally{await mock.close();}
    });
    await t.test('geri okumada bozulma: doğrulanmış sayılmaz',async()=>{
      const {mock,store}=await mockStore([{method:'GET',prefix:'db/',kind:'corrupt'}],{timeoutMs:10000});
      try{
        const r=await runBackup({...base,store,runId:rid()});
        assert.equal(r.verified,false);assert.equal(r.stages.upload.code,'roundtrip');noPlaintext();
      }finally{await mock.close();}
    });
    await t.test('şifreleme aracı yoksa: hiçbir şey yüklenmez, şifresiz dosya kalmaz',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid(),ageBin:path.join(dir,'yok','age')});
      assert.equal(r.stages.encryption.status,'failed');assert.equal(r.stages.upload.status,'skipped');
      assert.deepEqual(await store.list('db/'),[]);noPlaintext();
    });
    await t.test('döküm sırasında bağlantı kesilirse: döküm başarısız, şifresiz dosya kalmaz',async()=>{
      const store=new MemoryStore();
      const killer=setTimeout(()=>db.query(`select pg_terminate_backend(pid) from pg_stat_activity where usename=$1`,[role]).catch(()=>{}),300);
      try{
        const r=await runBackup({...base,store,runId:rid(),dumpOptions:{delayBeforeDumpMs:1500}});
        assert.equal(r.stages.dump.status,'failed',JSON.stringify(r.stages));assert.equal(r.verified,false);
        assert.deepEqual(await store.list('db/'),[]);noPlaintext();
      }finally{clearTimeout(killer);}
    });
    await t.test('veritabanına ulaşılamazsa: çökmez, başarısız manifest yazılır',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid(),conn:{...conn,password:'yanlis-test-parolasi'}});
      assert.equal(r.stages.dump.status,'failed');assert.equal(r.stages.dump.code,'exception');assert.equal(r.verified,false);
      assert.equal(r.extra.manifest_upload.status,'ok');assert.deepEqual(await store.list('db/'),[]);noPlaintext();
    });
    await t.test('kurtarma tatbikatı: yedek → indir ve doğrula → çevrim dışı çöz → yalıtılmış PostgreSQL\'e geri yükle',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid()});
      assert.equal(r.verified,true,JSON.stringify(r.stages));
      const ct=path.join(dir,'drill.tar.age');
      const f=await DR.fetchLatest({store,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:ct});
      assert.equal(f.ok,true,JSON.stringify(f));assert.equal(f.run_id,r.manifest.run_id);
      const bundle=path.join(dir,'drill');fs.mkdirSync(bundle,{mode:0o700});
      execFileSync('sh',['-c','age -d -i "$1" "$2" | tar -xf - -C "$3"','sh',ids[1],ct,bundle]);
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      for(const code of ['counts','b_content','fk_orphans','fingerprint','contract'])assert.ok(v.checks.some(c=>c.code===code&&c.ok),code);
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([role]);fs.rmSync(dir,{recursive:true,force:true});}
});

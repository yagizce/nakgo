/** B7-A2 testleri: bağlantı kuralları, depo (taklit), SigV4, kapılı silme, manifesto, age şifrelemesi ve
 * gerçek PostgreSQL üzerinde uçtan uca boru hattı (tutarlı anlık görüntü, eşzamanlı yazıcı, kasıtlı bozmalar).
 * Uçtan uca testler: PGlite'ta çalışmaz (pg_dump/pg_restore ve çoklu bağlantı yok); pg_dump sunucudan eskiyse yerelde
 * atlanır, CI'da (NAKGO_REQUIRE_DUMP=1) HATA verir. age yoksa yerelde atlanır, CI'da (NAKGO_REQUIRE_AGE=1) hata verir. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {realPg,migratedDb,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {seed}=require('./fixtures.cjs');
const s3mock=require('./s3-mock.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {validateConn,snapshotDump,toolMajor}=require('../../tools/backup/dump.cjs');
const {restoreAndVerify,fkOrphans}=require('../../tools/backup/restore-verify.cjs');
const {S3Store,MemoryStore}=require('../../tools/backup/store.cjs');
const E=require('../../tools/backup/encrypt.cjs');
const M=require('../../tools/backup/manifest.cjs');
const D=require('../../tools/backup/deletion.cjs');
const {runBackup}=require('../../tools/backup/pipeline.cjs');
const C=require('../../tools/backup/crypto.cjs');

const hasBin=b=>{try{execFileSync('which',[b],{stdio:'ignore'});return true;}catch{return false;}};
const ageMissing=()=>{if(hasBin('age')&&hasBin('age-keygen'))return null;if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error('age gerekli ama yok');return 'age kurulu değil';};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-t-'));

/** Test alıcıları: iki geçici age kimliği. Kimlik dosyaları test sonunda silinir. */
function testRecipients(dir){
  const ids=[0,1].map(i=>{const f=path.join(dir,'id'+i+'.txt');execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
  const pubs=ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]);
  const rf=path.join(dir,'recipients.txt');fs.writeFileSync(rf,'# test\n'+pubs.join('\n')+'\n');
  return {ids,recipientsFile:rf,pinned:E.recipientsSha256(rf)};
}

test('bağlantı kuralları (muaf tutulamaz)',t=>{
  const d=tmp();t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
  const cert=path.join(d,'ca.pem');fs.writeFileSync(cert,'x');
  const good={host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,user:'nakgo_backup.ref',sslmode:'verify-full',sslrootcert:cert};
  assert.deepEqual(validateConn(good),[]);
  assert.ok(validateConn({...good,port:6543})[0].includes('İŞLEM'));
  assert.ok(validateConn({...good,sslmode:'require'}).some(p=>p.includes('verify-full')));
  assert.ok(validateConn({...good,sslrootcert:'/yok'}).some(p=>p.includes('sertifika')));
  assert.ok(validateConn({...good,host:'db.example.com'}).some(p=>p.includes('beklenmeyen')));
  assert.ok(validateConn({host:'/tmp',port:5432}).length===1,'yerel yalnız testte');
  assert.deepEqual(validateConn({host:'/tmp',port:5432},{allowLocal:true}),[]);
});

test('MemoryStore: koşullu yazma ve kilit simülasyonu',async()=>{
  let now=new Date('2026-11-01T00:00:00Z');
  const s=new MemoryStore({lockDays:14,lockPrefixes:['db/'],clock:()=>now});
  assert.equal((await s.put('db/a','1',{ifNoneMatch:true})).ok,true);
  assert.equal((await s.put('db/a','2',{ifNoneMatch:true})).status,412);
  assert.equal((await s.put('db/a','2')).status,403,'kilitliyken üzerine yazılamaz');
  assert.equal((await s.delete('db/a')).status,403,'kilitliyken silinemez');
  now=new Date('2026-11-15T00:00:01Z');
  assert.equal((await s.delete('db/a')).ok,true);
  assert.equal((await s.delete('db/a')).status,404);
});

test('S3Store (SigV4) yerel taklide karşı',async()=>{
  const mock=await s3mock.start({accessKeyId:'AKTEST',secretAccessKey:'secret-test-only',bucket:'b',store:new MemoryStore({lockDays:14,lockPrefixes:['db/']})});
  try{
    const s=new S3Store({endpoint:mock.endpoint,bucket:'b',accessKeyId:'AKTEST',secretAccessKey:'secret-test-only'});
    assert.equal((await s.put('db/2026/11/17/a b+ç.tar.age',Buffer.from('veri'),{ifNoneMatch:true})).ok,true);
    assert.equal((await s.put('db/2026/11/17/a b+ç.tar.age',Buffer.from('x'),{ifNoneMatch:true})).status,412);
    assert.equal((await s.get('db/2026/11/17/a b+ç.tar.age')).toString(),'veri');
    assert.equal((await s.head('db/2026/11/17/a b+ç.tar.age')).size,4);
    assert.deepEqual((await s.list('db/')).map(o=>o.key),['db/2026/11/17/a b+ç.tar.age']);
    assert.equal((await s.delete('db/2026/11/17/a b+ç.tar.age')).ok,false,'kilit simülasyonu silmeyi reddeder');
    assert.equal(await s.get('db/yok'),null);
    const wrong=new S3Store({endpoint:mock.endpoint,bucket:'b',accessKeyId:'AKTEST',secretAccessKey:'yanlis'});
    assert.equal((await wrong.put('x','1')).status,403,'yanlış gizli anahtarla imza reddedilir');
    assert.throws(()=>new S3Store({endpoint:'http://example.com',bucket:'b'}),/HTTPS/);
  }finally{await mock.close();}
});

test('kapılı silme: fail-closed',async()=>{
  const now=new Date('2026-12-01T00:00:00Z');
  const recent=[1,2,3,4].map(i=>({key:'db/v'+i,last_modified:`2026-11-${26+i>30?30:26+i}T0${i}:00:00Z`}));
  const objects=[{key:'db/old',last_modified:'2026-11-10T00:00:00Z'},{key:'db/new',last_modified:'2026-11-25T00:00:00Z'},...recent];
  const coverage={verified:['db/old','db/new',...recent.map(o=>o.key)]};
  const ok={enabled:true,capabilityVerified:true,openEvents:0,anchorsOk:true};
  assert.equal(D.plan({objects,now,coverage}).allowed,false,'varsayılan kapalı');
  for(const [k,v] of [['enabled',false],['capabilityVerified',false],['openEvents',1],['openEvents',undefined],['anchorsOk',false]]){
    const p=D.plan({objects,now,gate:{...ok,[k]:v},coverage});
    assert.equal(p.allowed,false,k);assert.deepEqual(p.delete,[]);
  }
  assert.equal(D.plan({objects,now,gate:ok}).allowed,false,'kapsama bilinmiyorsa silme yok');
  const p=D.plan({objects,now,gate:ok,coverage});
  assert.deepEqual(p.delete,['db/old']);
  const store=new MemoryStore({lockDays:14,lockPrefixes:['db/'],clock:()=>now});
  store.objects.set('db/old',{body:Buffer.from('x'),created:new Date('2026-11-10T00:00:00Z')});
  assert.deepEqual((await D.execute(store,p)).map(x=>x.status),['deleted']);
  assert.deepEqual((await D.execute(store,p)).map(x=>x.status),['already_deleted'],'tekrar edilebilir');
  const locked=new MemoryStore({lockDays:30,lockPrefixes:['db/'],clock:()=>now});
  locked.objects.set('db/old',{body:Buffer.from('x'),created:new Date('2026-11-10T00:00:00Z')});
  assert.deepEqual((await D.execute(locked,p)).map(x=>x.status),['refused'],'kilit kodun izninden bağımsız korur');
});

test('manifesto: aşamalar ayrı, imza',()=>{
  const all=Object.fromEntries(M.DATA_STAGES.map(s=>[s,{status:'ok'}]));
  assert.equal(M.isVerified(all),true);
  assert.equal(M.isVerified({...all,legal:{status:'n/a'}}),true);
  for(const s of M.DATA_STAGES)assert.equal(M.isVerified({...all,[s]:{status:'failed'}}),false,s);
  assert.equal(M.isVerified({...all,upload:{status:'skipped'}}),false);
  const k1=C.testKeyPair(),m=M.buildManifest({runId:'r1',createdAt:'2026-11-17T00:00:00Z',stages:all});
  const signed=M.signManifest(m,k1);
  assert.equal(M.verifyManifest(signed,{[k1.keyId]:k1.publicKey}).ok,true);
  assert.equal(M.verifyManifest({...signed,verified:false},{[k1.keyId]:k1.publicKey}).ok,false);
  assert.equal(M.verifyManifest(signed,{}).ok,false);
});

test('age şifrelemesi',async t=>{
  const miss=ageMissing();if(miss){t.skip(miss);return;}
  const dir=tmp();
  try{
    const {ids,recipientsFile,pinned}=testRecipients(dir);
    const plain=path.join(dir,'p.bin');fs.writeFileSync(plain,Buffer.from('gizli test verisi '.repeat(100)));
    const out=path.join(dir,'p.age');
    const r=await E.encryptFile({input:plain,output:out,recipientsFile,pinnedRecipientsSha256:pinned});
    assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.recipients_count,2);
    for(const id of ids)assert.equal(execFileSync('age',['-d','-i',id,out]).toString(),fs.readFileSync(plain,'utf8'),'iki alıcı da çözebilmeli (yalnız test anahtarı)');
    assert.equal((await E.encryptFile({input:plain,output:out+'2',recipientsFile,pinnedRecipientsSha256:'0'.repeat(64)})).code,'recipients_mismatch');
    const evil=path.join(dir,'evil.txt');fs.writeFileSync(evil,fs.readFileSync(recipientsFile,'utf8')+/# public key: (age1\S+)/.exec(execFileSync('age-keygen').toString())[1]+'\n');
    assert.equal((await E.encryptFile({input:plain,output:out+'3',recipientsFile:evil,pinnedRecipientsSha256:pinned})).code,'recipients_mismatch','eklenen alıcı yakalanır');
    assert.equal(E.parseHeader(Buffer.from('age-encryption.org/v1\n-> scrypt abc 18\nxx\n--- y\n')).stanzas[0],'scrypt');
    const ct=fs.readFileSync(out);ct[ct.length-10]^=1;fs.writeFileSync(out+'.bad',ct);
    assert.throws(()=>execFileSync('age',['-d','-i',ids[0],out+'.bad'],{stdio:'pipe'}),'değiştirilmiş şifreli dosya çözülemez');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('uçtan uca boru hattı (gerçek PostgreSQL)',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump/pg_restore ve çoklu bağlantı yok; PG16/PG17 ile çalışır');return;}
  const miss=ageMissing();if(miss){t.skip(miss);return;}
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_t');let primary=null;const dir=tmp();
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
    const scope=BR.loadScope();
    const {ids,recipientsFile,pinned}=testRecipients(dir);
    const k1=C.testKeyPair();
    const base={conn,scope,recipientsFile,pinnedRecipientsSha256:pinned,k1,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN,
      hooks:{preflight:async()=>({status:'ok'})}};
    let n=0;const rid=()=>'t'+(++n);

    await t.test('başarılı çalışma: bütün aşamalar ok, şifresiz dosya kalmaz',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid(),workRoot:dir});
      assert.equal(r.verified,true,JSON.stringify(r.stages)+JSON.stringify(r.restore_checks));
      for(const s of M.DATA_STAGES)assert.ok(['ok','n/a'].includes(r.stages[s].status),s);
      assert.equal(r.extra.manifest_signature.status,'ok');assert.equal(r.extra.manifest_upload.status,'ok');
      assert.equal(r.extra.plaintext_cleanup.status,'ok');
      assert.deepEqual(fs.readdirSync(dir).filter(f=>f.startsWith('nakgo-backup-')),[],'şifresiz çalışma klasörü silinmiş');
      assert.equal(M.verifyManifest(r.manifest,{[k1.keyId]:k1.publicKey}).ok,true);
      assert.ok(!JSON.stringify(r.manifest).includes('public.listings'),'manifestte tablo bazında sayı yok');
      const ct=await store.get(r.keys.data);const f=path.join(dir,'c.age');fs.writeFileSync(f,ct);
      const tarList=execFileSync('sh',['-c',`age -d -i ${ids[1]} ${f} | tar -tf -`]).toString().split('\n').filter(Boolean).sort();
      // Auth/Storage yalnız dışa aktarma fonksiyonlarından (B/*.jsonl); oturum/belirteç tabloları ne okunabilir ne dökümde.
      assert.ok(tarList.includes('A.dump')&&tarList.includes('B.pre.sql')&&tarList.includes('B.post.sql')&&tarList.includes('bootstrap.sql')&&tarList.includes('source.json'),tarList.join(','));
      assert.ok(tarList.includes('B/auth.users.jsonl')&&tarList.includes('B/auth.identities.jsonl'),tarList.join(','));
      assert.ok(!tarList.some(x=>/sessions|refresh_tokens|mfa_challenges|one_time_tokens|flow_state/.test(x)),tarList.join(','));
      assert.ok(!tarList.includes('B.dump'));
      assert.ok(Number((await db.query('select count(*) n from auth.sessions')).rows[0].n)>0,'kaynakta oturum vardı');
      const tokens=(await db.query(`select string_agg(token,'|') t from (select token from auth.refresh_tokens where token is not null union all select id::text from auth.sessions) x`)).rows[0].t;
      const plainAll=execFileSync('sh',['-c',`age -d -i ${ids[1]} ${f} | tar -xOf - ${tarList.filter(x=>x.startsWith('B/')).join(' ')}`]).toString();
      for(const tk of (tokens||'').split('|').filter(x=>x.length>8))assert.ok(!plainAll.includes(tk),'oturum/belirteç değeri B dosyalarında yok');
      assert.deepEqual(r.restore_checks.filter(c=>!c.ok),[]);
    });

    await db.exec(`create table public.zz_writer(id bigserial primary key,v text); grant select on public.zz_writer, public.zz_writer_id_seq to ${role};`);
    const writerRun=async(useSnapshot)=>{
      const {Client}=require('pg');
      const w=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:db.name});
      await w.connect();let stop=false,writes=0;
      const loop=(async()=>{while(!stop){await w.query(`insert into public.zz_writer(v) values('x')`);writes++;}})();
      try{
        await new Promise(r=>setTimeout(r,100));
        const out=path.join(dir,'w'+(++n));
        const d=await snapshotDump({conn,scope,outDir:out,allowLocal:true,delayBeforeDumpMs:700,useSnapshot,pgBin:process.env.NAKGO_PG_BIN});
        assert.equal(d.status,'ok',JSON.stringify(d));
        stop=true;await loop;
        const live=Number((await db.query('select count(*) n from public.zz_writer')).rows[0].n);
        const v=await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN});
        return {d,v,live,writes};
      }finally{stop=true;await loop.catch(()=>{});await w.end();}
    };
    await t.test('eşzamanlı yazıcı: döküm S1 anlık görüntüsüyle birebir aynı',async()=>{
      const {d,v,live,writes}=await writerRun(true);
      assert.ok(writes>20,'yazıcı çalıştı: '+writes);
      assert.ok(live>d.source.counts['public.zz_writer'],`canlı sayı (${live}) S1'den (${d.source.counts['public.zz_writer']}) büyük olmalı`);
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
    });
    await t.test('kasıtlı bozma: --snapshot olmadan sayılar tutmaz ve doğrulama düşer',async()=>{
      const {v}=await writerRun(false);
      assert.equal(v.status,'failed');
      assert.ok(v.checks.some(c=>c.code==='counts'&&!c.ok&&JSON.stringify(c.detail).includes('zz_writer')));
    });

    await t.test('bozma: kesilmiş döküm dosyası geri yüklenemez',async()=>{
      const out=path.join(dir,'trunc');
      assert.equal((await snapshotDump({conn,scope,outDir:out,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN})).status,'ok');
      const f=path.join(out,'A.dump');fs.truncateSync(f,Math.floor(fs.statSync(f).size/2));
      assert.equal((await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN})).status,'failed');
    });

    const failCase=async(name,setup,check,teardown)=>t.test(name,async()=>{
      await db.exec(setup);
      try{const store=new MemoryStore();const r=await runBackup({...base,store,runId:rid(),workRoot:dir});check(r,store);assert.equal(r.verified,false);assert.equal(r.extra.plaintext_cleanup.status,'ok');}
      finally{if(teardown)await db.exec(teardown);}
    });
    await failCase('koruma: storage.objects boş değil → döküm başlamaz',
      `alter table storage.objects disable trigger user; insert into storage.objects(bucket_id,name) values('carrier-documents','x'); alter table storage.objects enable trigger user;`,
      r=>{assert.equal(r.stages.dump.status,'failed');assert.equal(r.stages.dump.code,'guards');assert.equal(r.stages.encryption.status,'skipped');},
      `alter table storage.objects disable trigger user; delete from storage.objects; alter table storage.objects enable trigger user;`);
    await failCase('koruma: kapsam dışı Auth özelliğinde veri → döküm başlamaz',
      `create table auth.webauthn_credentials(id int); insert into auth.webauthn_credentials values (1); analyze auth.webauthn_credentials; select pg_stat_force_next_flush();`,
      r=>{assert.equal(r.stages.dump.code,'guards');assert.ok(r.stages.dump.reason.includes('webauthn'));},
      `drop table auth.webauthn_credentials`);
    await failCase('koruma kesin sayımla: istatistik güncellenmeden eklenen satır da yakalanır',
      `create table auth.webauthn_credentials(id int); insert into auth.webauthn_credentials values (1);`,
      r=>{assert.equal(r.stages.dump.code,'guards');assert.match(r.stages.dump.reason,/webauthn_credentials \(1 satır\)/);},
      `drop table auth.webauthn_credentials`);
    // Varsayılan yetkiler (şablonu çalıştıran rol için) sayesinde yeni tablo otomatik okunur ve tam şema dökümüne girer.
    await t.test('yeni tablo otomatik dökülür ve geri yüklemede sayısı tutar',async()=>{
      await db.exec(`create table public.zz_new(id int); insert into public.zz_new select generate_series(1,7)`);
      try{
        const out=path.join(dir,'newtab');
        const d=await snapshotDump({conn,scope,outDir:out,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN});
        assert.equal(d.status,'ok',JSON.stringify(d));assert.equal(d.source.counts['public.zz_new'],7);
        assert.equal((await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN})).status,'ok');
      }finally{await db.exec(`drop table public.zz_new`);}
    });
    await failCase('dışa aktarma yetkisi geri alınmışsa → yetki aşamasında durur',
      `revoke execute on function private.nakgo_backup_auth_users() from ${role}`,
      r=>{assert.equal(r.stages.dump.status,'failed');assert.equal(r.stages.dump.code,'permissions',r.stages.dump.reason);assert.ok(r.stages.dump.reason.includes('nakgo_backup_auth_users'),r.stages.dump.reason);},
      `grant execute on function private.nakgo_backup_auth_users() to ${role}`);
    await failCase('başka rolün oluşturduğu tablo okunamıyorsa → yetki aşamasında durur (sessiz eksik yok)',
      `create table public.zz_foreign(id int); revoke select on public.zz_foreign from ${role}`,
      r=>{assert.equal(r.stages.dump.code,'permissions');assert.ok(r.stages.dump.reason.includes('public.zz_foreign'),r.stages.dump.reason);},
      `drop table public.zz_foreign`);
    await t.test('tek kullanımlık Auth belirteç sütunları yedeğe girmez; geri yükleme yine geçer',async()=>{
      await db.exec(`alter table auth.users add column recovery_token varchar(255), add column confirmation_token varchar(255);
        update auth.users set recovery_token='rt-secret-'||id, confirmation_token='ct-secret-'||id`);
      try{
        const out=path.join(dir,'tok');
        const d=await snapshotDump({conn,scope,outDir:out,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN});
        assert.equal(d.status,'ok',JSON.stringify(d));
        const text=fs.readFileSync(path.join(out,'B/auth.users.jsonl'),'utf8');
        assert.ok(!/rt-secret-|ct-secret-/.test(text),'belirteç değeri yok');
        assert.ok(text.split('\n').filter(Boolean).every(l=>{const j=JSON.parse(l);return j.recovery_token===''&&j.confirmation_token==='';}));
        assert.equal(d.source.counts['auth.users'],Number((await db.query('select count(*) n from auth.users')).rows[0].n));
        assert.equal((await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN})).status,'ok');
      }finally{await db.exec(`alter table auth.users drop column recovery_token, drop column confirmation_token`);}
    });
    await t.test('bozma: B veri dosyası değiştirilirse geri yükleme düşer',async()=>{
      const out=path.join(dir,'bmod');
      assert.equal((await snapshotDump({conn,scope,outDir:out,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN})).status,'ok');
      const f=path.join(out,'B/auth.users.jsonl');fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('\n').slice(1).join('\n'));
      const v=await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'failed');assert.ok(v.checks.some(c=>c.code==='restore_b'&&/bozuk/.test(c.detail)),JSON.stringify(v.checks));
    });
    await failCase('büyük nesne varsa (yedeğe girmez) → koruma aşamasında durur',
      `select lo_create(0)`,
      r=>{assert.equal(r.stages.dump.status,'failed');assert.equal(r.stages.dump.code,'guards');assert.match(r.stages.dump.reason,/büyük nesne/);},
      `select lo_unlink(oid) from pg_largeobject_metadata`);

    await t.test('ön kontrol başarısızsa hiçbir şey dökülmez',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid(),workRoot:dir,hooks:{preflight:async()=>({status:'failed',code:'stop_waivable',reason:'izin listesi dışı fonksiyon'})}});
      assert.equal(r.verified,false);assert.equal(r.stages.dump.status,'skipped');
      assert.deepEqual((await store.list('db/')),[]);
      assert.equal((await store.list('manifests/')).length,1,'başarısız çalışma da imzalı manifesto bırakır');
    });
    await t.test('ön kontrol tanımlı değilse fail-closed',async()=>{
      const r=await runBackup({...base,store:new MemoryStore(),runId:rid(),workRoot:dir,hooks:{}});
      assert.equal(r.stages.preflight.status,'failed');assert.equal(r.verified,false);
    });
    await t.test('alıcı listesi sabit değerle uyuşmazsa şifreleme ve yükleme yok',async()=>{
      const store=new MemoryStore();
      const r=await runBackup({...base,store,runId:rid(),workRoot:dir,pinnedRecipientsSha256:'0'.repeat(64)});
      assert.equal(r.stages.restore_test.status,'ok');assert.equal(r.stages.encryption.code,'recipients_mismatch');
      assert.equal(r.stages.upload.status,'skipped');assert.deepEqual(await store.list('db/'),[]);
    });
    await t.test('yükleme hatası: diğer aşamalar ok ama doğrulanmış değil',async()=>{
      const store=new MemoryStore();store.failNext.put=1;
      const r=await runBackup({...base,store,runId:rid(),workRoot:dir});
      assert.equal(r.stages.dump.status,'ok');assert.equal(r.stages.restore_test.status,'ok');assert.equal(r.stages.encryption.status,'ok');
      assert.equal(r.stages.upload.status,'failed');assert.equal(r.verified,false);assert.equal(r.manifest.verified,false);
    });
    await t.test('geri okunan nesne farklıysa yükleme başarısız',async()=>{
      const store=new MemoryStore();const orig=store.get.bind(store);store.get=async k=>{const b=await orig(k);if(b&&k.startsWith('db/'))b[0]^=1;return b;};
      const r=await runBackup({...base,store,runId:rid(),workRoot:dir});
      assert.equal(r.stages.upload.code,'roundtrip');assert.equal(r.verified,false);
    });
    await t.test('aynı adla nesne varsa üzerine yazılmaz (412)',async()=>{
      const store=new MemoryStore();const now=new Date('2026-11-17T02:17:00Z');
      const {objectKeys}=require('../../tools/backup/pipeline.cjs');
      await store.put(objectKeys('dup',now).data,Buffer.from('eski'));
      const r=await runBackup({...base,store,runId:'dup',now,workRoot:dir});
      assert.equal(r.stages.upload.code,'put_412');assert.equal((await store.get(objectKeys('dup',now).data)).toString(),'eski');
    });
    await t.test('yetim satır denetimi NOT VALID yabancı anahtarları da sayar',async()=>{
      await db.exec(`create table public.zz_child(user_id uuid); insert into public.zz_child values (gen_random_uuid());
        alter table public.zz_child add constraint zz_fk foreign key (user_id) references auth.users(id) not valid;`);
      try{const f=(await fkOrphans(db)).find(x=>x.constraint==='zz_fk');assert.equal(f.orphans,1);assert.equal(f.validated,false);}
      finally{await db.exec('drop table public.zz_child');}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([role]);fs.rmSync(dir,{recursive:true,force:true});}
});

test('nesne anahtarı: çalışma kimliği biçimi denetlenir',()=>{
  const {objectKeys}=require('../../tools/backup/pipeline.cjs');
  const now=new Date('2026-11-17T06:00:00Z');
  assert.equal(objectKeys('123-1',now).data,'db/2026/11/17/nakgo-20261117T060000Z-123-1.tar.age');
  for(const bad of ['../x','a/b','','a b','x'.repeat(65),'..',null])assert.throws(()=>objectKeys(bad,now),/çalışma kimliği/,String(bad));
});

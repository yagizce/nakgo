/** B7-B hazırlık testleri: test iş akışının ve gizlilerin kapsamı (statik), güvenlik kapıları, V1–V3 (yerel S3 taklidi),
 * #125 senaryo yalıtımı ve V4–V8 (yerel PostgreSQL). Hiçbir uzak sisteme bağlanmaz; canlı test DEĞİLDİR. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {realPg,migratedDb,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {openDb,STUB,assertTestRoles,snapshot}=require('../../tools/db-lib.cjs');
const G=require('../../tools/backup/b7b/guards.cjs');
const V=require('../../tools/backup/b7b/verify.cjs');
const RUN=require('../../tools/backup/b7b/run.cjs');
const {MemoryStore,S3Store}=require('../../tools/backup/store.cjs');
const s3mock=require('./s3-mock.cjs');
const root=path.resolve(__dirname,'../..');
const WF=path.join(root,'.github/workflows/b7b-test.yml');

test('test iş akışı: yalnız elle, yalnız test dalı ve test ortamı, yalnız test gizlileri',()=>{
  const y=fs.readFileSync(WF,'utf8');
  const on=/\non:\n([\s\S]*?)\npermissions:/.exec(y)[1];
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map(m=>m[1]),['workflow_dispatch'],'tek tetikleyici');
  assert.match(y,/\n    if: github\.ref == 'refs\/heads\/nakgo\/b7b-test' && github\.event_name == 'workflow_dispatch'\n/);
  assert.match(y,/\n    environment: backup-test\n/);
  assert.match(y,/\npermissions:\n  contents: read\nconcurrency:/,'yalnız okuma izni');
  const secrets=[...y.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(m=>m[1]);
  assert.ok(secrets.length>0);
  for(const s of secrets)assert.match(s,/^NAKGO_TEST_/,'yalnız test gizlisi: '+s);
  assert.ok(!/secrets:\s*inherit|toJSON\(secrets\)|secrets\[/.test(y),'gizlilerin toplu aktarımı yok');
  assert.ok(!/NAKGO_(DB|R2|ANCHOR|K1|K7)_/.test(y.replace(/NAKGO_TEST_/g,'')),'production gizli adı yok');
  for(const u of y.matchAll(/uses: (\S+)/g))assert.match(u[1],/@[0-9a-f]{40}$/,'eylem SHA ile sabit: '+u[1]);
  // run: blokları (devam satırları dahil) ifade içermez: girdiler yalnız env ile geçer (komut enjeksiyonu yok).
  const lines=y.split('\n');
  for(let i=0;i<lines.length;i++){
    const m=/^(\s+)(?:- )?run:(.*)$/.exec(lines[i]);if(!m)continue;
    const block=[m[2]];for(let j=i+1;j<lines.length&&(lines[j].trim()===''||lines[j].search(/\S/)>m[1].length);j++)block.push(lines[j]);
    assert.ok(!/\$\{\{/.test(block.join('\n')),'run bloğunda ifade yok: '+lines[i].trim());
  }
  // Diğer iş akışları test gizlilerini ve test ortamını kullanmaz; bu iş akışı başka iş akışını tetiklemez.
  for(const f of fs.readdirSync(path.join(root,'.github/workflows')).filter(f=>f!=='b7b-test.yml')){
    const o=fs.readFileSync(path.join(root,'.github/workflows',f),'utf8');
    assert.ok(!/NAKGO_TEST_|backup-test/.test(o),f+' test gizlisi/ortamı kullanmamalı');
  }
});

test('güvenlik kapıları: bağlam, Supabase hedefi, R2 hedefi',()=>{
  const ok={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/nakgo/b7b-test',NAKGO_TEST_ENVIRONMENT:'backup-test',NAKGO_TEST_SUITE:'r2'};
  assert.deepEqual(G.checkRunContext(ok),[]);
  for(const [k,v] of [['GITHUB_EVENT_NAME','push'],['GITHUB_EVENT_NAME','pull_request'],['GITHUB_REF','refs/heads/main'],['GITHUB_REF','refs/heads/nakgo/altyapi'],
    ['NAKGO_TEST_ENVIRONMENT','backup-production'],['NAKGO_TEST_SUITE','hepsi']])assert.ok(G.checkRunContext({...ok,[k]:v}).length,k+'='+v);
  const t={ref:'abcdefghijklmnopqrst',host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,adminUser:'postgres.abcdefghijklmnopqrst',rootCertFile:'/x'};
  assert.deepEqual(G.checkSupabaseTarget(t),[]);
  assert.deepEqual([...G.FORBIDDEN_PROJECT_REFS].sort(),['axkotffqrsddbrazhcwj','fimlifldsivecezbxwuo'],'AGENTS.md: DEV ve Production');
  for(const ref of G.FORBIDDEN_PROJECT_REFS){
    // Kimliğin kendisi yasaksa (adres ve kullanıcı kimlikle tutarlı olsa bile) reddedilir.
    assert.ok(G.checkSupabaseTarget({...t,ref,adminUser:'postgres.'+ref}).includes('production/DEV projesine bağlanılamaz'),ref);
    // Kimlik test projesini gösterse de adres ya da kullanıcı yasak projeyi gösterirse reddedilir.
    assert.ok(G.checkSupabaseTarget({...t,host:`aws-0-eu-central-1.pooler.supabase.com.${ref}`}).includes('bağlantı bilgisi production/DEV projesini gösteriyor'),'adres: '+ref);
  }
  assert.ok(G.checkSupabaseTarget({...t,host:'db.abcdefghijklmnopqrst.supabase.co'}).length,'doğrudan adres değil havuz');
  assert.ok(G.checkSupabaseTarget({...t,port:6543}).length,'işlem modu reddedilir');
  assert.ok(G.checkSupabaseTarget({...t,adminUser:'postgres.zzzzzzzzzzzzzzzzzzzz'}).length,'kullanıcı ile proje tutarlı');
  assert.ok(G.checkSupabaseTarget({...t,ref:''}).length);
  const e='https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com';
  assert.deepEqual(G.checkR2Target({endpoint:e,bucket:'nakgo-backup-test'}),[]);
  assert.ok(G.checkR2Target({endpoint:e,bucket:'nakgo-backup'}).length,'adında test yoksa reddedilir');
  assert.ok(G.checkR2Target({endpoint:'http://127.0.0.1:9000',bucket:'nakgo-backup-test'}).length);
});

test('V7 (g) danışma kilidi yorumu',()=>{
  const ok={blocked_code:'55P03',terminate:true,app_after_terminate:'alındı'};
  assert.equal(V.advisoryVerdict(ok),null);
  assert.match(V.advisoryVerdict({...ok,blocked_code:null}),/beklemedi/);
  assert.match(V.advisoryVerdict({...ok,terminate:'42501'}),/sonlandıramadı/);
  assert.match(V.advisoryVerdict({...ok,app_after_terminate:'55P03'}),/alınamadı/);
});

test('V1–V3 yerel S3 taklidinde (gerçek R2 kanıtı DEĞİL)',async()=>{
  const lockStore=new MemoryStore({lockDays:1,lockPrefixes:['db/']});
  const mock=await s3mock.start({accessKeyId:'AKTEST',secretAccessKey:'secret-test-only',bucket:'b',store:lockStore});
  try{
    const s=new S3Store({endpoint:mock.endpoint,bucket:'b',accessKeyId:'AKTEST',secretAccessKey:'secret-test-only'});
    const out=await RUN.suiteR2({store:s,prefix:'b7b-test/1-1/'});
    assert.deepEqual(out.map(x=>[x.code,x.status]),[['V1','pass'],['V2','pass'],['V3','pass']],JSON.stringify(out));
  }finally{await mock.close();}
  // Bozma: koşullu yazmayı yok sayan depo V1'de, kilitsiz depo V3'te kalır.
  const noCond=new MemoryStore();const put=noCond.put.bind(noCond);noCond.put=(k,b)=>put(k,b);
  assert.equal((await V.v1(noCond,{prefix:'x/',n:3})).status,'fail');
  assert.equal((await V.v3(new MemoryStore(),{lockedPrefix:'db/x/',openPrefix:'tmp/x/'})).status,'fail');
  const stale=new MemoryStore();const get=stale.get.bind(stale);let first=true;stale.get=async k=>{if(first){first=false;return null;}return get(k);};
  assert.equal((await V.v2(stale,{prefix:'x/',n:3})).status,'fail');
});

test('#125 senaryo yalıtımı ve V4–V8 (yerel PostgreSQL)',async t=>{
  if(!realPg()){t.skip('çoklu oturum ve pg_dump gerekir; PG16/PG17 ile çalışır');return;}
  const role=uniqueRole('nakgo_backup_b');let primary=null;
  const db=await openDb();
  const ref=await migratedDb();
  try{
    await db.exec(STUB);await assertTestRoles(db);
    await t.test('migration uygulayıcı: depo migration\'ları build() ile aynı şemayı kurar, ikinci çağrı bir şey yapmaz',async()=>{
      const applied=await V.applyMigrations(db);
      assert.equal(applied.length,fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length);
      assert.deepEqual(await snapshot(db),await snapshot(ref));
      assert.deepEqual(await V.applyMigrations(db),[]);
      await assert.rejects(V.applyMigrations(db,{list:[{name:applied[0],sql:'select 1'}]}),/değişmiş/);
    });
    await t.test('senaryo base: #125 nesnesi yok',async()=>{
      const s=await V.prepareScenario(db,'base');
      assert.equal(s.status,'pass',JSON.stringify(s));assert.equal(await V.scenarioOf(db),'base');
    });
    const pw='test-only-'+role;
    const {Client}=require('pg');
    const backupClient=async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password:pw,database:db.name});await c.connect();c.on('error',()=>{});return c;};
    await t.test('V4–V7 temel senaryoda geçer (V7 danışma kilidi ölçümü dahil)',async()=>{
      await db.query(`insert into auth.users(id,email) values (gen_random_uuid(),'b7b@example.invalid')`);
      const x4=await V.v4(db,{role,password:pw});assert.equal(x4.status,'pass',JSON.stringify(x4));
      const b=await backupClient();
      try{
        const x5=await V.v5(db,b,{role});assert.equal(x5.status,'pass',JSON.stringify(x5));
        assert.equal(x5.detail.reads['auth.sessions'],'42501');assert.equal(x5.detail.users_with_token_values,0);
        const x6=await V.v6(b,{role});assert.equal(x6.status,'pass',JSON.stringify(x6));
        const x7=await V.v7(db,b,{role});assert.ok(['pass','review'].includes(x7.status),JSON.stringify(x7));
        assert.equal(x7.detail.a_lo_create_default,'25006');assert.equal(x7.detail.b_temp_default,'25006');
        assert.deepEqual(x7.detail.c_lo_after_override,{created:true,guard_sees:true,cleaned:true});
        assert.deepEqual(x7.detail.d_network_callable,[]);
        assert.equal(x7.detail.g_advisory.app_blocked,true,'uygulama kilidi 2 sn içinde alamaz');
        assert.equal(x7.detail.g_advisory.terminate,true);assert.equal(x7.detail.g_advisory.app_after_terminate,'alındı');
        await assert.rejects(b.query('select 1'),'yedek oturumu sonlandırıldı');
      }finally{await b.end().catch(()=>{});}
    });
    await t.test('V7 bozma: belgede olmayan yan yol ve ağ fonksiyonu yakalanır',async()=>{
      await db.exec(`create schema net; create function net.http_post(u text) returns bigint language sql as 'select 1'; grant usage on schema net to ${role}`);
      const b=await backupClient();
      try{const x=await V.v7(db,b,{role});assert.equal(x.status,'stop');assert.deepEqual(x.detail.d_network_callable,['net.http_post']);}
      finally{await b.end().catch(()=>{});await db.exec('drop schema net cascade');}
    });
    await t.test('V5 bozma: oturum tablosu okunabilirse kalır',async()=>{
      await db.exec(`grant usage on schema auth to ${role}; grant select on auth.sessions to ${role}`);
      const b=await backupClient();
      try{const x=await V.v5(db,b,{role});assert.equal(x.status,'fail');assert.equal(x.detail.reads['auth.sessions'],'OKUNDU');assert.ok(x.detail.reasons.includes('direct_read'),JSON.stringify(x.detail.reasons));}
      finally{await b.end().catch(()=>{});await db.exec(`revoke select on auth.sessions from ${role}; revoke usage on schema auth from ${role}`);}
    });
    const ageMissing=()=>{try{execFileSync('which',['age-keygen'],{stdio:'ignore'});return false;}catch{return true;}};
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password:pw,database:db.name};
    const {toolMajor}=require('../../tools/backup/dump.cjs');
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    const v8Skip=ageMissing()?'age yok':(!tool||tool<major)?`pg_dump ${tool} sunucudan (${major}) eski`:null;
    await t.test('V8 temel senaryo: geçici anahtarlarla uçtan uca doğrulanmış yedek',async t2=>{
      if(v8Skip){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(v8Skip);t2.skip(v8Skip);return;}
      const store=new MemoryStore({lockDays:1,lockPrefixes:['db/']});
      const x=await RUN.v8({conn,store,anchorStore:new MemoryStore(),pgBin:process.env.NAKGO_PG_BIN,expectLegal:false,allowLocal:true,runId:'b7b-1'});
      assert.equal(x.status,'pass',JSON.stringify(x));
      assert.equal(fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith('nakgo-b7b-keys-')).length,0,'geçici anahtar klasörü silindi');
      const r=RUN.v8ConnectionRules({host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,sslmode:'verify-full',sslrootcert:'/yok'});
      assert.deepEqual(r,{port_6543_rejected:true,sslmode_require_rejected:true});
    });
    await t.test('senaryo legal125: sabitlenmiş #125 kopyası ayrı uygulanır; geri dönüş yok',async()=>{
      const s=await V.prepareScenario(db,'legal125');
      assert.equal(s.status,'pass',JSON.stringify(s));assert.deepEqual(s.detail.applied,[V.LEGAL125.name]);
      assert.equal(await V.scenarioOf(db),'legal125');
      assert.equal((await V.prepareScenario(db,'base')).status,'stop','legal125 sonrası temel senaryo bu projede koşulamaz');
      const b=await backupClient();
      try{
        assert.equal((await V.v5(db,b,{role})).status,'pass');
        const x6=await V.v6(b,{role});assert.equal(x6.status,'pass',JSON.stringify(x6));
      }finally{await b.end().catch(()=>{});}
    });
    await t.test('V8 legal125 senaryosu: yasal tablolar beklenir',async t2=>{
      if(v8Skip){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(v8Skip);t2.skip(v8Skip);return;}
      const x=await RUN.v8({conn,store:new MemoryStore({lockDays:1,lockPrefixes:['db/']}),anchorStore:new MemoryStore(),pgBin:process.env.NAKGO_PG_BIN,expectLegal:true,allowLocal:true,runId:'b7b-2'});
      assert.equal(x.status,'pass',JSON.stringify(x));
    });
    await t.test('#125 kopyası değişirse senaryo durur',async()=>{
      const orig=V.LEGAL125.sha256;V.LEGAL125.sha256='0'.repeat(64);
      try{assert.equal((await V.prepareScenario(db,'legal125')).status,'stop');}finally{V.LEGAL125.sha256=orig;}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(ref,null).catch(()=>{});await finish(db,primary);await dropRoles([role]);}
});

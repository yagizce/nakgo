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

test('test iş akışı: yalnız test dalına push, onaylı test ortamı, takıma göre gizliler, sabit bağımlılıklar',()=>{
  const y=fs.readFileSync(WF,'utf8');
  const on=/\non:\n([\s\S]*?)\npermissions:/.exec(y)[1];
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map(m=>m[1]),['push'],'tek tetikleyici: push');
  assert.match(on,/^    branches: \[nakgo\/b7b-test\]$/m,'yalnız test dalı');
  assert.ok(!/workflow_dispatch|pull_request|schedule|workflow_run|repository_dispatch/.test(on));
  assert.match(y,/\npermissions:\n  contents: read\nconcurrency:/,'yalnız okuma izni');
  // İşleri ayır: "select" gizli ve ortam kullanmaz; test işleri yalnız backup-test ortamında ve takıma göre.
  const jobs={};for(const m of y.split('\njobs:\n')[1].matchAll(/^  ([a-z0-9_-]+):\n([\s\S]*?)(?=^  [a-z0-9_-]+:\n|(?![\s\S]))/gm))jobs[m[1]]=m[2];
  assert.deepEqual(Object.keys(jobs),['select','r2','supabase']);
  assert.match(jobs.select,/if: github\.ref == 'refs\/heads\/nakgo\/b7b-test' && github\.event_name == 'push'/);
  assert.ok(!/secrets\.|environment:/.test(jobs.select),'seçim işinde gizli ve ortam yok');
  const sec=t=>[...new Set([...t.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(m=>m[1]))].sort();
  for(const j of ['r2','supabase']){
    assert.match(jobs[j],/\n    needs: select\n/);assert.match(jobs[j],/\n    environment: backup-test\n/);
    for(const k of sec(jobs[j]))assert.match(k,/^NAKGO_TEST_/,'yalnız test gizlisi: '+k);
  }
  assert.match(jobs.r2,/if: needs\.select\.outputs\.suite == 'r2'/);
  assert.deepEqual(sec(jobs.r2),['NAKGO_TEST_R2_ACCESS_KEY_ID','NAKGO_TEST_R2_BUCKET','NAKGO_TEST_R2_ENDPOINT','NAKGO_TEST_R2_SECRET_ACCESS_KEY'],'R2 işinde yalnız R2 gizlileri');
  assert.ok(sec(jobs.supabase).includes('NAKGO_TEST_DB_ADMIN_PASSWORD'));
  assert.ok(!/secrets:\s*inherit|toJSON\(secrets\)|secrets\[/.test(y),'gizlilerin toplu aktarımı yok');
  assert.ok(!/NAKGO_(DB|R2|ANCHOR|K1|K7)_/.test(y.replace(/NAKGO_TEST_/g,'')),'production gizli adı yok');
  for(const u of y.matchAll(/uses: (\S+)/g))assert.match(u[1],/@[0-9a-f]{40}$/,'eylem SHA ile sabit: '+u[1]);
  // Tedarik zinciri: servis imajı özetle, PostgreSQL istemcisi tam sürümle (imzalı depodan), Node tam sürümle, age sha256 ile.
  const images=[...y.matchAll(/^\s+image: (\S+)$/gm)].map(m=>m[1]);
  assert.deepEqual(images,['postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac']);
  assert.ok(!/(container|image):\s*[a-z0-9./-]+:[^@\s]+\s*$/m.test(y),'etiketle imaj yok');
  assert.match(y,/apt-get install -y -qq --no-install-recommends postgresql-client-17=17\.12-1\.pgdg24\.04\+1\n/);
  assert.match(y,/test "\$\(dpkg-query -W -f='\$\{Version\}' postgresql-client-17\)" = 17\.12-1\.pgdg24\.04\+1/);
  assert.match(y,/deb \[signed-by=\/usr\/share\/postgresql-common\/pgdg\/apt\.postgresql\.org\.asc\] https:\/\/apt\.postgresql\.org\/pub\/repos\/apt noble-pgdg main 17"/);
  assert.match(y,/= "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"/,'PGDG anahtar parmak izi');
  assert.ok(!/trusted=yes|allow-unauthenticated|AllowUnauthenticated/i.test(y),'imza doğrulaması kapatılmamış');
  assert.ok(!/apt-get install[^\n]*postgresql-client-17(\s|$)/.test(y),'sürümsüz istemci kurulumu yok');
  const nodes=[...y.matchAll(/node-version: '([^']+)'/g)].map(m=>m[1]);
  assert.ok(nodes.length===2&&nodes.every(v=>/^\d+\.\d+\.\d+$/.test(v)),'Node tam sürüm: '+nodes);
  assert.match(y,/7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50  \$RUNNER_TEMP\/age\.tgz" \| sha256sum --check/);
  for(const c of y.matchAll(/curl [^\n]*(https?:\/\/\S+)/g))assert.match(c[1],/^https:\/\//,'yalnız https: '+c[1]);
  // run: blokları (devam satırları dahil) ifade içermez: girdiler yalnız env ile geçer (komut enjeksiyonu yok).
  const lines=y.split('\n');
  for(let i=0;i<lines.length;i++){
    const m=/^(\s+)(?:- )?run:(.*)$/.exec(lines[i]);if(!m)continue;
    const block=[m[2]];for(let k=i+1;k<lines.length&&(lines[k].trim()===''||lines[k].search(/\S/)>m[1].length);k++)block.push(lines[k]);
    assert.ok(!/\$\{\{/.test(block.join('\n')),'run bloğunda ifade yok: '+lines[i].trim());
  }
  // Bağımlılıklar yalnız kilit dosyasından (bütünlük özetiyle) npm ci ile kurulur.
  assert.ok(!/npm install/.test(y),'npm install yok');
  assert.equal((y.match(/npm ci --prefix ops\/backup\/ci --ignore-scripts/g)||[]).length,2);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'ops/backup/ci/package.json'),'utf8'));
  assert.deepEqual(pkg.dependencies,{pg:'8.23.1'},'tam sürüm');
  const lock=JSON.parse(fs.readFileSync(path.join(root,'ops/backup/ci/package-lock.json'),'utf8'));
  const pk=Object.entries(lock.packages).filter(([k])=>k);
  assert.ok(pk.length>=10);
  for(const [k,v] of pk){assert.match(v.integrity||'',/^sha512-/,'bütünlük özeti: '+k);assert.match(v.resolved||'',/^https:\/\/registry\.npmjs\.org\//,'kaynak: '+k);}
  assert.equal(lock.packages['node_modules/pg'].version,'8.23.1');
  // Takım seçimi: varsayılan "none" (bu dal birleşse de hiçbir test işi başlamaz).
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'ops/backup/b7b-suite.json'),'utf8')).suite,'none');
  for(const f of fs.readdirSync(path.join(root,'.github/workflows')).filter(f=>f!=='b7b-test.yml')){
    const o=fs.readFileSync(path.join(root,'.github/workflows',f),'utf8');
    assert.ok(!/NAKGO_TEST_|backup-test/.test(o),f+' test gizlisi/ortamı kullanmamalı');
  }
});

test('gizliler ortamdan alınır ve silinir; üretilen parola maskelenir',()=>{
  const env={NAKGO_TEST_SUITE:'r2',NAKGO_TEST_ENVIRONMENT:'backup-test',NAKGO_TEST_R2_SECRET_ACCESS_KEY:'s3cr3t-value',NAKGO_TEST_DB_ADMIN_PASSWORD:'pw-value-123',PATH:'/bin'};
  const got=RUN.takeSecrets(env);
  assert.deepEqual(Object.keys(got).sort(),['NAKGO_TEST_DB_ADMIN_PASSWORD','NAKGO_TEST_R2_SECRET_ACCESS_KEY']);
  assert.deepEqual(Object.keys(env).sort(),['NAKGO_TEST_ENVIRONMENT','NAKGO_TEST_SUITE','PATH'],'alt süreçlere geçmez');
  let out='';RUN.mask('abcdef0123456789',s=>{out+=s;});
  assert.equal(out,'::add-mask::abcdef0123456789\n');
  assert.throws(()=>RUN.mask('',()=>{}));
});

test('güvenlik kapıları: bağlam, Supabase hedefi, R2 hedefi',()=>{
  const ok={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/nakgo/b7b-test',NAKGO_TEST_ENVIRONMENT:'backup-test',NAKGO_TEST_SUITE:'r2'};
  assert.deepEqual(G.checkRunContext(ok),[]);
  assert.ok(G.checkRunContext({...ok,NAKGO_TEST_DB_ADMIN_PASSWORD:'x'}).some(p=>/veritabanı gizlisi/.test(p)),'R2 takımında DB gizlisi reddedilir');
  assert.deepEqual(G.checkRunContext({...ok,NAKGO_TEST_SUITE:'supabase-base',NAKGO_TEST_DB_ADMIN_PASSWORD:'x'}),[]);
  for(const [k,v] of [['GITHUB_EVENT_NAME','workflow_dispatch'],['GITHUB_EVENT_NAME','pull_request'],['GITHUB_REF','refs/heads/main'],['GITHUB_REF','refs/heads/nakgo/altyapi'],
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
  assert.deepEqual(G.checkR2Target({endpoint:'https://'+'b'.repeat(32)+'.eu.r2.cloudflarestorage.com',bucket:'nakgo-backup-test'}),[],'AB yargı bölgesi');
  for(const bad of ['https://'+'b'.repeat(32)+'.fedramp.r2.cloudflarestorage.com','https://'+'b'.repeat(32)+'.r2.cloudflarestorage.com.evil.example','https://x.eu.r2.cloudflarestorage.com'])
    assert.ok(G.checkR2Target({endpoint:bad,bucket:'nakgo-backup-test'}).length,bad);
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
    assert.deepEqual(out.map(x=>[x.code,x.status]),[['R2-scope','pass'],['V1','pass'],['V2','pass'],['V3','pass']],JSON.stringify(out));
  }finally{await mock.close();}
  // Bozma: hesap düzeyinde kova listeleyebilen belirteç kapsam denetiminde kalır ve V1'e geçilmez.
  const wide=await s3mock.start({accessKeyId:'AKTEST',secretAccessKey:'secret-test-only',bucket:'b',allowListBuckets:true});
  try{
    const s=new S3Store({endpoint:wide.endpoint,bucket:'b',accessKeyId:'AKTEST',secretAccessKey:'secret-test-only'});
    assert.deepEqual((await RUN.suiteR2({store:s,prefix:'p/'})).map(x=>[x.code,x.status]),[['R2-scope','fail']]);
  }finally{await wide.close();}
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
    // #125 depoya girdiyse depo kurulumu #125'i içerir: temel senaryo durur, aynı akış legal125 senaryosunda koşar.
    const IN_REPO=V.legalInRepo(),S=IN_REPO?'legal125':'base';
    await t.test('senaryo base: #125 nesnesi yok',async()=>{
      if(IN_REPO){
        const b=await V.prepareScenario(db,'base');assert.equal(b.status,'stop',JSON.stringify(b));assert.match(b.detail,/temel senaryo artık yok/);
        const s=await V.prepareScenario(db,'legal125');assert.equal(s.status,'pass',JSON.stringify(s));assert.deepEqual(s.detail.applied,[]);
        assert.equal(await V.scenarioOf(db),'legal125');return;
      }
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
    await t.test('V7(c) büyük nesnesi ölçüm hata verse de silinir (yedek oturumu silemezse yönetici siler)',async()=>{
      const b=await backupClient();
      const flaky={on:()=>{},query:(sql,a)=>/pg_largeobject_metadata|lo_unlink/.test(sql)?Promise.reject(Object.assign(Error('ölçüm hatası'),{code:'XX000'})):b.query(sql,a)};
      try{
        await assert.rejects(V.v7(db,flaky,{role}),/ölçüm hatası/);
        assert.equal(Number((await db.query(`select count(*) n from pg_largeobject_metadata`)).rows[0].n),0,'büyük nesne kalmadı');
      }finally{await b.end().catch(()=>{});}
    });
    await t.test('rol temizliği: hata durumunda da rol ve sahip olduğu büyük nesne silinir',async()=>{
      const r2=uniqueRole('nakgo_backup_c');
      const out=await RUN.suiteSupabase({scenario:S,admin:db,role:r2,maskImpl:()=>{},
        connectBackup:async()=>{throw Error('bağlantı kurulamadı');},conn:{},store:new MemoryStore(),anchorStore:new MemoryStore(),runId:'c-1'});
      assert.deepEqual(out.map(x=>[x.code,x.status]),[['scenario','pass'],['V4','pass'],['exception','fail'],['cleanup','pass']],JSON.stringify(out));
      assert.equal((await db.query(`select count(*)::int n from pg_roles where rolname=$1`,[r2])).rows[0].n,0,'rol silindi');
      // Rol, sahip olduğu bir büyük nesneyle kalmışsa da: DROP OWNED onu da kaldırır.
      await db.exec(`create role ${r2} login; set role ${r2}; select lo_create(0); reset role;`);
      const c=await V.cleanupRole(db,{role:r2});
      assert.equal(c.status,'pass');assert.equal(c.detail.large_objects_owned_before,1);
      assert.equal(Number((await db.query(`select count(*) n from pg_largeobject_metadata`)).rows[0].n),0);
      assert.equal((await V.cleanupRole(db,{role:r2})).detail.role_present,false,'yoksa da sorunsuz');
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
      const x=await RUN.v8({conn,store,anchorStore:new MemoryStore(),pgBin:process.env.NAKGO_PG_BIN,expectLegal:IN_REPO,allowLocal:true,runId:'b7b-1'});
      assert.equal(x.status,'pass',JSON.stringify(x));
      assert.equal(fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith('nakgo-b7b-keys-')).length,0,'geçici anahtar klasörü silindi');
      const r=RUN.v8ConnectionRules({host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,sslmode:'verify-full',sslrootcert:'/yok'});
      assert.deepEqual(r,{port_6543_rejected:true,sslmode_require_rejected:true});
    });
    await t.test('temel takım uçtan uca (V4–V8) ve sonda rol silinir',async t2=>{
      if(v8Skip){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(v8Skip);t2.skip(v8Skip);return;}
      // Aynı veritabanında başka bir yedek rolü EXECUTE taşırsa V6 bunu (doğru olarak) yakalar: önce önceki test rolü kaldırılır.
      assert.equal((await V.cleanupRole(db,{role})).status,'pass');
      const r3=uniqueRole('nakgo_backup_s');let masked=null;
      const {Client}=require('pg');
      const out=await RUN.suiteSupabase({scenario:S,admin:db,role:r3,maskImpl:v=>{masked=v;},allowLocal:true,runId:'s-1',
        connectBackup:async pw=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:r3,password:pw,database:db.name});await c.connect();c.on('error',()=>{});return c;},
        conn:{host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:r3,database:db.name},
        store:new MemoryStore({lockDays:1,lockPrefixes:['db/']}),anchorStore:new MemoryStore(),pgBin:process.env.NAKGO_PG_BIN});
      assert.deepEqual(out.map(x=>x.code),['scenario','V4','V5','V6','V7','V8','cleanup'],JSON.stringify(out));
      assert.ok(out.every(x=>['pass','review'].includes(x.status)),JSON.stringify(out.filter(x=>!['pass','review'].includes(x.status))));
      assert.match(masked,/^[0-9a-f]{48}$/,'üretilen parola maskelendi');
      assert.ok(!JSON.stringify(out).includes(masked),'sonuçta parola yok');
      assert.equal((await db.query(`select count(*)::int n from pg_roles where rolname=$1`,[r3])).rows[0].n,0,'rol silindi');
      assert.equal((await V.v4(db,{role,password:pw})).status,'pass','sonraki testler için rol yeniden kuruldu');
    });
    await t.test('senaryo legal125: sabitlenmiş #125 kopyası ayrı uygulanır; geri dönüş yok',async()=>{
      const s=await V.prepareScenario(db,'legal125');
      assert.equal(s.status,'pass',JSON.stringify(s));assert.deepEqual(s.detail.applied,IN_REPO?[]:[V.LEGAL125.name]);
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

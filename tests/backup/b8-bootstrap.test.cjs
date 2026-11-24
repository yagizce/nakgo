/** B8 testleri: ilk Production yedeği (bootstrap), kapsam denetimi, yönetim verisi (cron, migration geçmişi), uçtan uca
 * şifreli yedek → indirme ve doğrulama → çözme → boş veritabanına geri yükleme ve bekleyen migration provası.
 *
 * Kaynak, Production'ın bugünkü biçimindedir: yalnız ilk 32 migration (son: 20261115184145) ve Supabase taklidi
 * (Auth tabloları ayrı role ait ve RLS'li, auth.instances, Vault, Storage sürüm tablosu, pg_cron'un cron.job tablosu,
 * supabase_migrations geçmişi). Bootstrap rolü Supabase'in postgres rolü gibi süper kullanıcı değildir, BYPASSRLS'lidir.
 * Hiçbir uzak sisteme bağlanmaz. Gerçek PostgreSQL ve sunucuyla aynı ana sürümde pg_dump gerekir (CI: PG17). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const {realPg,migratedDb,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {seed}=require('./fixtures.cjs');
const {openDb,build,migrations,FULL_SNAPSHOT_SQL}=require('../../tools/db-lib.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {snapshotDump,toolMajor,dumpEnv,PG_DUMP_TRANSACTION,clientConfig,newClient,enforceReadOnly}=require('../../tools/backup/dump.cjs');
const RO_SOURCE={s1_transaction:true,s1_default:true,s1_explicit_set:true,pg_dump_transaction:'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'};
const {restoreAndVerify}=require('../../tools/backup/restore-verify.cjs');
const SE=require('../../tools/backup/scope-export.cjs');
const RM=require('../../tools/backup/restore-meta.cjs');
const {rehearsalHook}=require('../../tools/backup/migration-rehearsal.cjs');
const {runBootstrap}=require('../../tools/backup/bootstrap.cjs');
const MF=require('../../tools/backup/manual-flow.cjs');
const SJ=require('../../tools/backup/strict-json.cjs');
const {FileStore}=require('../../tools/backup/store.cjs');
const E=require('../../tools/backup/encrypt.cjs');
const A=require('../../tools/backup/abort.cjs');
const C=require('../../tools/backup/crypto.cjs');
const DR=require('../../tools/backup/dr-fetch.cjs');
const {verifyManifest}=require('../../tools/backup/manifest.cjs');

const root=path.resolve(__dirname,'../..');
const PROD_APPLIED='20261115184145';
const hasBin=b=>{try{execFileSync('which',[b],{stdio:'ignore'});return true;}catch{return false;}};
const ageMissing=()=>{if(hasBin('age')&&hasBin('age-keygen'))return null;if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error('age gerekli ama yok');return 'age kurulu değil';};
/** Testin kendi benzersiz geçici klasörü. Kayıt altında tutulur: süreç beklenmedik biçimde biterse (yakalanmamış hata,
 * process.exit) 'exit' anında yalnız BU kayıttaki klasörler silinir; silinemeyen bildirilir. */
const OWN_TMP=new Set();
const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-b8-'));OWN_TMP.add(d);return d;};
process.on('exit',()=>{for(const d of OWN_TMP){if(!fs.existsSync(d))continue;try{fs.rmSync(d,{recursive:true,force:true});}catch(e){process.stderr.write('geçici klasör silinemedi: '+d+': '+e.message+'\n');}}});
/** Geçici klasörle çalıştır: başarı, hata ve assertion hatası dahil her yolda silinir. Silme hatası yutulmaz: test hatasıyla
 * birlikte AggregateError, yalnız başına ise kendisi fırlatılır; klasör hâlâ duruyorsa bu da hatadır. */
async function withTmpDir(fn){
  const d=tmp();let primary=null;
  try{return await fn(d);}
  catch(e){primary=e;throw e;}
  finally{
    let cleanup=null;
    try{fs.rmSync(d,{recursive:true,force:true});if(fs.existsSync(d))throw Error('geçici klasör silinemedi: '+d);OWN_TMP.delete(d);}catch(e){cleanup=e;}
    if(cleanup){if(primary)throw new AggregateError([primary,cleanup],'test hatası ve geçici klasör temizliği hatası');throw cleanup;}
  }
}
const FAKE_CERT='-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n';
const exitCodeOfOk=r=>require('../../tools/backup/bootstrap.cjs').exitCodeOf(r);
/** K9 akışının yapılandırma alanları (test anahtarı ve sentetik çapa hash'i); K1/K2 olduğu gibi. */
const withK9=cfg=>{const k9=C.testKeyPair();const a=require('node:crypto').randomBytes(32).toString('hex');
  return {...cfg,trusted_k9:{[k9.keyId]:k9.publicKey},active_k9:k9.keyId,trusted_anchors:{[a]:{created_at:'2026-11-22T10:00:00.000Z'}},active_anchor_sha256:a};};
const qn=t=>t.split('.').map(s=>'"'+s+'"').join('.');

const {SUPABASE_EMULATION,PG_CRON_API,PROD_JOBS,PROD_AUX_TABLES,LIFECYCLE_DDL,bootRoleSql,prodShaped}=require('./prod-fixture.cjs');

/* --- Veritabanı gerektirmeyen birimler --- */
test('kapsam: listeler ayrık, her meta ve kapsam tablosu tek sınıfta; doğrudan sorgular fonksiyon gövdeleriyle aynı',()=>{
  const scope=BR.loadScope();
  const groups={tables:scope.tables.map(t=>t.name),transient:scope.excluded.transient,known_loss:scope.excluded.known_loss,guard:scope.excluded.guard_stop_if_rows,
    pending:scope.excluded.guard_stop_if_rows_pending,managed:scope.excluded.managed,zero:scope.guard_exact_zero,meta:scope.meta.map(m=>m.name)};
  const seen=new Map();
  for(const [g,list] of Object.entries(groups))for(const t of list){
    if(g==='zero'&&groups.tables.includes(t))continue;// storage.objects: kapsamda ve boş olmalı
    assert.ok(!seen.has(t),`${t} hem ${seen.get(t)} hem ${g}`);seen.set(t,g);
  }
  assert.ok(scope.excluded.guard_stop_if_rows_pending.includes('auth.instances'));
  assert.ok(scope.meta.every(m=>!m.export),'B7 için meta dışa aktarma fonksiyonu yok (ayrı iş)');
  assert.deepEqual(scope.coverage_schemas,['auth','storage','vault']);
  for(const m of scope.meta)assert.ok(SE.DIRECT_SQL[m.name],'doğrudan sorgu: '+m.name);
  for(const t of scope.tables)assert.ok(SE.DIRECT_SQL[t.name],'doğrudan sorgu: '+t.name);
  // Sayım fonksiyonunun listesi = çekirdek liste (a1 testi de denetler); bekleyenler fonksiyonda yok, bootstrap doğrudan sayar.
  const src=fs.readFileSync(path.join(root,'supabase/migrations/20261118000000_backup_export.sql'),'utf8');
  const fn=/create function private\.nakgo_backup_guard_counts\(\)[\s\S]*?end \$\$;/.exec(src)[0];
  const inFn=[...new Set([...fn.matchAll(/to_regclass\('([a-z0-9_.]+)'\)/g)].map(m=>m[1]))].sort();
  assert.deepEqual(inFn,[...SE.coreGuardList(scope)].sort());
  for(const t of scope.excluded.guard_stop_if_rows_pending)assert.ok(!inFn.includes(t)&&SE.guardList(scope).includes(t),t);
  // Kapsam tablolarının doğrudan sorguları fonksiyonların "return query" gövdeleriyle birebir aynı (boşluk farkı hariç).
  const all=src.replace(/\s+/g,'');
  for(const t of scope.tables)assert.ok(all.includes('returnquery'+SE.DIRECT_SQL[t.name].replace(/\s+/g,'')+';'),t.name+' sorgusu fonksiyon gövdesiyle aynı');
});

test('FileStore: üzerine yazmaz (412), geçersiz anahtar reddedilir, silmez, liste önekle',async()=>{
  const dir=tmp();
  try{
    const s=new FileStore({dir});
    assert.equal((await s.put('manual/db/a.age',Buffer.from('x'),{ifNoneMatch:true})).ok,true);
    assert.equal((await s.put('manual/db/a.age',Buffer.from('y'),{ifNoneMatch:true})).status,412);
    assert.equal((await s.get('manual/db/a.age')).toString(),'x');
    assert.equal((fs.statSync(path.join(dir,'manual/db/a.age')).mode&0o777),0o600);
    for(const bad of ['../x','/abs','a//b','a/../b','',null])await assert.rejects(s.put(bad,Buffer.from('z')),/geçersiz anahtar/,String(bad));
    assert.deepEqual((await s.list('manual/')).map(o=>o.key),['manual/db/a.age']);
    assert.equal((await s.delete('manual/db/a.age')).ok,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

/** Yerel PostgreSQL vekili: başlangıç paketinden verilen parametreleri (varsayılan: options) düşürür ve istemcinin
 * gönderdiği SQL'i (basit sorgu ve Parse iletileri) bağlantı başına kaydeder. Supavisor'ın başlangıç seçeneğini
 * iletmediği durumun taklidi. SSL/GSS isteğine 'N' der (yerel, düz metin). */
function startOptionsDroppingProxy({targetHost,targetPort,drop=['options']}){
  const net=require('node:net');
  const conns=[];const sockets=new Set();
  const srv=net.createServer(cli=>{
    sockets.add(cli);cli.on('close',()=>sockets.delete(cli));
    const rec={startup:null,dropped:[],queries:[]};conns.push(rec);
    let buf=Buffer.alloc(0),phase='startup',up=null,pend=Buffer.alloc(0);
    const parse=chunk=>{pend=Buffer.concat([pend,chunk]);
      while(pend.length>=5){const t=String.fromCharCode(pend[0]),len=pend.readInt32BE(1);if(pend.length<1+len)break;
        const body=pend.subarray(5,1+len);pend=pend.subarray(1+len);
        if(t==='Q')rec.queries.push(body.subarray(0,body.length-1).toString('utf8'));
        else if(t==='P'){const z=body.indexOf(0);rec.queries.push(body.subarray(z+1,body.indexOf(0,z+1)).toString('utf8'));}}};
    cli.on('error',()=>{});
    cli.on('data',d=>{
      buf=Buffer.concat([buf,d]);
      for(;;){
        if(phase==='startup'){
          if(buf.length<8)return;const len=buf.readInt32BE(0);if(buf.length<len)return;
          const code=buf.readInt32BE(4);const msg=buf.subarray(0,len);buf=buf.subarray(len);
          if(code===80877103||code===80877104){cli.write('N');continue;}
          const parts=msg.subarray(8).toString('utf8').split('\0');const params={};
          for(let k=0;k+1<parts.length&&parts[k];k+=2)params[parts[k]]=parts[k+1];
          rec.startup={...params};for(const key of drop)if(key in params){rec.dropped.push(key);delete params[key];}
          const body=Buffer.from(Object.entries(params).map(([k,v])=>k+'\0'+v+'\0').join('')+'\0','utf8');
          const out=Buffer.alloc(8+body.length);out.writeInt32BE(8+body.length,0);out.writeInt32BE(code,4);body.copy(out,8);
          phase='connecting';
          up=net.connect(targetPort,targetHost,()=>{up.write(out);if(buf.length){up.write(buf);parse(buf);buf=Buffer.alloc(0);}phase='stream';});
          sockets.add(up);up.on('close',()=>sockets.delete(up));
          up.on('data',x=>cli.write(x));up.on('error',()=>cli.destroy());up.on('end',()=>cli.end());cli.on('end',()=>up.end());
          return;
        }
        if(phase==='stream'){up.write(buf);parse(buf);buf=Buffer.alloc(0);}
        return;
      }
    });
  });
  return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({port:srv.address().port,conns,
    close:()=>{for(const x of sockets)x.destroy();return new Promise(y=>srv.close(y));}})));
}

/* --- Bağlantı güvenliği: güvensiz yapılandırma bağlantı AÇILMADAN reddedilir --- */
const POOLER='aws-0-eu-central-1.pooler.supabase.com';
/** Bağlantı denemelerini sayan sahte istemci: kurulursa (ya da connect çağrılırsa) sayılır. */
const recordingClient=()=>{const st={built:0,connects:0};class RC{constructor(){st.built++;}on(){}async connect(){st.connects++;throw Error('bağlanılmamalıydı');}async query(){throw Error('x');}async end(){}};return {RC,st};};
test('bağlantı güvenliği: TLS doğrulaması olmayan uzak yapılandırma üretilmez; kural ihlalinde hiç bağlanılmaz',async()=>{
  const dir=tmp();const cert=path.join(dir,'root.crt');fs.writeFileSync(cert,'-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n');
  const good={host:POOLER,port:5432,user:'postgres.x',password:'yalnız-test',database:'postgres',sslmode:'verify-full',sslrootcert:cert};
  const savedHost=process.env.NAKGO_PG_HOST;process.env.NAKGO_PG_HOST='localhost';
  try{
    // clientConfig: uzak sunucuda verify-full ve var olan kök sertifika olmadan yapılandırma yok.
    const ok=clientConfig(good);
    assert.deepEqual({r:ok.ssl.rejectUnauthorized,s:ok.ssl.servername,ca:ok.ssl.ca.includes('BEGIN CERTIFICATE')},{r:true,s:POOLER,ca:true});
    for(const [label,c,re] of [['sslmode yok',{...good,sslmode:undefined},/verify-full/],['sslmode=require',{...good,sslmode:'require'},/verify-full/],
      ['sslmode=disable',{...good,sslmode:'disable'},/verify-full/],['kök sertifika yok',{...good,sslrootcert:undefined},/kök sertifika/],
      ['kök sertifika dosyası yok',{...good,sslrootcert:path.join(dir,'yok.crt')},/kök sertifika/]])assert.throws(()=>clientConfig(c),re,label);
    assert.equal(clientConfig({host:'localhost',port:5432,user:'u'}).ssl,undefined,'yerel test bağlantısı değişmedi');
    assert.equal(clientConfig({host:'/var/run/postgresql',port:5432,user:'u'}).ssl,undefined);
    // preflight: kurallar bağlantıdan önce; ihlalde istemci hiç kurulmaz.
    const bad=[['sslmode yok',{...good,sslmode:undefined},/verify-full/],['sslmode=require',{...good,sslmode:'require'},/verify-full/],
      ['yanlış sunucu adı',{...good,host:'db.example.com'},/beklenmeyen sunucu/],['işlem modu portu',{...good,port:6543},/6543/],
      ['yanlış port',{...good,port:5433},/5432/],['kök sertifika dosyası yok',{...good,sslrootcert:path.join(dir,'yok.crt')},/sertifika/],
      ['yerel sunucu (izin yok)',{...good,host:'localhost',sslmode:undefined},/yerel sunucuya yalnız testlerde/]];
    const k2=C.testKeyPair();
    const tlsRecips=path.join(dir,'recipients.txt');fs.writeFileSync(tlsRecips,['age1'+'a'.repeat(58),'age1'+'b'.repeat(58)].join('\n')+'\n');
    const tlsPinned=E.recipientsSha256(tlsRecips);const tlsCfg=withK9({version:1,recipients_sha256:tlsPinned,trusted_k1:{},trusted_k2:{[k2.keyId]:k2.publicKey}});
    for(const [label,conn,re] of bad){
      const {RC,st}=recordingClient();
      const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn,approval:'TEST-ONAY-TLS',Client:RC});
      assert.equal(p.status,'failed',label);assert.match(p.reason,/bağlantı kuralları/,label);assert.match(p.reason,re,label);
      assert.deepEqual(st,{built:0,connects:0},label+': bağlantı açılmadı');
      const {RC:RC2,st:st2}=recordingClient();
      const d=await snapshotDump({conn,scope:BR.loadScope(),outDir:path.join(dir,'d'),Client:RC2});
      assert.equal(d.status,'failed',label);assert.equal(d.stage,'connection',label);assert.deepEqual(st2,{built:0,connects:0},label+': döküm bağlantısı açılmadı');
      const {RC:RC3,st:st3}=recordingClient();
      const b=await runBootstrap({conn,outDir:path.join(dir,'o'),recipientsFile:tlsRecips,pinnedRecipientsSha256:tlsPinned,approval:'TEST-ONAY-TLS',
        runId:'tls',Client:RC3,workRoot:dir,config:tlsCfg});
      assert.equal(b.stages.preflight.status,'failed',label);assert.equal(b.stages.dump.status,'skipped',label);assert.deepEqual(st3,{built:0,connects:0},label);
      assert.notEqual(b.stages.preflight.code,'config',label+': yapılandırma geçti, durma nedeni bağlantı kuralı');assert.match(b.stages.preflight.reason,/bağlantı kuralları/,label);
    }
    // Kurallar geçse bile TLS yapılandırması üretilemezse bağlanılmaz (savunma derinliği: clientConfig).
    assert.throws(()=>clientConfig({...good,sslmode:'verify-ca'}),/verify-full/);
  }finally{if(savedHost===undefined)delete process.env.NAKGO_PG_HOST;else process.env.NAKGO_PG_HOST=savedHost;fs.rmSync(dir,{recursive:true,force:true});}
});

test('bağlantı güvenliği: B7 orkestratörünün A1 ön denetimi de kurallar geçmeden bağlanmaz',async()=>{
  const R=require('../../tools/backup/run.cjs');
  const dir=tmp();const cert=path.join(dir,'root.crt');fs.writeFileSync(cert,'-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n');
  const good={host:POOLER,port:5432,user:'nakgo_backup.x',password:'yalnız-test',database:'postgres',sslmode:'verify-full',sslrootcert:cert};
  try{
    for(const [label,conn,re] of [['sslmode yok',{...good,sslmode:undefined},/verify-full/],['sslmode=require',{...good,sslmode:'require'},/verify-full/],
      ['yanlış sunucu adı',{...good,host:'db.example.com'},/beklenmeyen sunucu/],['işlem modu portu',{...good,port:6543},/6543/],['yanlış port',{...good,port:5433},/5432/],
      ['kök sertifika dosyası yok',{...good,sslrootcert:path.join(dir,'yok.crt')},/sertifika/],['yerel sunucu (izin yok)',{...good,host:'localhost'},/yerel sunucuya yalnız testlerde/]]){
      const {RC,st}=recordingClient();
      await assert.rejects(R.preflightAudit({conn,Client:RC,allowlist:{version:1,entries:[]}}),e=>/bağlantı kuralları/.test(e.message)&&re.test(e.message),label);
      assert.deepEqual(st,{built:0,connects:0},label+': bağlantı açılmadı');
    }
    // Kurallar geçince (ve yalnız o zaman) bağlanılır: doğru yapılandırmada istemci kurulur, TLS doğrulamasıyla.
    const seen=[];class Spy{constructor(cfg){seen.push(cfg);}on(){}async connect(){throw Error('yalnız test: bağlanılmadı');}async end(){}}
    await assert.rejects(R.preflightAudit({conn:good,Client:Spy,allowlist:{version:1,entries:[]}}),/yalnız test/);
    assert.equal(seen.length,1);assert.equal(seen[0].ssl.rejectUnauthorized,true);assert.equal(seen[0].ssl.servername,POOLER);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

/** PGOPTIONS değerleri: boş (yok), boş dize ve dolu. */
const withPgOptions=async(value,fn)=>{
  const had=Object.prototype.hasOwnProperty.call(process.env,'PGOPTIONS'),saved=process.env.PGOPTIONS;
  if(value===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=value;
  try{return await fn();}finally{if(had)process.env.PGOPTIONS=saved;else delete process.env.PGOPTIONS;}
};
test('PGOPTIONS: node-pg istemcisi ortamdaki değeri başlangıç parametresine taşımaz; global ortam değişmez; denetlenemezse bağlanılmaz',async t=>{
  let pg;try{pg=require('pg');}catch{if(realPg())throw Error('pg gerekli');t.skip('pg istemcisi yok');return;}
  const local={host:'localhost',port:5432,user:'u',password:'yalnız-test',database:'postgres'};
  for(const value of [undefined,'','-c statement_timeout=1 -c default_transaction_read_only=off']){
    await withPgOptions(value,async()=>{
      // Negatif kontrol: düz node-pg istemcisi dolu PGOPTIONS'ı başlangıç paketine koyar (korunan davranışın nedeni).
      if(value)assert.equal(new pg.Client(clientConfig(local)).getStartupConf().options,value,'düz istemci ortamdan okur');
      // Yapıcı sırasında ortam değişmez (global ortamı geçici silme yöntemi kullanılmaz).
      let during='?';class Watch extends pg.Client{constructor(c){during=process.env.PGOPTIONS;super(c);}}
      const c=newClient(Watch,clientConfig(local));
      assert.equal(during,value,'yapıcı sırasında process.env aynı');
      assert.equal(process.env.PGOPTIONS,value,'sonra da aynı');
      assert.equal('options' in c.getStartupConf(),false,'başlangıç paketinde options yok: '+String(value));
      assert.deepEqual(Object.keys(c.getStartupConf()).sort(),['application_name','database','user']);
      // Yapılandırmada açıkça verilse de taşınmaz.
      assert.equal('options' in newClient(pg.Client,{...clientConfig(local),options:'-c x=1'}).getStartupConf(),false);
      // Eşzamanlı (iç içe) istemci kurulumu ortamı etkilemez: istemci kurulurken başka bir istemci kurulsa da ikisi de temiz.
      let inner=null;class Nest extends pg.Client{constructor(c){super(c);if(!inner)inner=newClient(pg.Client,clientConfig(local));}}
      const outer=newClient(Nest,clientConfig(local));
      assert.equal('options' in outer.getStartupConf(),false);assert.equal('options' in inner.getStartupConf(),false);
      assert.equal(process.env.PGOPTIONS,value);
    });
  }
  // Güvenli taraf: node-pg istemcisinin iç yapısı farklıysa ya da options kaldırılamıyorsa hata (bağlanılmaz).
  let connects=0;
  class Leaky extends pg.Client{getStartupConf(){return {...super.getStartupConf(),options:'-c x=1'};}async connect(){connects++;throw Error('bağlanılmamalıydı');}}
  class Changed extends pg.Client{constructor(c){super(c);delete this.connectionParameters;}async connect(){connects++;throw Error('bağlanılmamalıydı');}}
  assert.throws(()=>newClient(Leaky,clientConfig(local)),/options/);
  assert.throws(()=>newClient(Changed,clientConfig(local)),/beklenen yapıda değil/);
  const dir=tmp();const savedHost=process.env.NAKGO_PG_HOST;process.env.NAKGO_PG_HOST='localhost';
  try{
    const R=require('../../tools/backup/run.cjs');const k2=C.testKeyPair();
    for(const K of [Leaky,Changed]){
      await assert.rejects(R.preflightAudit({conn:local,Client:K,allowlist:{version:1,entries:[]},allowLocal:true}),/options|beklenen yapıda/);
      const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn:local,approval:'TEST-ONAY-OPT',allowLocal:true,Client:K});
      assert.equal(p.status,'failed');assert.match(p.reason,/options|beklenen yapıda/);
      const d=await snapshotDump({conn:local,scope:BR.loadScope(),outDir:path.join(dir,'d'),allowLocal:true,Client:K});
      assert.equal(d.status,'failed');assert.equal(d.stage,'connection');
    }
    assert.equal(connects,0,'hiçbir yol bağlanmadı');
  }finally{if(savedHost===undefined)delete process.env.NAKGO_PG_HOST;else process.env.NAKGO_PG_HOST=savedHost;fs.rmSync(dir,{recursive:true,force:true});}
});

test('node-pg sürümü sabit: tek kaynak ops/backup/ci, lockfile ve CI aynı sürüm; başka sürümde ve TLS yapılandırması değişirse bağlanılmaz',async t=>{
  const {PG_CLIENT_VERSION}=require('../../tools/backup/dump.cjs');
  assert.equal(PG_CLIENT_VERSION,'8.23.1');
  const lock=JSON.parse(fs.readFileSync(path.join(root,'ops/backup/ci/package-lock.json'),'utf8'));
  assert.equal(lock.packages['node_modules/pg'].version,PG_CLIENT_VERSION,'lockfile');
  assert.equal(lock.packages[''].dependencies.pg,PG_CLIENT_VERSION,'lockfile kök bağımlılığı');
  // CI'da node-pg kuran her iş akışı aynı sürümü kurar (ya da ops/backup/ci lockfile'ını kullanır).
  const wf=path.join(root,'.github/workflows');let pins=0;
  for(const f of fs.readdirSync(wf)){
    const y=fs.readFileSync(path.join(wf,f),'utf8');
    for(const m of y.matchAll(/\bpg@(\S+)/g)){pins++;assert.equal(m[1],PG_CLIENT_VERSION,f);}
  }
  assert.ok(pins>=3,'CI sabitlemeleri bulundu');
  let pg;try{pg=require('pg');}catch{if(realPg())throw Error('pg gerekli');t.skip('pg istemcisi yok');return;}
  assert.equal(require('pg/package.json').version,PG_CLIENT_VERSION,'çalışma anında kurulu sürüm sabit sürüm');
  const local={host:'localhost',port:5432,user:'u',password:'yalnız-test',database:'postgres'};
  assert.ok(newClient(pg.Client,clientConfig(local)) instanceof pg.Client);
  // Sürüm farklıysa (yükseltme) hiçbir yol bağlanmaz: iç alanlara dayanan denetim yeniden incelenmeden kullanılmaz.
  const pkg=require('pg/package.json');const saved=pkg.version;let connects=0;
  class Counting extends pg.Client{async connect(){connects++;throw Error('bağlanılmamalıydı');}}
  const dir=tmp();const savedHost=process.env.NAKGO_PG_HOST;process.env.NAKGO_PG_HOST='localhost';
  pkg.version='8.99.0';
  try{
    assert.throws(()=>newClient(pg.Client,clientConfig(local)),/node-pg sürümü 8\.99\.0; desteklenen 8\.23\.1/);
    const R=require('../../tools/backup/run.cjs');
    await assert.rejects(R.preflightAudit({conn:local,Client:Counting,allowlist:{version:1,entries:[]},allowLocal:true}),/node-pg sürümü/);
    const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn:local,approval:'TEST-ONAY-VER',allowLocal:true,Client:Counting});
    assert.equal(p.status,'failed');assert.match(p.reason,/node-pg sürümü/);
    const d=await snapshotDump({conn:local,scope:BR.loadScope(),outDir:path.join(dir,'d'),allowLocal:true,Client:Counting});
    assert.equal(d.status,'failed');assert.equal(d.stage,'connection');assert.match(d.reasons.join(),/node-pg sürümü/);
    assert.equal(connects,0,'hiçbir yol bağlanmadı');
  }finally{pkg.version=saved;if(savedHost===undefined)delete process.env.NAKGO_PG_HOST;else process.env.NAKGO_PG_HOST=savedHost;fs.rmSync(dir,{recursive:true,force:true});}
  // TLS yapılandırması istemciye aynen geçmezse (ör. iç alan değişikliği) bağlanılmaz.
  await withTmpDir(async cdir=>{
    const cert=path.join(cdir,'root.crt');fs.writeFileSync(cert,FAKE_CERT);
    const remote={host:'aws-0-eu-central-1.pooler.supabase.com',port:5432,user:'postgres.x',password:'yalnız-test',database:'postgres',sslmode:'verify-full',sslrootcert:cert};
    const ok=newClient(pg.Client,clientConfig(remote));
    assert.equal(ok.connectionParameters.ssl.rejectUnauthorized,true);assert.equal(ok.connectionParameters.ssl.servername,remote.host);
    class WeakTls extends pg.Client{constructor(c){super(c);this.connectionParameters.ssl={rejectUnauthorized:false};}}
    assert.throws(()=>newClient(WeakTls,clientConfig(remote)),/TLS yapılandırması/);
  });
});

test('geçici klasör temizliği: başarı, assertion hatası ve beklenmeyen hata yollarında silinir; silme hatası yutulmaz',async()=>{
  // Başarı.
  let seen=null;
  assert.equal(await withTmpDir(async d=>{seen=d;fs.writeFileSync(path.join(d,'root.crt'),FAKE_CERT);return 7;}),7);
  assert.equal(fs.existsSync(seen),false);assert.equal(OWN_TMP.has(seen),false);
  // Assertion hatasıyla biten test: sahte sertifikalı klasör yine silinir, hata olduğu gibi yükselir.
  await assert.rejects(withTmpDir(async d=>{seen=d;fs.mkdirSync(path.join(d,'alt'));fs.writeFileSync(path.join(d,'alt','root.crt'),FAKE_CERT);assert.equal(1,2,'kasıtlı');}),
    e=>e instanceof assert.AssertionError&&/kasıtlı/.test(e.message));
  assert.equal(fs.existsSync(seen),false,'assertion hatasında da silindi');
  // Beklenmeyen hata (TypeError).
  await assert.rejects(withTmpDir(async d=>{seen=d;fs.writeFileSync(path.join(d,'root.crt'),FAKE_CERT);null.x;}),TypeError);
  assert.equal(fs.existsSync(seen),false);
  // Silme başarısız: yutulmaz. Test hatası varsa ikisi birlikte (AggregateError), yoksa silme hatası.
  const orig=fs.rmSync;let target=null;
  fs.rmSync=function(p,...a){if(target&&String(p)===target)throw Object.assign(Error('EBUSY: simüle'),{code:'EBUSY'});return orig.call(fs,p,...a);};
  try{
    await assert.rejects(withTmpDir(async d=>{target=d;fs.writeFileSync(path.join(d,'root.crt'),FAKE_CERT);}),e=>e.code==='EBUSY');
    assert.ok(fs.existsSync(target)&&OWN_TMP.has(target),'kayıtta kaldı (çıkışta silinecek)');
    const first=target;target=null;orig.call(fs,first,{recursive:true,force:true});OWN_TMP.delete(first);
    await assert.rejects(withTmpDir(async d=>{target=d;assert.fail('kasıtlı test hatası');}),
      e=>e instanceof AggregateError&&e.errors[0] instanceof assert.AssertionError&&e.errors[1].code==='EBUSY');
  }finally{fs.rmSync=orig;if(target){orig.call(fs,target,{recursive:true,force:true});OWN_TMP.delete(target);}}
  // Süreç beklenmedik biçimde biterse 'exit' kancası kendi klasörünü siler (ayrı süreçte; başka klasörlere dokunmaz).
  await withTmpDir(async outer=>{
    const keep=path.join(outer,'baska-test');fs.mkdirSync(keep);
    const script=path.join(outer,'child.cjs');
    fs.writeFileSync(script,`const fs=require('fs'),path=require('path'),os=require('os');
const OWN=new Set();const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-b8-'));OWN.add(d);return d;};
process.on('exit',()=>{for(const d of OWN){if(!fs.existsSync(d))continue;try{fs.rmSync(d,{recursive:true,force:true});}catch(e){process.stderr.write('silinemedi '+d);}}});
const d=tmp();fs.writeFileSync(path.join(d,'root.crt'),'x');fs.writeFileSync(${JSON.stringify(path.join(outer,'made.txt'))},d);
setImmediate(()=>{throw Error('beklenmeyen');});`);
    // Kanca bu dosyadakiyle aynı olmalı (kopya değil, aynı metin):
    const src=fs.readFileSync(__filename,'utf8');
    assert.ok(src.includes(`process.on('exit',()=>{for(const d of OWN_TMP){if(!fs.existsSync(d))continue;try{fs.rmSync(d,{recursive:true,force:true});}catch(e){process.stderr.write('geçici klasör silinemedi: '+d+': '+e.message+'\\n');}}});`));
    const r=spawnSync(process.execPath,[script],{encoding:'utf8'});
    assert.notEqual(r.status,0,'süreç hatayla bitti');
    const made=fs.readFileSync(path.join(outer,'made.txt'),'utf8');
    assert.equal(fs.existsSync(made),false,'yakalanmamış hatada geçici klasör silindi');
    assert.equal(fs.existsSync(keep),true,'başka klasöre dokunulmadı');
  });
});

test('bağlantı güvenliği: yanlış sertifika ve yanlış sunucu adı TLS el sıkışmasında reddedilir; giriş bilgisi gönderilmez',async t=>{
  let pg;try{pg=require('pg');}catch{if(realPg())throw Error('pg gerekli');t.skip('pg istemcisi yok');return;}
  if(!hasBin('openssl')){if(realPg())throw Error('openssl gerekli');t.skip('openssl yok');return;}
  const net=require('node:net'),tls=require('node:tls');
  const dir=tmp();const o=(...a)=>execFileSync('openssl',a,{cwd:dir,stdio:'ignore'});
  try{
    const ca=(n)=>{o('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',n+'.key','-out',n+'.crt','-days','2','-subj','/CN='+n);};
    const leaf=(n,cn,signer)=>{o('req','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',n+'.key','-out',n+'.csr','-subj','/CN='+cn);
      fs.writeFileSync(path.join(dir,n+'.ext'),'subjectAltName=DNS:'+cn+'\n');
      o('x509','-req','-in',n+'.csr','-CA',signer+'.crt','-CAkey',signer+'.key','-CAcreateserial','-out',n+'.crt','-days','2','-extfile',n+'.ext');};
    ca('guvenilir');ca('yabanci');
    leaf('dogru',POOLER,'guvenilir');leaf('yanlisad','baska.example.com','guvenilir');leaf('yabancica',POOLER,'yabanci');
    const rd=n=>fs.readFileSync(path.join(dir,n));
    /** Sahte PostgreSQL TLS sunucusu: SSLRequest'e 'S' der, TLS'e geçer; el sıkışma ve sonrasında gelen veri kaydedilir. */
    const serve=leafName=>new Promise(res=>{
      const seen={secure:false,plainAfterTls:0};
      const srv=net.createServer(sock=>{sock.on('error',()=>{});sock.once('data',()=>{sock.write('S');
        const ts=new tls.TLSSocket(sock,{isServer:true,key:rd(leafName+'.key'),cert:rd(leafName+'.crt')});
        ts.on('error',()=>{});ts.on('secure',()=>{seen.secure=true;});ts.on('data',d=>{seen.plainAfterTls+=d.length;ts.destroy();});});});
      srv.listen(0,'127.0.0.1',()=>res({srv,seen,port:srv.address().port}));});
    const attempt=async leafName=>{
      const {srv,seen,port}=await serve(leafName);
      const cfg=clientConfig({host:POOLER,port:5432,user:'postgres.x',password:'yalnız-test',database:'postgres',sslmode:'verify-full',sslrootcert:path.join(dir,'guvenilir.crt')});
      // Ağ adı çözümlemesi yerine yerel sahte sunucu; sertifika doğrulaması yine POOLER adına (servername) yapılır.
      const c=new pg.Client({...cfg,host:'127.0.0.1',port,connectionTimeoutMillis:5000});
      let err=null;try{await c.connect();}catch(e){err=e;}finally{await c.end().catch(()=>{});await new Promise(r=>srv.close(r));}
      return {err,seen};
    };
    const wrongName=await attempt('yanlisad');
    assert.ok(wrongName.err,'yanlış ad reddedildi');assert.match(String(wrongName.err.code||wrongName.err.message),/ALTNAME|Hostname|altnames/i);
    assert.equal(wrongName.seen.plainAfterTls,0,'giriş bilgisi gönderilmedi');
    const wrongCa=await attempt('yabancica');
    assert.ok(wrongCa.err,'yabancı CA reddedildi');assert.match(String(wrongCa.err.code||wrongCa.err.message),/UNABLE_TO_VERIFY|SELF_SIGNED|certificate/i);
    assert.equal(wrongCa.seen.plainAfterTls,0,'giriş bilgisi gönderilmedi');
    // Kontrol: doğru sertifikada TLS kurulur (sahte sunucu sonra bağlantıyı keser).
    const right=await attempt('dogru');
    assert.equal(right.seen.secure,true,'doğru sertifikada TLS kuruldu');assert.ok(right.seen.plainAfterTls>0,'başlangıç mesajı yalnız TLS içinde geldi');
    assert.doesNotMatch(String(right.err&&right.err.code||''),/ALTNAME|UNABLE_TO_VERIFY|SELF_SIGNED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('FileStore atomik yazma: yarıda kalan yazma hedef adla görünmez, geçici dosya kalmaz; kısmi yazma tamamlanır',async()=>{
  const dir=tmp();const s=new FileStore({dir});const orig=fs.writeSync;
  try{
    // Disk dolu taklidi: ilk yazma 3 bayt yazıp hata verir.
    let calls=0;
    fs.writeSync=function(fd,buf,off,len){calls++;if(calls===1){orig.call(fs,fd,buf,off,Math.min(len,3));throw Object.assign(Error('ENOSPC (taklit)'),{code:'ENOSPC'});}return orig.apply(fs,arguments);};
    await assert.rejects(s.put('manual/manifests/m.json',Buffer.from('{"tam":true}'),{ifNoneMatch:true}),/ENOSPC/);
    fs.writeSync=orig;
    assert.equal(fs.existsSync(path.join(dir,'manual/manifests/m.json')),false,'yarım dosya hedef adla yok');
    assert.deepEqual(fs.readdirSync(path.join(dir,'manual/manifests')),[],'geçici dosya kalmadı');
    // Kısmi yazma: her çağrı en çok 2 bayt yazsa da içerik tam.
    fs.writeSync=function(fd,buf,off,len){return orig.call(fs,fd,buf,off,Math.min(len,2));};
    assert.equal((await s.put('manual/manifests/m.json',Buffer.from('{"tam":true}'),{ifNoneMatch:true})).ok,true);
    fs.writeSync=orig;
    assert.equal(fs.readFileSync(path.join(dir,'manual/manifests/m.json'),'utf8'),'{"tam":true}');
    // Var olanın üzerine yazmaz; ortada kalmış geçici dosya listede görünmez.
    assert.equal((await s.put('manual/manifests/m.json',Buffer.from('baska'),{ifNoneMatch:true})).status,412);
    assert.equal(fs.readFileSync(path.join(dir,'manual/manifests/m.json'),'utf8'),'{"tam":true}');
    fs.writeFileSync(path.join(dir,'manual/manifests/.nakgo-tmp-artik'),'x');
    assert.deepEqual((await s.list('manual/')).map(o=>o.key),['manual/manifests/m.json']);
  }finally{fs.writeSync=orig;fs.rmSync(dir,{recursive:true,force:true});}
});

/** fs.linkSync'i belirli bir hata koduyla başarısız yapar (yalnız ön kontrol / depo yazımı denemelerinde). */
const failLink=async(code,fn)=>{const orig=fs.linkSync;let calls=0;
  fs.linkSync=function(){calls++;throw Object.assign(Error(code+': simüle edilmiş hard link hatası'),{code,errno:-1,syscall:'link'});};
  try{return await fn(()=>calls);}finally{fs.linkSync=orig;}};
const filesUnder=d=>{const out=[];const walk=x=>{if(!fs.existsSync(x))return;for(const e of fs.readdirSync(x,{withFileTypes:true})){const p=path.join(x,e.name);out.push(path.relative(d,p));if(e.isDirectory())walk(p);}};walk(d);return out;};

test('FileStore ön kontrolü: hard link çalışıyorsa geçer ve iz bırakmaz; desteklenmiyorsa güvenli biçimde başarısız, zayıf yönteme geçmez',async()=>{
  await withTmpDir(async dir=>{
    const s=new FileStore({dir});
    assert.deepEqual(s.probe(),{ok:true,dirs:['.']});assert.deepEqual(filesUnder(dir),[],'deneme dosyası kalmadı');
    // Ön kontrolden sonra atomik ve üzerine yazmayan yazım aynen çalışır.
    assert.deepEqual(await s.put('manual/db/a.age',Buffer.from('x'),{ifNoneMatch:true}),{ok:true,status:200});
    assert.equal((await s.put('manual/db/a.age',Buffer.from('y'),{ifNoneMatch:true})).status,412);
    assert.equal((await s.get('manual/db/a.age')).toString(),'x');
    for(const code of ['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS']){
      await withTmpDir(async d2=>{
        const s2=new FileStore({dir:d2});
        const renames=[];const origRename=fs.renameSync,origCopy=fs.copyFileSync;
        fs.renameSync=(...a)=>{renames.push(a);return origRename.apply(fs,a);};fs.copyFileSync=(...a)=>{renames.push(a);return origCopy.apply(fs,a);};
        let r;try{r=await failLink(code,async calls=>{const x=s2.probe();assert.equal(calls(),1,code);return x;});}
        finally{fs.renameSync=origRename;fs.copyFileSync=origCopy;}
        assert.equal(r.ok,false,code);assert.equal(r.step,'link');assert.equal(r.code,code);
        assert.match(r.reason,new RegExp(`hard link desteklemiyor \\(${code}\\)`));
        assert.deepEqual(renames,[],code+': rename/kopya ile devam edilmedi');
        assert.deepEqual(filesUnder(d2),[],code+': deneme dosyası kalmadı');
      });
    }
    // Destek dışı olmayan bir hata da başarısızlıktır (yutulmaz).
    await withTmpDir(async d3=>{
      const r=await failLink('EIO',async()=>new FileStore({dir:d3}).probe());
      assert.deepEqual([r.ok,r.step,r.code],[false,'link','EIO']);assert.match(r.reason,/ön kontrolü başarısız \(link: EIO\)/);assert.deepEqual(filesUnder(d3),[]);
    });
    // Deneme dosyaları silinemezse bu da başarısızlıktır.
    await withTmpDir(async d4=>{
      const orig=fs.rmSync;
      fs.rmSync=function(p,...a){if(path.basename(String(p)).startsWith('.nakgo-tmp-probe-'))throw Object.assign(Error('EBUSY'),{code:'EBUSY'});return orig.call(fs,p,...a);};
      let r;try{r=new FileStore({dir:d4}).probe();}finally{fs.rmSync=orig;}
      assert.deepEqual([r.ok,r.step,r.code],[false,'cleanup','ECLEANUP']);assert.match(r.reason,/silinemedi/);
      for(const f of fs.readdirSync(d4))orig.call(fs,path.join(d4,f),{force:true});
    });
  });
});

test('bootstrap depo ön kontrolü: hard link yoksa hiçbir bağlantı kurulmaz, manifest/paket/onay kaydı ve geçici dosya oluşmaz, çıkış 1',async()=>{
  const {exitCodeOf,terminalLines}=require('../../tools/backup/bootstrap.cjs');
  await withTmpDir(async dir=>{
    for(const code of ['EPERM','ENOTSUP']){
      const out=path.join(dir,'out-'+code),work=path.join(dir,'work-'+code);fs.mkdirSync(out);fs.mkdirSync(work);
      const st={built:0,connects:0};
      class Counting{constructor(){st.built++;}on(){}async connect(){st.connects++;throw Error('bağlanılmamalıydı');}async query(){throw Error('x');}async end(){}}
      const r=await failLink(code,()=>runBootstrap({conn:{host:'localhost',port:5432,user:'u',password:'yalnız-test',database:'postgres'},outDir:out,recipientsFile:path.join(dir,'yok.txt'),
        pinnedRecipientsSha256:'0'.repeat(64),approval:'TEST-ONAY-PROBE',runId:'probe',now:new Date('2026-11-23T15:00:00Z'),allowLocal:true,workRoot:work,Client:Counting}));
      assert.deepEqual(st,{built:0,connects:0},code+': hiçbir bağlantı kurulmadı');
      assert.equal(r.state,'failed');assert.equal(r.run_complete,false);assert.deepEqual(r.failed,['storage_probe']);assert.equal(r.backup_verified,false);
      assert.deepEqual(Object.fromEntries(Object.entries(r.stages).map(([k,v])=>[k,v.status+(v.code?':'+v.code:'')])),
        {preflight:'failed:storage_probe',dump:'skipped',restore_test:'skipped',legal:'skipped',encryption:'skipped',upload:'skipped'});
      assert.equal(r.keys,null);assert.equal(r.request_key,null);assert.equal(exitCodeOf(r),1,code+': çıkış 1');
      assert.deepEqual(filesUnder(out),[],code+': manifest, şifreli paket, onay kaydı ya da geçici dosya yok');
      assert.deepEqual(filesUnder(work),[],code+': şifresiz çalışma klasörü hiç açılmadı');
      assert.ok(terminalLines(r).some(l=>l.includes('storage_probe')&&l.includes('hard link desteklemiyor ('+code+')')));
    }
  });
});

/** Yalnız belirli bir yazım klasöründe (yol parçası) hard link başarısız; diğer klasörlerde gerçek link. */
const failLinkIn=async(part,code,fn)=>{const orig=fs.linkSync;let hits=0;
  fs.linkSync=function(a,b){if(String(a).includes(path.sep+part+path.sep)){hits++;throw Object.assign(Error(code+': simüle'),{code});}return orig.apply(fs,arguments);};
  try{return await fn(()=>hits);}finally{fs.linkSync=orig;}};
/** Yalnız belirli bir yazım klasörü farklı bir aygıtta (bağlama noktası) görünür. */
const otherDeviceIn=async(part,fn)=>{const orig=fs.statSync;
  fs.statSync=function(p,...a){const st=orig.call(fs,p,...a);const f=String(p);
    if(st&&f.includes(path.sep+part)&&/\d{4}[\\/]\d{2}[\\/]\d{2}$/.test(f)){const c=Object.create(Object.getPrototypeOf(st));Object.assign(c,st,{dev:st.dev+1});return c;}return st;};
  try{return await fn();}finally{fs.statSync=orig;}};
const TARGETS=['manual/db','manual/manifests','manual/records'].map(x=>x.split('/').join(path.sep));

test('FileStore ön kontrolü (anahtarlar): her yazım klasörü kendi yerinde denenir; yalnız denemek için açılan klasörler kalmaz, var olanlara dokunulmaz',async()=>{
  await withTmpDir(async dir=>{
    fs.mkdirSync(path.join(dir,'manual'));fs.writeFileSync(path.join(dir,'manual','onceden.txt'),'x');
    const keys=['manual/db/2026/11/23/a.tar.age','manual/manifests/2026/11/23/a.json','manual/records/2026/11/23/a.json'];
    const s=new FileStore({dir});
    assert.deepEqual(s.probe(keys),{ok:true,dirs:['.','manual/db/2026/11/23','manual/manifests/2026/11/23','manual/records/2026/11/23']});
    assert.deepEqual(filesUnder(dir).sort(),['manual','manual/onceden.txt'].map(x=>x.split('/').join(path.sep)),'yalnız önceden var olanlar');
    // Gerçek yazım sonradan aynı klasörleri oluşturur; atomik ve üzerine yazmayan davranış aynı.
    for(const k of keys){assert.equal((await s.put(k,Buffer.from('v'),{ifNoneMatch:true})).status,200);assert.equal((await s.put(k,Buffer.from('w'),{ifNoneMatch:true})).status,412);}
    // Kök çıktı klasörü yoksa: deneme için açılır, başarısızlıkta kalmaz.
    const fresh=path.join(dir,'yeni','cikti');
    const r=await failLinkIn('db','EPERM',async()=>new FileStore({dir:fresh}).probe(keys));
    assert.equal(r.ok,false);assert.equal(fs.existsSync(path.join(dir,'yeni')),false,'deneme için açılan kök de silindi');
  });
});

test('bootstrap depo ön kontrolü: manual/db, manual/manifests ve manual/records klasörlerinin HER BİRİNDE hard link ya da aygıt sorunu ayrı yakalanır; bağlantı yok, çıktı yok',async()=>{
  const {exitCodeOf}=require('../../tools/backup/bootstrap.cjs');
  await withTmpDir(async dir=>{
    const cases=[];
    for(const t of TARGETS){cases.push([t,'EPERM','link']);cases.push([t,'ENOTSUP','link']);cases.push([t,null,'device']);}
    let i=0;
    for(const [target,code,kind] of cases){
      const out=path.join(dir,'out'+i),work=path.join(dir,'work'+i);i++;fs.mkdirSync(out);fs.mkdirSync(work);
      fs.mkdirSync(path.join(out,'manual'));// önceden var olan klasör korunur
      const st={built:0,connects:0};
      class Counting{constructor(){st.built++;}on(){}async connect(){st.connects++;throw Error('bağlanılmamalıydı');}async query(){throw Error('x');}async end(){}}
      const go=()=>runBootstrap({conn:{host:'localhost',port:5432,user:'u',password:'yalnız-test',database:'postgres'},outDir:out,recipientsFile:path.join(dir,'yok.txt'),
        pinnedRecipientsSha256:'0'.repeat(64),approval:'TEST-ONAY-HEDEF',runId:'hedef',now:new Date('2026-11-23T15:00:00Z'),allowLocal:true,workRoot:work,Client:Counting});
      let r,hits=null;
      if(kind==='link')r=await failLinkIn(target,code,async h=>{const x=await go();hits=h();return x;});
      else r=await otherDeviceIn(target,go);
      const label=target+' '+(code||'aygıt');
      if(kind==='link')assert.equal(hits,1,label+': yalnız bu klasörde denendi ve düştü');
      assert.deepEqual(st,{built:0,connects:0},label+': hiçbir bağlantı');
      assert.deepEqual(r.failed,['storage_probe'],label);assert.equal(exitCodeOf(r),1,label);
      assert.ok(r.probe.dir.startsWith(target.split(path.sep).join('/')+'/2026/11/23'),label+': '+r.probe.dir);
      assert.match(r.stages.preflight.reason,kind==='link'?new RegExp(`hard link desteklemiyor \\(${code}\\).*\\[${target.split(path.sep).join('/')}/2026/11/23\\]`):/tek dosya sisteminde değil: manual\/\S+ farklı bir bağlama noktasında/,label);
      assert.deepEqual(filesUnder(out),['manual'],label+': yalnız önceden var olan klasör; manifest, paket, onay kaydı, deneme klasörü ya da dosyası yok');
      assert.deepEqual(filesUnder(work),[],label+': çalışma klasörü açılmadı');
    }
  });
});

test('Y2 yapılandırma ve anahtar güveni: alıcı hash\'i config ile, tam iki alıcı, K9 ve çapa güvenilir ve etkin, K1/K2/K9 ayrık; ihlalde bağlanmadan durur ve değer sızdırmaz',async()=>{
  const {bootstrapConfigProblems,exitCodeOf}=require('../../tools/backup/bootstrap.cjs');
  await withTmpDir(async dir=>{
    const rc=(name,list)=>{const f=path.join(dir,name);fs.writeFileSync(f,list.join('\n')+'\n');return f;};
    const A='age1'+'a'.repeat(58),Bk='age1'+'b'.repeat(58),Ck='age1'+'c'.repeat(58);
    const two=rc('two.txt',[A,Bk]),pinned=E.recipientsSha256(two);
    const k2=C.testKeyPair(),k1=C.testKeyPair(),other=C.testKeyPair();
    const good=withK9({version:1,recipients_sha256:pinned,trusted_k1:{[k1.keyId]:k1.publicKey},trusted_k2:{[k2.keyId]:k2.publicKey}});
    const k9id=good.active_k9,anchor=good.active_anchor_sha256;
    const base={config:good,recipientsFile:two,pinnedRecipientsSha256:pinned};
    assert.deepEqual(bootstrapConfigProblems(base),[],'geçerli yapılandırma');
    assert.deepEqual(bootstrapConfigProblems({...base,config:{...good,trusted_k1:{}}}),[],'K1 henüz yoksa da geçerli');
    const one=rc('one.txt',[A]),three=rc('three.txt',[A,Bk,Ck]),dup=rc('dup.txt',[A,A]),changed=rc('changed.txt',[A,Ck]);
    const cases=[
      ['yapılandırma yok',{config:null},/okunamadı ya da bozuk/],
      ['sürüm bozuk',{config:{...good,version:2}},/okunamadı ya da bozuk/],
      ['hash sabitlenmemiş (repo bugünkü hali)',{config:{...good,recipients_sha256:null}},/sabitlenmemiş/],
      ['hash biçimi bozuk',{config:{...good,recipients_sha256:'xyz'}},/sabitlenmemiş/],
      ['operatör hash\'i farklı',{pinnedRecipientsSha256:'f'.repeat(64)},/verilen alıcı hash'i yapılandırmadaki değerle uyuşmuyor/],
      ['tek alıcı (hash ona sabit)',{recipientsFile:one,pinnedRecipientsSha256:E.recipientsSha256(one),config:{...good,recipients_sha256:E.recipientsSha256(one)}},/tam 2 farklı alıcı/],
      ['üç alıcı (hash ona sabit)',{recipientsFile:three,pinnedRecipientsSha256:E.recipientsSha256(three),config:{...good,recipients_sha256:E.recipientsSha256(three)}},/tam 2 farklı alıcı/],
      ['yinelenen alıcı',{recipientsFile:dup,pinnedRecipientsSha256:E.recipientsSha256(dup),config:{...good,recipients_sha256:E.recipientsSha256(dup)}},/tam 2 farklı alıcı/],
      ['alıcı dosyası değişmiş',{recipientsFile:changed},/alıcı dosyası yapılandırmadaki hash ile uyuşmuyor/],
      ['alıcı dosyası yok',{recipientsFile:path.join(dir,'yok.txt')},/alıcı dosyası okunamadı/],
      ['trusted_k2 dizi',{config:{...good,trusted_k2:[k2.publicKey]}},/K2 listesi bozuk/],
      ['trusted_k1 bozuk',{config:{...good,trusted_k1:'x'}},/K1 listesi bozuk/],
      ['trusted_k9 boş (repo bugünkü hali)',{config:{...good,trusted_k9:{}}},/K9 açık anahtarı yok/],
      ['trusted_k9 dizi',{config:{...good,trusted_k9:[]}},/K9 listesi bozuk/],
      ['active_k9 yok',{config:{...good,active_k9:null}},/etkin K9/],
      ['active_k9 listede değil',{config:{...good,active_k9:other.keyId}},/etkin K9/],
      ['K9 girdisinin kimliği yanlış',{config:{...good,trusted_k9:{[k9id]:other.publicKey}}},/K9 girdisinin kimliği/],
      ['K9 açık anahtarı bozuk',{config:{...good,trusted_k9:{[k9id]:'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'}}},/K9 açık anahtarı okunamadı/],
      ['çapa yok',{config:{...good,trusted_anchors:{},active_anchor_sha256:null}},/güvenilir çapa yok/],
      ['etkin çapa listede değil',{config:{...good,active_anchor_sha256:'e'.repeat(64)}},/etkin çapa/],
      ['çapa hash biçimi bozuk',{config:{...good,trusted_anchors:{...good.trusted_anchors,XYZ:{}}}},/çapa hash'i biçimi/],
      ['K1 = K9',{config:{...good,trusted_k1:{...good.trusted_k1,[k9id]:good.trusted_k9[k9id]}}},/K1 ve K9 aynı anahtarı paylaşıyor/],
      ['K2 = K9',{config:{...good,trusted_k2:{[k9id]:good.trusted_k9[k9id]}}},/K2 ve K9 aynı anahtarı paylaşıyor/],
      ['K1 = K2',{config:{...good,trusted_k1:{[k2.keyId]:k2.publicKey}}},/görev ayrılığı/],
      ['K1 ve K2 başka anahtarı paylaşıyor',{config:{...good,trusted_k1:{[other.keyId]:other.publicKey},trusted_k2:{[k2.keyId]:k2.publicKey,[other.keyId]:other.publicKey}}},/aynı anahtarı paylaşıyor/]];
    const secrets=[pinned,A,Bk,Ck,k2.keyId,k1.keyId,other.keyId,k9id,anchor,dir,'BEGIN','PRIVATE'];
    for(const [label,over,re] of cases){
      const probs=bootstrapConfigProblems({...base,...over});
      assert.ok(probs.length,label);assert.match(probs.join('|'),re,label+': '+probs.join('|'));
      for(const x of secrets)assert.ok(!probs.join('|').includes(x),label+': mesajda değer yok');
      // Gerçek akış: ön kontrolden sonra, BAĞLANTIDAN ÖNCE durur; manifest/paket/onay kaydı/çalışma klasörü yok.
      const out=fs.mkdtempSync(path.join(dir,'o-')),work=fs.mkdtempSync(path.join(dir,'w-'));
      const st={built:0,connects:0};
      class Counting{constructor(){st.built++;}on(){}async connect(){st.connects++;throw Error('bağlanılmamalıydı');}async query(){throw Error('x');}async end(){}}
      const args={...base,...over};
      const r=await runBootstrap({conn:{host:'localhost',port:5432,user:'u',password:'yalnız-test',database:'postgres'},outDir:out,recipientsFile:args.recipientsFile,
        pinnedRecipientsSha256:args.pinnedRecipientsSha256,config:args.config,approval:'TEST-ONAY-CFG',runId:'cfg',now:new Date('2026-11-23T19:00:00Z'),allowLocal:true,workRoot:work,Client:Counting});
      assert.deepEqual(st,{built:0,connects:0},label+': bağlantı yok');
      assert.deepEqual(r.failed,['config'],label);assert.equal(r.stages.preflight.code,'config');assert.equal(exitCodeOf(r),1,label);
      assert.equal(r.keys,null);assert.equal(r.request_key,null);
      assert.deepEqual(filesUnder(out),[],label+': çıktı yok');assert.deepEqual(filesUnder(work),[],label+': çalışma klasörü açılmadı');
      for(const x of secrets)assert.ok(!r.stages.preflight.reason.includes(x),label+': nedende değer yok');
    }
  });
});

test('Y2 şifreleme akışı: elle yedekte tam iki alıcı zorunlu (hash eşleşse de); B7 varsayılanı değişmez',async()=>{
  await withTmpDir(async dir=>{
    const three=path.join(dir,'three.txt');fs.writeFileSync(three,['age1'+'a'.repeat(58),'age1'+'b'.repeat(58),'age1'+'c'.repeat(58)].join('\n')+'\n');
    const input=path.join(dir,'in');fs.writeFileSync(input,'x');const output=path.join(dir,'out.age');
    const r=await E.encryptFile({input,output,recipientsFile:three,pinnedRecipientsSha256:E.recipientsSha256(three),ageBin:path.join(dir,'age-yok'),requiredRecipients:2});
    assert.deepEqual([r.status,r.code],['failed','recipients_count']);assert.equal(fs.existsSync(output),false,'age hiç çalışmadı');
    assert.ok(!JSON.stringify(r).includes('age1'),'alıcılar mesajda yok');
    // requiredRecipients verilmezse (B7) sayı denetimi yok: bir sonraki adım (age sürümü) çalışır.
    const b7=await E.encryptFile({input,output,recipientsFile:three,pinnedRecipientsSha256:E.recipientsSha256(three),ageBin:path.join(dir,'age-yok')});
    assert.equal(b7.code,'age_version');
    // Bootstrap şifrelemeye 2 geçirir.
    const src=fs.readFileSync(path.join(root,'tools/backup/bootstrap.cjs'),'utf8');assert.match(src,/requiredRecipients:REQUIRED_RECIPIENTS/);
    assert.equal(require('../../tools/backup/bootstrap.cjs').REQUIRED_RECIPIENTS,2);
  });
});

test('Y2 CLI: repodaki yapılandırma doldurulmadan (bugünkü hali) bootstrap bağlanmadan durur; çıktı değer sızdırmaz',async()=>{
  const cfg=require('../../tools/backup/bootstrap.cjs').loadBackupConfig();
  assert.equal(cfg.recipients_sha256,null,'repo yapılandırması henüz doldurulmamış (anahtar töreni bekleniyor)');
  await withTmpDir(async dir=>{
    const pre=path.join(dir,'net.cjs');
    fs.writeFileSync(pre,`const net=require('net');const c=net.connect;net.connect=net.createConnection=function(){require('fs').writeFileSync(${JSON.stringify(path.join(dir,'connected'))},'1');return c.apply(this,arguments);};`);
    const key=path.join(dir,'k2.pem');fs.writeFileSync(key,require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    const recips=path.join(dir,'r.txt');fs.writeFileSync(recips,['age1'+'a'.repeat(58),'age1'+'b'.repeat(58)].join('\n')+'\n');
    const pinned=E.recipientsSha256(recips);
    const out=path.join(dir,'out');
    const env={...process.env,PGHOST:'aws-0-eu-central-1.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.x',PGPASSWORD:'yalnız-test',PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(dir,'yok.crt')};
    delete env.CI;delete env.GITHUB_ACTIONS;
    const r=spawnSync(process.execPath,['-r',pre,path.join(root,'tools/backup/bootstrap.cjs'),'run','--out',out,'--recipients',recips,
      '--recipients-sha256',pinned,'--approval','TEST-ONAY-CLI'],{encoding:'utf8',env});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.stderr,/aşama preflight başarısız \(config\): yapılandırma: .*sabitlenmemiş.*K9 açık anahtarı yok.*güvenilir çapa yok/);
    assert.deepEqual([cfg.trusted_k9,cfg.active_k9,cfg.trusted_anchors,cfg.active_anchor_sha256],[{},null,{},null],'K9 alanları boş şema olarak var');
    const j=JSON.parse(r.stdout);assert.equal(j.state,'failed');assert.equal(j.request,null);assert.deepEqual(filesUnder(out),[]);
    // Özel anahtar bu makinede hiç kabul edilmez (imza yalnız çevrim dışı).
    const k=spawnSync(process.execPath,['-r',pre,path.join(root,'tools/backup/bootstrap.cjs'),'run','--out',out,'--recipients',recips,
      '--recipients-sha256',pinned,'--sign-key',key,'--approval','TEST-ONAY-CLI'],{encoding:'utf8',env});
    assert.equal(k.status,1);assert.match(k.stderr,/özel anahtar bu makinede kullanılmaz/);
    assert.equal(fs.existsSync(path.join(dir,'connected')),false,'ağ bağlantısı açılmadı');
    for(const x of [pinned,'age1','BEGIN','yalnız-test'])assert.ok(!(r.stdout+r.stderr).includes(x),'çıktıda değer yok: '+x.slice(0,6));
  });
});

test('bootstrap CLI: hard link desteklenmeyen çıktı klasöründe bağlanmadan durur, sıfır dışı çıkış kodu, dosya bırakmaz',async()=>{
  await withTmpDir(async dir=>{
    const pre=path.join(dir,'eperm.cjs');
    fs.writeFileSync(pre,`const fs=require('fs');fs.linkSync=()=>{throw Object.assign(Error('EPERM: simüle'),{code:'EPERM'});};
const net=require('net');const c=net.connect;net.connect=net.createConnection=function(){require('fs').writeFileSync(${JSON.stringify(path.join(dir,'connected'))},'1');return c.apply(this,arguments);};`);
    const key=path.join(dir,'k2.pem');fs.writeFileSync(key,require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    const out=path.join(dir,'out');
    const env={...process.env,PGHOST:'aws-0-eu-central-1.pooler.supabase.com',PGPORT:'5432',PGUSER:'postgres.x',PGPASSWORD:'yalnız-test',PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(dir,'yok.crt'),NAKGO_PG_HOST:'localhost'};
    delete env.CI;delete env.GITHUB_ACTIONS;
    const r=spawnSync(process.execPath,['-r',pre,path.join(root,'tools/backup/bootstrap.cjs'),'run','--out',out,'--recipients',path.join(dir,'yok.txt'),
      '--recipients-sha256','0'.repeat(64),'--approval','TEST-ONAY-CLI'],{encoding:'utf8',env});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.stderr,/aşama preflight başarısız \(storage_probe\): çıktı klasörü hard link desteklemiyor \(EPERM\)/);
    assert.match(r.stderr,/bootstrap başarısız: storage_probe/);
    assert.equal(JSON.parse(r.stdout).request,null);
    assert.deepEqual(filesUnder(out),[],'çıktı klasörü boş');assert.equal(fs.existsSync(path.join(dir,'connected')),false,'ağ bağlantısı açılmadı');
  });
});

test('run tamamlanma koşulu: doğrulanmış veri, paket yazılmış, şifresiz temizlik tamam, sözleşme sonucu bilinir, manifest imzası ve yüklemesi BİLEREK ertelenmiş',()=>{
  const {runCompletionOf}=require('../../tools/backup/bootstrap.cjs');
  const okExtra={manifest_signature:{status:'deferred'},manifest_upload:{status:'deferred'},plaintext_cleanup:{status:'ok'}};
  const good={verified:true,stages:{upload:{status:'ok'}},extra:okExtra,contract:{status:'passed'}};
  assert.deepEqual(runCompletionOf(good),{ok:true,failed:[]});
  assert.deepEqual(runCompletionOf({...good,contract:{status:'skipped',rehearsal_required:true}}),{ok:true,failed:[]});
  for(const c of [{status:'failed'},{status:'not_run'},{status:'bilinmeyen'},{},undefined])assert.deepEqual(runCompletionOf({...good,contract:c}).failed,['contract'],JSON.stringify(c));
  // Çevrim içi imza ya da yükleme "ok" görünürse bu da hatadır: manifest yalnız çevrim dışı K9 ile imzalanır.
  for(const k of ['manifest_signature','manifest_upload'])for(const st of ['ok','failed','pending',undefined])
    assert.deepEqual(runCompletionOf({...good,extra:{...okExtra,[k]:st?{status:st}:undefined}}).failed,[k],k+' '+st);
  for(const st of ['failed','pending',undefined])assert.deepEqual(runCompletionOf({...good,extra:{...okExtra,plaintext_cleanup:st?{status:st}:undefined}}).failed,['plaintext_cleanup']);
  assert.deepEqual(runCompletionOf({...good,stages:{upload:{status:'failed'}}}).failed,['upload']);
  assert.deepEqual(runCompletionOf({...good,verified:false}).failed,['verified']);
  assert.equal(runCompletionOf(null).ok,false);
});
test('manifest hata metni temizleme: tırnak içi değer, CONTEXT, DETAIL, Key (...), e-posta, UUID maskelenir; her girdide güvenli',()=>{
  const M=require('../../tools/backup/manifest.cjs');const {safeReason,REASON_MAX}=M;
  const MK='NAKGO-SIZINTI-41';
  const no=(x,label)=>{const out=safeReason(x);assert.equal(typeof out,'string',label);assert.ok(!out.includes(MK),label+': '+out);assert.ok([...out].length<=REASON_MAX,label);return out;};
  // pg_restore / COPY biçimi (çok satırlı): tırnak içi değer ve CONTEXT maskelenir, teşhis sözcükleri kalır.
  let o=no(`pg_restore: error: COPY failed for table "users": ERROR:  invalid input syntax for type uuid: "${MK}"\nCONTEXT:  COPY users, line 3, column id: "${MK}"`,'COPY');
  assert.match(o,/pg_restore: error: COPY failed/);
  o=no(`ERROR:  extra data after last expected column\nCONTEXT:  COPY users, line 3: ${MK} ${MK}@ornek.com`,'CONTEXT (tırnaksız)');
  assert.equal(o,'ERROR: extra data after last expected column | CONTEXT: [gizli]');
  o=no(`invalid input syntax for type uuid: "${MK}"`,'uuid hatası');assert.equal(o,'invalid input syntax for type uuid: "[gizli]"');
  o=no(`duplicate key value violates unique constraint "users_pkey"\r\nDETAIL:  Key (email)=(${MK}@ornek.com) already exists.`,'DETAIL');
  assert.match(o,/^duplicate key value violates unique constraint/);
  o=no(`new row violates check constraint\nDETAIL:  Failing row contains (${MK}, 5).`,'DETAIL (tırnaksız)');assert.equal(o,'new row violates check constraint | DETAIL: [gizli]');
  o=no(`insert or update violates foreign key | Key (owner_id)=(${MK}) is not present in table "profiles"`,'Key');assert.match(o,/Key \(\[gizli\]\)/);
  for(const [label,x] of [['HINT',`HINT: değer ${MK}`],['QUERY',`QUERY: select '${MK}'`],['WHERE',`WHERE: PL/pgSQL ${MK}`],['STATEMENT',`STATEMENT: insert ${MK}`],
    ['LINE',`syntax error | LINE 1: select ${MK}`],['Command was',`pg_restore: from TOC entry 1; Command was: COPY x FROM stdin ${MK}`]])no(x,label);
  // Tırnaklar: tek, ters, kapanmayan ve değerin içinde tırnak (eşleşme kaymaz).
  for(const [label,x] of [['tek tırnak',`x='${MK}'`],['ters tırnak','x=`'+MK+'`'],['kapanmayan',`değer "${MK} devam`],['iç tırnak',`v "a"${MK}"b" son`],
    ['iç tırnak (tek)',`v 'a'${MK}'b' son`],['ayrıcılı',`a "b | ${MK}" c`]])no(x,label);
  assert.equal(safeReason("Production'da yerel PostgreSQL gerekli"),"Production'da yerel PostgreSQL gerekli",'Türkçe kesme işareti metni korur');
  // E-posta ve UUID (tirelı ve tiresiz), uzun sayı ve belirteç: tırnaksız da.
  o=safeReason('kullanıcı ali.veli+x@ornek.com.tr, kimlik 123E4567-E89B-12D3-A456-426614174000 ve 123e4567e89b12d3a456426614174000');
  assert.equal(o,'kullanıcı [e-posta], kimlik [uuid] ve [uuid]');
  assert.equal(safeReason('tel +90 532 123 45 67'),'tel [sayı]');
  assert.equal(safeReason('belirteç eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0abc'),'belirteç [uzun-dizgi]');
  // JSON metni ve nesne ayrıntısı (doğrulama kontrolleri): düzleştirilir, değerler maskelenir.
  no(JSON.stringify(`invalid input syntax for type uuid: "${MK}"`),'JSON metni');
  no(JSON.stringify({table:'auth.users',error:`bad "a"${MK}"b"`}),'JSON nesne metni');
  o=no({table:'public.listings',missing:2,rows:[`${MK}@x.io`]},'nesne');assert.match(o,/table: public\.listings \| missing: 2/);
  // Boş, eksik, beklenmeyen türler, döngü, kontrol karakterleri.
  for(const x of ['',null,undefined])assert.equal(safeReason(x),'');
  assert.equal(safeReason(42),'42');assert.equal(safeReason(['a',1]),'a | 1');
  const cyc={a:1};cyc.self=cyc;assert.equal(typeof safeReason(cyc),'string');
  assert.equal(safeReason('a\u0000b\u001bc d'),'a b c d');
  // Çok uzun: kesim maskelemeden sonra; işaretçi sonda, ortada ya da kesim sınırında açığa çıkmaz.
  for(const pos of [0,250,480,495,499,19900,19950,29000]){
    const x='a '.repeat(Math.floor(pos/2))+`${MK}@ornek.com `+'b '.repeat(15000);no(x,'uzun '+pos);
  }
  no('x'.repeat(19970)+MK+'@ornek.com','giriş sınırında');
  // Manifest: neden yalnız temizlenmiş yazılır, kod yalnız güvenli karakterler.
  const st=Object.fromEntries(M.DATA_STAGES.map(k=>[k,{status:'skipped'}]));
  st.restore_test={status:'failed',code:'restore_b',reason:`invalid input syntax for type uuid: "${MK}"`};
  st.dump={status:'failed',code:`x"${MK}`,reason:`pg_dump: error: ${MK}@ornek.com`};
  const m=M.buildManifest({runId:'r',createdAt:'2026-11-23T00:00:00Z',stages:st});
  assert.ok(!JSON.stringify(m).includes(MK));
  assert.deepEqual(m.stages.restore_test,{status:'failed',code:'restore_b',reason:'invalid input syntax for type uuid: "[gizli]"'});
  assert.equal(m.stages.dump.code,'unknown');assert.equal(m.stages.dump.reason,'pg_dump: error: [e-posta]');
  // Terminal: ham teşhis kaybolmaz (yalnız ekran; dosyaya yazılmaz).
  const lines=require('../../tools/backup/bootstrap.cjs').terminalLines({stages:st});
  assert.ok(lines.some(l=>l.includes('aşama restore_test başarısız (restore_b)')&&l.includes(MK)),'terminalde ham neden');
  // CLI ham nedeni yalnız terminale yazar; dosya yazımı yok.
  const src=fs.readFileSync(path.join(root,'tools/backup/bootstrap.cjs'),'utf8');const cli=src.slice(src.indexOf('async function cli('));
  assert.match(cli,/for\(const l of terminalLines\(r\)\)console\.error\(l\);/);assert.doesNotMatch(cli,/writeFile|appendFile|openSync|createWriteStream/);
});

test('API sözleşmesi durumu: yapıldı, atlandı, başarısız ya da çalışmadı makinece ayrılır; atlanma başarı gibi görünmez',()=>{
  const {contractStatusOf}=require('../../tools/backup/bootstrap.cjs');
  const skipNote={code:'contract',skipped:true,pending:19,reason:'kaynak repodan 19 migration geride; sözleşme provada denetlenir'};
  assert.deepEqual(contractStatusOf([{code:'contract',ok:true,detail:'x'}],[]),{status:'passed',rehearsal_required:false});
  assert.deepEqual(contractStatusOf([{code:'contract',ok:false,detail:[]}],[]),{status:'failed',rehearsal_required:true});
  assert.deepEqual(contractStatusOf([{code:'counts',ok:true}],[skipNote]),{status:'skipped',rehearsal_required:true,pending:19,reason:skipNote.reason});
  assert.equal(contractStatusOf([],[]).status,'not_run');assert.equal(contractStatusOf(null,undefined).status,'not_run');
  assert.equal(contractStatusOf([],[{code:'contract'}]).status,'not_run','skipped:true olmayan not atlanma sayılmaz');
  assert.equal(contractStatusOf([{code:'contract',ok:true}],[skipNote]).status,'failed','hem kontrol hem atlama: tutarsız');
  assert.equal(contractStatusOf([{code:'contract',ok:true},{code:'contract',ok:true}],[]).status,'failed');
});

test('çıkış kodları: run → 2 yalnız imza isteği yazıldıysa, aksi 1; finalize → 0 yalnız tamamlandıysa; başka durum 1',()=>{
  const {exitCodeOf}=require('../../tools/backup/bootstrap.cjs');
  const pend={phase:'run',state:'signature_pending',request_key:'manual/pending/x/request.json',run_complete:true};
  assert.equal(exitCodeOf(pend),2);
  assert.equal(exitCodeOf({...pend,request_key:null}),1,'istek yazılmadıysa');
  assert.equal(exitCodeOf({...pend,run_complete:false}),1);
  assert.equal(exitCodeOf({...pend,state:'failed'}),1);
  assert.equal(exitCodeOf({phase:'finalize',completed:true}),0);
  assert.equal(exitCodeOf({phase:'finalize',completed:false}),1);
  assert.equal(exitCodeOf({phase:'finalize',completed:'true'}),1);
  for(const x of [null,undefined,{},{ok:true,verified:true}])assert.equal(exitCodeOf(x),1,'eski biçim ya da boş: '+JSON.stringify(x));
  // CLI çıkış kodunu yalnız exitCodeOf belirler; bootstrap.cjs'te özel anahtar okuyan ya da imza atan yol yok.
  const src=fs.readFileSync(path.join(root,'tools/backup/bootstrap.cjs'),'utf8');
  const cli=src.slice(src.indexOf('async function cli('));
  assert.equal((cli.match(/process\.exitCode=/g)||[]).length,2);assert.match(cli,/process\.exitCode=exitCodeOf\(r\);/);assert.match(cli,/process\.exitCode=1;/);
  for(const re of [/createPrivateKey/,/crypto\.sign\(/,/C\.sign\(/,/PRIVATE KEY/,/loadSignKey/])assert.doesNotMatch(src,re);
  const mf=fs.readFileSync(path.join(root,'tools/backup/manual-flow.cjs'),'utf8');
  for(const re of [/createPrivateKey/,/crypto\.sign\(/,/C\.sign\(/])assert.doesNotMatch(mf,re);
});

test('migration geçmişi ve zamanlanmış işler: repo ile tutarlılık, kurtarma SQL\'i',()=>{
  const list=RM.repoMigrations();
  const hist=list.slice(0,32).map(m=>({version:m.version,name:m.file.slice(15,-4)}));
  const ok=RM.historyStatus(hist,list);
  // R1: ad dosyanın ad kısmıyla aynı olmalı. Tam dosya adı biçimi ("<14 hane>_<ad>.sql", Production'da ölçüldü)
  // normalize edilir ve sayısı raporlanır; addaki damga başka bir dosyanın sürümüyse belirsiz, bozuk biçim ve başka ad ret.
  const full=RM.historyStatus(hist.map((h,i)=>i===5?{...h,name:list[5].file}:h),list);
  assert.equal(full.ok,true);assert.equal(full.normalized,1);assert.deepEqual(full.timestamp_mismatch,[]);
  assert.deepEqual(RM.historyStatus(hist.map((h,i)=>i===5?{...h,name:list[4].version+list[5].file.slice(14)}:h),list).unknown,[list[5].version],'belirsiz damga');
  for(const bad of [list[5].file.toUpperCase(),list[5].file+' ',list[5].file.slice(0,-4),list[5].file.slice(15)])
    assert.deepEqual(RM.historyStatus(hist.map((h,i)=>i===5?{...h,name:bad}:h),list).unknown,[list[5].version],JSON.stringify(bad));
  assert.deepEqual(RM.historyStatus(hist.map((h,i)=>i===5?{...h,name:'baska_ad'}:h),list).unknown,[list[5].version]);
  assert.equal(ok.ok,true);assert.equal(ok.applied,32);assert.equal(ok.last,PROD_APPLIED);
  assert.deepEqual(ok.pending,list.slice(32).map(m=>m.file));
  assert.ok(ok.pending.length>=19);
  const unknown=RM.historyStatus([...hist,{version:'20991231000000',name:'x'}],list);
  assert.equal(unknown.ok,false);assert.deepEqual(unknown.unknown,['20991231000000']);
  const gap=RM.historyStatus(hist.filter((_,i)=>i!==10),list);
  assert.equal(gap.ok,false);assert.deepEqual(gap.gaps,[list[10].file]);
  const jobs=PROD_JOBS.map(([jobname,schedule,command])=>({jobname,schedule,command,active:true}));
  assert.equal(RM.cronStatus(jobs,{history:hist,list}).ok,true);
  assert.match(RM.cronStatus([{...jobs[0],schedule:'5 0 * * *'},jobs[1]],{history:hist,list}).problems.join(),/zaman farklı/);
  assert.match(RM.cronStatus([...jobs,{jobname:'elle',schedule:'* * * * *',command:'select 1'}],{history:hist,list}).problems.join(),/repoda olmayan iş/);
  assert.match(RM.cronStatus([jobs[0]],{history:hist,list}).problems.join(),/yedekte yok: nakgo-daily-stats/);
  // Repoda olmayan iş: kurtarma SQL'i HİÇ üretilmez (yedekteki komut SQL'e taşınmaz).
  assert.throws(()=>RM.renderRestoreSql({'supabase_migrations.schema_migrations':hist,'cron.job':[...jobs,{jobname:"o'ne",schedule:'1 1 * * *',command:'select $nakgo$x$nakgo$',active:false}]}),
    e=>e.code==='cron_mismatch'&&!e.message.includes('$nakgo$x'));
  const sql=RM.renderRestoreSql({'supabase_migrations.schema_migrations':hist,'cron.job':[{...jobs[0],active:false},jobs[1]]});
  assert.match(sql,/insert into supabase_migrations\.schema_migrations\(version,name\) values\('20261115184145'/);
  assert.match(sql,/active:=false/);assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;$/m);
  // Dolar tırnağı: repo komutu $nakgo$ içerse de güvenli etiket seçilir (repo tanımı, sentetik migration listesi).
  const synth=[{version:'20990101000000',file:'20990101000000_x.sql',sql:"select cron.schedule('one','1 1 * * *',$q$select $nakgo$x$nakgo$$q$);"}];
  const q=RM.renderRestoreSql({'supabase_migrations.schema_migrations':[{version:'20990101000000',name:'x'}],'cron.job':[{jobname:'one',schedule:'1 1 * * *',command:'select $nakgo$x$nakgo$',active:false}]},{list:synth});
  assert.match(q,/select cron\.schedule\('one','1 1 \* \* \*',\$nakgo1\$select \$nakgo\$x\$nakgo\$\$nakgo1\$\);/);
});

test('kurtarma SQL\'i işleri yalnız repodaki doğrulanmış tanımlardan üretir; yedekteki komut, ad ya da zaman uyuşmazsa SQL üretilmez ve ham değer yazılmaz',()=>{
  const MK='NAKGO-CRON-SIZINTI-TEST';
  const list=RM.repoMigrations();const repo=RM.repoCronJobs(list);
  const hist=list.slice(0,32).map(m=>({version:m.version,name:m.file.slice(15,-4)}));
  const jobs=PROD_JOBS.map(([jobname,schedule,command])=>({jobname,schedule,command,active:true}));
  const meta=j=>({'supabase_migrations.schema_migrations':hist,'cron.job':j});
  // Normal: SQL repo tanımlarından, yedekteki sırayla; etkinlik yedekten.
  const sql=RM.renderRestoreSql(meta([{...jobs[1],active:false},jobs[0]]),{list});
  const cronLines=sql.split('\n').filter(l=>/^select cron\./.test(l));
  const lit=x=>"'"+x.replace(/'/g,"''")+"'";
  assert.deepEqual(cronLines,[
    `select cron.schedule('nakgo-daily-stats',${lit(repo['nakgo-daily-stats'].schedule)},$nakgo$${repo['nakgo-daily-stats'].command}$nakgo$);`,
    "select cron.alter_job((select jobid from cron.job where jobname='nakgo-daily-stats'),active:=false);",
    `select cron.schedule('nakgo-retention',${lit(repo['nakgo-retention'].schedule)},$nakgo$${repo['nakgo-retention'].command}$nakgo$);`,
    "select cron.alter_job((select jobid from cron.job where jobname='nakgo-retention'),active:=true);"]);
  assert.match(sql,/to_regprocedure\('cron\.schedule\(text,text,text\)'\)/,'pg_cron koruması yerinde');
  // Boşluk farkı (aynı komut sayılır): SQL'e yedekteki değil repodaki metin yazılır.
  const spaced=RM.renderRestoreSql(meta([{...jobs[0],command:'  select   private.retention_run()  '},jobs[1]]),{list});
  assert.ok(spaced.includes('$nakgo$select private.retention_run()$nakgo$'));assert.ok(!spaced.includes('select   private'));
  // Uyuşmazlıklar: her biri SQL üretmeden durur; hata metninde ve sorunlarda işaretçi (ham komut/zaman/ad) yok.
  const cases=[
    ['komut',[{...jobs[0],command:jobs[0].command+' -- '+MK},jobs[1]],/komut farklı: nakgo-retention/],
    ['komut (gizli değer)',[{...jobs[0],command:`select net.http_post('https://x.example/h','{"key":"${MK}"}')`},jobs[1]],/komut farklı: nakgo-retention/],
    ['zaman',[{...jobs[0],schedule:'5 0 * * * '+MK},jobs[1]],/zaman farklı: nakgo-retention \(beklenen 0 0 \* \* \*\)/],
    ['ad',[{...jobs[0],jobname:'nakgo-retention-x',command:jobs[0].command+MK},jobs[1]],/repoda olmayan iş: nakgo-retention-x.*işi yedekte yok: nakgo-retention/],
    ['güvenli olmayan ad',[{jobname:MK+"'; drop table x; --",schedule:'* * * * *',command:'select 1',active:true},...jobs],/repoda olmayan iş: #[0-9a-f]{12}/],
    ['eksik iş',[jobs[1]],/işi yedekte yok: nakgo-retention/],
    ['yinelenen',[...jobs,{...jobs[0],command:MK}],/yinelenen iş: nakgo-retention/],
    ['geçersiz kayıt',[{...jobs[0],command:null},jobs[1]],/geçersiz iş kaydı/],
    ['prototip adı',[{jobname:'__proto__',schedule:'* * * * *',command:MK,active:true},...jobs],/repoda olmayan iş: __proto__/],
    ['liste değil',{x:MK},/okunamadı/]];
  for(const [label,j,re] of cases){
    let err=null;try{RM.renderRestoreSql(meta(j),{list});}catch(e){err=e;}
    assert.ok(err,label+': SQL üretilmemeli');assert.equal(err.code,'cron_mismatch',label);
    assert.match(err.message,re,label+': '+err.message);
    assert.ok(!err.message.includes(MK)&&!JSON.stringify(err.problems).includes(MK),label+': ham değer yok');
    const st=RM.cronStatus(j,{history:hist,list});assert.equal(st.ok,false,label);assert.ok(!JSON.stringify(st).includes(MK),label+': cronStatus');
  }
  // Yedekte cron.job yoksa (null) eski davranış: iş yok notu.
  assert.match(RM.renderRestoreSql({'supabase_migrations.schema_migrations':hist,'cron.job':null},{list}),/-- Yedekte zamanlanmış iş yok\./);
});

/* --- Gerçek PostgreSQL --- */
test('bootstrap ve kurtarma (gerçek PostgreSQL, Production biçiminde kaynak)',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump/pg_restore ve çoklu bağlantı yok');return;}
  const miss=ageMissing();if(miss){t.skip(miss);return;}
  if(!process.env.NAKGO_PG_SERVER){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error('NAKGO_PG_SERVER gerekli (referans derlemesi)');t.skip('NAKGO_PG_SERVER yok');return;}
  const P=await prodShaped();const db=P.db;const boot=uniqueRole('nakgo_boot');let primary=null;const dir=tmp();
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    if(!tool||tool<major){const msg=`pg_dump ${tool} sunucudan (${major}) eski`;if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(msg);t.skip(msg);return;}
    const password='test-only-'+boot;
    await db.exec(bootRoleSql(boot,password));
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:boot,password,database:db.name};
    const scope=BR.loadScope();
    // Güvenilir referans: Production'a uygulanmış 32 migration'ın gerçek sonucu (ağsız atılabilir küme).
    const REF=await require('../../tools/backup/reference-build.cjs').buildReference({installDir:process.env.NAKGO_PG_SERVER,list:RM.repoMigrations().slice(0,32),scope});
    const ids=[0,1].map(i=>{const f=path.join(dir,'id'+i+'.txt');execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
    const wrongId=path.join(dir,'wrong.txt');execFileSync('age-keygen',['-o',wrongId],{stdio:'ignore'});
    const recipientsFile=path.join(dir,'recipients.txt');
    fs.writeFileSync(recipientsFile,ids.map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
    const pinned=E.recipientsSha256(recipientsFile);
    const k2=C.testKeyPair();const trustedK2={[k2.keyId]:k2.publicKey};
    // İncelenmiş yapılandırmanın test karşılığı: sabitlenmiş alıcı hash'i (A, B) ve güvenilir K2 (K1 henüz yok).
    const CFG=withK9({version:1,recipients_sha256:pinned,trusted_k1:{},trusted_k2:{[k2.keyId]:k2.publicKey}});
    const work=path.join(dir,'work');fs.mkdirSync(work);
    const dumpTo=async(name,opts={})=>{const out=path.join(dir,name);return {out,r:await snapshotDump({conn,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap',...opts})};};
    const rm=p=>fs.rmSync(p,{recursive:true,force:true});

    const outDir=path.join(dir,'out');fs.mkdirSync(outDir,{mode:0o700});
    const now=new Date('2026-11-23T03:00:00Z');
    const bs=await runBootstrap({config:CFG,conn,outDir,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-1 yerel prova',
      runId:'boot1',now,allowLocal:true,workRoot:work});
    const bundle=path.join(dir,'bundle');

    await t.test('uçtan uca (run): bootstrap yedeği doğrulanır ve şifrelenir; imza isteği yazılır (çıkış 2); nihai manifest ve kayıt YOK; şifresiz dosya kalmaz',async()=>{
      assert.equal(bs.state,'signature_pending',JSON.stringify({failed:bs.failed,stages:bs.stages}));assert.equal(bs.backup_verified,true);assert.equal(bs.run_complete,true);
      assert.equal(exitCodeOfOk(bs),2);
      assert.equal(bs.stages.legal.status,'n/a');
      assert.match(bs.keys.data_key,/^manual\/db\/2026\/11\/23\/nakgo-20261123T030000Z-boot1\.tar\.age$/);
      assert.deepEqual(fs.readdirSync(work),[],'şifresiz çalışma klasörü silindi');
      assert.deepEqual((await new FileStore({dir:outDir}).list('manual/')).map(o=>o.key).sort(),[bs.keys.data_key,bs.request_key,bs.keys.reference_key].sort(),'yalnız paket, imza isteği ve T8 ölçümü');
      const req=MF.decodeRequestFile(fs.readFileSync(path.join(outDir,bs.request_key))).request;
      assert.equal(req.approval_ref,'TEST-ONAY-1 yerel prova');assert.equal(req.manifest.verified,true);assert.equal(req.manifest.source.mode,'bootstrap');
      assert.deepEqual({...req.claims.extra},{manifest_signature:'deferred',manifest_upload:'deferred',plaintext_cleanup:'ok'});
      // Sözleşme: bekleyen migration'lar yüzünden atlandı; çevrim dışı politikada istisna kodu gerekir.
      const pendingN=RM.repoMigrations().length-32;
      assert.deepEqual(bs.contract,{status:'skipped',rehearsal_required:true,pending:pendingN,reason:`kaynak repodan ${pendingN} migration geride; sözleşme provada denetlenir`});
      assert.equal(req.claims.contract,'skipped');
      assert.ok(!bs.restore_checks.some(c=>c.code==='contract'));
      for(const code of ['migration_history','cron_jobs','meta','counts','fingerprint']){
        assert.ok(bs.restore_checks.some(c=>c.code===code&&c.ok===true),code);assert.ok(req.claims.checks.some(c=>c.code===code&&c.ok===true),code);
      }
      const mh=bs.notes.find(n=>n.code==='migration_history');
      assert.equal(mh.ok,true);assert.equal(mh.applied,32);assert.equal(mh.pending.length,pendingN);assert.deepEqual(mh.unknown,[]);assert.deepEqual(mh.gaps,[]);
      assert.deepEqual({...req.claims.notes.migration_history},{ok:true,applied:32,pending:pendingN,unknown:0,gaps:0},'istekte yalnız sayılar');
      const raw=fs.readFileSync(path.join(outDir,bs.keys.data_key));
      assert.ok(raw.subarray(0,22).toString()==='age-encryption.org/v1\n','şifreli');
      assert.ok(!raw.includes(Buffer.from('test0@example.invalid')),'düz metin e-posta yok');
      const reqRaw=fs.readFileSync(path.join(outDir,bs.request_key));
      for(const x of ['test0@example.invalid',boot,password,'select '])assert.ok(!reqRaw.includes(Buffer.from(x)),'istekte yok: '+x.slice(0,8));
      assert.equal((await new FileStore({dir:outDir}).put(bs.keys.data_key,Buffer.from('x'),{ifNoneMatch:true})).status,412,'yedek üzerine yazılamaz');
    });

    await t.test('paket: K1 yolu elle yedeği seçmez ve reddeder; çözme yalnız A/B ile',async()=>{
      const store=new FileStore({dir:outDir});
      const ct=path.join(dir,'boot.tar.age');fs.copyFileSync(path.join(outDir,bs.keys.data_key),ct);
      assert.equal((await DR.fetchVerified({store,manifestKey:bs.keys.manifest_key,trustedK1:trustedK2,pinnedRecipientsSha256:pinned,outFile:path.join(dir,'x1')})).code,'manual_key');
      assert.equal((await DR.fetchLatest({store,trustedK1:trustedK2,pinnedRecipientsSha256:pinned,outFile:path.join(dir,'x2')})).code,'none');
      const w=spawnSync('age',['-d','-i',wrongId,'-o',path.join(dir,'w.tar'),ct]);assert.notEqual(w.status,0,'yanlış anahtar çözemez');
      fs.rmSync(path.join(dir,'w.tar'),{force:true});
      fs.mkdirSync(bundle,{mode:0o700});
      execFileSync('bash',['-c','set -o pipefail; age -d -i "$1" "$2" | tar -xf - -C "$3"','bash',ids[1],ct,bundle]);
    });

    await t.test('paket içeriği: kip, salt okunurluk, kapsam, belirteç ve geçici veri dışlanmış, meta tam',async()=>{
      const src=JSON.parse(fs.readFileSync(path.join(bundle,'source.json'),'utf8'));
      assert.equal(src.mode,'bootstrap');assert.equal(src.dump_role,boot);
      assert.deepEqual(src.read_only,RO_SOURCE);assert.equal(PG_DUMP_TRANSACTION,RO_SOURCE.pg_dump_transaction);
      assert.equal(src.coverage.unclassified,0);assert.equal(src.coverage.tables,PROD_AUX_TABLES.length,'Production envanteri: 38 Auth/Storage/Vault tablosu');
      assert.equal(src.guard_counts['storage.bucket_lifecycle_states'],0);assert.equal(src.guard_counts['storage.lifecycle_abandoned_artifacts'],0);
      assert.deepEqual(src.external_triggers.map(x=>x.table+'.'+x.name),['auth.sessions.nakgo_access_log']);
      assert.ok(fs.existsSync(path.join(bundle,'X.pre.sql')));
      assert.equal(src.guard_counts['auth.instances'],0);assert.equal(src.guard_counts['vault.secrets'],0);assert.equal(src.guard_counts['storage.objects'],0);
      const files=fs.readdirSync(path.join(bundle,'B')).sort();
      assert.deepEqual(files,['auth.identities.jsonl','auth.mfa_factors.jsonl','auth.schema_migrations.jsonl','auth.users.jsonl','storage.buckets.jsonl','storage.objects.jsonl']);
      const all=execFileSync('bash',['-c','cat "$1"/source.json "$1"/B/*.jsonl "$1"/meta/*.jsonl "$1"/*.sql; pg_restore_bin="$2"; "$2" -f - -a "$1"/A.dump','bash',bundle,path.join(process.env.NAKGO_PG_BIN||'/usr/bin','pg_restore')],{maxBuffer:1<<28}).toString();
      for(const tok of ['TOK-CONF-','TOK-RECOV-','TOK-REFRESH-','TOK-OTT-HASH','TOK-FLOW'])assert.ok(!all.includes(tok),'yedekte olmamalı: '+tok);
      const users=fs.readFileSync(path.join(bundle,'B/auth.users.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
      assert.equal(users.length,7);for(const u of users){assert.equal(u.confirmation_token,'');assert.equal(u.recovery_token,'');assert.equal(u.encrypted_password,'$2a$10$hashonly');}
      assert.equal(src.meta_files['cron.job'].rows,2);assert.equal(src.meta_files['supabase_migrations.schema_migrations'].rows,32);
      const m=SE.readMeta(bundle,src.meta_files);
      assert.deepEqual(m['cron.job'].map(j=>j.jobname).sort(),['nakgo-daily-stats','nakgo-retention']);
      assert.ok(!('statements' in m['supabase_migrations.schema_migrations'][0]),'migration SQL metni alınmaz');
    });

    await t.test('boş veritabanına geri yükleme: bütün S1 denetimleri, meta, RLS/ACL, migration geçmişi ve cron notları',async()=>{
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      for(const code of ['restore','counts','b_content','fk_orphans','fingerprint','auth_version','meta'])assert.ok(v.checks.some(c=>c.code===code&&c.ok),code);
      // Kaynak repodan geride: sözleşme bu kopyada değil, provada (migration'lardan sonra) denetlenir.
      assert.ok(!v.checks.some(c=>c.code==='contract'));assert.match(v.notes.find(n=>n.code==='contract').reason,/migration geride/);
      assert.deepEqual(v.notes.find(n=>n.code==='external_triggers').triggers,['auth.sessions.nakgo_access_log']);
      const h=v.notes.find(n=>n.code==='migration_history');
      assert.equal(h.ok,true);assert.equal(h.applied,32);
      assert.deepEqual(h.pending,RM.repoMigrations().slice(32).map(m=>m.file));
      assert.equal(v.notes.find(n=>n.code==='cron_jobs').ok,true);
    });

    await t.test('kurtarma SQL\'i geri yüklenmiş kopyada çalışır: zamanlanmış işler, migration geçmişi ve giriş tetikleyicisi geri gelir; pg_cron yoksa hiçbir şey yazılmaz; iki kez çalıştırmak aynı sonucu verir',async()=>{
      const src=JSON.parse(fs.readFileSync(path.join(bundle,'source.json'),'utf8'));
      const out={};
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,hooks:{restore_sql:async rdb=>{
        const meta=SE.readMeta(bundle,src.meta_files);
        // Etkinlik de geri gelmeli: işlerden biri yedekte pasif olsun.
        meta['cron.job']=meta['cron.job'].map(j=>j.jobname==='nakgo-daily-stats'?{...j,active:false}:j);
        const sql=RM.renderRestoreSql(meta,{externalTriggers:src.external_triggers,expected:{cron:REF.cron,triggers:REF.triggers}});
        try{await rdb.exec(sql);out.without_cron='çalıştı';}catch(e){out.without_cron=e.message;await rdb.exec('rollback').catch(()=>{});}
        out.history_without_cron=(await rdb.query(`select to_regclass('supabase_migrations.schema_migrations')::text r`)).rows[0].r;
        // Hedefte Supabase'in hazır sunduğu nesneler: auth.sessions (yapısı X.pre.sql) ve pg_cron API'si (taklit).
        await rdb.exec(fs.readFileSync(path.join(bundle,'X.pre.sql'),'utf8'));
        await rdb.exec(PG_CRON_API);
        await rdb.exec(sql);
        const snap=async()=>({jobs:(await rdb.query(`select jobname,schedule,command,active from cron.job order by jobname`)).rows,
          history:(await rdb.query(`select version,name from supabase_migrations.schema_migrations order by version`)).rows,
          triggers:(await rdb.query(`select tgname from pg_trigger where tgrelid='auth.sessions'::regclass and not tgisinternal order by 1`)).rows.map(r=>r.tgname)});
        out.first=await snap();
        await rdb.exec(sql);
        out.second=await snap();
        // Giriş tetikleyicisi gerçekten çalışıyor: oturum eklemek giriş günlüğüne satır yazar.
        const before=Number((await rdb.query('select count(*) n from private.access_log')).rows[0].n);
        await rdb.query(`insert into auth.sessions(user_id) values($1)`,[P.ids[1]]);
        out.access_log_delta=Number((await rdb.query('select count(*) n from private.access_log')).rows[0].n)-before;
        out.pending=RM.historyStatus(out.first.history).pending.length;
        return {ok:true,detail:'ok'};
      }}});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      assert.match(out.without_cron,/pg_cron yok/);assert.equal(out.history_without_cron,null,'pg_cron yokken geçmiş de yazılmadı');
      assert.deepEqual(out.first.jobs,[
        {jobname:'nakgo-daily-stats',schedule:PROD_JOBS[1][1],command:PROD_JOBS[1][2],active:false},
        {jobname:'nakgo-retention',schedule:PROD_JOBS[0][1],command:PROD_JOBS[0][2],active:true}]);
      assert.deepEqual(out.first.history.map(r=>r.version),P.list.map(m=>m.name.slice(0,14)));
      assert.deepEqual(out.first.triggers,['nakgo_access_log']);
      assert.deepEqual(out.second,out.first,'ikinci çalıştırma aynı sonucu verir');
      assert.equal(out.access_log_delta,1);
      assert.equal(out.pending,RM.repoMigrations().length-32);
    });

    let report=null;
    const dataChecks=async rdb=>{
      // Gerçek (geri yüklenmiş) veri üstünde: #157 doldurması, saklama işareti, yasal korumalar, gece temizliği.
      const post={};
      post.suspended=(await rdb.query(`select bool_and(owner_suspended) a,count(*)::int n from public.listings where owner_id=$1`,[P.suspended])).rows[0];
      post.others=(await rdb.query(`select count(*)::int n from public.listings where owner_suspended and owner_id<>$1`,[P.suspended])).rows[0].n;
      post.hold=(await rdb.query(`select hold from private.listing_moderation where listing_id=$1`,[P.held])).rows[0].hold;
      await rdb.exec('begin');
      try{
        let code=null;await rdb.exec('savepoint s');try{await rdb.query('delete from public.listings where id=$1',[P.held]);}catch(e){code=e.code;}await rdb.exec('rollback to savepoint s');
        post.held_delete=code;
        await rdb.query('select private.retention_run()');
        post.held_after_retention=(await rdb.query('select count(*)::int n from public.listings where id=$1',[P.held])).rows[0].n;
      }finally{await rdb.exec('rollback');}
      // Askıyı panel yoluyla kaldır: geri yüklenmiş kopyada da çalışmalı; kaldırınca işaret iner.
      const rev=(await rdb.query('select revision from private.account_moderation where user_id=$1',[P.suspended])).rows[0].revision;
      await rdb.exec('begin');
      try{
        await rdb.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims','{"aal":"aal2"}',true)`,[P.admin]);
        await rdb.exec('set local role authenticated');
        await rdb.query(`select public.nakgo_admin_moderate('user',$1,'resume','Prova askı kaldır',$2)`,[P.suspended,rev]);
        await rdb.exec('commit');
      }catch(e){await rdb.exec('rollback');throw e;}
      post.after_resume=(await rdb.query(`select count(*)::int n from public.listings where owner_suspended`)).rows[0].n;
      return post;
    };
    await t.test('migration provası: bekleyenler geri yüklenmiş kopyada dosya sırasıyla, kilit ve süre ölçülerek; şema, sözleşme, veri dönüşümleri ve BÜTÜN fixture\'lar',async()=>{
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,hooks:{
        rehearsal:rehearsalHook({expectedTriggers:REF.triggers,beforeFixtures:dataChecks,onReport:r=>{report=r;}})}});
      if(process.env.NAKGO_REHEARSAL_REPORT)fs.writeFileSync(process.env.NAKGO_REHEARSAL_REPORT,JSON.stringify({checks:v.checks,notes:v.notes,rehearsal:report},null,1));
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok),null,1).slice(0,4000));
      const pending=RM.repoMigrations().slice(32).map(m=>m.file);
      assert.equal(pending.length,19,'Production\'da bekleyen 19 migration');
      assert.deepEqual(report.migrations.map(m=>m.file),pending,'dosya sırasıyla, hepsi');
      assert.ok(report.migrations.every(m=>m.ok&&m.ms>=0));
      assert.deepEqual(report.schema.missing,[]);assert.deepEqual(report.schema.extra,[]);
      assert.deepEqual(report.contract.fails,[]);
      assert.deepEqual(report.external_triggers,['auth.sessions.nakgo_access_log']);
      assert.ok(report.fixtures.length>=29&&report.fixtures.every(f=>f.ok),JSON.stringify(report.fixtures.filter(f=>!f.ok)));
      const post=report.data;
      assert.deepEqual(post.suspended,{a:true,n:2},'askıdaki sahibin ilanları işaretlendi');assert.equal(post.others,0);
      assert.equal(post.hold,true,'saklama işareti korundu');
      assert.equal(post.held_delete,'55000','saklamadaki ilan silinemez');
      assert.equal(post.held_after_retention,1,'saklamadaki ilan gece temizliğinden sonra da yerinde');
      assert.equal(post.after_resume,0,'askı kalkınca işaret iner');
    });

    await t.test('fixture kapısı: gerçek veride bir fixture başarısızsa prova BAŞARISIZ olur (gevşetme yok)',async()=>{
      // Askı kaldırılmadan (beforeFixtures yok) zengin veride suspended-owner-flag.sql'in varsayımı bozulur.
      let rep=null;
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,hooks:{rehearsal:rehearsalHook({expectedTriggers:REF.triggers,onReport:x=>{rep=x;}})}});
      assert.equal(v.status,'failed');
      assert.ok(v.checks.some(c=>c.code==='rehearsal'&&!c.ok));
      assert.ok(rep.migrations.every(m=>m.ok),'migration\'lar yine de uygulandı');
      assert.deepEqual(rep.fixtures.filter(f=>!f.ok).map(f=>f.file),['suspended-owner-flag.sql']);
      assert.match(rep.fixtures.find(f=>!f.ok).error,/FAIL other owners flagged/);
    });

    await t.test('O5 prova: yedekteki tetikleyici tanımı çalıştırılmaz; referans yoksa ya da yedekteki tanım farklıysa prova durur; X.pre.sql katı biçim',async()=>{
      const MK='NAKGO-TRIGGER-SIZINTI';
      const d=path.join(dir,'o5-bundle');fs.cpSync(bundle,d,{recursive:true});
      const srcF=path.join(d,'source.json');const src=JSON.parse(fs.readFileSync(srcF,'utf8'));
      let rep=null;const runR=async opts=>restoreAndVerify({bundleDir:d,pgBin:process.env.NAKGO_PG_BIN,hooks:{rehearsal:rehearsalHook({...opts,onReport:x=>{rep=x;}})}});
      let v=await runR({});assert.equal(v.status,'failed');assert.match(rep.error,/referans derlemesi \(expectedTriggers\) gerekli/);
      src.external_triggers=src.external_triggers.map(x=>({...x,def:x.def.replace('private.log_login()',`private.log_login() /* ${MK} */`)}));fs.writeFileSync(srcF,JSON.stringify(src));
      v=await runR({expectedTriggers:REF.triggers});assert.equal(v.status,'failed');assert.match(rep.error,/dış tetikleyiciler referansla uyuşmuyor: tetikleyici tanımı farklı: nakgo_access_log/);
      assert.ok(!JSON.stringify(rep).includes(MK),'raporda yedekteki tanım yok');assert.equal(rep.migrations,undefined,'hiçbir migration uygulanmadı');
      // X.pre.sql: izin verilmeyen deyim (yedekten gelen SQL) çalıştırılmaz.
      const d2=path.join(dir,'o5-xpre');fs.cpSync(bundle,d2,{recursive:true});
      fs.appendFileSync(path.join(d2,'X.pre.sql'),'\ncreate table auth.x (\n id int default (select 1)\n);\n');
      rep=null;v=await restoreAndVerify({bundleDir:d2,pgBin:process.env.NAKGO_PG_BIN,hooks:{rehearsal:rehearsalHook({expectedTriggers:REF.triggers,onReport:x=>{rep=x;}})}});
      assert.equal(v.status,'failed');assert.match(rep.error,/X\.pre\.sql izin verilmeyen ifade/);
      fs.rmSync(d,{recursive:true,force:true});fs.rmSync(d2,{recursive:true,force:true});
    });

    await t.test('Production\'a sadık veri: bekleyen migration\'lar ve BÜTÜN fixture\'lar geri yüklenmiş kopyada geçer',async()=>{
      const F=await prodShaped({rich:false});const role2=uniqueRole('nakgo_boot_f');let p2=null;
      try{
        await F.db.exec(bootRoleSql(role2,'test-only-'+role2));
        const c2={...conn,user:role2,password:'test-only-'+role2,database:F.db.name};
        const out=path.join(dir,'faithful');
        const r=await snapshotDump({conn:c2,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap'});
        assert.equal(r.status,'ok',JSON.stringify(r.reasons));
        let rep=null;
        const v=await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN,hooks:{rehearsal:rehearsalHook({expectedTriggers:REF.triggers,onReport:x=>{rep=x;}})}});
        assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)).slice(0,3000));
        assert.ok(rep.fixtures.length>=29&&rep.fixtures.every(f=>f.ok));
        assert.equal(rep.migrations.length,RM.repoMigrations().length-32);
        rm(out);
      }catch(e){p2=e;throw e;}
      finally{await finish(F.db,p2);await dropRoles([role2]);}
    });

    await t.test('anlık görüntü tutarlılığı: döküm sürerken yazılan satırlar yedeğe girmez, sayılar S1 ile birebir',async()=>{
      let stop=false,written=0;
      const writer=(async()=>{while(!stop){await db.query(`insert into private.admin_audit(actor_id,target,action,reason,revision) values($1,'x','suspend','yazıcı',1)`,[P.admin]);written++;await new Promise(r=>setTimeout(r,5));}})();
      const {out,r}=await dumpTo('snap',{delayBeforeDumpMs:1500});
      stop=true;await writer;
      assert.equal(r.status,'ok',JSON.stringify(r.reasons));
      const live=Number((await db.query('select count(*) n from private.admin_audit')).rows[0].n);
      assert.ok(written>5&&live>r.source.counts['private.admin_audit'],'canlı sayı büyüdü');
      const v=await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      rm(out);
    });

    const metaFail=async(label,runId,hour,setup,undo,code,re)=>{
      const o=path.join(dir,'mf-'+runId);fs.mkdirSync(o);
      const t2=new Date(`2026-11-23T${hour}:00:00Z`);
      await setup();
      let r;try{r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-MF',runId,now:t2,allowLocal:true,workRoot:work});}
      finally{await undo();}
      assert.equal(r.backup_verified,false,label+': doğrulanmış sayılmaz');
      assert.equal(r.stages.restore_test.status,'failed',label);assert.equal(r.stages.restore_test.code,code,label+': '+JSON.stringify(r.stages.restore_test));
      assert.match(r.stages.restore_test.reason,re,label);
      for(const k of ['encryption','upload'])assert.equal(r.stages[k].status,'skipped',label+': '+k);
      assert.deepEqual(await new FileStore({dir:o}).list('manual/db/'),[],label+': şifreli paket yazılmadı');
      assert.equal(r.state,'failed',label);assert.equal(r.run_complete,false,label);assert.ok(r.failed.includes('verified'),label);assert.equal(r.request_key,null);
      assert.equal(require('../../tools/backup/bootstrap.cjs').exitCodeOf(r),1,label+': CLI çıkış kodu 1');
      // Yalnız başarısızlık raporu (sabit kodlar): imza isteği, manifest ve kayıt yok.
      assert.deepEqual((await new FileStore({dir:o}).list('manual/')).map(x=>x.key),[r.failed_key],label);
      const rep=MF.validateFailed(SJ.parseCanonical(fs.readFileSync(path.join(o,r.failed_key))));
      assert.equal(rep.failed_stage,'restore_test',label);assert.ok(rep.codes.includes(code),label+': '+rep.codes);assert.equal(rep.stages.restore_test,'failed');
      fs.rmSync(o,{recursive:true,force:true});
      return r;
    };
    await t.test('migration geçmişi ya da zamanlanmış işler repo ile tutarsızsa bootstrap doğrulanmaz ve tamamlanmaz (runbook DURDURMA kodda)',async()=>{
      const list=RM.repoMigrations();
      let rec=await metaFail('repoda olmayan migration','mfunknown','08',
        ()=>db.exec(`insert into supabase_migrations.schema_migrations(version,name) values('20200101000000','elle_uygulanmis')`),
        ()=>db.exec(`delete from supabase_migrations.schema_migrations where version='20200101000000'`),'migration_history',/20200101000000/);
      assert.deepEqual(rec.notes.find(n=>n.code==='migration_history').unknown,['20200101000000'],'not da korunur');
      const mid=list[10];
      const row=(await db.query(`select * from supabase_migrations.schema_migrations where version=$1`,[mid.version])).rows[0];
      assert.ok(row,'ortadaki migration geçmişte');
      rec=await metaFail('geçmişte boşluk','mfgap','09',
        ()=>db.query(`delete from supabase_migrations.schema_migrations where version=$1`,[mid.version]),
        ()=>db.query(`insert into supabase_migrations.schema_migrations(version,name) values($1,$2)`,[row.version,row.name]),'migration_history',new RegExp(mid.file.replace('.','\\.')));
      assert.deepEqual(rec.notes.find(n=>n.code==='migration_history').gaps,[mid.file]);
      rec=await metaFail('iş zamanı repodan farklı','mfcron','10',
        ()=>db.exec(`update cron.job set schedule='15 1 * * *' where jobname='nakgo-retention'`),
        ()=>db.query(`update cron.job set schedule=$1 where jobname='nakgo-retention'`,[PROD_JOBS[0][1]]),'cron_jobs',/zaman farklı: nakgo-retention/);
      rec=await metaFail('repoda olmayan iş','mfcronx','11',
        ()=>db.exec(`insert into cron.job(jobname,schedule,command) values('elle-is','* * * * *','select 1')`),
        ()=>db.exec(`delete from cron.job where jobname='elle-is'`),'cron_jobs',/repoda olmayan iş: elle-is/);
      rec=await metaFail('uygulanmış migration\'ın işi eksik','mfcronmiss','12',
        ()=>db.exec(`update cron.job set jobname='nakgo-retention-x' where jobname='nakgo-retention'`),
        ()=>db.exec(`update cron.job set jobname='nakgo-retention' where jobname='nakgo-retention-x'`),'cron_jobs',/repoda olmayan iş|işi yedekte yok/);
      // Kaynak geri döndü: normal çalışma yine tamamlanır (önceki uçtan uca sonuç).
      assert.equal(exitCodeOfOk(bs),2);
    });

    await t.test('geri yükleme hatasındaki veri (işaretçili geçersiz UUID) manifeste ve onay kaydına ulaşmaz; terminal teşhisi korunur',async()=>{
      const MK='NAKGO-SIZINTI-7f3a9c';
      const o=path.join(dir,'leak');fs.mkdirSync(o);
      const t2=new Date('2026-11-23T13:00:00Z');
      // Test enjeksiyonu: pipeline'ın çalışma klasöründeki paket, geri yüklemeden hemen önce okunurken auth.users'ın ilk
      // satırının kimliği geçersiz bir UUID (işaretçi) yapılır; source.json'daki hash buna göre verilir ki bozukluk değil
      // gerçek bir PostgreSQL tür hatası (jsonb_populate_recordset) oluşsun.
      const orig=fs.readFileSync;let tampered=null,injected=0;
      fs.readFileSync=function(p,...a){
        const f=String(p);
        if(f.startsWith(work)&&f.endsWith(path.sep+'bundle'+path.sep+'source.json')){
          const src=JSON.parse(orig.call(fs,p,'utf8'));const bf=src.b_files['auth.users'];
          const file=path.join(path.dirname(f),bf.file);
          const lines=orig.call(fs,file,'utf8').split('\n').filter(Boolean);const u=JSON.parse(lines[0]);u.id=MK;lines[0]=JSON.stringify(u);
          tampered={file,buf:Buffer.from(lines.join('\n')+'\n')};bf.sha256=require('node:crypto').createHash('sha256').update(tampered.buf).digest('hex');injected++;
          const out=JSON.stringify(src);return a[0]==='utf8'||(a[0]&&a[0].encoding)?out:Buffer.from(out);
        }
        if(tampered&&f===tampered.file)return a[0]==='utf8'||(a[0]&&a[0].encoding)?tampered.buf.toString('utf8'):tampered.buf;
        return orig.call(fs,p,...a);
      };
      let r;
      try{r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-LEAK',runId:'leak',now:t2,allowLocal:true,workRoot:work});}
      finally{fs.readFileSync=orig;}
      assert.equal(injected,1,'enjeksiyon yapıldı');
      assert.equal(r.backup_verified,false);assert.equal(r.stages.restore_test.status,'failed');assert.equal(r.stages.restore_test.code,'restore_b',JSON.stringify(r.stages.restore_test));
      // Terminal (ham): teşhis ve değer görünür.
      assert.match(r.stages.restore_test.reason,new RegExp('invalid input syntax for type uuid: "'+MK+'"'));
      const lines=require('../../tools/backup/bootstrap.cjs').terminalLines(r);
      assert.ok(lines.some(l=>/aşama restore_test başarısız \(restore_b\)/.test(l)&&l.includes('invalid input syntax for type uuid')&&l.includes(MK)),lines.join('\n'));
      // Kalıcı dosyalar: çıktı klasöründeki HER dosya (yalnız başarısızlık raporu) işaretçiyi içermez; şifresiz çalışma klasörü silindi.
      const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):files.push(p);}};walk(o);
      assert.deepEqual(files.map(f=>path.relative(o,f).split(path.sep).join('/')),[r.failed_key]);
      for(const f of files)assert.ok(!fs.readFileSync(f).includes(Buffer.from(MK)),'işaretçi yok: '+path.relative(o,f));
      assert.deepEqual(fs.readdirSync(work),[],'çalışma klasörü temiz');
      const rep=MF.validateFailed(SJ.parseCanonical(fs.readFileSync(files[0])));
      assert.equal(rep.failed_stage,'restore_test');assert.ok(rep.codes.includes('restore_b'));assert.equal(rep.stages.restore_test,'failed');
      assert.equal(require('../../tools/backup/bootstrap.cjs').exitCodeOf(r),1);
      fs.rmSync(o,{recursive:true,force:true});
    });

    await t.test('hard link yoksa gerçek sunucuya hiçbir bağlantı açılmaz (kaydeden vekil); geçerse aynı çıktı klasörüne yedek yazılır',async()=>{
      const proxy=await startOptionsDroppingProxy({targetHost:process.env.NAKGO_PG_HOST,targetPort:Number(process.env.NAKGO_PG_PORT||5432),drop:[]});
      const o=path.join(dir,'probe-real');fs.mkdirSync(o);
      try{
        const pconn={...conn,host:'127.0.0.1',port:proxy.port};
        const run=hour=>runBootstrap({config:CFG,conn:pconn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-PROBE',runId:'probereal',now:new Date(`2026-11-23T${hour}:00:00Z`),allowLocal:true,workRoot:work});
        const r=await failLink('EPERM',()=>run('16'));
        assert.equal(proxy.conns.length,0,'sunucuya hiç bağlantı yok');
        assert.deepEqual(r.failed,['storage_probe']);assert.equal(exitCodeOfOk(r),1);
        assert.deepEqual(filesUnder(o),[]);assert.deepEqual(fs.readdirSync(work),[]);
        // Aynı klasör, hard link çalışırken: normal yol (bağlantı açılır, yedek doğrulanır ve yazılır).
        const ok=await run('17');
        assert.equal(exitCodeOfOk(ok),2,JSON.stringify(ok.stages));assert.ok(proxy.conns.length>=2);
        assert.equal((await new FileStore({dir:o}).list('manual/')).length,3,'paket, imza isteği ve T8 ölçümü');
        assert.ok(!filesUnder(o).some(f=>path.basename(f).startsWith('.nakgo-tmp-')),'deneme/geçici dosya yok');
      }finally{await proxy.close();fs.rmSync(o,{recursive:true,force:true});}
    });

    await t.test('her gerçek yazım klasöründe hard link yoksa gerçek sunucuya hiçbir bağlantı açılmaz (kaydeden vekil)',async()=>{
      const proxy=await startOptionsDroppingProxy({targetHost:process.env.NAKGO_PG_HOST,targetPort:Number(process.env.NAKGO_PG_PORT||5432),drop:[]});
      try{
        const pconn={...conn,host:'127.0.0.1',port:proxy.port};
        for(const [i,target] of TARGETS.entries()){
          const o=path.join(dir,'probe-target-'+i);fs.mkdirSync(o);
          const r=await failLinkIn(target,'EPERM',()=>runBootstrap({config:CFG,conn:pconn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-HEDEF',
            runId:'hedef'+i,now:new Date('2026-11-23T18:00:00Z'),allowLocal:true,workRoot:work}));
          assert.equal(proxy.conns.length,0,target+': sunucuya hiç bağlantı yok');
          assert.deepEqual(r.failed,['storage_probe'],target);assert.equal(exitCodeOfOk(r),1);
          assert.deepEqual(filesUnder(o),[],target);assert.deepEqual(fs.readdirSync(work),[]);
          fs.rmSync(o,{recursive:true,force:true});
        }
      }finally{await proxy.close();}
    });

    /* Y3: gerçek sinyal testleri. Bootstrap ayrı bir Node sürecinde (CLI ile aynı işleyici: installSignalHandlers) çalışır;
     * pg_dump/pg_restore gerçek PG17 ikilileri önünde ince sarmalayıcılardır:
     *   dump   : gerçek pg_dump başlatılır ve kaynakta bekleyen bir kilit yüzünden GERÇEKTEN takılı kalır (S1 açık, döküm sürüyor);
     *   restore: geçici doğrulama veritabanı oluşmuş, şifresiz paket diskte; sarmalayıcı bir torun süreç (sleep) başlatıp bekler.
     * Sinyal YALNIZ bootstrap sürecine gönderilir (grup değil): alt süreçleri sonlandırmak bootstrap'ın işidir. */
    const sigCase=async({stage,signal,failWorkRm=false})=>{
      const label=stage+' '+signal+(failWorkRm?' (temizlik hatası)':'');
      const base=path.join(dir,'sig-'+stage+'-'+signal+(failWorkRm?'-rmfail':''));fs.mkdirSync(base);
      const bin=path.join(base,'bin'),out=path.join(base,'out'),wroot=path.join(base,'work'),hold=path.join(base,'hold.json');
      fs.mkdirSync(bin);fs.mkdirSync(out);fs.mkdirSync(wroot);
      const real=process.env.NAKGO_PG_BIN;
      const head=`#!${process.execPath}\nconst {spawn,spawnSync}=require('child_process'),fs=require('fs');const a=process.argv.slice(2);\n`;
      const pass=name=>`const r=spawnSync(${JSON.stringify(path.join(real,'x'))}.replace(/x$/,'${name}'),a,{stdio:'inherit'});process.exit(r.status===null?1:r.status);`;
      fs.writeFileSync(path.join(bin,'pg_dump'),head+(stage!=='dump'?pass('pg_dump'):`if(a.includes('--version'))${'{'+pass('pg_dump')+'}'}
const dbg=m=>fs.appendFileSync(process.env.NAKGO_SIG_HOLD+'.log',m+'\\n');dbg('başla '+a.join(' '));
(async()=>{const {Client}=require('pg');
  // Kilit ve izleme: test yöneticisi rolüyle (yedek rolü salt okunur ve kilit yetkisi yok).
  const adm={user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD};
  const lk=new Client({...adm,application_name:'nakgo-test-lock'});lk.on('error',()=>{});await lk.connect();
  const mon=new Client({...adm,application_name:'nakgo-test-mon'});mon.on('error',()=>{});await mon.connect();
  dbg('bağlandı');const lpid=(await lk.query('select pg_backend_pid() p')).rows[0].p;dbg('lpid '+lpid);
  lk.query('begin').then(()=>lk.query('lock table public.listings in access exclusive mode')).catch(()=>{});
  let it=0;for(;;){if((await mon.query("select 1 from pg_locks where pid=$1 and locktype='relation' and relation='public.listings'::regclass and mode='AccessExclusiveLock'",[lpid])).rows.length)break;if(++it%100===0)dbg('bekliyor '+JSON.stringify((await mon.query("select locktype,relation::regclass::text r,mode,granted from pg_locks where pid=$1",[lpid])).rows)+' '+JSON.stringify((await mon.query("select state,wait_event_type,query from pg_stat_activity where pid=$1",[lpid])).rows));await new Promise(r=>setTimeout(r,20));}
  dbg('kilit istendi');const c=spawn(${JSON.stringify(path.join(real,'pg_dump'))},a,{stdio:['ignore','inherit','inherit']});
  let bp=null;for(;;){const q=(await mon.query("select pid from pg_stat_activity where datname=current_database() and application_name='nakgo-backup' and wait_event_type='Lock' and pid<>$1",[lpid])).rows;if(q.length){bp=q[0].pid;break;}await new Promise(r=>setTimeout(r,20));}
  await mon.end();
  fs.writeFileSync(process.env.NAKGO_SIG_HOLD,JSON.stringify({wrapper:process.pid,child:c.pid,backend:bp}));
  c.on('exit',code=>process.exit(code===null?1:code));
})().catch(e=>{process.stderr.write(String(e));process.exit(1);});`),{mode:0o755});
      fs.writeFileSync(path.join(bin,'pg_restore'),head+(stage!=='restore'?pass('pg_restore'):`if(a.includes('--version')||a.includes('-l'))${'{'+pass('pg_restore')+'}'}
const c=spawn('sleep',['600'],{stdio:'ignore'});
fs.writeFileSync(process.env.NAKGO_SIG_HOLD,JSON.stringify({wrapper:process.pid,child:c.pid}));
c.on('exit',code=>process.exit(code===null?1:code));`),{mode:0o755});
      const params={conn,outDir:out,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-SIG',runId:'sig',now:'2026-11-23T20:00:00Z',allowLocal:true,workRoot:wroot,config:CFG};
      const pf=path.join(base,'params.json');fs.writeFileSync(pf,JSON.stringify(params),{mode:0o600});
      const script=path.join(base,'child.cjs');
      fs.writeFileSync(script,`const fs=require('fs');const B=require(${JSON.stringify(path.join(root,'tools/backup/bootstrap.cjs'))});
const P=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
B.installSignalHandlers();
if(${failWorkRm}){const o=fs.rmSync;fs.rmSync=function(p,...x){if(/nakgo-backup-/.test(String(p)))throw Object.assign(Error('EBUSY: simüle edilmiş silme hatası'),{code:'EBUSY'});return o.call(fs,p,...x);};}
B.runBootstrap({...P,now:new Date(P.now)}).then(r=>{process.stdout.write('BITTI '+JSON.stringify({completed:r.completed,failed:r.failed})+'\\n');process.exitCode=B.exitCodeOf(r);},e=>{process.stdout.write('HATA '+e.message+'\\n');process.exitCode=1;});`);
      const ch=require('node:child_process').spawn(process.execPath,[script,pf],{env:{...process.env,NAKGO_PG_BIN:bin,NAKGO_SIG_HOLD:hold},stdio:['ignore','pipe','pipe']});
      let so='',se='';ch.stdout.on('data',d=>so+=d);ch.stderr.on('data',d=>se+=d);
      const exited=new Promise(r=>ch.on('exit',(code,sig)=>r({code,sig})));
      let ended=null;exited.then(x=>{ended=x;});
      // Test başarısız olsa bile (ör. mutasyon) sahipsiz süreç bırakmamak için: bitişte kalan her şey öldürülür.
      let H=null;
      try{
      const t0=Date.now();while(!fs.existsSync(hold)){if(ended)assert.fail(label+': bootstrap beklenen aşamaya gelmeden bitti '+JSON.stringify(ended)+' '+so+se);if(Date.now()-t0>60000){ch.kill('SIGKILL');assert.fail(label+': zaman aşımı '+so+se+(fs.existsSync(hold+'.log')?fs.readFileSync(hold+'.log','utf8'):''));}await new Promise(r=>setTimeout(r,50));}
      await new Promise(r=>setTimeout(r,100));
      H=JSON.parse(fs.readFileSync(hold,'utf8'));
      const own="nakgo_check_"+ch.pid+"_%";
      const checkDbs=async()=>Number((await db.query(`select count(*)::int n from pg_database where datname like $1`,[own])).rows[0].n);
      const srcConns=async()=>Number((await db.query(`select count(*)::int n from pg_stat_activity where datname=$1 and application_name in ('nakgo-backup','nakgo-test-lock') and pid<>pg_backend_pid()`,[db.name])).rows[0].n);
      const works=()=>fs.readdirSync(wroot).filter(x=>x.startsWith('nakgo-backup-'));
      // Sinyal öncesi gerçekten iş ortasında: alt süreçler canlı, şifresiz paket diskte.
      for(const pid of [H.wrapper,H.child])assert.ok(A.alive(pid),label+': alt süreç canlı '+pid);
      assert.equal(works().length,1,label+': şifresiz çalışma klasörü var');
      if(stage==='dump'){assert.ok(await srcConns()>=2,label+': kaynakta S1 ve takılı pg_dump bağlantıları');}
      else{assert.equal(await checkDbs(),1,label+': geçici doğrulama veritabanı var');assert.ok(fs.existsSync(path.join(wroot,works()[0],'bundle','A.dump')),label+': şifresiz döküm diskte');}
      process.kill(ch.pid,signal);
      const res=await Promise.race([exited,new Promise(r=>setTimeout(()=>r({timeout:true}),90000))]);
      assert.ok(!res.timeout,label+': bootstrap sinyalden sonra bitmedi');
      assert.equal(res.code,128+A.SIGNO[signal],label+': çıkış kodu '+JSON.stringify(res)+' '+se);
      assert.doesNotMatch(so,/^BITTI/m,label+': normal sonuç üretilmedi');
      const deadline=Date.now()+5000;
      while(([H.wrapper,H.child].some(A.alive)||await srcConns()>0)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      for(const pid of [H.wrapper,H.child])assert.equal(A.alive(pid),false,label+': sahipsiz süreç kalmadı '+pid);
      assert.equal(await srcConns(),0,label+': kaynakta bağlantı (S1, pg_dump) kalmadı');
      assert.equal(await checkDbs(),0,label+': geçici doğrulama veritabanı düşürüldü');
      assert.deepEqual(filesUnder(out),[],label+': manifest, paket, onay kaydı yok');
      if(failWorkRm){
        assert.match(se,new RegExp(`sinyalle durduruldu \\(${signal}\\); TEMİZLİK HATALARI: şifresiz çalışma klasörü: EBUSY`),label+': '+se);
        assert.equal(works().length,1,label+': silme gerçekten başarısızdı (yutulmadı, raporlandı)');
      }else{
        assert.match(se,new RegExp(`sinyalle durduruldu \\(${signal}\\); temizlik tamam \\(.*\\)\\. İmza isteği ya da kayıt yazılmadı\\.`),label+': '+se);
        assert.doesNotMatch(se,/TEMİZLİK HATALARI/,label);
        assert.deepEqual(works(),[],label+': şifresiz çalışma klasörü silindi');
      }
      }finally{
        if(!ended)try{ch.kill('SIGKILL');}catch{}
        for(const pid of H?[H.wrapper,H.child]:[])for(const x of [-pid,pid])try{process.kill(x,'SIGKILL');}catch{}
        await db.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and application_name in ('nakgo-backup','nakgo-test-lock','nakgo-test-mon') and pid<>pg_backend_pid()`,[db.name]).catch(()=>{});
      }
      fs.rmSync(base,{recursive:true,force:true});
    };
    await t.test('Y3 sinyalden sonra yeni alt süreç ve geçici veritabanı açılmaz; tarama yalnız bu sürecin geçici veritabanlarını düşürür',async()=>{
      // Gerçek sinyal, ayrı süreç: işleyici kurulur, süreç kendine SIGTERM gönderir (çıkış devre dışı), sonra yeni iş denenir.
      const base=path.join(dir,'sig-guard');fs.mkdirSync(base);
      const script=path.join(base,'g.cjs');
      fs.writeFileSync(script,`const A=require(${JSON.stringify(path.join(root,'tools/backup/abort.cjs'))});const D=require(${JSON.stringify(path.join(root,'tools/backup/dump.cjs'))});
const {restoreAndVerify}=require(${JSON.stringify(path.join(root,'tools/backup/restore-verify.cjs'))});
let msgs='';A.installSignalHandlers({exit:()=>{},write:m=>{msgs+=m;}});
process.kill(process.pid,'SIGTERM');
(async()=>{for(let i=0;i<200&&!/durduruldu/.test(msgs);i++)await new Promise(r=>setTimeout(r,25));
  const r=await D.run('sleep',['5']);
  const v=await restoreAndVerify({bundleDir:${JSON.stringify(bundle)},pgBin:process.env.NAKGO_PG_BIN});
  process.stdout.write(JSON.stringify({pid:process.pid,aborting:A.isAborting(),msgs,run:r,verify:v.checks.map(c=>c.code)}));process.exit(0);})();`);
      const t0=Date.now();
      const r=spawnSync(process.execPath,[script],{encoding:'utf8',env:process.env,timeout:60000});
      assert.equal(r.status,0,r.stderr);const o=JSON.parse(r.stdout);
      assert.equal(o.aborting,true);assert.match(o.msgs,/sinyalle durduruldu \(SIGTERM\); temizlik tamam/);
      assert.equal(o.run.code,-1);assert.match(o.run.err,/sinyal alındı \(SIGTERM\): alt süreç başlatılmadı/);
      assert.ok(Date.now()-t0<5000,'sleep hiç başlamadı');
      assert.deepEqual(o.verify,['aborted'],'geçici veritabanı açılmadı');
      assert.equal(Number((await db.query(`select count(*)::int n from pg_database where datname like $1`,['nakgo_check_'+o.pid+'_%'])).rows[0].n),0);
      fs.rmSync(base,{recursive:true,force:true});
      // Tarama: yalnız bu sürecin (pid) geçici veritabanları; başkasınınki ve ad kalıbına uymayan dokunulmaz.
      // Ayrı süreçte (bu test sürecinin kendi test veritabanları da aynı ad kalıbını kullanır).
      const theirs='nakgo_check_999999999_1';await db.exec(`create database "${theirs}"`);
      const base2=path.join(dir,'sig-sweep');fs.mkdirSync(base2);const sw=path.join(base2,'s.cjs');
      fs.writeFileSync(sw,`const A=require(${JSON.stringify(path.join(root,'tools/backup/abort.cjs'))});const {Client}=require('pg');
(async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:'postgres'});await c.connect();
  const mine='nakgo_check_'+process.pid+'_1',odd='nakgo_check_'+process.pid+'_x';
  for(const d of [mine,odd])await c.query('create database "'+d+'"');
  const n=await A.dropOwnCheckDbs();
  const left=(await c.query("select datname from pg_database where datname = any($1)",[[mine,odd,${JSON.stringify(theirs)}]])).rows.map(x=>x.datname).sort();
  await c.query('drop database if exists "'+odd+'"');await c.end();
  process.stdout.write(JSON.stringify({n,left,mine,odd}));})().catch(e=>{process.stderr.write(e.message);process.exit(1);});`);
      try{
        const r2=spawnSync(process.execPath,[sw],{encoding:'utf8',env:process.env,timeout:60000});
        assert.equal(r2.status,0,r2.stderr);const o2=JSON.parse(r2.stdout);
        assert.equal(o2.n,1,'yalnız kendi geçici veritabanı');assert.deepEqual(o2.left,[o2.odd,theirs].sort(),'başkasınınki ve kalıp dışı olan kaldı');
      }finally{await db.exec(`drop database if exists "${theirs}" with (force)`);fs.rmSync(base2,{recursive:true,force:true});}
    });

    await t.test('Y3 sinyal: SIGINT ve SIGTERM gerçek pg_dump ve geri yükleme sırasında; alt süreçler, S1, geçici veritabanı ve şifresiz klasör temizlenir; onay kaydı yok; temizlik hatası raporlanır',async()=>{
      await sigCase({stage:'dump',signal:'SIGTERM'});
      await sigCase({stage:'dump',signal:'SIGINT'});
      await sigCase({stage:'restore',signal:'SIGINT'});
      await sigCase({stage:'restore',signal:'SIGTERM'});
      await sigCase({stage:'restore',signal:'SIGTERM',failWorkRm:true});
      // CLI aynı işleyiciyi runBootstrap'tan ÖNCE kurar.
      const src=fs.readFileSync(path.join(root,'tools/backup/bootstrap.cjs'),'utf8');const cli=src.slice(src.indexOf('async function cli('));
      assert.ok(cli.indexOf('ABORT.installSignalHandlers();')>0&&cli.indexOf('ABORT.installSignalHandlers();')<cli.indexOf('runManual('));
    });

    await t.test('cron komutunda işaretçi: bootstrap durur; manifest, onay kaydı ve kurtarma SQL\'i ham komutu içermez; kurtarma aracı dosya yazmaz',async()=>{
      const MK='NAKGO-CRON-SIZINTI-TEST';
      // 1) Kaynakta işaretçili komut: bootstrap cron_jobs ile durur; çıktı klasöründeki hiçbir dosyada işaretçi yok.
      const o=path.join(dir,'cronleak');fs.mkdirSync(o);
      await db.exec(`update cron.job set command=command||' -- ${MK}' where jobname='nakgo-retention'`);
      let r;
      try{r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-CRON',runId:'cronleak',now:new Date('2026-11-23T14:00:00Z'),allowLocal:true,workRoot:work});}
      finally{await db.query(`update cron.job set command=$1 where jobname='nakgo-retention'`,[PROD_JOBS[0][2]]);}
      assert.equal(r.backup_verified,false);assert.equal(r.stages.restore_test.code,'cron_jobs',JSON.stringify(r.stages.restore_test));
      assert.match(r.stages.restore_test.reason,/komut farklı: nakgo-retention/);assert.ok(!r.stages.restore_test.reason.includes(MK),'terminal nedeninde de komut yok');
      const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):files.push(p);}};walk(o);
      assert.equal(files.length,1,'yalnız başarısızlık raporu');
      for(const f of files)assert.ok(!fs.readFileSync(f).includes(Buffer.from(MK)),'işaretçi yok: '+path.relative(o,f));
      assert.deepEqual(fs.readdirSync(work),[],'çalışma klasörü temiz');
      assert.equal(require('../../tools/backup/bootstrap.cjs').exitCodeOf(r),1);
      fs.rmSync(o,{recursive:true,force:true});
      // 2) Yedek paketinde işaretçili komut (paket hash'leri tutarlı): kurtarma SQL'i üretilmez; araç dosya yazmaz, çıktısında işaretçi yok.
      const d=path.join(dir,'cronleak-bundle');fs.cpSync(bundle,d,{recursive:true});
      const srcF=path.join(d,'source.json');const src=JSON.parse(fs.readFileSync(srcF,'utf8'));const mf=src.meta_files['cron.job'];
      const rows=fs.readFileSync(path.join(d,mf.file),'utf8').split('\n').filter(Boolean).map(JSON.parse);
      for(const x of rows)if(x.jobname==='nakgo-retention')x.command+=' -- '+MK;
      const buf=Buffer.from(rows.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.writeFileSync(path.join(d,mf.file),buf);
      mf.sha256=require('node:crypto').createHash('sha256').update(buf).digest('hex');fs.writeFileSync(srcF,JSON.stringify(src));
      const st=RM.bundleStatus(d);assert.equal(st.cron.ok,false);assert.ok(!JSON.stringify(st.cron).includes(MK));
      assert.throws(()=>RM.renderRestoreSql(st.meta,{externalTriggers:st.external}),e=>e.code==='cron_mismatch'&&!e.message.includes(MK));
      const sqlOut=path.join(dir,'cronleak.sql');
      const cli=spawnSync(process.execPath,[path.join(root,'tools/backup/restore-meta.cjs'),'--bundle',d,'--sql',sqlOut,'--pg-install',process.env.NAKGO_PG_SERVER],{encoding:'utf8'});
      assert.equal(cli.status,1,cli.stderr);assert.equal(fs.existsSync(sqlOut),false,'SQL dosyası oluşmadı');
      assert.ok(!(cli.stdout+cli.stderr).includes(MK),'araç çıktısında işaretçi yok');assert.match(cli.stderr,/kurtarma SQL'i üretilmedi/);
      // Aynı paket işaretçisiz: araç repo tanımlarından SQL yazar (normal yol).
      fs.rmSync(d,{recursive:true,force:true});
      const okOut=path.join(dir,'ok.sql');
      // Dış tetikleyici var: referans derlemesi olmadan SQL üretilmez (yedekteki tanım kullanılmaz).
      const noRef=spawnSync(process.execPath,[path.join(root,'tools/backup/restore-meta.cjs'),'--bundle',bundle,'--sql',okOut],{encoding:'utf8'});
      assert.equal(noRef.status,1);assert.equal(fs.existsSync(okOut),false);assert.match(noRef.stderr,/referans derlemesi gerekli/);
      const ok=spawnSync(process.execPath,[path.join(root,'tools/backup/restore-meta.cjs'),'--bundle',bundle,'--sql',okOut,'--pg-install',process.env.NAKGO_PG_SERVER],{encoding:'utf8'});
      assert.equal(ok.status,0,ok.stderr);const okSql=fs.readFileSync(okOut,'utf8');
      for(const [n,sch,cmd] of PROD_JOBS)assert.ok(okSql.includes(`select cron.schedule('${n}','${sch}',$nakgo$${cmd}$nakgo$);`),n);
      assert.ok(okSql.includes('CREATE TRIGGER nakgo_access_log AFTER INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.log_login()'),'tetikleyici referans tanımından');
      assert.equal(fs.statSync(okOut).mode&0o777,0o600);fs.rmSync(okOut);
    });

    await t.test('yönetim verisi eksik ya da okunamıyorsa sessizce kabul edilmez (requireMeta); varsayılan kipte yalnız not',async()=>{
      const copy=n=>{const d=path.join(dir,'meta-'+n);fs.cpSync(bundle,d,{recursive:true});return d;};
      const edit=(d,fn)=>{const f=path.join(d,'source.json');const src=JSON.parse(fs.readFileSync(f,'utf8'));fn(src);fs.writeFileSync(f,JSON.stringify(src));};
      const run=async(d,strict)=>restoreAndVerify({bundleDir:d,pgBin:process.env.NAKGO_PG_BIN,...(strict?{requireMeta:true}:{})});
      const failedOf=v=>v.checks.filter(c=>!c.ok).map(c=>c.code+':'+JSON.stringify(c.detail));
      // Tam paket: zorunlu kontroller geçer.
      let v=await run(bundle,true);
      assert.equal(v.status,'ok',JSON.stringify(failedOf(v)));
      for(const code of ['migration_history','cron_jobs'])assert.ok(v.checks.some(c=>c.code===code&&c.ok),code);
      // cron.job kaydı yok.
      let d=copy('nocron');edit(d,src=>{delete src.meta_files['cron.job'];});
      v=await run(d,true);assert.equal(v.status,'failed');assert.deepEqual(failedOf(v),['cron_jobs:'+JSON.stringify({ok:false,reason:'yedekte yok: cron.job'})]);
      assert.equal((await run(d,false)).status,'ok','varsayılan kip (B7) değişmedi: eksik meta yalnız not');
      fs.rmSync(d,{recursive:true,force:true});
      // migration geçmişi "yok" olarak işaretli.
      d=copy('nohist');edit(d,src=>{src.meta_files['supabase_migrations.schema_migrations']={present:false};});
      v=await run(d,true);assert.equal(v.status,'failed');
      assert.ok(failedOf(v).includes('migration_history:'+JSON.stringify({ok:false,reason:'yedekte yok: supabase_migrations.schema_migrations'})),JSON.stringify(failedOf(v)));
      fs.rmSync(d,{recursive:true,force:true});
      // meta_files hiç yok.
      d=copy('nometa');edit(d,src=>{delete src.meta_files;});
      v=await run(d,true);assert.equal(v.status,'failed');
      // Geçmiş olmadan "geride" bilinemez: sözleşme denetlenir ve eski şemada düşer; yönetim verisi kontrolleri yine kayıtlı.
      for(const code of ['cron_jobs','migration_history'])assert.ok(failedOf(v).some(x=>x.startsWith(code+':')&&x.includes('yedekte yok')),code+' '+JSON.stringify(failedOf(v)));
      fs.rmSync(d,{recursive:true,force:true});
      // Dosya bozuk (hash tutmaz): meta kontrolü düşer ve ikisi de "okunamadı".
      d=copy('corrupt');const f=path.join(d,JSON.parse(fs.readFileSync(path.join(d,'source.json'),'utf8')).meta_files['cron.job'].file);
      fs.appendFileSync(f,'{"jobname":"eklenen"}\n');
      v=await run(d,true);assert.equal(v.status,'failed');
      assert.deepEqual(v.checks.filter(c=>!c.ok).map(c=>c.code).sort(),['cron_jobs','meta','migration_history']);
      assert.match(JSON.stringify(v.checks.find(c=>c.code==='cron_jobs').detail),/okunamadı: cron\.job/);
      fs.rmSync(d,{recursive:true,force:true});
    });

    await t.test('imza isteği yazılamazsa run başarısız sayılır (yedek doğrulanmış olsa da); var olan dosya değişmez',async()=>{
      const o=path.join(dir,'rec-fail');fs.mkdirSync(o);
      const t2=new Date('2026-11-23T05:00:00Z');
      // Aynı adla bir istek önceden var: "yoksa yaz" reddeder (412), istek yazılamaz.
      const reqKey='manual/pending/recfail/request.json';
      fs.mkdirSync(path.dirname(path.join(o,reqKey)),{recursive:true});fs.writeFileSync(path.join(o,reqKey),'başka');
      const r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-REC',runId:'recfail',now:t2,allowLocal:true,workRoot:work});
      assert.equal(r.backup_verified,true,JSON.stringify(r.stages));
      assert.equal(r.state,'failed');assert.equal(r.request_key,null);
      const rep=MF.validateFailed(SJ.parseCanonical(fs.readFileSync(path.join(o,r.failed_key))));
      assert.equal(rep.failed_stage,'request');assert.deepEqual(rep.codes,['request_write_412']);
      assert.equal(require('../../tools/backup/bootstrap.cjs').exitCodeOf(r),1);
      assert.equal(fs.readFileSync(path.join(o,reqKey),'utf8'),'başka','var olan dosya değişmedi');
      assert.equal(exitCodeOfOk(bs),2,'normal çalışmada istek yazıldı ve çıkış kodu 2');
    });

    const failRun=async(label,runId,hour,prepare,after)=>{
      const o=path.join(dir,'cf-'+runId);fs.mkdirSync(o);
      const t2=new Date(`2026-11-23T${hour}:00:00Z`);
      const undo=await prepare(o,t2);
      let r;try{r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-CF',runId,now:t2,allowLocal:true,workRoot:work});}
      finally{if(undo)undo();}
      assert.equal(r.backup_verified,true,label+': veri yine doğrulandı');
      assert.equal(r.state,'failed',label);assert.equal(r.run_complete,false,label);assert.equal(r.request_key,null,label+': imza isteği yok');
      assert.equal(require('../../tools/backup/bootstrap.cjs').exitCodeOf(r),1,label+': CLI çıkış kodu 1');
      // Başarısızlık raporu yazıldı ama işlemi başarılı GÖSTERMİYOR.
      assert.equal(typeof r.failed_key,'string',label);
      const rec=MF.validateFailed(SJ.parseCanonical(fs.readFileSync(path.join(o,r.failed_key))));
      for(const f of r.failed)assert.ok(rec.codes.includes(f),label+': '+f);
      if(after)await after(o,r,rec);
      return r;
    };
    await t.test('run nihai manifest ve kayıt anahtarlarına hiç yazmaz: orada önceden dosya olsa da değişmez (finalize çakışma olarak reddeder)',async()=>{
      const o=path.join(dir,'cf-manfail');fs.mkdirSync(o);
      const mkey='manual/manifests/2026/11/23/nakgo-20261123T060000Z-manfail.json',rkey='manual/records/2026/11/23/nakgo-20261123T060000Z-manfail.json';
      for(const k of [mkey,rkey]){fs.mkdirSync(path.dirname(path.join(o,k)),{recursive:true});fs.writeFileSync(path.join(o,k),'önceden var');}
      const r=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-CF',runId:'manfail',now:new Date('2026-11-23T06:00:00Z'),allowLocal:true,workRoot:work});
      assert.equal(r.state,'signature_pending',JSON.stringify(r.failed));
      for(const k of [mkey,rkey])assert.equal(fs.readFileSync(path.join(o,k),'utf8'),'önceden var','var olan dosya değişmedi');
      fs.rmSync(o,{recursive:true,force:true});
    });
    await t.test('şifresiz geçici dosyalar silinemezse işlem tamamlanmış sayılmaz: çıkış 1, onay kaydı "completed: false"',async()=>{
      let leftover=null;
      await failRun('şifresiz dosya temizliği','cleanfail','07',()=>{
        const orig=fs.rmSync;
        fs.rmSync=function(p,opts){if(typeof p==='string'&&p.startsWith(work+path.sep+'nakgo-backup-')){leftover=p;throw Object.assign(Error('EBUSY (taklit)'),{code:'EBUSY'});}return orig.apply(fs,arguments);};
        return ()=>{fs.rmSync=orig;};
      },async(o,r,rec)=>{
        assert.deepEqual(r.failed,['plaintext_cleanup']);assert.equal(r.extra.plaintext_cleanup.status,'failed');
        assert.ok(leftover&&fs.existsSync(leftover),'şifresiz klasör gerçekten kaldı (ve bildirildi)');
        fs.rmSync(leftover,{recursive:true,force:true});
      });
    });

    await t.test('pg_dump bağlantısı: başlangıç parametresi olmadan yalnız READ ONLY işlem içinde okur (gerçek pg_dump, kaydeden vekil)',async()=>{
      const proxy=await startOptionsDroppingProxy({targetHost:process.env.NAKGO_PG_HOST,targetPort:Number(process.env.NAKGO_PG_PORT||5432)});
      try{
        const pconn={...conn,host:'127.0.0.1',port:proxy.port};
        const out=path.join(dir,'via-proxy');
        const r=await snapshotDump({conn:pconn,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap'});
        assert.equal(r.status,'ok',JSON.stringify(r.reasons));
        const v=await restoreAndVerify({bundleDir:out,pgBin:process.env.NAKGO_PG_BIN});
        assert.equal(v.status,'ok','vekil üzerinden alınan döküm de doğrulanır');
        rm(out);
        // Hiçbir bağlantı başlangıç parametresi (options) göndermedi: havuzlayıcının desteğine bağımlılık yok.
        assert.ok(proxy.conns.length>=2);
        for(const c of proxy.conns){assert.equal('options' in c.startup,false,JSON.stringify(c.startup));assert.deepEqual(c.dropped,[]);}
        // S1: ilk komut açık salt okunurluk.
        const s1=proxy.conns.find(c=>c.queries.some(q=>/pg_export_snapshot/.test(q)));
        assert.equal(s1.queries[0],'set default_transaction_read_only = on');
        // pg_dump: işlemden önce yalnız oturum ayarları; tek BEGIN; hemen ardından READ ONLY ve anlık görüntü; sonra yalnız okuma.
        const d=proxy.conns.find(c=>c.queries.some(q=>/^SET TRANSACTION SNAPSHOT /.test(q)));
        assert.ok(d,'pg_dump bağlantısı görüldü');
        const qs=d.queries.map(q=>q.trim());
        const b=qs.indexOf('BEGIN');
        assert.ok(b>0);assert.equal(qs.filter(q=>/^(BEGIN|START\s+TRANSACTION)\b/i.test(q)).length,1,'tek işlem');
        const pre=[/^SELECT pg_catalog\.set_config\('search_path', '', false\);?$/,/^SELECT pg_catalog\.pg_is_in_recovery\(\)$/,
          /^SET (DATESTYLE = ISO|INTERVALSTYLE = POSTGRES|extra_float_digits TO \d+|synchronize_seqscans TO off|statement_timeout = 0|lock_timeout = 0|idle_in_transaction_session_timeout = 0|transaction_timeout = 0|row_security = off)$/,
          /^SELECT set_config\(name, 'view, foreign-table', false\) FROM pg_settings WHERE name = 'restrict_nonsystem_relation_kind'$/];
        for(const q of qs.slice(0,b))assert.ok(pre.some(re=>re.test(q)),'işlem öncesi beklenmeyen komut: '+q);
        assert.equal(qs[b+1],'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        assert.match(qs[b+2],/^SET TRANSACTION SNAPSHOT '[0-9A-F-]+'$/);
        const after=qs.slice(b+3);
        assert.ok(after.length>10);
        for(const q of after){
          assert.doesNotMatch(q,/^(BEGIN|START|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE)\b/i,'işlem değişmez: '+q);
          assert.doesNotMatch(q,/SET\s+(SESSION\s+CHARACTERISTICS|TRANSACTION\s+READ\s+WRITE|default_transaction_read_only|transaction_read_only)/i,'salt okunurluk değişmez: '+q);
          assert.match(q,/^(SELECT|WITH|EXECUTE\s|PREPARE\s+\w+\(.*\)\s+AS\s+SELECT|LOCK TABLE .* IN ACCESS SHARE MODE|COPY .* TO stdout;?$)/is,'yalnız okuma: '+q.slice(0,120));
        }
        assert.ok(after.some(q=>/^COPY .* TO stdout/i.test(q)),'veri bu işlem içinde okundu');
        // Sunucu tarafı kanıt: başlangıç parametresi yokken pg_dump'ın kurduğu işlem türünde her yazma reddedilir.
        const pg=require('pg');const c=new pg.Client(clientConfig(pconn));await c.connect();
        // nextval yetki denetimi salt okunurluktan önce gelir: yetki verilir ki reddin nedeni salt okunurluk olsun.
        await db.exec(`grant usage on sequence private.access_log_id_seq to ${boot}`);
        try{
          assert.equal((await c.query(`select current_setting('default_transaction_read_only') v`)).rows[0].v,'off','oturum varsayılanı kapalı (negatif kontrol)');
          await c.query('BEGIN');await c.query(PG_DUMP_TRANSACTION);
          for(const sql of ['create table public.nakgo_pgdump_yazma(x int)',`insert into private.admin_audit(actor_id,target,action,reason,revision) values(gen_random_uuid(),'x','suspend','y',1)`,
            `select nextval('private.access_log_id_seq')`,`update auth.users set email=email`]){
            await c.query('savepoint s');let code=null;try{await c.query(sql);}catch(e){code=e.code;}await c.query('rollback to savepoint s');
            assert.equal(code,'25006',sql);
          }
          let code=null;try{await c.query('SET TRANSACTION READ WRITE');}catch(e){code=e.code;}
          assert.equal(code,'25001','sorgudan sonra işlem okuma-yazmaya çevrilemez');
        }finally{await c.query('rollback').catch(()=>{});await c.end();await db.exec(`revoke usage on sequence private.access_log_id_seq from ${boot}`);}
        assert.equal((await db.query(`select to_regclass('public.nakgo_pgdump_yazma') r`)).rows[0].r,null);
      }finally{await proxy.close();}
    });

    await t.test('salt okunurluk: başlangıç parametresi olmadan oturum açıkça salt okunur yapılır, doğrulanır ve yazma reddedilir',async()=>{
      const pg=require('pg');
      /** Bir başlangıç parametresi verilse bile (ör. eski yapılandırma) iletmeyen havuzlayıcı taklidi. */
      class DropOptions extends pg.Client{constructor(cfg){const {options,...rest}=cfg;super(rest);}}
      const cfg=clientConfig(conn);
      assert.equal('options' in cfg,false,'yapılandırmada başlangıç parametresi yok');
      // Negatif kontrol: rol varsayılanı kapalı → SET'ten önce oturum yazabilir durumda.
      const raw=new DropOptions(cfg);await raw.connect();
      try{
        assert.equal((await raw.query(`select current_setting('default_transaction_read_only') v`)).rows[0].v,'off','SET öncesi kapalı');
        assert.equal(await enforceReadOnly(raw),'on');
        for(const sql of ['create table public.nakgo_yazma_denemesi(x int)',`insert into private.admin_audit(actor_id,target,action,reason,revision) values(gen_random_uuid(),'x','suspend','y',1)`,
          `update auth.users set email=email`,`delete from cron.job`]){
          let code=null;try{await raw.query(sql);}catch(e){code=e.code;}
          assert.equal(code,'25006',sql+' reddedilmeli (salt okunur işlem)');
        }
      }finally{await raw.end();}
      assert.equal((await db.query(`select to_regclass('public.nakgo_yazma_denemesi') r`)).rows[0].r,null,'yazma olmadı');
      // Döküm ve ön kontrol bu istemciyle de salt okunur çalışır.
      const out=path.join(dir,'ro-drop');
      const r=await snapshotDump({conn,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap',Client:DropOptions});
      assert.equal(r.status,'ok',JSON.stringify(r.reasons));assert.equal(r.source.read_only.s1_default,true);assert.equal(r.source.read_only.s1_transaction,true);
      rm(out);
      const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn,approval:'TEST-ONAY-RO',allowLocal:true,Client:DropOptions});
      assert.equal(p.status,'ok',p.reason);
    });

    await t.test('salt okunurluk ayarlanamazsa her yol hemen ve güvenli biçimde durur; hiçbir şey okunmaz ya da yazılmaz',async()=>{
      const pg=require('pg');
      /** Seçeneği düşüren ve SET komutunu etkisiz bırakan (ör. reddeden ya da yok sayan) havuzlayıcı taklidi. */
      class NoReadOnly extends pg.Client{constructor(cfg){const {options,...rest}=cfg;super(rest);}
        query(q,...a){if(typeof q==='string'&&/^\s*set default_transaction_read_only/i.test(q))q='select 1';return super.query(q,...a);}}
      const out=path.join(dir,'ro-fail');
      const r=await snapshotDump({conn,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap',Client:NoReadOnly});
      assert.equal(r.status,'failed');assert.equal(r.stage,'read_only');assert.match(r.reasons[0],/default_transaction_read_only=off/);
      assert.deepEqual(fs.existsSync(out)?fs.readdirSync(out):[],[],'hiçbir dosya yazılmadı');
      const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn,approval:'TEST-ONAY-RO',allowLocal:true,Client:NoReadOnly});
      assert.equal(p.status,'failed');assert.match(p.reason,/salt okunurluk/);
      const o=path.join(dir,'ro-boot');fs.mkdirSync(o);
      const b=await runBootstrap({config:CFG,conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-RO',runId:'ro',now,allowLocal:true,workRoot:work,Client:NoReadOnly});
      assert.equal(b.backup_verified,false);assert.equal(b.stages.preflight.status,'failed');assert.equal(b.stages.dump.status,'skipped');
      assert.deepEqual(await new FileStore({dir:o}).list('manual/db/'),[],'veri yazılmadı');
    });

    await t.test('salt okunurluk: rol ayarı kapalıyken de döküm salt okunur; başlangıç parametresi hiç gönderilmez (devralınan PGOPTIONS dahil)',async()=>{
      await db.exec(`alter role ${boot} set default_transaction_read_only=off`);
      const saved=process.env.PGOPTIONS;process.env.PGOPTIONS='-c statement_timeout=1';
      try{
        const {out,r}=await dumpTo('ro');
        assert.equal(r.status,'ok',JSON.stringify(r.reasons));
        assert.deepEqual(r.source.read_only,RO_SOURCE);
        rm(out);
        const env=dumpEnv(conn);
        assert.equal('PGOPTIONS' in env,false,'pg_dump ortamında başlangıç parametresi yok (devralınan da silindi)');
        assert.equal('options' in newClient(require('pg').Client,clientConfig(conn)).getStartupConf(),false,'node-pg istemcisi PGOPTIONS taşımaz');
        assert.equal(process.env.PGOPTIONS,'-c statement_timeout=1','global ortam değişmedi');
      }finally{if(saved===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=saved;await db.exec(`alter role ${boot} reset default_transaction_read_only`);}
    });

    await t.test('PGOPTIONS boşken ve doluyken hiçbir bağlantı yolu (B7 A1 ön denetimi, bootstrap ön kontrolü, S1, pg_dump) başlangıç parametresi göndermez',async()=>{
      const pg=require('pg');const R=require('../../tools/backup/run.cjs');
      for(const value of [undefined,'','-c statement_timeout=1 -c default_transaction_read_only=off']){
        await withPgOptions(value,async()=>{
          const proxy=await startOptionsDroppingProxy({targetHost:process.env.NAKGO_PG_HOST,targetPort:Number(process.env.NAKGO_PG_PORT||5432),drop:[]});
          try{
            const pconn={...conn,host:'127.0.0.1',port:proxy.port};
            const label=JSON.stringify(value===undefined?null:value);
            // B7 A1 ön denetimi (gerçek denetim sorguları; kararı burada önemsiz).
            let n=proxy.conns.length;
            const ev=await R.preflightAudit({conn:pconn,Client:pg.Client,allowlist:{version:1,entries:[]},allowLocal:true});
            assert.ok(ev&&ev.decision,label+': A1 denetimi çalıştı');
            assert.equal(proxy.conns.length,n+1,label+': A1 tek bağlantı');
            const a1=proxy.conns[n];
            assert.deepEqual(Object.keys(a1.startup).sort(),['application_name','client_encoding','database','user'],label+' A1: '+JSON.stringify(Object.keys(a1.startup)));
            assert.equal(a1.startup.application_name,'nakgo-backup');
            // Bootstrap ön kontrolü.
            n=proxy.conns.length;
            const p=await require('../../tools/backup/bootstrap.cjs').preflight({conn:pconn,approval:'TEST-ONAY-OPT',allowLocal:true});
            assert.equal(p.status,'ok',label+': '+p.reason);
            assert.equal('options' in proxy.conns[n].startup,false,label+' ön kontrol');
            // S1 + pg_dump.
            n=proxy.conns.length;
            const out=path.join(dir,'opt');
            const r=await snapshotDump({conn:pconn,scope,outDir:out,pgBin:process.env.NAKGO_PG_BIN,allowLocal:true,mode:'bootstrap'});
            assert.equal(r.status,'ok',label+': '+JSON.stringify(r.reasons));rm(out);
            const dumpConns=proxy.conns.slice(n);
            assert.ok(dumpConns.some(c=>c.queries.some(q=>/pg_export_snapshot/.test(q))),'S1 görüldü');
            assert.ok(dumpConns.some(c=>c.queries.some(q=>/^SET TRANSACTION SNAPSHOT /.test(q))),'pg_dump görüldü');
            for(const c of proxy.conns)assert.equal('options' in c.startup,false,label+': '+JSON.stringify(c.startup));
            assert.equal(process.env.PGOPTIONS,value,'global ortam değişmedi');
          }finally{await proxy.close();}
        });
      }
    });

    const stopCase=async(label,setup,undo,stage,re)=>{
      await db.exec(setup);
      try{
        const {out,r}=await dumpTo('stop');
        assert.equal(r.status,'failed',label);assert.equal(r.stage,stage,label+': '+JSON.stringify(r.reasons));assert.match(r.reasons.join('|'),re,label);
        assert.deepEqual(fs.existsSync(path.join(out,'A.dump'))?['A.dump']:[],[],label+': döküm alınmadı');
        rm(out);
      }finally{await db.exec(undo);}
    };
    await t.test('güvenli durdurma: kapsam dışı veri, sınıflandırılmamış tablo, RLS ve yetki',async()=>{
      await stopCase('auth.instances satırı',`insert into auth.instances(id) values(gen_random_uuid())`,`delete from auth.instances`,'guards',/auth\.instances \(1 satır\)/);
      await stopCase('Vault satırı',`insert into vault.secrets(secret) values('s')`,`delete from vault.secrets`,'guards',/vault\.secrets/);
      await stopCase('Storage nesnesi',`alter table storage.objects disable trigger user;insert into storage.objects(bucket_id,name) values('carrier-documents','b8');alter table storage.objects enable trigger user;`,
        `alter table storage.objects disable trigger user;delete from storage.objects;alter table storage.objects enable trigger user;`,'guards',/storage\.objects boş olmalı/);
      // Production envanterinde olmayan (sınıflandırılmış ama gözlenmemiş) tablo: satır sayımından önce envanterde durur.
      await stopCase('Storage yardımcı tablosu (önek, Production envanterinde yok)',`create table storage.prefixes(bucket_id text,name text);grant select on storage.prefixes to ${boot};insert into storage.prefixes values('carrier-documents','a/')`,
        `drop table storage.prefixes`,'coverage',/envanterde olmayan tablo: storage\.prefixes/);
      // Kova yaşam döngüsü tabloları (Production'da var, boş): satır görünürse veri okunmadan durur; ayrı ayrı ve birlikte.
      const LS='storage.bucket_lifecycle_states',LA='storage.lifecycle_abandoned_artifacts';
      // Satırlar Storage kaynağındaki gerçek yollarla aynı biçimde: durum satırı kova yaşam döngüsü kuralı açılınca
      // (reconcile_lifecycle_state), terk edilmiş öğe fiziksel silme beklerken (SaveLifecycleMetadataDeletions) oluşur.
      const stateRow=`insert into ${LS}(bucket_id,generation,next_run_at) values('carrier-documents',gen_random_uuid(),now())`;
      const artifactRow=n=>`insert into ${LA}(bucket_id,key,name,version) select 'carrier-documents','k'||g,'belge-'||g||'.pdf',null from generate_series(1,${n}) g`;
      await stopCase('yaşam döngüsü durumu satırı',stateRow,`delete from ${LS}`,'guards',/storage\.bucket_lifecycle_states \(1 satır\)/);
      await stopCase('terk edilmiş yaşam döngüsü öğesi satırı',artifactRow(1),`delete from ${LA}`,'guards',/storage\.lifecycle_abandoned_artifacts \(1 satır\)/);
      await stopCase('iki yaşam döngüsü tablosu birlikte dolu',stateRow+';'+artifactRow(2),`delete from ${LS};delete from ${LA}`,
        'guards',/storage\.bucket_lifecycle_states \(1 satır\)[\s\S]*storage\.lifecycle_abandoned_artifacts \(2 satır\)/);
      // Beklenen (envanterdeki) tablo eksik: sessiz geçilmez.
      await stopCase('envanterdeki Storage tablosu yok',`drop table ${LA}`,
        `${LIFECYCLE_DDL[LA]};alter table ${LA} enable row level security;grant select on ${LA} to ${boot}`,'coverage',/envanterdeki tablo veritabanında yok: storage\.lifecycle_abandoned_artifacts/);
      await stopCase('envanterdeki Auth tablosu yok',`drop table auth.saml_providers`,
        `create table auth.saml_providers(id bigint);alter table auth.saml_providers owner to supabase_auth_admin;alter table auth.saml_providers enable row level security;grant select on auth.saml_providers to ${boot}`,
        'coverage',/envanterdeki tablo veritabanında yok: auth\.saml_providers/);
      await stopCase('sınıflandırılmamış Storage tablosu',`create table storage.yeni_ozellik(x int)`,`drop table storage.yeni_ozellik`,'coverage',/sınıflandırılmamış tablo: storage\.yeni_ozellik/);
      await stopCase('sınıflandırılmamış Auth tablosu',`create table auth.yeni_ozellik(x int)`,`drop table auth.yeni_ozellik`,'coverage',/sınıflandırılmamış tablo: auth\.yeni_ozellik/);
      await stopCase('sınıflandırılmamış Vault tablosu',`create table vault.baska(x int)`,`drop table vault.baska`,'coverage',/vault\.baska/);
      await stopCase('BYPASSRLS yok',`alter role ${boot} nobypassrls`,`alter role ${boot} bypassrls`,'rls',/auth\.users/);
      await stopCase('Auth okuma yetkisi yok',`revoke select on auth.users from ${boot}`,`grant select on auth.users to ${boot}`,'permissions',/doğrudan okuma yetkisi yok: auth\.users/);
      await stopCase('dizi okuma yetkisi yok',`revoke select on sequence private.access_log_id_seq from ${boot}`,`grant select on sequence private.access_log_id_seq to ${boot}`,'permissions',/okuma yetkisi yok: private\.access_log_id_seq/);
      await stopCase('cron okuma yetkisi yok',`revoke select on cron.job from ${boot}`,`grant select on cron.job to ${boot}`,'permissions',/cron\.job/);
    });

    await t.test('ön koşullar: onay, K9/çapa yapılandırması ve yerel geri yükleme hedefi olmadan bootstrap başlamaz',async()=>{
      const o=path.join(dir,'pre');fs.mkdirSync(o);
      const base={conn,outDir:o,recipientsFile,pinnedRecipientsSha256:pinned,approval:'TEST-ONAY-2',allowLocal:true,workRoot:work,now};
      const a=await runBootstrap({config:CFG,...base,approval:'',runId:'p1'});
      assert.equal(a.backup_verified,false);assert.equal(a.stages.preflight.status,'failed');assert.match(a.stages.preflight.reason,/onay/);assert.equal(a.stages.dump.status,'skipped');
      const b=await runBootstrap({config:{...CFG,trusted_k9:{},active_k9:null},...base,runId:'p2'});
      assert.equal(b.stages.preflight.code,'config');assert.match(b.stages.preflight.reason,/K9/);
      const h=process.env.NAKGO_PG_HOST;process.env.NAKGO_PG_HOST='db.example.invalid';
      try{const c=await runBootstrap({config:CFG,...base,runId:'p3'});assert.match(c.stages.preflight.reason,/yerel PostgreSQL/);}finally{process.env.NAKGO_PG_HOST=h;}
      assert.deepEqual((await new FileStore({dir:o}).list('manual/db/')),[],'hiçbir veri yazılmadı');
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([boot]);fs.rmSync(dir,{recursive:true,force:true});}
});

test('B7 kipi (tam zincir): fonksiyon ve doğrudan okuma aynı satırları verir; sayılamayan tablo ve okunamayan yönetim verisi dökümü durdurur; bootstrap reddedilir',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump ve çoklu bağlantı yok');return;}
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_b8');let primary=null;const dir=tmp();
  try{
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    if(!tool||tool<major){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error('pg_dump eski');t.skip('pg_dump eski');return;}
    await seed(db);
    const scope=BR.loadScope();
    await t.test('iki kip birebir aynı satırlar (kapsam tabloları ve sayım fonksiyonunun saydıkları)',async()=>{
      await db.exec(`begin isolation level repeatable read read only`);
      try{
        for(const tb of scope.tables){
          if(!(await SE.relExists(db,tb.name)))continue;
          const a=(await db.query(`select j::text j from ${qn(tb.export)}() j`)).rows.map(r=>r.j).sort();
          const b=(await db.query(`select j::text j from ${SE.directFrom(tb.name)}`)).rows.map(r=>r.j).sort();
          assert.deepEqual(b,a,tb.name);
        }
        const fn=(await db.query(`select private.nakgo_backup_guard_counts() g`)).rows[0].g;
        const direct=await SE.directGuardCounts(db,scope);
        for(const k of Object.keys(fn))assert.equal(direct[k],fn[k],k);
      }finally{await db.exec('rollback');}
    });
    await t.test('B7 rolüyle döküm doğrulanır; auth.instances ya da cron/migration geçmişi varsa güvenli tarafta durur',async()=>{
      const password='test-only-'+role;
      await db.exec(BR.renderLiteral({role,password}));
      const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password,database:db.name};
      assert.deepEqual(await BR.verifyRole((s,a)=>db.query(s,a),{role}),[]);
      const ok=await snapshotDump({conn,scope,outDir:path.join(dir,'f1'),pgBin:process.env.NAKGO_PG_BIN,allowLocal:true});
      assert.equal(ok.status,'ok',JSON.stringify(ok.reasons));assert.equal(ok.source.mode,'functions');
      assert.equal(ok.source.meta_files['cron.job'].present,false);
      const v=await restoreAndVerify({bundleDir:path.join(dir,'f1'),pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      await db.exec(`create table auth.instances(id uuid primary key,raw_base_config text);`);
      try{
        const r=await snapshotDump({conn,scope,outDir:path.join(dir,'f2'),pgBin:process.env.NAKGO_PG_BIN,allowLocal:true});
        assert.equal(r.status,'failed');assert.equal(r.stage,'guards');assert.match(r.reasons.join(),/sayılamadı: auth\.instances/);
      }finally{await db.exec(`drop table auth.instances;`);}
      await db.exec(`create schema cron;create table cron.job(jobid bigserial primary key,schedule text not null,command text not null,jobname text);`);
      try{
        const r=await snapshotDump({conn,scope,outDir:path.join(dir,'f3'),pgBin:process.env.NAKGO_PG_BIN,allowLocal:true});
        assert.equal(r.status,'failed');assert.equal(r.stage,'meta');assert.match(r.reasons.join(),/cron\.job/);
        assert.ok(!fs.existsSync(path.join(dir,'f3','A.dump')));
      }finally{await db.exec(`drop schema cron cascade;`);}
      const preflight=require('../../tools/backup/bootstrap.cjs').preflight;
      const p=await preflight({conn,approval:'TEST-ONAY-3',allowLocal:true});
      assert.equal(p.status,'failed');assert.match(p.reason,/bootstrap yerine K6b yolu/);
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([role]);fs.rmSync(dir,{recursive:true,force:true});}
});

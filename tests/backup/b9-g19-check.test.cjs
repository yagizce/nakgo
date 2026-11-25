'use strict';
/* G19 bağlantı denetimi (tools/backup/g19-check.cjs), gerçek TLS ile: geçici PostgreSQL 17 kümesi yalnız 'localhost'ta,
 * yalnız hostssl + scram ile dinler; sunucu sertifikası testte üretilen tek kullanımlık bir kökle imzalanır (anahtarlar
 * geçici klasörde, sonunda silinir). Rol ops/backup/bootstrap-role.sql ile, Supabase postgres'ini taklit eden süper
 * kullanıcı olmayan rolle oluşturulur. Supavisor taklit edilmez: oturum modu kontrolü doğrudan bağlantıda geçer. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawnSync,execFileSync}=require('node:child_process');
const {g19Check,roleOfUser,WRONG_CA}=require('../../tools/backup/g19-check.cjs');
const {startCluster,adminClient}=require('../../tools/backup/pg-cluster.cjs');
const {binPath,toolMajor}=require('../../tools/backup/dump.cjs');

const root=path.join(__dirname,'../..');
const ROLE='nakgo_bootstrap_reader';

test('roleOfUser: Supavisor kullanıcı adından rol; yanlış kök sertifika dosyasında özel anahtar yok',()=>{
  assert.equal(roleOfUser('nakgo_bootstrap_reader.abcdefghijklmnop'),ROLE);
  assert.equal(roleOfUser(ROLE),ROLE);
  const pem=fs.readFileSync(WRONG_CA,'utf8');
  assert.match(pem,/^-----BEGIN CERTIFICATE-----/);assert.doesNotMatch(pem,/PRIVATE KEY/);
});

const freePort=()=>new Promise((res,rej)=>{const s=net.createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});
const ossl=(args,cwd)=>execFileSync('openssl',args,{cwd,stdio:['ignore','pipe','pipe']});

test('G19 denetimi gerçek TLS (verify-full) ile',async t=>{
  const installDir=process.env.NAKGO_PG_SERVER,pgBin=process.env.NAKGO_PG_BIN;
  const need=[];if(!installDir)need.push('NAKGO_PG_SERVER');if(!(await toolMajor('pg_dump',pgBin)))need.push('pg_dump');
  if(spawnSync('openssl',['version']).status!==0)need.push('openssl');
  if(need.length){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error('gerekli araç yok: '+need.join(', '));t.skip(need.join(', ')+' yok');return;}
  const certs=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-g19c-'));
  let cl=null,adm=null;
  try{
    // Tek kullanımlık kök + 'localhost' sunucu sertifikası (yalnız DNS adı; IP yok).
    fs.chmodSync(certs,0o755);
    ossl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','ca.key','-out','ca.pem','-days','2','-subj','/CN=nakgo-g19-test-ca'],certs);
    const issue=san=>{
      fs.writeFileSync(path.join(certs,'ext.cnf'),`subjectAltName=${san}\n`);
      ossl(['req','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost'],certs);
      ossl(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','2','-extfile','ext.cnf'],certs);
      fs.chmodSync(path.join(certs,'server.key'),0o600);fs.chmodSync(path.join(certs,'server.crt'),0o644);
      if(process.getuid&&process.getuid()===0&&process.env.NAKGO_PG_RUN_AS){
        const uid=Number(execFileSync('id',['-u',process.env.NAKGO_PG_RUN_AS]).toString()),gid=Number(execFileSync('id',['-g',process.env.NAKGO_PG_RUN_AS]).toString());
        fs.chownSync(path.join(certs,'server.key'),uid,gid);
      }
    };
    issue('DNS:localhost');
    fs.writeFileSync(path.join(certs,'hba.conf'),'local all all trust\nhostssl all all 127.0.0.1/32 scram-sha-256\nhostssl all all ::1/128 scram-sha-256\n');
    fs.chmodSync(path.join(certs,'hba.conf'),0o644);
    const port=await freePort();
    cl=await startCluster({installDir,settings:{listen_addresses:'localhost',port,ssl:'on',ssl_cert_file:path.join(certs,'server.crt'),
      ssl_key_file:path.join(certs,'server.key'),hba_file:path.join(certs,'hba.conf'),password_encryption:'scram-sha-256'}});
    adm=await adminClient({...cl,port});
    // Supabase postgres'ine benzer yönetici rol, iki şema, RLS'li tablolar.
    const emul='nakgo_pgemul';
    await adm.query(`create role ${emul} login nosuperuser createrole bypassrls inherit password 'test-only-emul';
      grant pg_read_all_data to ${emul} with admin option;grant pg_signal_backend to ${emul};
      create schema private;create table public.ilan(id int primary key,ad text);create table private.not_(id int primary key,ilan int references public.ilan);
      alter table public.ilan enable row level security;alter table private.not_ enable row level security;
      create policy p on public.ilan using (false);insert into public.ilan values(1,'a');`);
    const iso=new Date(Date.now()+7*864e5).toISOString();
    const r=spawnSync(binPath('psql',pgBin),['-X','-q','--single-transaction','-v','ON_ERROR_STOP=1','-v','valid_until='+iso,'-c','set role '+emul,'-f',path.join(root,'ops/backup/bootstrap-role.sql')],
      {encoding:'utf8',env:{...process.env,PGHOST:cl.host,PGPORT:String(port),PGUSER:cl.admin,PGDATABASE:'postgres',PGPASSWORD:'',PGOPTIONS:''}});
    assert.equal(r.status,0,r.stderr);
    await adm.query(`alter role ${ROLE} password 'test-only-reader'`);
    const conn={host:'localhost',port,user:ROLE,password:'test-only-reader',database:'postgres',sslmode:'verify-full',sslrootcert:path.join(certs,'ca.pem')};
    const local=process.env.NAKGO_PG_HOST;
    const run=(over={},opts={})=>g19Check({conn:{...conn,...over},pgBin,allowLocal:true,localPg:local,...opts});
    const byCode=x=>Object.fromEntries(x.checks.map(c=>[c.code,c]));

    await t.test('olumlu: bütün kontroller geçer (yanlış kök ve IP ile bağlantı reddedilir, anlık görüntü ve pg_dump verify-full ile)',async()=>{
      const x=await run();
      assert.equal(x.status,'ok',JSON.stringify(x.checks.filter(c=>!c.ok)));
      assert.deepEqual(x.checks.map(c=>c.code),['rules','tls_wrong_ca','tls_hostname','connect','role','read_only','session_mode','snapshot','tools','pg_dump','local_pg'].filter(c=>c!=='local_pg'||local));
      assert.match(byCode(x).pg_dump.detail,/şema öğesi/);
      assert.doesNotMatch(JSON.stringify(x),/test-only|localhost|127\.0\.0\.1/,'raporda parola ya da sunucu adı yok');
      const left=fs.readdirSync(os.tmpdir()).filter(f=>f.startsWith('nakgo-g19-'));
      assert.deepEqual(left,[],'geçici şema dökümü silindi');
    });

    await t.test('kurallar: verify-full değil, kök sertifika yok ya da kullanıcı bootstrap rolü değil → bağlanmadan durur',async()=>{
      for(const [over,re] of [[{sslmode:'require'},/verify-full/],[{sslrootcert:path.join(certs,'yok.pem')},/kök sertifika/],[{user:emul,password:'test-only-emul'},/kullanıcı nakgo_bootstrap_reader değil/]]){
        const x=await run(over);
        assert.equal(x.status,'failed');assert.deepEqual(x.checks.map(c=>c.code),['rules']);assert.match(x.checks[0].detail,re);
      }
    });

    await t.test('yanlış kök sertifika verilirse olumlu bağlantı TLS aşamasında düşer',async()=>{
      const x=await run({sslrootcert:WRONG_CA});
      assert.equal(x.status,'failed');
      const c=byCode(x);assert.equal(c.connect.ok,false);assert.match(c.connect.detail,/certificate|self[- ]signed/i);
      assert.equal(c.role,undefined,'bağlanılamadığı için rol okunmadı');
    });

    await t.test('rol beklenenden fazla yetkiliyse (BYPASSRLS yok, yazma üyeliği, salt okunur varsayılan yok) rol kontrolü düşer',async()=>{
      await adm.query(`create role nakgo_g19_weak login password 'test-only-weak' valid until '${iso}';grant pg_write_all_data to nakgo_g19_weak`);
      const x=await run({user:'nakgo_g19_weak',password:'test-only-weak'},{expectRole:'nakgo_g19_weak'});
      const c=byCode(x);assert.equal(x.status,'failed');assert.equal(c.role.ok,false);
      for(const re of [/BYPASSRLS yok/,/üyelikler/,/yazma yetkisi/,/salt okunur varsayılan yok/,/INHERIT/])assert.match(c.role.detail,re);
    });

    await t.test('sunucu sertifikası IP adresini de kapsıyorsa sunucu adı kontrolü bunu yakalar',async()=>{
      issue('DNS:localhost,IP:127.0.0.1,IP:::1');
      await adm.query('select pg_reload_conf()');await new Promise(r=>setTimeout(r,500));
      const x=await run();
      const c=byCode(x);assert.equal(c.tls_hostname.ok,false);assert.match(c.tls_hostname.detail,/IP ile bağlanıldı/);
      assert.equal(c.connect.ok,true);assert.equal(x.status,'failed');
      issue('DNS:localhost');await adm.query('select pg_reload_conf()');
    });
  }finally{
    if(adm)await adm.end().catch(()=>{});
    if(cl)await cl.stop().catch(()=>{});
    fs.rmSync(certs,{recursive:true,force:true});
  }
});

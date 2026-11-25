#!/usr/bin/env node
'use strict';
/* G19 bağlantı denetimi: ilk yedekten önce, Production'a (Supavisor oturum modu, verify-full) bootstrap rolüyle yalnız
 * okuyarak bağlanıp şunları kanıtlar ve evet/hayır raporlar:
 *   rules        bağlantı kuralları (5432, verify-full, kök sertifika dosyası, beklenen sunucu)
 *   tls_wrong_ca yanlış kök sertifikayla bağlantı TLS aşamasında reddedilir (parola gönderilmeden)
 *   tls_hostname sunucu adı yerine IP ile bağlantı sertifika adı uyuşmazlığıyla reddedilir
 *   connect      doğru kök sertifikayla node-pg (aracın kullandığı yol) bağlanır
 *   role         bağlanan rol beklenen rol; süper kullanıcı değil; yalnız pg_read_all_data; BYPASSRLS; yazma yetkisi yok;
 *                rol düzeyinde salt okunur; geçerlilik süresi en fazla 14 gün
 *   read_only    aracın oturumu salt okunur yapması
 *   session_mode oturum, işlemler arasında aynı sunucu sürecinde kalır ve oturum ayarı korunur (işlem modu değil)
 *   snapshot     bir oturumda dışa aktarılan anlık görüntü ikinci oturumda içe alınır
 *   pg_dump      PostgreSQL 17 pg_dump, libpq verify-full ile ve aynı anlık görüntüden yalnız şema dökümü alır
 *                (tablo verisi alınmaz; dosya geçici klasörde, sonunda silinir) ve pg_restore arşivi okur
 *   tools        pg_dump/pg_restore sürümü sunucu sürümünden eski değil
 *   local_pg     geri yükleme için yerel PostgreSQL (NAKGO_PG_HOST) ayakta ve sürümü sunucudan eski değil
 * Hiçbir tabloyu okumaz, hiçbir şey yazmaz. Bağlantı bilgisi, parola ve sunucu adı rapora yazılmaz.
 *
 * Kullanım (sahibin makinesi; ayrı yazılı onayla):
 *   PGHOST=<havuzlayıcı> PGPORT=5432 PGUSER=nakgo_bootstrap_reader.<proje-ref> PGDATABASE=postgres \
 *   PGSSLMODE=verify-full PGSSLROOTCERT=<supabase kök sertifikası> NAKGO_PG_BIN=<pg17 bin> NAKGO_PG_HOST=<yerel pg> \
 *   read -s PGPASSWORD && export PGPASSWORD && node tools/backup/g19-check.cjs; unset PGPASSWORD
 * Çıkış kodu: 0 hepsi geçti, 1 en az biri başarısız, 2 kullanım hatası. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dns=require('node:dns').promises,net=require('node:net');
const D=require('./dump.cjs');

const EXPECT_ROLE='nakgo_bootstrap_reader';
const WRONG_CA=path.join(__dirname,'../../ops/backup/g19-wrong-ca.pem');
const scrub=s=>String(s&&s.message||s).replace(/postgres(ql)?:\/\/\S+/g,'<bağlantı>').split('\n')[0].slice(0,300);

function connFromEnv(e=process.env){
  return {host:e.PGHOST,port:Number(e.PGPORT||5432),user:e.PGUSER,password:e.PGPASSWORD,database:e.PGDATABASE||'postgres',sslmode:e.PGSSLMODE,sslrootcert:e.PGSSLROOTCERT};
}
/** Supavisor kullanıcı adı "<rol>.<proje-ref>"; sunucu tarafında current_user yalnız rol adıdır. */
const roleOfUser=u=>String(u||'').split('.')[0];

async function tryConnect(Client,cfg){
  const c=new Client(cfg);c.on('error',()=>{});
  try{await c.connect();await c.end().catch(()=>{});return {ok:true};}
  catch(e){await c.end().catch(()=>{});return {ok:false,code:e.code||'',msg:scrub(e)};}
}
const tlsReject=r=>!r.ok&&(/^(ERR_TLS|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO|CERT_|ERR_SSL)/.test(r.code)||/certificate|self[- ]signed|altnames|Hostname\/IP/i.test(r.msg));

async function g19Check({conn,expectRole=EXPECT_ROLE,pgBin=process.env.NAKGO_PG_BIN,allowLocal=false,Client,localPg=process.env.NAKGO_PG_HOST}={}){
  Client=Client||require('pg').Client;
  const checks=[];const add=(code,ok,detail)=>{checks.push({code,ok:!!ok,...(detail?{detail}:{})});return !!ok;};
  const done=()=>({status:checks.every(c=>c.ok)?'ok':'failed',checks});
  // 1. Kurallar. G19 için yerelde de verify-full zorunludur (yerel test yalnız sunucu adı kuralını atlar).
  const rules=D.validateConn(conn,{allowLocal});
  if(conn&&conn.sslmode!=='verify-full')rules.push('sslmode=verify-full zorunlu');
  if(conn&&(!conn.sslrootcert||!fs.existsSync(conn.sslrootcert)))rules.push('kök sertifika dosyası yok');
  if(conn&&roleOfUser(conn.user)!==expectRole)rules.push(`kullanıcı ${expectRole} değil`);
  if(!add('rules',!rules.length,rules.join('; ')||undefined))return done();
  let cfg;try{cfg=D.clientConfig(conn);D.newClient(Client,cfg);}catch(e){add('rules',false,scrub(e));return done();}
  // 2. Olumsuz TLS: yanlış kök sertifika ve sunucu adı uyuşmazlığı. Parola TLS doğrulandıktan sonra gönderilir.
  const wrong=await tryConnect(Client,{...cfg,ssl:{...cfg.ssl,ca:fs.readFileSync(WRONG_CA,'utf8')}});
  add('tls_wrong_ca',tlsReject(wrong),wrong.ok?'yanlış kök sertifikayla bağlanıldı':wrong.code||wrong.msg);
  let ip=null;try{ip=net.isIP(conn.host)?null:(await dns.lookup(conn.host)).address;}catch(e){}
  if(!ip)add('tls_hostname',false,'sunucu adı IP adresine çözülemedi');
  else{const {servername,...ssl}=cfg.ssl;const r=await tryConnect(Client,{...cfg,host:ip,ssl});add('tls_hostname',tlsReject(r),r.ok?'IP ile bağlanıldı: sunucu adı doğrulanmıyor':r.code||r.msg);}
  // 3. Olumlu bağlantı ve rol.
  const a=new Client(cfg);a.on('error',()=>{});
  let b=null,dir=null;
  try{
    try{await a.connect();}catch(e){add('connect',false,scrub(e));return done();}
    add('connect',true);
    const r=(await a.query(`select current_user::text cu,session_user::text su,r.rolsuper,r.rolbypassrls,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
        r.rolvaliduntil,current_setting('default_transaction_read_only') ro0,current_setting('server_version_num')::int/10000 major,
        (select array_agg(g.rolname::text order by 1) from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid) member_of,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p')
           and has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) writable,
        has_schema_privilege(r.oid,'public','CREATE') or coalesce(has_schema_privilege(r.oid,'private','CREATE'),false) create_schema
      from pg_roles r where r.rolname=current_user`)).rows[0];
    const roleProblems=[];
    if(r.cu!==expectRole||r.su!==expectRole)roleProblems.push('bağlanan rol beklenen değil: '+r.cu);
    if(r.rolsuper||r.rolcreaterole||r.rolcreatedb||r.rolreplication)roleProblems.push('ayrıcalıklı öznitelik');
    if(!r.rolbypassrls)roleProblems.push('BYPASSRLS yok: RLS eksik okumaya yol açar');
    if(r.rolinherit)roleProblems.push('INHERIT olmamalı');
    if(JSON.stringify(r.member_of)!==JSON.stringify(['pg_read_all_data']))roleProblems.push('üyelikler: '+JSON.stringify(r.member_of));
    if(r.writable!==0)roleProblems.push(`${r.writable} tabloda yazma yetkisi`);
    if(r.create_schema)roleProblems.push('şemada CREATE yetkisi');
    if(r.ro0!=='on')roleProblems.push('rol düzeyinde salt okunur varsayılan yok');
    if(!r.rolvaliduntil||new Date(r.rolvaliduntil)<=new Date()||new Date(r.rolvaliduntil)>new Date(Date.now()+14*86400000))roleProblems.push('geçerlilik süresi şimdiden sonra ve en fazla 14 gün olmalı');
    add('role',!roleProblems.length,roleProblems.join('; ')||`${r.cu}, PostgreSQL ${r.major}`);
    try{add('read_only',(await D.enforceReadOnly(a))==='on');}catch(e){add('read_only',false,scrub(e));}
    // 4. Oturum modu: ayrı işlemler arasında aynı süreç ve oturum ayarı korunur.
    const p1=(await a.query(`select pg_backend_pid() p,set_config('application_name','nakgo-g19',false) s`)).rows[0].p;
    await new Promise(res=>setTimeout(res,1500));
    const s2=(await a.query(`select pg_backend_pid() p,current_setting('application_name') n`)).rows[0];
    const s3=(await a.query(`select pg_backend_pid() p`)).rows[0];
    add('session_mode',p1===s2.p&&s2.p===s3.p&&s2.n==='nakgo-g19',p1===s2.p&&s2.p===s3.p?(s2.n==='nakgo-g19'?undefined:'oturum ayarı kayboldu'):'sunucu süreci değişti (işlem modu?)');
    // 5. Anlık görüntü paylaşımı ve pg_dump (yalnız şema).
    await a.query('begin isolation level repeatable read read only');
    const snap=(await a.query('select pg_export_snapshot() s')).rows[0].s;
    b=new Client(cfg);b.on('error',()=>{});
    try{
      await b.connect();await b.query('begin isolation level repeatable read read only');
      await b.query(`set transaction snapshot '${snap.replace(/'/g,"''")}'`);await b.query('select 1');await b.query('rollback');
      add('snapshot',true);
    }catch(e){add('snapshot',false,scrub(e));}
    const tools=[];for(const t of ['pg_dump','pg_restore']){const m=await D.toolMajor(t,pgBin);if(!m||m<r.major)tools.push(`${t} ${m||'yok'} < sunucu ${r.major}`);}
    add('tools',!tools.length,tools.join('; ')||undefined);
    if(!tools.length){
      dir=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-g19-'));fs.chmodSync(dir,0o700);
      const f=path.join(dir,'schema.dump');
      const d=await D.run(D.binPath('pg_dump',pgBin),['-Fc','--schema-only','-n','public','-n','private','--snapshot='+snap,'--no-sync','-f',f],{env:D.dumpEnv(conn)});
      if(d.code!==0)add('pg_dump',false,scrub(d.err));
      else{
        const l=await D.run(D.binPath('pg_restore',pgBin),['-l',f]);
        const n=l.code===0?l.out.split('\n').filter(x=>/^\d+;/.test(x)).length:0;
        add('pg_dump',l.code===0&&n>0,l.code===0?`${n} şema öğesi`:scrub(l.err));
      }
    }
    await a.query('rollback').catch(()=>{});
    // 6. Yerel geri yükleme sunucusu (ilk yedekte bağımsız PostgreSQL 17 geri yüklemesi için).
    if(!localPg||!D.isLocalHost(localPg))add('local_pg',false,'NAKGO_PG_HOST yerel bir PostgreSQL olmalı');
    else{
      const l=new Client({host:localPg,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:'postgres'});
      l.on('error',()=>{});
      try{await l.connect();const m=(await l.query(`select current_setting('server_version_num')::int/10000 m`)).rows[0].m;add('local_pg',m>=r.major,m>=r.major?`PostgreSQL ${m}`:`yerel ${m} < sunucu ${r.major}`);}
      catch(e){add('local_pg',false,scrub(e));}
      finally{await l.end().catch(()=>{});}
    }
  }catch(e){add('unexpected',false,scrub(e));}
  finally{
    if(b)await b.end().catch(()=>{});
    await a.end().catch(()=>{});
    if(dir)fs.rmSync(dir,{recursive:true,force:true});
  }
  return done();
}

module.exports={g19Check,connFromEnv,roleOfUser,EXPECT_ROLE,WRONG_CA};

if(require.main===module){
  (async()=>{
    const conn=connFromEnv();
    if(!conn.host||!conn.user||!conn.password){console.error('PGHOST, PGUSER ve PGPASSWORD gerekli (parola yalnız ortamdan; komut satırına yazılmaz)');process.exit(2);}
    const r=await g19Check({conn});
    console.log(JSON.stringify(r,null,1));
    process.exit(r.status==='ok'?0:1);
  })().catch(e=>{console.error(scrub(e));process.exit(1);});
}

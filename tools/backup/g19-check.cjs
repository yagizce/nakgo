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
 *   session_mode YOKLAMA (kesin kanıt değil): işlem havuzlamasının belirtilerini arar (süreç değişmesi, ayar kaybı,
 *                başka istemcinin bu istemcinin sunucu sürecini alması); belirti görülürse kesin düşer
 *   pooler_mode_confirmed  sahibin Supabase panelinde "Session pooler" (5432) bağlantısını elle teyidi
 *                (NAKGO_G19_POOLER_MODE=session); yoklama geçse de bu olmadan sonuç başarılı sayılmaz
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
 *   NAKGO_G19_POOLER_MODE=session   # yalnız panelde "Session pooler" (5432) görüldükten sonra \
 *   read -s PGPASSWORD && export PGPASSWORD && node tools/backup/g19-check.cjs; unset PGPASSWORD
 * Çıkış kodu: 0 hepsi geçti, 1 en az biri başarısız, 2 kullanım hatası. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dns=require('node:dns').promises,net=require('node:net');
const D=require('./dump.cjs');

const EXPECT_ROLE='nakgo_bootstrap_reader';
const WRONG_CA=path.join(__dirname,'../../ops/backup/g19-wrong-ca.pem');
const tlsCode=/^(ERR_TLS|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO|CERT_|ERR_SSL)/;
const tlsMessage=/certificate|self[- ]signed|altnames|Hostname\/IP/i;

function errorDetail(error){
  const code=error?.code||'';
  const message=String(error?.message||error);
  if(tlsCode.test(code)||tlsMessage.test(message))return 'TLS certificate doğrulaması başarısız';
  if(code==='28P01')return 'Parola doğrulaması başarısız (28P01)';
  if(code==='ECONNREFUSED'||code==='ETIMEDOUT'||code==='ENOTFOUND')return `Bağlantı başarısız (${code})`;
  return 'İşlem başarısız; ilgili kontrolün runbook adımını inceleyin';
}

function connFromEnv(e=process.env){
  return {host:e.PGHOST,port:Number(e.PGPORT||5432),user:e.PGUSER,password:e.PGPASSWORD,database:e.PGDATABASE||'postgres',sslmode:e.PGSSLMODE,sslrootcert:e.PGSSLROOTCERT};
}
/** Supavisor kullanıcı adı "<rol>.<proje-ref>"; sunucu tarafında current_user yalnız rol adıdır. */
const roleOfUser=u=>String(u||'').split('.')[0];

async function tryConnect(Client,cfg){
  const c=new Client(cfg);c.on('error',()=>{});
  try{await c.connect();await c.end().catch(()=>{});return {ok:true};}
  catch(e){await c.end().catch(()=>{});return {ok:false,tlsRejected:tlsCode.test(e.code||'')||tlsMessage.test(e.message),detail:errorDetail(e)};}
}

/** İşlem (transaction) havuzlamasına karşı yoklama. A (zaten bağlı, işlem dışında) bir oturum ayarı koyar; iki ek istemci
 * aynı anda işlem açar. Oturum modunda bir sunucu süreci, istemcisi bağlı kaldıkça yalnız ona aittir: başka bir istemci
 * A'nın sürecini alamaz, A'nın ayarını göremez, A'nın süreci değişmez. Bunlardan biri görülürse işlem modu KESİN demektir.
 * Hiçbiri görülmezse bu yalnız "belirti yok"tur: havuzlayıcı ek istemcilere yeni bağlantı açmış olabilir. Bu yüzden sonuç
 * kanıt değil yoklamadır; oturum modu ayrıca sahibin panel teyidiyle (pooler_mode_confirmed) zorunlu tutulur.
 * En fazla 3 eşzamanlı bağlantı kullanır (bootstrap rolünün bağlantı sınırı). */
async function sessionModeProbe(a,open,{waitMs=1000}={}){
  const extra=[];
  try{
    const p1=(await a.query(`select pg_backend_pid() p,set_config('nakgo.g19_probe','a',false) s`)).rows[0].p;
    await new Promise(r=>setTimeout(r,waitMs));
    const s2=(await a.query(`select pg_backend_pid() p,current_setting('nakgo.g19_probe',true) n`)).rows[0];
    if(s2.p!==p1)return {ok:false,detail:'işlem modu: aynı istemcinin sunucu süreci değişti'};
    if(s2.n!=='a')return {ok:false,detail:'işlem modu: oturum ayarı korunmadı'};
    for(let i=0;i<2;i++){const b=await open();extra.push(b);await b.query('begin');}
    for(const b of extra){
      const r=(await b.query(`select pg_backend_pid() p,current_setting('nakgo.g19_probe',true) n`)).rows[0];
      if(r.p===p1)return {ok:false,detail:"işlem modu: başka bir istemci, ilk istemci bağlıyken onun sunucu sürecini aldı"};
      if(r.n==='a')return {ok:false,detail:"işlem modu: ilk istemcinin oturum ayarı başka istemcide görünüyor"};
    }
    const p3=(await a.query('select pg_backend_pid() p')).rows[0].p;
    if(p3!==p1)return {ok:false,detail:'işlem modu: aynı istemcinin sunucu süreci değişti'};
    return {ok:true,detail:'yoklama: işlem modu belirtisi yok (kesin kanıt değil; panel teyidi zorunlu)'};
  }catch(e){return {ok:false,detail:'yoklama: '+errorDetail(e)};}
  finally{for(const b of extra){await b.query('rollback').catch(()=>{});await b.end().catch(()=>{});}}
}

async function g19Check({conn,expectRole=EXPECT_ROLE,pgBin=process.env.NAKGO_PG_BIN,allowLocal=false,Client,localPg=process.env.NAKGO_PG_HOST,
  poolerMode=process.env.NAKGO_G19_POOLER_MODE}={}){
  Client=Client||require('pg').Client;
  const checks=[];const add=(code,ok,detail)=>{checks.push({code,ok:!!ok,...(detail?{detail}:{})});return !!ok;};
  const done=()=>({status:checks.every(c=>c.ok)?'ok':'failed',checks});
  // 1. Kurallar. G19 için yerelde de verify-full zorunludur (yerel test yalnız sunucu adı kuralını atlar).
  const rules=D.validateConn(conn,{allowLocal});
  if(conn&&conn.sslmode!=='verify-full')rules.push('sslmode=verify-full zorunlu');
  if(conn&&(!conn.sslrootcert||!fs.existsSync(conn.sslrootcert)))rules.push('kök sertifika dosyası yok');
  if(conn&&roleOfUser(conn.user)!==expectRole)rules.push(`kullanıcı ${expectRole} değil`);
  if(!add('rules',!rules.length,rules.join('; ')||undefined))return done();
  let cfg;try{cfg=D.clientConfig(conn);D.newClient(Client,cfg);}catch(e){add('rules',false,errorDetail(e));return done();}
  // 2. Olumsuz TLS: yanlış kök sertifika ve sunucu adı uyuşmazlığı. Parola TLS doğrulandıktan sonra gönderilir.
  const wrong=await tryConnect(Client,{...cfg,ssl:{...cfg.ssl,ca:fs.readFileSync(WRONG_CA,'utf8')}});
  add('tls_wrong_ca',wrong.tlsRejected,wrong.ok?'yanlış kök sertifikayla bağlanıldı':wrong.detail);
  let ip=null;try{ip=net.isIP(conn.host)?null:(await dns.lookup(conn.host)).address;}catch(e){}
  if(!ip)add('tls_hostname',false,'sunucu adı IP adresine çözülemedi');
  else{const {servername,...ssl}=cfg.ssl;const r=await tryConnect(Client,{...cfg,host:ip,ssl});add('tls_hostname',r.tlsRejected,r.ok?'IP ile bağlanıldı: sunucu adı doğrulanmıyor':r.detail);}
  // 3. Olumlu bağlantı ve rol.
  const a=new Client(cfg);a.on('error',()=>{});
  let b=null,dir=null;
  try{
    try{await a.connect();}catch(e){add('connect',false,errorDetail(e));return done();}
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
    try{add('read_only',(await D.enforceReadOnly(a))==='on');}catch(e){add('read_only',false,errorDetail(e));}
    // 4. Oturum modu: yalnız YOKLAMA (kesin kanıt değil) + sahibin panelden teyidi (zorunlu).
    const probe=await sessionModeProbe(a,async()=>{const x=new Client(cfg);x.on('error',()=>{});await x.connect();return x;});
    checks.push({code:'session_mode',ok:probe.ok,kind:'probe',detail:probe.detail});
    add('pooler_mode_confirmed',poolerMode==='session',poolerMode==='session'?'sahip teyidi: oturum havuzlayıcısı (5432)'
      :'NAKGO_G19_POOLER_MODE=session gerekli: Supabase panelinde bağlantı dizesinin "Session pooler" (5432) olduğu elle doğrulanmalı');
    // 5. Anlık görüntü paylaşımı ve pg_dump (yalnız şema).
    await a.query('begin isolation level repeatable read read only');
    const snap=(await a.query('select pg_export_snapshot() s')).rows[0].s;
    b=new Client(cfg);b.on('error',()=>{});
    try{
      await b.connect();await b.query('begin isolation level repeatable read read only');
      await b.query(`set transaction snapshot '${snap.replace(/'/g,"''")}'`);await b.query('select 1');await b.query('rollback');
      add('snapshot',true);
    }catch(e){add('snapshot',false,errorDetail(e));}
    const tools=[];for(const t of ['pg_dump','pg_restore']){const m=await D.toolMajor(t,pgBin);if(!m||m<r.major)tools.push(`${t} ${m||'yok'} < sunucu ${r.major}`);}
    add('tools',!tools.length,tools.join('; ')||undefined);
    if(!tools.length){
      dir=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-g19-'));fs.chmodSync(dir,0o700);
      const f=path.join(dir,'schema.dump');
      const d=await D.run(D.binPath('pg_dump',pgBin),['-Fc','--schema-only','-n','public','-n','private','--snapshot='+snap,'--no-sync','-f',f],{env:D.dumpEnv(conn)});
      if(d.code!==0)add('pg_dump',false,errorDetail(d.err));
      else{
        const l=await D.run(D.binPath('pg_restore',pgBin),['-l',f]);
        const n=l.code===0?l.out.split('\n').filter(x=>/^\d+;/.test(x)).length:0;
        add('pg_dump',l.code===0&&n>0,l.code===0?`${n} şema öğesi`:errorDetail(l.err));
      }
    }
    await a.query('rollback').catch(()=>{});
    // 6. Yerel geri yükleme sunucusu (ilk yedekte bağımsız PostgreSQL 17 geri yüklemesi için).
    if(!localPg||!D.isLocalHost(localPg))add('local_pg',false,'NAKGO_PG_HOST yerel bir PostgreSQL olmalı');
    else{
      const l=new Client({host:localPg,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:'postgres'});
      l.on('error',()=>{});
      try{await l.connect();const m=(await l.query(`select current_setting('server_version_num')::int/10000 m`)).rows[0].m;add('local_pg',m>=r.major,m>=r.major?`PostgreSQL ${m}`:`yerel ${m} < sunucu ${r.major}`);}
      catch(e){add('local_pg',false,errorDetail(e));}
      finally{await l.end().catch(()=>{});}
    }
  }catch(e){add('unexpected',false,errorDetail(e));}
  finally{
    if(b)await b.end().catch(()=>{});
    await a.end().catch(()=>{});
    if(dir)fs.rmSync(dir,{recursive:true,force:true});
  }
  return done();
}

module.exports={g19Check,sessionModeProbe,connFromEnv,roleOfUser,EXPECT_ROLE,WRONG_CA};

if(require.main===module){
  (async()=>{
    const conn=connFromEnv();
    if(!conn.host||!conn.user||!conn.password){console.error('PGHOST, PGUSER ve PGPASSWORD gerekli (parola yalnız ortamdan; komut satırına yazılmaz)');process.exit(2);}
    const r=await g19Check({conn});
    console.log(JSON.stringify(r,null,1));
    process.exit(r.status==='ok'?0:1);
  })().catch(e=>{console.error(errorDetail(e));process.exit(1);});
}

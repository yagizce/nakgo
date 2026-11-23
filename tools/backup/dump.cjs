/** B7-A2: tek ve tutarlı PostgreSQL anlık görüntüsünden döküm.
 *
 * Akış:
 *   S1 (dışa aktaran oturum, yedek rolüyle): BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
 *      ilk komut pg_export_snapshot() → işlemin görüntüsü sabitlenir. Aynı işlem içinde: tablo başına satır sayıları,
 *      kapsam korumaları, Auth sürümü, şema parmak izi (db-lib SNAPSHOT_SQL), geri yükleme için tip/fonksiyon/rol bilgisi.
 *   B (Auth/Storage kapsamı) S1 içinde: yapı katalogdan, veri yalnız dışa aktarma fonksiyonlarından (scope-export.cjs);
 *      yedek rolü bu şemalarda hiçbir tabloyu doğrudan okuyamaz.
 *   S2: pg_dump --snapshot=<id> (tam şemalar). PostgreSQL dışa aktarılan görüntünün içe alınmasını, dışa aktaran işlem
 *      açık kaldığı sürece garanti eder; alınamazsa pg_dump hata ile durur.
 *   S1, pg_dump bitene kadar açık kalır, sonra geri alınır. Kanıt: geri yüklenen kopyadaki sayılar S1 ile birebir eşit
 *   olmalı (restore-verify); eşzamanlı yazıcı testi bunu canlı yazma altında gösterir.
 *
 * Bağlantı kuralları (muaf tutulamaz):
 *   - Uzak sunucu: sslmode=verify-full ve kök sertifika dosyası zorunlu; port 5432 (Supavisor OTURUM modu).
 *     6543 (işlem modu) reddedilir: açık işlem ve oturum ayarları korunmaz, dışa aktarılan görüntü güvenilmez olur.
 *   - Yerel sunucu yalnız allowLocal ile (testler).
 * Salt okunurluk (her bağlantı), başlangıç parametresine (options / PGOPTIONS) DAYANMADAN — havuzlayıcı onu iletmeyebilir
 *   ya da reddedebilir:
 *   - S1: bağlantı kurulur kurulmaz, başka hiçbir sorgudan önce açık "SET default_transaction_read_only = on" ve değerin
 *     sorgulanarak doğrulanması (enforceReadOnly); ayrıca S1 READ ONLY işlemdir ve ikisi de "on" değilse hiçbir şey okunmaz.
 *   - pg_dump: kendi bağlantısında tek işlem açar ve ilk iş "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
 *     yapar; bütün okumalar bu işlemdedir (b8 testi gerçek pg_dump'ın gönderdiği komutları kaydedip denetler).
 *
 * Kipler: functions (B7, yedek rolü, dışa aktarma fonksiyonları) ve bootstrap (ilk yedek: yedek rolü ve fonksiyonlar
 * henüz yokken, fonksiyonların sahibi olacak rolle aynı sorgular doğrudan; bkz. docs/backup/runbooks/bootstrap-first-backup.md).
 * İki kipte de kapsam denetimi (sınıflandırılmamış Auth/Storage/Vault tablosu → dur), kapsam dışı tablo sayımları ve
 * yönetim verisi (cron, migration geçmişi) aynıdır.
 * Bu araç production'a hiçbir şey yazmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {SNAPSHOT_SQL}=require('../db-lib.cjs');
const {sha256}=require('./crypto.cjs');
const {scopeDDL,exportScope,exportMeta,EXPORT_SETTINGS,directFrom,unclassifiedTables,guardList,guardKey,directGuardCounts,relExists}=require('./scope-export.cjs');

const isLocalHost=h=>typeof h==='string'&&(h.startsWith('/')||['localhost','127.0.0.1','::1'].includes(h));

function validateConn(conn,{allowLocal=false,expectedHostSuffix='.pooler.supabase.com'}={}){
  const problems=[];
  if(!conn||!conn.host)problems.push('bağlantı bilgisi eksik');
  else if(isLocalHost(conn.host)){if(!allowLocal)problems.push('yerel sunucuya yalnız testlerde bağlanılır');}
  else{
    if(!conn.host.endsWith(expectedHostSuffix))problems.push('beklenmeyen sunucu: '+conn.host);
    if(Number(conn.port)===6543)problems.push('port 6543 Supavisor İŞLEM modu: döküm yalnız oturum modunda (5432) alınır');
    else if(Number(conn.port)!==5432)problems.push('port 5432 olmalı (Supavisor oturum modu)');
    if(conn.sslmode!=='verify-full')problems.push('sslmode=verify-full zorunlu');
    if(!conn.sslrootcert||!fs.existsSync(conn.sslrootcert))problems.push('kök sertifika dosyası yok');
  }
  return problems;
}

function pgEnv(conn){
  const env={...process.env,PGHOST:conn.host,PGPORT:String(conn.port||5432),PGUSER:conn.user,PGDATABASE:conn.database||'postgres',PGAPPNAME:'nakgo-backup'};
  if(conn.password)env.PGPASSWORD=conn.password;else delete env.PGPASSWORD;
  if(conn.sslmode){env.PGSSLMODE=conn.sslmode;env.PGSSLROOTCERT=conn.sslrootcert;}
  return env;
}
/** Bağlantı kurulduktan HEMEN SONRA, başka hiçbir sorgudan önce: oturumu açıkça salt okunur yapar ve değeri sorgulayarak
 * doğrular. Başlangıç parametresi kullanılmaz; havuzlayıcıdan bağımsızdır. Değer "on" değilse
 * hata fırlatır; çağıran hiçbir şey okumadan durur. */
async function enforceReadOnly(c){
  await c.query('set default_transaction_read_only = on');
  const v=(await c.query(`select current_setting('default_transaction_read_only') v`)).rows[0].v;
  if(v!=='on')throw Object.assign(Error(`oturum salt okunur yapılamadı (default_transaction_read_only=${v})`),{code:'nakgo_read_only'});
  return v;
}
/** pg_dump ortamı. Başlangıç parametresi (PGOPTIONS) gönderilmez; ortamdan devralınan bir PGOPTIONS da silinir ki
 * havuzlayıcının desteklemediği bir parametre bağlantıyı düşürmesin. Salt okunurluk pg_dump'ın kendi READ ONLY işlemidir. */
const dumpEnv=conn=>{const env=pgEnv(conn);delete env.PGOPTIONS;return env;};
/** Desteklenen node-pg sürümü: tek kaynak ops/backup/ci/package.json (lockfile ile sabit; CI da bu sürümü kurar).
 * newClient node-pg'nin iç alanlarına (connectionParameters, getStartupConf) dayanır; başka bir sürümde bağlanılmaz. */
const PG_CLIENT_VERSION=JSON.parse(fs.readFileSync(path.join(__dirname,'../../ops/backup/ci/package.json'),'utf8')).dependencies.pg;
/** İstemci (node-pg). node-pg, yapılandırmada options yoksa ortamdaki PGOPTIONS'ı yapıcıda okuyup başlangıç parametresi
 * olarak gönderir; yapılandırmayla bunu kapatmanın yolu yoktur (boş değer ortama düşer). Bu yüzden değer YALNIZ bu istemcinin
 * bağlantı parametrelerinden kaldırılır; process.env değişmez. node-pg sürümü sabit sürüm değilse, iç yapı beklenenden
 * farklıysa, başlangıç paketinde options hâlâ varsa ya da TLS yapılandırması istemciye aynen geçmemişse hata verilir
 * (bağlanılmaz). node-pg olmayan istemciler (test sahteleri) olduğu gibi döner. */
function newClient(Client,cfg){
  let pg=null;try{pg=require('pg');}catch{}
  if(pg){
    const v=require('pg/package.json').version;
    if(v!==PG_CLIENT_VERSION)throw Error(`node-pg sürümü ${v}; desteklenen ${PG_CLIENT_VERSION} (npm ci --prefix ops/backup/ci)`);
  }
  const c=new Client(cfg);
  if((pg&&c instanceof pg.Client)||(c&&c.connectionParameters)){
    if(!c.connectionParameters||typeof c.getStartupConf!=='function')throw Error('node-pg istemcisi beklenen yapıda değil: başlangıç parametreleri denetlenemiyor');
    c.connectionParameters.options=undefined;
    if('options' in c.getStartupConf())throw Error('başlangıç parametresi (options) kaldırılamadı');
    if(c.connectionParameters.ssl!==(cfg.ssl===undefined?c.connectionParameters.ssl:cfg.ssl))throw Error('TLS yapılandırması istemciye aynen geçmedi');
  }
  return c;
}
/** pg_dump'ın veri okuduğu işlem türü (kaynak: pg_dump setup_connection; b8 vekil testi doğrular). */
const PG_DUMP_TRANSACTION='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY';
/** Bağlantı yapılandırması. Uzak sunucuda TLS doğrulaması olmadan yapılandırma ÜRETİLMEZ (hata): sslmode=verify-full,
 * kök sertifika dosyası, sertifika zinciri ve sunucu adı doğrulaması zorunlu. Yerel test sunucusu (soket/localhost) aynen kalır.
 * Bağlantı kurallarının tamamı (sunucu adı, port) validateConn'dadır ve bağlantıdan ÖNCE çağrılmalıdır. */
function clientConfig(conn){
  if(!conn||!conn.host)throw Error('bağlantı bilgisi eksik');
  if(!isLocalHost(conn.host)){
    if(conn.sslmode!=='verify-full')throw Error('uzak bağlantı yalnız sslmode=verify-full ile kurulur');
    if(!conn.sslrootcert||!fs.existsSync(conn.sslrootcert))throw Error('uzak bağlantı için kök sertifika dosyası gerekli');
  }
  const c={host:conn.host,port:Number(conn.port||5432),user:conn.user,password:conn.password,database:conn.database||'postgres',application_name:'nakgo-backup'};
  if(conn.sslmode==='verify-full')c.ssl={rejectUnauthorized:true,ca:fs.readFileSync(conn.sslrootcert,'utf8'),servername:conn.host};
  return c;
}

function run(bin,args,{env,timeoutMs=20*60*1000}={}){
  return new Promise((resolve)=>{
    // Sinyal işleyicileri kuruluysa (elle bootstrap) alt süreç kendi grubunda başlar ve izlenir: sinyalde torunlarıyla
    // birlikte sonlandırılır (abort.cjs). Kurulu değilse davranış aynı.
    const A=require('./abort.cjs'),o=A.spawnOptions();
    if(A.isAborting())return resolve({code:-1,out:'',err:'sinyal alındı ('+A.abortSignal()+'): alt süreç başlatılmadı'});
    const p=spawn(bin,args,{env,stdio:['ignore','pipe','pipe'],...o});
    A.trackChild(p,{detached:!!o.detached});
    let out='',err='';
    const t=setTimeout(()=>{p.kill('SIGKILL');err+='\nzaman aşımı';},timeoutMs);
    p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
    p.on('close',code=>{clearTimeout(t);resolve({code,out,err});});
    p.on('error',e=>{clearTimeout(t);resolve({code:-1,out,err:err+e.message});});
  });
}
const binPath=(name,pgBin)=>pgBin?path.join(pgBin,name):name;
async function toolMajor(name,pgBin){const r=await run(binPath(name,pgBin),['--version']);const m=/\s(\d+)(?:\.\d+)?/.exec(r.out);return m?Number(m[1]):null;}

const qi=s=>'"'+String(s).replace(/"/g,'""')+'"';

/** Çalıştıran rolden bağımsız ACL satırları. B1'in SNAPSHOT_SQL'indeki "grant"/"colgrant" satırları information_schema
 * görünümlerinden gelir; bu görünümler yalnız çağıranın görebildiği yetkileri listeler (yedek rolüyle anon/authenticated
 * yetkileri görünmez). Bu yüzden yedek doğrulamasında o satırlar çıkarılır, yerine doğrudan katalogdaki ACL'ler kullanılır. */
const ACL_SQL=`
select line from (
  select 'acl '||c.relkind::text||' '||n.nspname||'.'||c.relname||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type||case when a.is_grantable then ' grantable' else '' end line
    from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a
    where (n.nspname = any($1::text[]) or n.nspname||'.'||c.relname = any($2)) and c.relkind in ('r','p','v','m','f','S') and a.grantee<>c.relowner
  union all
  select 'colacl '||n.nspname||'.'||c.relname||'.'||at.attname||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_attribute at join pg_class c on c.oid=at.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(at.attacl) a
    where (n.nspname = any($1::text[]) or n.nspname||'.'||c.relname = any($2)) and at.attnum>0 and not at.attisdropped and a.grantee<>c.relowner
  union all
  select 'nspacl '||n.nspname||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname = any($1::text[])
  union all
  select 'proacl '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname = any($1::text[]) and a.grantee<>p.proowner
) x order by 1`;

/** Yedek doğrulamasında kullanılan rol bağımsız parmak izi (kaynak ve geri yüklenen kopya aynı fonksiyonla hesaplanır).
 * Sahiplik satırları ve dökülen rolün kendisine verilen yetkiler hariç tutulur: geri yükleme --no-owner ile yapılır.
 * Nesne sahibinin kendi yetki satırları da (tablo, sütun, fonksiyon) hariçtir: Supabase'te Auth tablolarının sahibi
 * supabase_auth_admin'dir, geri yüklenen kopyada ise geri yükleyen rol; sahibe verilen örtük yetki yapı değil sahipliktir. */
async function catalogFingerprint(query,{fullSchemas,includedTables,excludeRoles=[]}){
  const base=(await query(SNAPSHOT_SQL)).rows.map(r=>r.line).filter(l=>!/^(grant|colgrant) /.test(l));
  const acl=(await query(ACL_SQL,[fullSchemas,includedTables])).rows.map(r=>r.line)
    .filter(l=>!excludeRoles.some(r=>l.includes(' '+r+' ')));
  return [...base,...acl].sort();
}

/** S1 içinde, geri yüklemenin düz PostgreSQL'de yapılabilmesi için gerekenler: tipler, başvurulan fonksiyonlar, roller. */
async function restoreBootstrap(c,scope,includedTables){
  const fullSchemas=scope.full_schemas;
  const extraSchemas=[...new Set(includedTables.map(t=>t.split('.')[0]))].filter(s=>!fullSchemas.includes(s));
  const lines=extraSchemas.map(s=>`create schema if not exists ${qi(s)};`);
  const types=(await c.query(`select distinct t.oid,n.nspname s,t.typname name,t.typtype::text kind
      from pg_attribute a join pg_class cl on cl.oid=a.attrelid join pg_namespace cn on cn.oid=cl.relnamespace
      join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
      where cn.nspname||'.'||cl.relname = any($1) and a.attnum>0 and not a.attisdropped and n.nspname <> all($2::text[]) and n.nspname not in ('pg_catalog','information_schema')
      order by 2,3`,[includedTables,fullSchemas])).rows;
  for(const t of types){
    if(t.kind==='e'){
      const labels=(await c.query(`select enumlabel from pg_enum where enumtypid=$1 order by enumsortorder`,[t.oid])).rows.map(r=>"'"+r.enumlabel.replace(/'/g,"''")+"'");
      lines.push(`do $$ begin if to_regtype('${t.s}.${t.name}') is null then create type ${qi(t.s)}.${qi(t.name)} as enum (${labels.join(', ')}); end if; end $$;`);
    }else if(t.kind==='d'){
      const d=(await c.query(`select format_type(typbasetype,typtypmod) base,typnotnull nn,
          coalesce((select string_agg(pg_get_constraintdef(oid),' ') from pg_constraint where contypid=$1),'') checks from pg_type where oid=$1`,[t.oid])).rows[0];
      lines.push(`do $$ begin if to_regtype('${t.s}.${t.name}') is null then create domain ${qi(t.s)}.${qi(t.name)} as ${d.base}${d.nn?' not null':''} ${d.checks}; end if; end $$;`);
    }else throw Error('Desteklenmeyen tip kapsamda: '+t.s+'.'+t.name+' ('+t.kind+')');
  }
  // Tam şemalardaki nesnelerin (varsayılanlar, politikalar, kısıtlar, görünümler) başvurduğu, kapsam dışı şemalardaki fonksiyonlar.
  const funcs=(await c.query(`select distinct p.oid,n.nspname s,p.proname name from pg_depend d
      join pg_proc p on d.refclassid='pg_proc'::regclass and d.refobjid=p.oid join pg_namespace n on n.oid=p.pronamespace
      where n.nspname <> all($1::text[]) and n.nspname not in ('pg_catalog','information_schema')
        and (
          (d.classid='pg_attrdef'::regclass and exists(select 1 from pg_attrdef ad join pg_class cl on cl.oid=ad.adrelid join pg_namespace cn on cn.oid=cl.relnamespace where ad.oid=d.objid and (cn.nspname = any($1::text[]) or cn.nspname||'.'||cl.relname = any($2))))
          or (d.classid='pg_policy'::regclass and exists(select 1 from pg_policy po join pg_class cl on cl.oid=po.polrelid join pg_namespace cn on cn.oid=cl.relnamespace where po.oid=d.objid and (cn.nspname = any($1::text[]) or cn.nspname||'.'||cl.relname = any($2))))
          or (d.classid='pg_constraint'::regclass and exists(select 1 from pg_constraint co join pg_namespace cn on cn.oid=co.connamespace where co.oid=d.objid and cn.nspname = any($1::text[])))
          or (d.classid='pg_rewrite'::regclass and exists(select 1 from pg_rewrite rw join pg_class cl on cl.oid=rw.ev_class join pg_namespace cn on cn.oid=cl.relnamespace where rw.oid=d.objid and cn.nspname = any($1::text[])))
        ) order by 2,3`,[fullSchemas,includedTables])).rows;
  for(const f of funcs){
    const def=(await c.query(`select pg_get_functiondef($1) d,l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1`,[f.oid])).rows[0];
    if(!['sql','plpgsql'].includes(def.lanname))throw Error('Geri yükleme için başvurulan fonksiyon SQL/PLpgSQL değil: '+f.s+'.'+f.name);
    lines.push(def.d.trim().replace(/;?\s*$/,';'));
  }
  // ACL'lerde ve politikalarda geçen roller (geri yüklemede yoksa NOLOGIN oluşturulur).
  const roles=(await c.query(`with acls as (
      select relacl acl from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname = any($1::text[]) or n.nspname||'.'||cl.relname = any($2)
      union all select proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname = any($1::text[])
      union all select nspacl from pg_namespace where nspname = any($1::text[]) or nspname = any($3::text[])
      union all select typacl from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname = any($1::text[])
      union all select defaclacl from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname = any($1::text[]))
    select distinct r.rolname from acls cross join lateral aclexplode(acls.acl) a join pg_roles r on r.oid in (a.grantee,a.grantor)
    union select distinct r.rolname from pg_policy po join pg_class cl on cl.oid=po.polrelid join pg_namespace n on n.oid=cl.relnamespace
      cross join lateral unnest(po.polroles) pr join pg_roles r on r.oid=pr where n.nspname = any($1::text[]) or n.nspname||'.'||cl.relname = any($2)
    union select distinct pg_get_userbyid(d.defaclrole) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname = any($1::text[])
    order by 1`,[fullSchemas,includedTables,extraSchemas])).rows.map(r=>r.rolname);
  // Kapsamdaki tekil tablolarda yalnız kendi şemalarımızdaki fonksiyonları çağıran tetikleyiciler geri yüklenir.
  const triggers=(await c.query(`select n.nspname||' '||cl.relname||' '||t.tgname entry from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      join pg_namespace n on n.oid=cl.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
      where not t.tgisinternal and n.nspname||'.'||cl.relname = any($1) and pn.nspname = any($2::text[]) order by 1`,[includedTables,fullSchemas])).rows.map(r=>r.entry);
  // Kapsam dışı şemaların (auth, storage) kullanım yetkileri: Supabase hedefte bunları kendisi kurar; düz PostgreSQL
  // doğrulamasında ve provada istemci rolleri auth.uid() gibi fonksiyonlara bu yetkiyle ulaşır.
  const nsp=(await c.query(`select n.nspname s,case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end g,a.privilege_type p
      from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname = any($1::text[]) and a.grantee<>n.nspowner order by 1,2,3`,[extraSchemas])).rows;
  const sql=[...lines,...nsp.map(x=>`grant ${x.p.toLowerCase()} on schema ${qi(x.s)} to ${x.g};`)];
  return {sql:sql.join('\n')+'\n',roles,triggers,extraSchemas};
}

/** Kapsam DIŞI Auth/Storage tablolarında bizim fonksiyonlarımızı çağıran tetikleyiciler (ör. auth.sessions → giriş günlüğü).
 * Bu tablolar yedeğe girmez; Supabase hedefte onları kurar ama tetikleyicilerimizi kurmaz. Tanımları ve (yalnız provada
 * yerel taklit için) tabloların yapısı kaydedilir; kurtarma SQL'i (restore-meta.cjs) tetikleyicileri yeniden kurar. */
async function externalTriggers(c,scope,included){
  const rows=(await c.query(`select n.nspname||'.'||cl.relname tbl,t.tgname,pg_get_triggerdef(t.oid) def from pg_trigger t
      join pg_class cl on cl.oid=t.tgrelid join pg_namespace n on n.oid=cl.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
      where not t.tgisinternal and n.nspname = any($1::text[]) and pn.nspname = any($2::text[]) and n.nspname||'.'||cl.relname <> all($3::text[]) order by 1,2`,
    [scope.coverage_schemas||[],scope.full_schemas,included])).rows;
  return rows.map(r=>({table:r.tbl,name:r.tgname,def:r.def}));
}

/**
 * Döküm alır. Dönüş: {status:'ok'|'failed', reasons[], source:{...}} ve outDir altında A.dump, B.pre.sql, B/*.jsonl,
 * B.post.sql, bootstrap.sql, source.json.
 * Testlere özel: delayBeforeDumpMs (S1 ile pg_dump arasında bekleme), useSnapshot=false (kasıtlı bozma).
 */
async function snapshotDump({conn,scope,outDir,pgBin,allowLocal=false,delayBeforeDumpMs=0,useSnapshot=true,mode='functions',Client=require('pg').Client}){
  if(!['functions','bootstrap'].includes(mode))return {status:'failed',stage:'mode',reasons:['bilinmeyen kip: '+mode]};
  const direct=mode==='bootstrap';
  const reasons=validateConn(conn,{allowLocal});
  if(reasons.length)return {status:'failed',stage:'connection',reasons};
  fs.mkdirSync(outDir,{recursive:true,mode:0o700});
  const started=Date.now();
  let cfg;
  try{cfg=clientConfig(conn);}catch(e){return {status:'failed',stage:'connection',reasons:[e.message]};}
  let c;
  try{c=newClient(Client,cfg);}catch(e){return {status:'failed',stage:'connection',reasons:[e.message]};}
  // Bağlantı boştayken koparsa (bakım, sonlandırma) 'error' olayı dinleyicisiz kalırsa süreci çökertir; sorgu zaten
  // hata döndürür ve aşama başarısız raporlanır.
  c.on('error',()=>{});
  await c.connect();
  let s1Open=false;
  // Sinyalde (abort.cjs): kaynak bağlantısı kapatılır; anlık görüntü işlemi sunucuda geri alınır.
  const unregS1=require('./abort.cjs').register('kaynak S1 bağlantısı',async()=>{await c.end();});
  try{
    try{await enforceReadOnly(c);}catch(e){return {status:'failed',stage:'read_only',reasons:[e.message]};}
    const serverMajor=Number((await c.query(`select current_setting('server_version_num')::int/10000 v`)).rows[0].v);
    for(const tool of ['pg_dump','pg_restore']){
      const m=await toolMajor(tool,pgBin);
      if(!m||m<serverMajor)return {status:'failed',stage:'tools',reasons:[`${tool} sürümü (${m}) sunucudan (${serverMajor}) eski olamaz`]};
    }
    await c.query('begin isolation level repeatable read read only');s1Open=true;
    const snap=(await c.query(`select pg_export_snapshot() id,pg_current_snapshot()::text txid_snapshot,to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') taken_at,
      current_setting('server_version') server_version,current_user role,current_setting('transaction_read_only') tro,
      current_setting('default_transaction_read_only') dtro`)).rows[0];
    if(snap.tro!=='on'||snap.dtro!=='on')return {status:'failed',stage:'read_only',reasons:[`oturum salt okunur değil (işlem ${snap.tro}, varsayılan ${snap.dtro})`]};
    // Kapsam denetimi (yalnız katalog): sınıflandırılmamış Auth/Storage/Vault tablosu varsa hiçbir veri okunmaz.
    const cov=await unclassifiedTables(c,scope);
    if(cov.unclassified.length)return {status:'failed',stage:'coverage',reasons:cov.unclassified.map(t=>'sınıflandırılmamış tablo: '+t+' (ops/backup/scope.json)')};
    // Kapsam ve korumalar
    const included=[],missing=[];
    for(const t of scope.tables){
      // Katalogdan bakılır: metin adı çözmek (to_regclass) şema USAGE'ı yoksa hata verir; yetki ayrıca denetlenir.
      const [ns,rel]=t.name.split('.');
      const ok=(await c.query(`select exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2) e`,[ns,rel])).rows[0].e;
      if(ok)included.push(t.name);else if(t.required)missing.push(t.name);
    }
    if(missing.length)return {status:'failed',stage:'scope',reasons:missing.map(m=>'zorunlu tablo yok: '+m)};
    // Yetki: tam şemalarda tablo okuma; kapsam tablolarında yalnız dışa aktarma fonksiyonu. Eksikse "yetki" aşamasında durur.
    const tables=(await c.query(`select n.nspname||'.'||c.relname q from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname = any($1::text[]) order by 1`,[scope.full_schemas])).rows.map(r=>r.q);
    const unreadable=(await c.query(`select x from unnest($1::text[]) x where not coalesce((select has_table_privilege(current_user,c.oid,'SELECT')
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=split_part(x,'.',1) and c.relname=split_part(x,'.',2)),false)
      or not has_schema_privilege(current_user,split_part(x,'.',1),'USAGE')`,[tables])).rows.map(r=>r.x);
    const scoped=scope.tables.filter(t=>included.includes(t.name));
    const metaPresent=[];
    for(const m of scope.meta||[])if(await relExists(c,m.name))metaPresent.push(m);
    const guardPresent=[];
    for(const t of guardList(scope))if(await relExists(c,t))guardPresent.push(t);
    let notCallable=[],directUnreadable=[];
    if(!direct){
      // Yönetim verisi için yedek rolünün dışa aktarma fonksiyonu henüz yok: tablo varsa sessiz geçilmez, durur.
      if(metaPresent.length)return {status:'failed',stage:'meta',reasons:metaPresent.map(m=>'B7 kipinde okunamayan yönetim verisi: '+m.name+' (bootstrap ya da ayrı iş: dışa aktarma fonksiyonu)')};
      const fnNames=[...scoped.map(t=>t.export),scope.guard_counts_function];
      notCallable=(await c.query(`select x from unnest($1::text[]) x where not coalesce((select has_function_privilege(current_user,p.oid,'EXECUTE')
        and has_schema_privilege(current_user,n.oid,'USAGE') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname=split_part(x,'.',1) and p.proname=split_part(x,'.',2) and p.pronargs=0),false)`,[fnNames])).rows.map(r=>r.x);
    }else{
      // Bootstrap: kapsam, meta ve sayılacak tablolar doğrudan okunur; hepsi okunabilir olmalı.
      const need=[...scoped.map(t=>t.name),...metaPresent.map(m=>m.name),...guardPresent];
      directUnreadable=(await c.query(`select x from unnest($1::text[]) x where not coalesce((select has_table_privilege(current_user,c.oid,'SELECT')
        and has_schema_privilege(current_user,n.oid,'USAGE') from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname=split_part(x,'.',1) and c.relname=split_part(x,'.',2)),false)`,[need])).rows.map(r=>r.x);
    }
    // pg_dump dizilerin son değerini de okur: tam şemalardaki her dizi okunabilmeli (yoksa döküm ortasında durur).
    const seqUnreadable=(await c.query(`select c.oid::regclass::text q from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where c.relkind='S' and n.nspname = any($1::text[]) and not has_sequence_privilege(current_user,c.oid,'SELECT') order by 1`,[scope.full_schemas])).rows.map(r=>r.q);
    unreadable.push(...seqUnreadable);
    if(unreadable.length||notCallable.length||directUnreadable.length)return {status:'failed',stage:'permissions',reasons:[
      ...unreadable.map(t=>'okuma yetkisi yok: '+t),...notCallable.map(f=>'dışa aktarma fonksiyonu çağrılamıyor: '+f),
      ...directUnreadable.map(t=>'doğrudan okuma yetkisi yok: '+t)]};
    if(direct){
      // Fonksiyonlardaki "RLS etkinse dur" kuralının karşılığı: RLS bu rol için etkinse satırlar eksik okunur.
      const rls=(await c.query(`select x from unnest($1::text[]) x where row_security_active(x::regclass)`,
        [[...scoped.map(t=>t.name),...metaPresent.map(m=>m.name),...guardPresent,...tables]])).rows.map(r=>r.x);
      if(rls.length)return {status:'failed',stage:'rls',reasons:rls.map(t=>'RLS bu rol için etkin (satırlar eksik okunur): '+t)};
    }
    // Kesin sayımlar (içerik değil): kapsam dışı tablolar ve storage.objects. Liste fonksiyonda (bootstrap: kodda) sabittir.
    const gc=direct?await directGuardCounts(c,scope):(await c.query(`select ${scope.guard_counts_function.split('.').map(qi).join('.')}() g`)).rows[0].g;
    const guards=[];
    // Veritabanında olup sayılamayan liste tablosu (B7: sayım fonksiyonu bu tabloyu saymıyor): sessiz geçilmez.
    for(const t of guardPresent)if(!(guardKey(t) in gc))guards.push(`kapsam dışı tablo sayılamadı: ${t} (yedek rolünün sayım fonksiyonu bu tabloyu saymıyor)`);
    for(const q of [...scope.excluded.guard_stop_if_rows,...(scope.excluded.guard_stop_if_rows_pending||[])])if(gc[q])guards.push(`kapsam dışı ama veri içeren tablo: ${q} (${gc[q]} satır)`);
    for(const q of scope.guard_exact_zero)if(included.includes(q)&&gc[q])guards.push(`${q} boş olmalı: ${gc[q]} satır (dosya yedeği tasarlanmadı)`);
    // Büyük nesneler ne pg_dump -n ne de dışa aktarma kapsamındadır; ayrıca PUBLIC lo_create yan yolunun tek kalıcı izi
    // burada görünür (docs/backup/side-channels.md). Varsa yedek "eksik ama başarılı" görünmesin diye durur.
    const lo=Number((await c.query(`select count(*) n from pg_catalog.pg_largeobject_metadata`)).rows[0].n);
    if(lo)guards.push(`büyük nesne (large object) var: ${lo}; yedek kapsamında değil`);
    if(guards.length)return {status:'failed',stage:'guards',reasons:guards};
    const knownLoss={};
    for(const q of scope.excluded.known_loss)if(q in gc)knownLoss[q]=Number(gc[q]);
    // Sayılar (S1 görüntüsü): tam şemalar count(*), kapsam tabloları dışa aktarılan satır sayısı (aşağıda).
    const counts={};
    for(const t of tables)counts[t]=Number((await c.query(`select count(*) n from ${t.split('.').map(qi).join('.')}`)).rows[0].n);
    const migr=scoped.find(t=>t.name==='auth.schema_migrations');
    const authVersion=migr?(await c.query(direct?`select max(j->>'version') v from ${directFrom('auth.schema_migrations')}`
      :`select max(j->>'version') v from ${migr.export.split('.').map(qi).join('.')}() j`)).rows[0].v:null;
    const fingerprint=await catalogFingerprint((q,a)=>c.query(q,a),{fullSchemas:scope.full_schemas,includedTables:included,excludeRoles:[snap.role,'postgres']});
    const bootstrap=await restoreBootstrap(c,scope,included);
    fs.writeFileSync(path.join(outDir,'bootstrap.sql'),bootstrap.sql,{mode:0o600});
    let bFiles={},bSkipped=[];
    if(scoped.length){
      const ddl=await scopeDDL(c,{included,allowedTriggers:bootstrap.triggers,excludeAclRoles:[snap.role,'postgres']});
      fs.writeFileSync(path.join(outDir,'B.pre.sql'),ddl.pre,{mode:0o600});
      fs.writeFileSync(path.join(outDir,'B.post.sql'),ddl.post,{mode:0o600});
      bSkipped=ddl.skipped;
    }
    const external=await externalTriggers(c,scope,included);
    if(external.length){
      const xt=[...new Set(external.map(x=>x.table))];
      fs.writeFileSync(path.join(outDir,'X.pre.sql'),(await scopeDDL(c,{included:xt})).pre,{mode:0o600});
    }
    if(scoped.length){
      // to_jsonb çıktısını belirleyen ayarlar (geri yükleme içerik denetimiyle aynı). Parmak izinden SONRA: parmak izi
      // ifadeleri oturum ayarlarıyla biçimlenir ve geri yüklenen kopyada varsayılan ayarlarla hesaplanır.
      await c.query(EXPORT_SETTINGS);
      bFiles=await exportScope(c,{tables:scoped,outDir,mode:direct?'direct':'functions'});
      for(const [t,f] of Object.entries(bFiles))counts[t]=f.rows;
    }
    const metaFiles=await exportMeta(c,{meta:scope.meta||[],outDir,mode:direct?'direct':'functions'});
    if(delayBeforeDumpMs)await new Promise(r=>setTimeout(r,delayBeforeDumpMs));
    // S2: pg_dump (aynı görüntü)
    const env=dumpEnv(conn);
    const snapArgs=useSnapshot?['--snapshot='+snap.id]:[];
    const dumps={};
    const a=await run(binPath('pg_dump',pgBin),['-Fc','--no-password',...snapArgs,...scope.full_schemas.flatMap(s=>['-n',s]),'-f',path.join(outDir,'A.dump')],{env});
    dumps.A={code:a.code,stderr:a.err.slice(-2000)};
    if(a.code!==0)return {status:'failed',stage:'pg_dump',reasons:['tam şema dökümü başarısız: '+a.err.trim().split('\n').slice(-3).join(' | ')]};
    await c.query('rollback');s1Open=false;
    const source={
      version:1,snapshot_id:snap.id,txid_snapshot:snap.txid_snapshot,taken_at:snap.taken_at,
      server_version:snap.server_version,dump_role:snap.role,used_snapshot:useSnapshot,mode,
      read_only:{s1_transaction:snap.tro==='on',s1_default:snap.dtro==='on',s1_explicit_set:true,pg_dump_transaction:PG_DUMP_TRANSACTION},
      coverage:{schemas:scope.coverage_schemas||[],tables:cov.total,unclassified:0},guard_counts:gc,meta_files:metaFiles,external_triggers:external,
      full_schemas:scope.full_schemas,included_tables:included,excluded:scope.excluded,known_loss:knownLoss,
      counts,auth_version:authVersion,fingerprint_lines:fingerprint,fingerprint_sha256:sha256(fingerprint.join('\n')),
      restore:{roles:bootstrap.roles,triggers:bootstrap.triggers,extra_schemas:bootstrap.extraSchemas},
      b_files:bFiles,b_skipped:bSkipped,
      s1_open_ms:Date.now()-started
    };
    fs.writeFileSync(path.join(outDir,'source.json'),JSON.stringify(source,null,1),{mode:0o600});
    return {status:'ok',source};
  }catch(e){
    return {status:'failed',stage:'exception',reasons:[e.message]};
  }finally{
    if(s1Open)await c.query('rollback').catch(()=>{});
    await c.end().catch(()=>{});
    unregS1();
  }
}

module.exports={validateConn,snapshotDump,catalogFingerprint,ACL_SQL,run,binPath,toolMajor,pgEnv,dumpEnv,PG_DUMP_TRANSACTION,clientConfig,newClient,PG_CLIENT_VERSION,enforceReadOnly,isLocalHost};

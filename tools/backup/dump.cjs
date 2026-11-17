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
 * Bu araç production'a hiçbir şey yazmaz; yedek rolü yalnız okuyabilir. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {SNAPSHOT_SQL}=require('../db-lib.cjs');
const {sha256}=require('./crypto.cjs');
const {scopeDDL,exportScope}=require('./scope-export.cjs');

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
function clientConfig(conn){
  const c={host:conn.host,port:Number(conn.port||5432),user:conn.user,password:conn.password,database:conn.database||'postgres',application_name:'nakgo-backup'};
  if(conn.sslmode==='verify-full')c.ssl={rejectUnauthorized:true,ca:fs.readFileSync(conn.sslrootcert,'utf8'),servername:conn.host};
  return c;
}

function run(bin,args,{env,timeoutMs=20*60*1000}={}){
  return new Promise((resolve)=>{
    const p=spawn(bin,args,{env,stdio:['ignore','pipe','pipe']});
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
    where (n.nspname = any($1::text[]) or n.nspname||'.'||c.relname = any($2)) and c.relkind in ('r','p','v','m','f','S')
  union all
  select 'colacl '||n.nspname||'.'||c.relname||'.'||at.attname||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_attribute at join pg_class c on c.oid=at.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(at.attacl) a
    where (n.nspname = any($1::text[]) or n.nspname||'.'||c.relname = any($2)) and at.attnum>0 and not at.attisdropped
  union all
  select 'nspacl '||n.nspname||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname = any($1::text[])
  union all
  select 'proacl '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname = any($1::text[]) and a.grantee<>p.proowner
) x order by 1`;

/** Yedek doğrulamasında kullanılan rol bağımsız parmak izi (kaynak ve geri yüklenen kopya aynı fonksiyonla hesaplanır).
 * Sahiplik satırları ve dökülen rolün kendisine verilen yetkiler hariç tutulur: geri yükleme --no-owner ile yapılır. */
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
  return {sql:lines.join('\n')+'\n',roles,triggers,extraSchemas};
}

/**
 * Döküm alır. Dönüş: {status:'ok'|'failed', reasons[], source:{...}} ve outDir altında A.dump, B.pre.sql, B/*.jsonl,
 * B.post.sql, bootstrap.sql, source.json.
 * Testlere özel: delayBeforeDumpMs (S1 ile pg_dump arasında bekleme), useSnapshot=false (kasıtlı bozma).
 */
async function snapshotDump({conn,scope,outDir,pgBin,allowLocal=false,delayBeforeDumpMs=0,useSnapshot=true,Client=require('pg').Client}){
  const reasons=validateConn(conn,{allowLocal});
  if(reasons.length)return {status:'failed',stage:'connection',reasons};
  fs.mkdirSync(outDir,{recursive:true,mode:0o700});
  const started=Date.now();
  const c=new Client(clientConfig(conn));
  await c.connect();
  let s1Open=false;
  try{
    const serverMajor=Number((await c.query(`select current_setting('server_version_num')::int/10000 v`)).rows[0].v);
    for(const tool of ['pg_dump','pg_restore']){
      const m=await toolMajor(tool,pgBin);
      if(!m||m<serverMajor)return {status:'failed',stage:'tools',reasons:[`${tool} sürümü (${m}) sunucudan (${serverMajor}) eski olamaz`]};
    }
    await c.query('begin isolation level repeatable read read only');s1Open=true;
    const snap=(await c.query(`select pg_export_snapshot() id,pg_current_snapshot()::text txid_snapshot,to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') taken_at,
      current_setting('server_version') server_version,current_user role`)).rows[0];
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
    const fnNames=[...scoped.map(t=>t.export),scope.guard_counts_function];
    const notCallable=(await c.query(`select x from unnest($1::text[]) x where not coalesce((select has_function_privilege(current_user,p.oid,'EXECUTE')
      and has_schema_privilege(current_user,n.oid,'USAGE') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname=split_part(x,'.',1) and p.proname=split_part(x,'.',2) and p.pronargs=0),false)`,[fnNames])).rows.map(r=>r.x);
    if(unreadable.length||notCallable.length)return {status:'failed',stage:'permissions',reasons:[
      ...unreadable.map(t=>'yedek rolünün okuma yetkisi yok: '+t),...notCallable.map(f=>'dışa aktarma fonksiyonu çağrılamıyor: '+f)]};
    // Kesin sayımlar (içerik değil): kapsam dışı tablolar ve storage.objects. Liste fonksiyonda sabittir.
    const gc=(await c.query(`select ${scope.guard_counts_function.split('.').map(qi).join('.')}() g`)).rows[0].g;
    const guards=[];
    for(const q of scope.excluded.guard_stop_if_rows)if(gc[q])guards.push(`kapsam dışı ama veri içeren tablo: ${q} (${gc[q]} satır)`);
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
    const authVersion=migr?(await c.query(`select max(j->>'version') v from ${migr.export.split('.').map(qi).join('.')}() j`)).rows[0].v:null;
    const fingerprint=await catalogFingerprint((q,a)=>c.query(q,a),{fullSchemas:scope.full_schemas,includedTables:included,excludeRoles:[snap.role,'postgres']});
    const bootstrap=await restoreBootstrap(c,scope,included);
    fs.writeFileSync(path.join(outDir,'bootstrap.sql'),bootstrap.sql,{mode:0o600});
    let bFiles={},bSkipped=[];
    if(scoped.length){
      const ddl=await scopeDDL(c,{included,allowedTriggers:bootstrap.triggers,excludeAclRoles:[snap.role,'postgres']});
      fs.writeFileSync(path.join(outDir,'B.pre.sql'),ddl.pre,{mode:0o600});
      fs.writeFileSync(path.join(outDir,'B.post.sql'),ddl.post,{mode:0o600});
      bSkipped=ddl.skipped;
      bFiles=await exportScope(c,{tables:scoped,outDir});
      for(const [t,f] of Object.entries(bFiles))counts[t]=f.rows;
    }
    if(delayBeforeDumpMs)await new Promise(r=>setTimeout(r,delayBeforeDumpMs));
    // S2: pg_dump (aynı görüntü)
    const env=pgEnv(conn);
    const snapArgs=useSnapshot?['--snapshot='+snap.id]:[];
    const dumps={};
    const a=await run(binPath('pg_dump',pgBin),['-Fc','--no-password',...snapArgs,...scope.full_schemas.flatMap(s=>['-n',s]),'-f',path.join(outDir,'A.dump')],{env});
    dumps.A={code:a.code,stderr:a.err.slice(-2000)};
    if(a.code!==0)return {status:'failed',stage:'pg_dump',reasons:['tam şema dökümü başarısız: '+a.err.trim().split('\n').slice(-3).join(' | ')]};
    await c.query('rollback');s1Open=false;
    const source={
      version:1,snapshot_id:snap.id,txid_snapshot:snap.txid_snapshot,taken_at:snap.taken_at,
      server_version:snap.server_version,dump_role:snap.role,used_snapshot:useSnapshot,
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
  }
}

module.exports={validateConn,snapshotDump,catalogFingerprint,ACL_SQL,run,binPath,toolMajor,pgEnv,clientConfig,isLocalHost};

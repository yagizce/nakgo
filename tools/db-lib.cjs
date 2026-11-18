/** Ortak veritabanı test yardımcıları: boş bir PostgreSQL açar, Supabase'in auth/storage taklitlerini kurar,
 * depodaki migration'ları sırayla uygular ve şemanın karşılaştırılabilir özetini çıkarır.
 * Motor: varsayılan PGlite (NODE_PATH ile @electric-sql/pglite). NAKGO_PG_HOST verilirse (soket klasörü veya localhost)
 * gerçek PostgreSQL: o sunucuda her çalışma için geçici bir veritabanı açılır ve sonunda silinir.
 * Yalnız yerel adreslere bağlanır; uzak bir host verilirse çalışmayı reddeder. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Supabase'in hazır getirdiği nesnelerin yerel taklitleri. Varsayılan yetkiler production'daki postgres rolüyle aynıdır
// (pg_default_acl'den okundu; şema özetindeki "defacl" satırları bunu production'la karşılaştırır).
const STUB=`
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text unique,phone text unique,banned_until timestamptz,raw_user_meta_data jsonb not null default '{}');
create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,provider text);
create table auth.refresh_tokens(id bigserial primary key,user_id varchar(255),token text);
create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid,created_at timestamptz default now(),ip inet);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
grant usage on schema public to anon,authenticated;
-- Production (postgres rolü, public şeması) varsayılan yetkileriyle aynı: pg_default_acl'den okundu.
alter default privileges in schema public grant truncate,references,trigger on tables to anon,authenticated;
`;

function migrations(){
  const dir=path.join(root,'supabase/migrations');
  return fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort().map(f=>({name:f,sql:fs.readFileSync(path.join(dir,f),'utf8')}));
}

// Testler production gibi UTC'de koşar; makinenin ya da sunucunun saat dilimine güvenilmez.
async function requireUtc(query){
  const tz=Object.values((await query('show timezone')).rows[0])[0];
  if(tz!=='UTC')throw Error('Test oturumu UTC değil: '+tz);
}

async function openDb(){
  const host=process.env.NAKGO_PG_HOST;
  if(host){
    if(!(host.startsWith('/')||['localhost','127.0.0.1','::1'].includes(host)))throw Error('NAKGO_PG_HOST yalnız yerel olabilir (soket klasörü veya localhost): '+host);
    const {Client}=require('pg');
    const base={host,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD};
    const name='nakgo_check_'+process.pid+'_'+Date.now();
    const admin=new Client({...base,database:'postgres'});await admin.connect();
    let c=null,closed=false;
    // Her koşulda: önce test bağlantısı, sonra geçici veritabanı, en son yönetim bağlantısı. Bir adımın hatası
    // sonrakileri engellemez; hatalar toplanıp birlikte bildirilir.
    const close=async()=>{
      if(closed)return;closed=true;const errors=[];
      if(c)try{await c.end();}catch(e){errors.push(e);}
      try{await admin.query('drop database if exists '+name+' with (force)');}catch(e){errors.push(e);}
      try{await admin.end();}catch(e){errors.push(e);}
      if(errors.length)throw new AggregateError(errors,'Geçici veritabanı temizliği başarısız ('+name+'): '+errors.map(e=>e.message).join('; '));
    };
    try{
      await admin.query('create database '+name);
      await admin.query('alter database '+name+" set timezone to 'UTC'");
      c=new Client({...base,database:name,options:'-c TimeZone=UTC'});await c.connect();
      await requireUtc((s,a)=>c.query(s,a));
      return {engine:'postgresql '+(await c.query('show server_version')).rows[0].server_version,name,
        query:(s,a=[])=>c.query(s,a),exec:s=>c.query(s),close};
    }catch(e){await close().catch(()=>{});throw e;}
  }
  const {PGlite}=require('@electric-sql/pglite');
  const db=new PGlite();
  try{await db.exec("set timezone to 'UTC'");await requireUtc((s,a)=>db.query(s,a));}catch(e){await db.close().catch(()=>{});throw e;}
  return {engine:'pglite',query:(s,a=[])=>db.query(s,a),exec:s=>db.exec(s),close:()=>db.close()};
}

/** Veritabanını kapatır. Asıl bir hata varsa temizlik hatası onu gizlemez: stderr'e yazılır ve çıkış kodu 1 olur;
 * asıl hata yoksa temizlik hatası fırlatılır. */
async function finish(db,primary){
  try{await db.close();}
  catch(e){if(!primary)throw e;console.error('Temizlik hatası (asıl hata ayrıca bildirildi): '+e.message);process.exitCode=1;}
}

/** Test rolleri doğru yetkide mi? Yerel sunucuda önceden kalmış bir rol yanlış yetkideyse testler sessizce
 * yanlış koşmasın diye açık hata verir; rollere dokunmaz. */
async function assertTestRoles(db,{serviceRole=false}={}){
  const want=[['anon',false],['authenticated',false],...(serviceRole?[['service_role',true]]:[])];
  const rows=(await db.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname = any($1)",[want.map(w=>w[0])])).rows;
  for(const [role,bypass] of want){
    const r=rows.find(x=>x.rolname===role);
    if(!r)throw Error('Test rolü yok: '+role);
    if(r.rolsuper)throw Error('Test rolü '+role+' süper kullanıcı olmamalı; testler RLS ve yetkileri ölçemez. Yerel test sunucusunda rolü düzeltin.');
    if(r.rolbypassrls!==bypass)throw Error('Test rolü '+role+' için BYPASSRLS '+(bypass?'gerekli ama yok':'olmamalı ama var')+'. Testler yanlış yetkiyle koşmasın diye durduruldu; yerel test sunucusunda rolü düzeltin.');
  }
}

async function build(db,{list=migrations()}={}){
  await db.exec(STUB);
  await assertTestRoles(db);
  for(const m of list){
    try{await db.exec(m.sql);}catch(e){throw Error(m.name+': '+e.message,{cause:e});}
  }
}

// Şema özeti: her satır bir nesne. Fonksiyon gövdesi yorum, satır sonu ve boşluk ayıklanarak özetlenir;
// böylece aynı kod farklı biçimde yazılmışsa fark sayılmaz. Yalnız salt okunur katalog sorgusudur:
// aynı sorgu production'da da (salt okunur) çalıştırılıp karşılaştırılabilir.
const SNAPSHOT_SQL=`
with ns as (select oid,nspname from pg_namespace where nspname in('public','private')),
fn as (
 select n.nspname,p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args,coalesce(pg_get_function_result(p.oid),'procedure') result,
  p.prosecdef,p.provolatile,coalesce(array_to_string(p.proconfig,';'),'') cfg,
  md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid),'--[^\\n]*|\\r','','g'),'\\s+','','g')) body
 from pg_proc p join ns n on n.oid=p.pronamespace where p.prokind in('f','p'))
select regexp_replace(line,'\\s+',' ','g') line from (
 select 'table '||n.nspname||'.'||c.relname||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity line
  from pg_class c join ns n on n.oid=c.relnamespace where c.relkind='r'
 union all select 'column '||n.nspname||'.'||c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' not null' else '' end||coalesce(' default '||pg_get_expr(d.adbin,d.adrelid),'')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join ns n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where c.relkind in('r','v') and a.attnum>0 and not a.attisdropped
 union all select 'constraint '||n.nspname||'.'||c.relname||'.'||k.conname||' '||pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join ns n on n.oid=c.relnamespace
 union all select 'index '||schemaname||'.'||indexname||' '||indexdef from pg_indexes where schemaname in('public','private')
 union all select 'view '||n.nspname||'.'||c.relname from pg_class c join ns n on n.oid=c.relnamespace where c.relkind='v'
 union all select 'policy '||schemaname||'.'||tablename||'.'||policyname||' '||permissive||' '||cmd||' to '||array_to_string(roles,',')||' using '||coalesce(qual,'-')||' check '||coalesce(with_check,'-')
  from pg_policies where schemaname in('public','private','storage')
 union all select 'trigger '||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in('public','private','storage','auth') and pg_get_triggerdef(t.oid) ~ '(public|private)\\.'
 union all select 'function '||nspname||'.'||proname||'('||args||') returns '||result||case when prosecdef then ' definer' else ' invoker' end||' vol='||provolatile::text||' cfg='||cfg||' body='||body from fn
 union all select 'execute '||nspname||'.'||proname||'('||args||') '||r.rolname from fn cross join (values('anon'),('authenticated')) r(rolname)
  where has_function_privilege(r.rolname,fn.oid,'execute')
 union all select 'grant '||table_schema||'.'||table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants
  where table_schema in('public','private') and grantee in('anon','authenticated','PUBLIC')
 union all select 'colgrant '||table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type from information_schema.column_privileges
  where table_schema in('public','private') and grantee in('anon','authenticated','PUBLIC')
   and not exists(select 1 from information_schema.role_table_grants g where g.table_schema=column_privileges.table_schema and g.table_name=column_privileges.table_name and g.grantee=column_privileges.grantee and g.privilege_type=column_privileges.privilege_type)
 union all select distinct 'defacl public '||t.k||' '||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||' '||a.privilege_type
  from (values('r','r'),('S','s'),('f','f')) t(k,ak)
  cross join lateral (select coalesce((select d.defaclacl from pg_default_acl d where d.defaclnamespace=0 and d.defaclrole='postgres'::regrole
     and d.defaclobjtype=t.k::"char"),acldefault(t.ak::"char",'postgres'::regrole)) acl
   union all select d.defaclacl from pg_default_acl d where d.defaclnamespace='public'::regnamespace and d.defaclrole='postgres'::regrole
     and d.defaclobjtype=t.k::"char") x
  cross join lateral aclexplode(x.acl) a
  where (a.grantee=0 or pg_get_userbyid(a.grantee) in('anon','authenticated')) and a.privilege_type<>'MAINTAIN'
 union all select 'schema-usage '||n.nspname||' '||r.rolname from pg_namespace n cross join (values('anon'),('authenticated')) r(rolname)
  where n.nspname in('public','private') and has_schema_privilege(r.rolname,n.oid,'usage')
) s order by 1`;

// Sürümlü API (api şeması, B3). Ayrı tutulur: yedeğin şema parmak izi (tools/backup/dump.cjs) yalnız SNAPSHOT_SQL'i
// kullanır ve yedek kapsamı public/private'tır; kayma kontrolü ikisini birlikte denetler.
const API_SNAPSHOT_SQL=`
select line from (
 select 'schema-usage api '||r.rolname line from pg_namespace n cross join (values('anon'),('authenticated')) r(rolname)
  where n.nspname='api' and has_schema_privilege(r.rolname,n.oid,'usage')
 union all select 'function api.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') returns '||coalesce(pg_get_function_result(p.oid),'procedure')
  ||case when p.prosecdef then ' definer' else ' invoker' end||' vol='||p.provolatile::text||' cfg='||coalesce(array_to_string(p.proconfig,';'),'')
  ||' body='||md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid),'--[^\\n]*|\\r','','g'),'\\s+','','g'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api'
 union all select 'execute api.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||r.rolname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values('anon'),('authenticated')) r(rolname)
  where n.nspname='api' and has_function_privilege(r.rolname,p.oid,'execute')
 union all select 'apiview private.'||c.relname||' body='||md5(regexp_replace(pg_get_viewdef(c.oid),'\\s+','','g'))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='v' and c.relname like 'api\\_%'
) a`;
const FULL_SNAPSHOT_SQL='select line from ('+SNAPSHOT_SQL+') s union all '+API_SNAPSHOT_SQL+' order by 1';

async function snapshot(db){return (await db.query(FULL_SNAPSHOT_SQL)).rows.map(r=>r.line);}

function diff(expected,actual){
  const e=new Set(expected),a=new Set(actual);
  return {missing:expected.filter(x=>!a.has(x)),extra:actual.filter(x=>!e.has(x))};
}

module.exports={root,STUB,migrations,openDb,finish,assertTestRoles,build,SNAPSHOT_SQL,API_SNAPSHOT_SQL,FULL_SNAPSHOT_SQL,snapshot,diff};

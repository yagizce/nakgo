/** Production biçiminde kaynak veritabanı (b8 ve b9 testleri): ilk 32 migration (Production'daki), Supabase taklidi,
 * sentetik veri. Yalnız yerel test sunucusunda; gerçek bir sisteme bağlanmaz. */
'use strict';
const assert=require('node:assert/strict');
const {openDb,build,migrations,finish}=require('../../tools/db-lib.cjs');
const {seed}=require('./fixtures.cjs');
const PROD_APPLIED='20261115184145';
/** Supabase taklidi (Production'da gözlenen tablolar; içerik yok). */
const SUPABASE_EMULATION=`
alter table auth.users add column if not exists confirmation_token text, add column if not exists recovery_token text,
  add column if not exists email_change_token_new text, add column if not exists reauthentication_token text, add column if not exists encrypted_password text;
create table auth.instances(id uuid primary key,uuid uuid,raw_base_config text,created_at timestamptz,updated_at timestamptz);
create table auth.audit_log_entries(instance_id uuid,id uuid primary key,payload json,created_at timestamptz,ip_address varchar(64) not null default '');
create table auth.one_time_tokens(id uuid primary key default gen_random_uuid(),user_id uuid not null,token_type text,token_hash text not null,relates_to text);
create table auth.flow_state(id uuid primary key default gen_random_uuid(),auth_code text);
create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text not null);
create table storage.migrations(id integer primary key,name varchar(100) unique not null,hash varchar(40) not null,executed_at timestamp default current_timestamp);
create schema cron;
create table cron.job(jobid bigserial primary key,schedule text not null,command text not null,nodename text not null default 'localhost',nodeport int not null default 5432,
  database text not null default current_database(),username text not null default current_user,active boolean not null default true,jobname text);
alter table cron.job enable row level security;create policy cron_job_policy on cron.job using (username=current_user);
create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if; end $$;
grant usage,create on schema auth to supabase_auth_admin;
do $$ declare t text; begin
 for t in select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='r' loop
  execute format('alter table %s owner to supabase_auth_admin',t); execute format('alter table %s enable row level security',t);
 end loop;
end $$;`;

/** pg_cron'un kurtarma SQL'inin kullandığı API'si (pg_cron 1.5+ davranışı: cron.schedule aynı adla çağrılınca işi günceller;
 * cron.alter_job yalnız verilen alanları değiştirir). Yerel PostgreSQL'de pg_cron yok; hedef Supabase'te gerçeği vardır (G20). */
const PG_CRON_API=`create schema cron;
create table cron.job(jobid bigserial primary key,schedule text not null,command text not null,nodename text not null default 'localhost',nodeport int not null default 5432,
  database text not null default current_database(),username text not null default current_user,active boolean not null default true,jobname text unique);
create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $f$
  insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
  on conflict (jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $f$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
  returns void language sql as $f$ update cron.job j set schedule=coalesce(alter_job.schedule,j.schedule),command=coalesce(alter_job.command,j.command),
  database=coalesce(alter_job.database,j.database),username=coalesce(alter_job.username,j.username),active=coalesce(alter_job.active,j.active) where j.jobid=job_id $f$;`;

const PROD_JOBS=[['nakgo-retention','0 0 * * *','select private.retention_run()'],
  ['nakgo-daily-stats','30 21 * * *',"select private.record_daily_stats(((now() at time zone 'Europe/Istanbul')::date-1))"]];

/** Bootstrap rolü: Supabase postgres'i gibi (süper kullanıcı değil, BYPASSRLS, Auth/Storage/Vault/cron/geçmiş okuyabilir). */
const bootRoleSql=(role,password)=>`create role ${role} login password '${password}' nosuperuser bypassrls noinherit;
grant usage on schema public,private,auth,storage,vault,cron,supabase_migrations to ${role};
grant select on all tables in schema public,private,auth,storage,vault,cron,supabase_migrations to ${role};
grant select on all sequences in schema public,private to ${role};`;

/** Production biçiminde kaynak: ilk 32 migration + taklit + sentetik veri.
 * rich=false: Production'da ölçülenlere sadık (askıda hesap 0, saklama 0).
 * rich=true: ek olarak askıda bir hesap ve saklamada bir ilan (bekleyen migration'ların veri dönüşümleri için). */
async function prodShaped({rich=true}={}){
  const db=await openDb();
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    const list=migrations().filter(m=>m.name.slice(0,14)<=PROD_APPLIED);
    assert.equal(list.length,32,'Production 32 migration');
    await build(db,{list});
    await db.exec(SUPABASE_EMULATION);
    const ids=await seed(db,{users:7,listingsPerUser:2});
    const admin=ids[0],suspended=ids[5];
    await db.query(`insert into private.admin_members(user_id,active) values($1,true)`,[admin]);
    await db.query(`update auth.users set confirmation_token='TOK-CONF-'||id,recovery_token='TOK-RECOV-'||id,encrypted_password='$2a$10$hashonly'`);
    await db.query(`insert into auth.refresh_tokens(user_id,token) select id::text,'TOK-REFRESH-'||id from auth.users`);
    await db.query(`insert into auth.one_time_tokens(user_id,token_type,token_hash) values($1,'confirmation_token','TOK-OTT-HASH')`,[ids[1]]);
    await db.query(`insert into auth.flow_state(auth_code) values('TOK-FLOW')`);
    assert.equal(Number((await db.query(`select count(*) n from storage.buckets`)).rows[0].n),1,'migration kovayı kurdu (Production: 1)');
    await db.query(`insert into storage.migrations(id,name,hash) select g,'m'||g,md5(g::text) from generate_series(0,79) g`);
    for(const [n,s,c] of PROD_JOBS)await db.query(`insert into cron.job(jobname,schedule,command) values($1,$2,$3)`,[n,s,c]);
    for(const m of list)await db.query(`insert into supabase_migrations.schema_migrations(version,name) values($1,$2)`,[m.name.slice(0,14),m.name.slice(15,-4)]);
    // Gerçek yoldan: bir hesap askıda, bir ilan saklamada (32 migration'lık şemadaki panel işlemi).
    const held=(await db.query(`select id from public.listings where owner_id=$1 order by id limit 1`,[ids[2]])).rows[0].id;
    if(!rich)return {db,ids,admin,suspended:null,held:null,list};
    await db.exec('begin');
    try{
      await db.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims','{"aal":"aal2"}',true)`,[admin]);
      await db.exec('set local role authenticated');
      await db.query(`select public.nakgo_admin_moderate('user',$1,'suspend','Deneme askı',0)`,[suspended]);
      await db.query(`select public.nakgo_admin_moderate('listing',$1,'hold','Deneme saklama',0)`,[String(held)]);
      await db.exec('commit');
    }catch(e){await db.exec('rollback');throw e;}
    return {db,ids,admin,suspended,held,list};
  }catch(e){await finish(db,e);throw e;}
}

module.exports={PROD_APPLIED,SUPABASE_EMULATION,PG_CRON_API,PROD_JOBS,bootRoleSql,prodShaped};

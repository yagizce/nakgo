/** Production biçiminde kaynak veritabanı (b8 ve b9 testleri): ilk 32 migration (Production'daki), Supabase taklidi,
 * sentetik veri. Yalnız yerel test sunucusunda; gerçek bir sisteme bağlanmaz. */
'use strict';
const assert=require('node:assert/strict');
const {openDb,build,migrations,finish}=require('../../tools/db-lib.cjs');
const {seed}=require('./fixtures.cjs');
const PROD_APPLIED='20261115184145';
/** Production supabase_migrations.schema_migrations (version, name): 23.11.2026'da salt okunur ölçüldü (yalnız bu iki
 * sütun; SQL metni alınmadı). 17 satır yalın ad, 15 satır "<14 hane>_<ad>.sql"; bunların 8'inde addaki zaman damgası
 * sürümden farklı (apply_migration sürümü kendi yazdı, ad özgün dosya adını taşıyor). Canlı bağlantı yok; sabit veri. */
const PROD_MIGRATION_NAMES=Object.freeze([
  ['20261014000000','profiles'],['20261024000000','profile_details'],['20261024010000','listings'],
  ['20261024020000','listing_photo'],['20261024030000','listing_time'],['20261024040000','transport_jobs'],
  ['20261025080000','listing_favorites'],['20261025210000','private_messages'],['20261025220000','message_sender_index'],
  ['20261025230000','private_carrier_documents'],['20261026010000','admin_panel'],['20261026020000','admin_moderation'],
  ['20261026030000','single_admin_access'],['20261027010000','storage_service_activity'],['20261028010000','load_timing_text'],
  ['20261110010000','public_listings'],['20261111020000','route_alerts'],
  ['20261111040000','20261111040000_listing_districts_expiry.sql'],['20261111050000','20261111050000_listing_contact.sql'],
  ['20261112020000','20261112020000_data_retention.sql'],['20261112030000','20261112030000_admin_dashboard.sql'],
  ['20261112040000','20261112040000_admin_panel_tools.sql'],['20261112050000','20261112050000_accounts_admins.sql'],
  ['20261112060000','20261112060000_recent_archive.sql'],
  ['20261115075953','20261115010000_admin_live.sql'],['20261115181517','20261115180000_redaction_free_text.sql'],
  ['20261115181526','20261115190000_listing_quota.sql'],['20261115181530','20261115200000_trusted_request_ip.sql'],
  ['20261115181551','20261115210000_document_storage_cleanup.sql'],['20261115181600','20261115220000_listing_contact_date.sql'],
  ['20261115182624','20261115190000_unban_hold.sql'],['20261115184145','20261115230000_close_legacy_features.sql']].map(Object.freeze));
/** Production'daki Auth/Storage/Vault tablo envanteri ve RLS durumu (24.11.2026, salt okunur katalog sorgusu;
 * yalnız tablo adı ve relrowsecurity alındı, sütunlar ve satırlar alınmadı). Taklit bu kümeyi kurar; kapsam envanteri
 * (ops/backup/scope.json coverage_inventory) testte buna eşitlenir. Supabase tablo ekler ya da kaldırırsa bu liste ve
 * kapsam envanteri birlikte, incelemeli PR ile güncellenir. */
const PROD_AUX_TABLES=Object.freeze([
  ['auth.audit_log_entries',true],['auth.custom_oauth_providers',false],['auth.flow_state',true],['auth.identities',true],
  ['auth.instances',true],['auth.mfa_amr_claims',true],['auth.mfa_challenges',true],['auth.mfa_factors',true],
  ['auth.mfa_recovery_code_sets',false],['auth.mfa_recovery_codes',false],['auth.oauth_authorizations',false],['auth.oauth_client_states',false],
  ['auth.oauth_clients',false],['auth.oauth_consents',false],['auth.one_time_tokens',true],['auth.refresh_tokens',true],
  ['auth.saml_providers',true],['auth.saml_relay_states',true],['auth.schema_migrations',true],['auth.scim_tokens',false],
  ['auth.scim_users',false],['auth.sessions',true],['auth.sso_domains',true],['auth.sso_providers',true],
  ['auth.users',true],['auth.webauthn_challenges',false],['auth.webauthn_credentials',false],['storage.bucket_lifecycle_states',true],
  ['storage.buckets',true],['storage.buckets_analytics',true],['storage.buckets_vectors',true],['storage.lifecycle_abandoned_artifacts',true],
  ['storage.migrations',true],['storage.objects',true],['storage.s3_multipart_uploads',true],['storage.s3_multipart_uploads_parts',true],
  ['storage.vector_indexes',true],['vault.secrets',false]].map(Object.freeze));
/** Kova yaşam döngüsü tabloları: sütunlar Supabase Storage kaynağındaki tanımdan (supabase/storage
 * migrations/tenant/0076-noncurrent-lifecycle.sql ve 0079-lifecycle-writer-coordination.sql; CHECK kısıtları ve
 * dizinler alınmadı). Production'dan sütun okunmadı. */
const LIFECYCLE_DDL=Object.freeze({
  'storage.bucket_lifecycle_states':`create table storage.bucket_lifecycle_states(bucket_id text primary key references storage.buckets(id) on delete cascade,
    generation uuid,next_run_at timestamptz,claim_id uuid,claim_until timestamptz,continuation jsonb,last_started_at timestamptz,
    last_completed_at timestamptz,last_success_at timestamptz,last_result jsonb,failure_count integer not null default 0,last_error jsonb,
    updated_at timestamptz not null default now())`,
  'storage.lifecycle_abandoned_artifacts':`create table storage.lifecycle_abandoned_artifacts(bucket_id text not null,key text not null,name text not null,
    version text,attempted_at timestamptz not null default now(),primary key(bucket_id,key))`});
/** Taklitte eksik kalan envanter tablolarını kurar (yalnız var olmayanlar; sütun içeriği taklit edilmez: kapsam dışı
 * tablolar yalnız var olup olmadıkları ve satır sayılarıyla denetlenir; yaşam döngüsü tabloları LIFECYCLE_DDL ile).
 * Auth tabloları supabase_auth_admin'e ait. */
async function ensureProdInventory(db){
  for(const [t,rls] of PROD_AUX_TABLES){
    const [ns,rel]=t.split('.');
    const exists=(await db.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2`,[ns,rel])).rows.length;
    if(exists)continue;
    await db.exec(LIFECYCLE_DDL[t]||`create table ${ns}.${rel}(id bigint)`);
    if(ns==='auth')await db.exec(`alter table ${ns}.${rel} owner to supabase_auth_admin`);
    if(rls)await db.exec(`alter table ${ns}.${rel} enable row level security`);
  }
}

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
    await ensureProdInventory(db);
    const admin=ids[0],suspended=ids[5];
    await db.query(`insert into private.admin_members(user_id,active) values($1,true)`,[admin]);
    await db.query(`update auth.users set confirmation_token='TOK-CONF-'||id,recovery_token='TOK-RECOV-'||id,encrypted_password='$2a$10$hashonly'`);
    await db.query(`insert into auth.refresh_tokens(user_id,token) select id::text,'TOK-REFRESH-'||id from auth.users`);
    await db.query(`insert into auth.one_time_tokens(user_id,token_type,token_hash) values($1,'confirmation_token','TOK-OTT-HASH')`,[ids[1]]);
    await db.query(`insert into auth.flow_state(auth_code) values('TOK-FLOW')`);
    assert.equal(Number((await db.query(`select count(*) n from storage.buckets`)).rows[0].n),1,'migration kovayı kurdu (Production: 1)');
    await db.query(`insert into storage.migrations(id,name,hash) select g,'m'||g,md5(g::text) from generate_series(0,79) g`);
    for(const [n,s,c] of PROD_JOBS)await db.query(`insert into cron.job(jobname,schedule,command) values($1,$2,$3)`,[n,s,c]);
    // Production'daki gerçek ad biçimleri (17 yalın, 15 dosya adı biçiminde, 8'i farklı zaman damgalı).
    assert.deepEqual(list.map(m=>m.name.slice(0,14)),PROD_MIGRATION_NAMES.map(([v])=>v),'Production sürümleri repo dosyalarıyla aynı');
    for(const [v,n] of PROD_MIGRATION_NAMES)await db.query(`insert into supabase_migrations.schema_migrations(version,name) values($1,$2)`,[v,n]);
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

module.exports={PROD_APPLIED,PROD_MIGRATION_NAMES,PROD_AUX_TABLES,LIFECYCLE_DDL,ensureProdInventory,SUPABASE_EMULATION,PG_CRON_API,PROD_JOBS,bootRoleSql,prodShaped};

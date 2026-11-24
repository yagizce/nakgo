/** Referans derlemesi: Production'a UYGULANMIŞ migration'ların GERÇEK sonucu (O5, R4, R6).
 *
 * Neden: zamanlanmış işler ve Auth/Storage tablolarındaki tetikleyicilerimiz migration dosyalarında koşullu bloklar
 * (pg_cron varsa) ve dinamik SQL içinde kurulur; dosya metnini taramak (regex) yanlış sonuç verebilir. Burada uygulanmış
 * migration'lar ağsız, atılabilir bir kümede (pg-cluster.cjs) gerçekten çalıştırılır ve sonuç katalogdan okunur:
 *   cron      cron.job (ad, zaman, komut) — pg_cron TAKLİDİ eklentiyle (aşağıda; gerçek pg_cron arka plan işçisi yok)
 *   triggers  kapsam dışı şemalardaki (auth, storage, vault) ve yedeğe tekil tablo olarak GİRMEYEN tablolarda bizim fonksiyonlarımızı çağıran tetikleyiciler
 *   snapshot  public/private şema özeti (db-lib SNAPSHOT_SQL; geri yüklenen kopyayla karşılaştırılır: R4)
 * Yedekteki tanımlar (source.external_triggers, meta/cron.job) burada GÜVEN KAYNAĞI DEĞİLDİR; yalnız bununla karşılaştırılır.
 * Girdi yalnız repodaki migration dosyalarıdır; hiçbir yedek SQL'i bu kümede çalıştırılmaz. */
'use strict';
const PC=require('./pg-cluster.cjs');
const {STUB,SNAPSHOT_SQL}=require('../db-lib.cjs');
const SJ=require('./strict-json.cjs');

/** pg_cron'un migration'ların kullandığı API'si: cron.schedule (aynı adla çağrı günceller), unschedule, alter_job,
 * cron.job ve cron.job_run_details tabloları. Sürüm adı gerçek pg_cron'la aynı (1.6) ki "pg_available_extensions"
 * denetimi geçsin. Yalnız referans kümesine kurulur. */
const PG_CRON_EMULATION={version:'1.6',
  control:"comment = 'NakGo pg_cron taklidi (yalnız referans derlemesi)'\ndefault_version = '1.6'\nrelocatable = false\nschema = pg_catalog\nsuperuser = true\n",
  sql:`create schema cron;
create table cron.job(jobid bigserial primary key,schedule text not null,command text not null,nodename text not null default 'localhost',nodeport int not null default 5432,
  database text not null default current_database(),username text not null default current_user,active boolean not null default true,jobname text unique);
create table cron.job_run_details(jobid bigint,runid bigserial primary key,job_pid int,database text,username text,command text,status text,return_message text,
  start_time timestamptz,end_time timestamptz);
create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $f$
  insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
  on conflict (jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $f$;
create function cron.schedule(schedule text,command text) returns bigint language sql as $f$
  insert into cron.job(schedule,command) values(schedule,command) returning jobid $f$;
create function cron.unschedule(job_name text) returns boolean language sql as $f$
  with d as (delete from cron.job where jobname=job_name returning 1) select count(*)>0 from d $f$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $f$
  with d as (delete from cron.job where jobid=job_id returning 1) select count(*)>0 from d $f$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
  returns void language sql as $f$ update cron.job j set schedule=coalesce(alter_job.schedule,j.schedule),command=coalesce(alter_job.command,j.command),
  database=coalesce(alter_job.database,j.database),username=coalesce(alter_job.username,j.username),active=coalesce(alter_job.active,j.active) where j.jobid=job_id $f$;
`};

const EXTERNAL_TRIGGERS_SQL=`select n.nspname||'.'||cl.relname tbl,t.tgname,pg_get_triggerdef(t.oid) def from pg_trigger t
  join pg_class cl on cl.oid=t.tgrelid join pg_namespace n on n.oid=cl.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
  where not t.tgisinternal and n.nspname = any($1::text[]) and pn.nspname = any($2::text[])
  and n.nspname||'.'||cl.relname <> all($3::text[]) order by 1,2`;

/** list: uygulanmış migration'lar [{file, sql}] (dosya sırasıyla). Dönüş: {cron, triggers, snapshot, migrations, sha256}. */
async function buildReference({installDir,list,scope,workRoot,runAs}){
  if(!Array.isArray(list)||!list.length)throw Object.assign(Error('referans için uygulanmış migration listesi gerekli'),{code:'reference_input'});
  const cl=await PC.startCluster({installDir,workRoot,runAs,extensions:{pg_cron:PG_CRON_EMULATION}});
  let admin=null,db=null;
  try{
    admin=await PC.adminClient(cl);
    await admin.query('create database nakgo_reference');
    // Migration'lar Production'da "postgres" rolüyle uygulanır; nesne sahipliği ve varsayılan yetkiler (defacl) aynı olsun
    // diye referans kümesinde de o adla (yalnız bu atılabilir kümede süper kullanıcı, girişsiz) çalıştırılır.
    await admin.query(`create role postgres nologin superuser; create role service_role nologin bypassrls`);
    db=await PC.adminClient(cl,'nakgo_reference');
    await db.query("set timezone to 'UTC'; set role postgres");
    await db.query(STUB);
    for(const m of list){
      try{await db.query(m.sql);}
      catch(e){throw Object.assign(Error('referans derlemesi: migration uygulanamadı: '+m.file),{code:'reference_migration'});}
    }
    const cron=(await db.query(`select jobname,schedule,command from cron.job order by jobname,jobid`).catch(()=>({rows:[]}))).rows
      .map(r=>({jobname:r.jobname,schedule:r.schedule,command:r.command}));
    const triggers=(await db.query(EXTERNAL_TRIGGERS_SQL,[scope.coverage_schemas||[],scope.full_schemas,(scope.tables||[]).map(t=>t.name)])).rows.map(r=>({table:r.tbl,name:r.tgname,def:r.def}));
    const snapshot=(await db.query('select line from ('+SNAPSHOT_SQL+') s order by 1')).rows.map(r=>r.line);
    const result={migrations:list.map(m=>m.file),cron,triggers,snapshot};
    return {...result,sha256:SJ.domainHash('nakgo-reference-build/v1',result)};
  }finally{
    for(const c of [db,admin])if(c)await c.end().catch(()=>{});
    await cl.stop();
  }
}

module.exports={buildReference,PG_CRON_EMULATION,EXTERNAL_TRIGGERS_SQL};

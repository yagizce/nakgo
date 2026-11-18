/** Yönetim paneli "health" bölümü (nakgo_admin_page): yalnız yönetici; değerler gerçek tablolardan; pg_cron yoksa null,
 * varsa yalnız nakgo-* görevleri ve son çalışma sonucu (hata metni yok); kişisel veri döndürmez. Sentetik veri. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {migratedDb,finish}=require('../backup/helpers.cjs');
const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
async function as(db,user,role,sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const health=async(db,user,role='authenticated')=>{const r=await as(db,user,role,`select public.nakgo_admin_page('health') r`);return r.error?r:r.rows[0].r;};

test('Yönetim paneli sağlık bölümü',async t=>{
  const db=await migratedDb();
  try{
    const ADMIN=uid(1),USER=uid(2);
    for(const id of [ADMIN,USER])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[ADMIN]);
    await db.exec('reset session_replication_role');

    await t.test('yalnız yönetici; misafir ve üye reddedilir',async()=>{
      assert.equal((await health(db,USER)).error.key,'Admin required');
      assert.equal((await health(db,null,'anon')).error.code,'42501');
      const h=await health(db,ADMIN);
      assert.deepEqual(Object.keys(h).sort(),['api','db_size','held','jobs','reports','retention','security','server_time']);
      assert.equal(h.jobs,null,'pg_cron yok: null (sahte durum üretilmez)');
      assert.equal(h.retention,null,'gece temizliği hiç çalışmadı: null');
      assert.ok(Number(h.db_size)>0);
    });

    await t.test('değerler gerçek tablolardan; kişisel veri yok',async()=>{
      await db.exec('set session_replication_role=replica');
      await db.query(`insert into private.api_usage(hour,version,fn,shard,calls) values(date_trunc('hour',now()),'v1','listings_v1',0,7),(date_trunc('hour',now()),'v1','status_v1',1,2),(now()-interval '3 days','v1','listings_v1',0,50)`);
      await db.query(`insert into private.retention_runs(ran_at,counts) values(now()-interval '30 hours','{"listings_redacted":3,"listings_deleted":1}')`);
      await db.query(`insert into private.security_events(user_id,kind,hour,at) values($1,'contact_limit_hour',date_trunc('hour',now()),now()),($1,'contact_limit_day',date_trunc('hour',now()-interval '3 days'),now()-interval '3 days')`,[USER]);
      await db.query(`insert into private.listing_reports(reporter_id,subject,listing_id,reason,status) values($1,'listing',5,'fake','open'),($1,'listing',6,'fake','reviewing'),($1,'listing',7,'fake','resolved')`,[USER]);
      await db.exec('reset session_replication_role');
      const h=await health(db,ADMIN);
      assert.equal(Number(h.api.calls_24h),9);
      assert.deepEqual(h.api.top.map(x=>[x.fn,Number(x.calls)]),[['listings_v1',7],['status_v1',2]]);
      assert.equal(h.retention.stale,true,'30 saat önce: gecikmiş');
      assert.equal(h.retention.counts.listings_redacted,3);
      assert.deepEqual([Number(h.security.events_24h),Number(h.security.events_7d)],[1,2]);
      assert.deepEqual([Number(h.reports.open),Number(h.reports.reviewing)],[1,1]);
      await db.query(`insert into private.retention_runs(ran_at,counts) values(now()-interval '2 hours','{}')`);
      assert.equal((await health(db,ADMIN)).retention.stale,false,'son çalışma 26 saatten yeni');
      assert.ok(!JSON.stringify(await health(db,ADMIN)).includes(USER),'hesap kimliği dönmez');
    });

    await t.test('pg_cron varsa: yalnız nakgo-* görevleri, son çalışma; hata metni yok',async()=>{
      await db.exec(`create schema cron;
        create table cron.job(jobid bigint primary key,jobname text,schedule text,active boolean);
        create table cron.job_run_details(runid bigserial primary key,jobid bigint,status text,return_message text,start_time timestamptz,end_time timestamptz);
        insert into cron.job values(1,'nakgo-retention','0 0 * * *',true),(2,'nakgo-daily-stats','30 21 * * *',false),(3,'baska-gorev','* * * * *',true);
        insert into cron.job_run_details(jobid,status,return_message,start_time,end_time) values
         (1,'succeeded','ok',now()-interval '2 days',now()-interval '2 days'),(1,'failed','GIZLI HATA METNI',now()-interval '1 hour',now()-interval '1 hour'),(3,'failed','x',now(),now());`);
      const h=await health(db,ADMIN);
      assert.deepEqual(h.jobs.map(j=>[j.name,j.active,j.last_status]),[['nakgo-daily-stats',false,null],['nakgo-retention',true,'failed']]);
      assert.ok(!JSON.stringify(h).includes('GIZLI'),'hata metni dönmez');
      assert.equal((await as(db,ADMIN,'authenticated',`select private.admin_cron_jobs()`)).error.code,'42501','yardımcı istemciye kapalı');
    });
  }finally{await finish(db,null);}
});

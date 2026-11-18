/** B2 ölçümü: gece temizliği tek işlemde (retention_run) ve parçalı (retention_batches + retention_run) çalışırken
 * toplam süre ve aynı anda gelen kullanıcı yazmalarının en uzun bekleme süresi. Yalnız yerel gerçek PostgreSQL
 * (NAKGO_PG_HOST); her senaryo için ayrı geçici veritabanı, sentetik veri.
 *   node tools/retention-bench.cjs [--listings 200000] [--due 180000] [--batch 1000] */
'use strict';
const {openDb,build,finish}=require('./db-lib.cjs');
const {Client}=require('pg');
const arg=(n,d)=>{const i=process.argv.indexOf(n);return i>0?Number(process.argv[i+1]):d;};
const N=arg('--listings',200000),DUE=arg('--due',180000),BATCH=arg('--batch',1000);
if(!process.env.NAKGO_PG_HOST)throw Error('Yalnız yerel gerçek PostgreSQL: NAKGO_PG_HOST gerekli');

async function prepare(){
  const db=await openDb();
  await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
  await build(db);
  await db.exec(`set session_replication_role=replica`);
  await db.query(`insert into auth.users(id,email_confirmed_at) select gen_random_uuid(),now() from generate_series(1,2000)`);
  await db.query(`with u as (select id,row_number() over () n from auth.users)
    insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id,status,expires_at)
    select 'load','İstanbul','Ankara','Tır','Tenteli',10,'Yük','Ad','bugün','+905321234567',true,u.id,'active',
      case when g<=$2 then now()-interval '10 days' else now()+interval '3 hours' end
    from generate_series(1,$1) g join u on u.n=1+(g%2000)`,[N,DUE]);
  await db.exec(`reset session_replication_role; analyze`);
  return db;
}

/** Temizlik sürerken ikinci bağlantıdan her 20 ms'de bir ilan günceller; en uzun bekleme. */
async function measure(db,cleanup){
  const w=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:db.name});
  await w.connect();await w.query(`set session_replication_role=replica`);
  const target=(await w.query(`select max(id) id from public.listings`)).rows[0].id;
  let stop=false,max=0,writes=0;
  const writer=(async()=>{while(!stop){const t=performance.now();await w.query(`update public.listings set note=note where id=$1`,[target]);max=Math.max(max,performance.now()-t);writes++;await new Promise(r=>setTimeout(r,20));}})();
  const t0=performance.now();await cleanup();const total=performance.now()-t0;
  stop=true;await writer;await w.end();
  return {total_ms:Math.round(total),writer_max_wait_ms:Math.round(max),writes};
}

(async()=>{
  const out={listings:N,due:DUE,batch:BATCH};
  let db=await prepare();
  try{out.single=await measure(db,()=>db.query('select private.retention_run()'));}finally{await finish(db);}
  db=await prepare();
  try{
    out.batched=await measure(db,async()=>{await db.exec(`call private.retention_batches(${BATCH},100000)`);await db.query('select private.retention_run()');});
    const j=(await db.query(`select batches,counts,extract(epoch from finished_at-started_at)*1000 ms from private.retention_jobs order by id desc limit 1`)).rows[0];
    out.batched.job={batches:j.batches,counts:j.counts,job_ms:Math.round(j.ms),avg_batch_ms:Math.round(j.ms/Math.max(1,j.batches))};
    out.batched.left=(await db.query(`select count(*)::int n from public.listings where redacted_at is null and expires_at<now()-interval '8 days'`)).rows[0].n;
  }finally{await finish(db);}
  console.log(JSON.stringify(out,null,1));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

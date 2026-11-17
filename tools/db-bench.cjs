/** B2 ölçümü: geçici yerel PostgreSQL veritabanında migration'larla kurulan şemaya sentetik veri yükler ve ilan liste
 * sorgularını EXPLAIN ANALYZE ile ölçer. Gerçek veri yok; uzak host db-lib tarafından reddedilir.
 *   NAKGO_PG_HOST=... node tools/db-bench.cjs [--listings 200000] [--users 20000] [--active-share 0.1] [--live 277]
 * Çıktı: her sorgu için en iyi 5 çalıştırmanın süresi, okunan blok sayısı ve plan özeti (JSON). */
'use strict';
const crypto=require('node:crypto');
const {openDb,build,finish}=require('./db-lib.cjs');

const arg=(n,d)=>{const i=process.argv.indexOf(n);return i>0?Number(process.argv[i+1]):d;};
const LISTINGS=arg('--listings',200000),USERS=arg('--users',20000),ACTIVE=arg('--active-share',0.1),LIVE=arg('--live',277);

async function seed(db){
  await db.exec(`set session_replication_role=replica`);// tetikleyiciler (oturum ve kota denetimleri) yalnız yüklemede kapalı
  await db.query(`insert into auth.users(id,email_confirmed_at,email) select gen_random_uuid(),now(),'b'||g||'@example.invalid' from generate_series(1,$1) g`,[USERS]);
  await db.query(`insert into public.profiles(id,display_name,account_type) select id,'Test','owner' from auth.users`);
  // Kimlik sırası = zaman sırası. Son LIVE ilan süresi dolmamış aktif; aktiflerin geri kalanı süresi dolmuş ama açık
  // (gece kapanmadan önceki durum); diğerleri kapalı.
  await db.query(`with u as (select id,row_number() over () n from auth.users)
    insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,available_on,contact_phone,contact_consent,owner_id,status,created_at,expires_at)
    select case when g%2=0 then 'load' else 'truck' end,'İstanbul','Ankara','Tır','Tenteli',100,case when g%2=0 then 'Test' else '' end,'Test',null,(now() at time zone 'Europe/Istanbul')::date,'+905000000000',true,
      u.id,case when g>$1-$3 or random()<$2 then 'active' else 'closed' end,
      now()-make_interval(secs=>($1-g)*30),now()-make_interval(secs=>($1-g)*30)+interval '6 hours'
    from generate_series(1,$1) g join u on u.n=1+(g%$4)`,[LISTINGS,ACTIVE,LIVE,USERS]);
  await db.query(`update public.listings set expires_at=now()+interval '1 hour' where id in(select id from public.listings order by id desc limit $1)`,[LIVE]);
  await db.exec(`reset session_replication_role; analyze public.listings; analyze auth.users;`);
}

const QUERIES={
  public_list:{sql:`select * from public.nakgo_public_listings(null)`,role:'anon'},
  // Fonksiyon içindeki sorgu (planı görmek için doğrudan): SECURITY DEFINER olduğundan RLS yok.
  public_list_body:{sql:`select l.id from public.listings l where l.status='active' and l.expires_at>now()
    and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)
    and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)
    and not private.account_suspended(l.owner_id) order by l.id desc limit 50`},
  member_list:{sql:`select id,kind,from_city,to_city from public.listings where status='active' order by id desc limit 50`,role:'authenticated'},
};

async function measure(db,name,{sql,role},user){
  const runs=[];let plan;
  for(let i=0;i<7;i++){
    await db.exec('begin');
    try{
      if(role){await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[role==='authenticated'?user:'']);await db.exec(`set local role ${role}`);}
      const r=(await db.query(`explain (analyze,buffers,format json) ${sql}`)).rows[0]['QUERY PLAN'][0];
      runs.push({ms:r['Execution Time'],rows:r.Plan['Actual Rows'],blocks:(r.Plan['Shared Hit Blocks']||0)+(r.Plan['Shared Read Blocks']||0)});
      plan=r.Plan;
    }finally{await db.exec('rollback');}
  }
  runs.sort((a,b)=>a.ms-b.ms);
  const nodes=[];(function walk(p){nodes.push(p['Node Type']+(p['Index Name']?' '+p['Index Name']:'')+(p['Rows Removed by Filter']?` (filtrelenen ${p['Rows Removed by Filter']})`:''));(p.Plans||[]).forEach(walk);})(plan);
  return {query:name,rows:runs[0].rows,best_ms:Number(runs[0].ms.toFixed(2)),median_ms:Number(runs[3].ms.toFixed(2)),blocks:runs[0].blocks,plan:nodes};
}

(async()=>{
  const db=await openDb();let primary=null;
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db);
    await seed(db);
    const user=(await db.query(`select owner_id from public.listings order by id desc limit 1`)).rows[0].owner_id;
    const counts=(await db.query(`select count(*) filter (where status='active') active,count(*) filter (where status='active' and expires_at>now()) live,count(*) total from public.listings`)).rows[0];
    const out={engine:db.engine,listings:counts,results:[]};
    for(const [n,q] of Object.entries(QUERIES))out.results.push(await measure(db,n,q,user));
    console.log(JSON.stringify(out,null,1));
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

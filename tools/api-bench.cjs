/** B3-b1 ölçümü: 200.000 sentetik ilanla v0 ve v1 ilan akışı (misafir ve üye) süreleri. Geçici yerel veritabanı; yalnız
 * yerel gerçek PostgreSQL (NAKGO_PG_HOST). --with-index: PR #134'teki listings_active_expires indeksini de kurar.
 *   node tools/api-bench.cjs [--listings 200000] [--with-index] */
'use strict';
const {openDb,build,finish}=require('./db-lib.cjs');
if(!process.env.NAKGO_PG_HOST)throw Error('Yalnız yerel gerçek PostgreSQL: NAKGO_PG_HOST gerekli');
const arg=(n,d)=>{const i=process.argv.indexOf(n);return i>0?Number(process.argv[i+1]):d;};
const N=arg('--listings',200000),IDX=process.argv.includes('--with-index');
const COLS='id,owner_id,kind,from_city,to_city,from_district,to_district,expires_at,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,contact_consent';
(async()=>{
  const db=await openDb();let primary=null;
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into auth.users(id,email_confirmed_at) select gen_random_uuid(),now() from generate_series(1,20000)`);
    // %10 aktif; aktiflerin çoğu süresi geçmiş ama henüz kapanmamış (gece kapanmadan önceki gerçekçi durum); son 300 canlı.
    await db.query(`with u as (select id,row_number() over () n from auth.users)
      insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id,status,expires_at)
      select 'load','İstanbul','Ankara','Tır','Tenteli',10,'Yük','Ad','bugün','+905321234567',true,u.id,case when g%10=0 or g>$1-300 then 'active' else 'closed' end,
        case when g>$1-300 then now()+interval '3 hours' else now()-interval '1 day' end
      from generate_series(1,$1) g join u on u.n=1+(g%20000)`,[N]);
    await db.exec('reset session_replication_role');
    if(IDX)await db.exec(`create index listings_active_expires on public.listings(expires_at) where status='active'`);
    await db.exec('analyze');
    const member=(await db.query(`select id from auth.users limit 1`)).rows[0].id;
    const run=async(role,sql)=>{
      const t=[];
      for(let i=0;i<15;i++){
        await db.exec('begin');
        try{await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[role==='authenticated'?member:'']);await db.exec('set local role '+role);
          const s=performance.now();await db.query(sql);t.push(performance.now()-s);}finally{await db.exec('rollback');}
      }
      t.sort((a,b)=>a-b);return Number(t[7].toFixed(2));
    };
    const out={engine:db.engine,listings:N,index_134:IDX,median_ms:{
      v0_guest:await run('anon','select * from public.nakgo_public_listings(null)'),
      v1_guest:await run('anon','select api.listings_v1()'),
      v0_member:await run('authenticated',`select ${COLS} from public.listings where status='active' order by id desc limit 50`),
      v1_member:await run('authenticated','select api.listings_v1()'),
      v1_detail:await run('authenticated',`select api.listing_v1((select max(id) from public.listings))`),
      v1_my_listings:await run('authenticated','select api.my_listings_v1()')}};
    console.log(JSON.stringify(out));
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

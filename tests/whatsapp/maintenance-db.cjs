'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin,user}=await setup();
 try{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
  await assert.rejects(()=>q("select public.nakgo_maintenance('purge')"),e=>e.code==='42501');
  await assert.rejects(()=>q('select public.nakgo_maintenance_status()'),e=>e.code==='42501');
  await db.exec('reset role');
  await db.exec("alter function public.nakgo_wa_purge() rename to synthetic_real_purge; create function public.nakgo_wa_purge() returns void language plpgsql as $$begin raise exception 'Synthetic sensitive error text';end$$;");
  await db.exec('set role service_role');let r=(await q("select public.nakgo_maintenance('purge') v"))[0].v;assert.equal(r.ok,false);
  r=(await q("select public.nakgo_maintenance('purge') v"))[0].v;assert.equal(r.backoff,true);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from private.maintenance_events'))[0].n,1);
  const state=(await q("select * from private.maintenance_state where task='purge'"))[0];assert.equal(state.failures,1);assert.equal(state.last_error_code,'P0001');assert.ok(state.next_attempt);
  await db.exec('drop function public.nakgo_wa_purge();alter function public.synthetic_real_purge() rename to nakgo_wa_purge');
  await q("update private.maintenance_state set next_attempt=now()-interval '1 second' where task='purge'");
  await db.exec('set role service_role');r=(await q("select public.nakgo_maintenance('purge') v"))[0].v;assert.equal(r.ok,true);
  await db.exec('reset role');assert.equal((await q("select failures from private.maintenance_state where task='purge'"))[0].failures,0);
  assert.deepEqual((await q('select outcome from private.maintenance_events order by id')).map(r=>r.outcome),['failed','recovered']);
  const {createStore}=require('../../server/whatsapp/store.cjs');
  for(const result of [null,{ok:false}]){const store=createStore({env:{SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic'},fetchImpl:async()=>Response.json(result)});await assert.rejects(()=>store.purge(),/maintenance_retry_required/);}
  console.log('PASS durable maintenance error/recovery, bounded retry, private status and fail-closed HTTP result');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

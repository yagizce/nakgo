'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin,user}=await setup();
 const role=async(id)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
 try{
  await role(user);
  const a=(await q("select public.nakgo_privacy_request('deletion') v"))[0].v;
  const b=(await q("select public.nakgo_privacy_request('deletion') v"))[0].v;
  assert.equal(a.id,b.id);assert.equal(a.status,'open');assert.equal(new Date(a.due_at)-new Date(a.created_at),30*86400000);
  assert.equal((await q('select public.nakgo_privacy_requests() v'))[0].v.length,1);
  await denied(()=>q('select public.nakgo_privacy_queue()'));
  await denied(()=>q('select * from private.privacy_requests'));
  await role(admin);await denied(()=>q("select public.nakgo_admin_page('users')"));assert.deepEqual((await q('select public.nakgo_privacy_requests() v'))[0].v,[]);
  await denied(()=>q('select public.nakgo_privacy_queue()'));
  await db.exec('reset role');await q("insert into private.data_access_grants values($1,'listing_archive'),($1,'archive_contact')",[admin]);
  await role(admin);await denied(()=>q('select public.nakgo_privacy_queue()'));
  await db.exec('reset role');await q("insert into private.data_access_grants values($1,'privacy_cases')",[admin]);
  await role(admin);const queue=(await q('select public.nakgo_privacy_queue() v'))[0].v;
  assert.equal(queue.length,1);assert.equal(queue[0].subject_id,undefined);
  await db.exec('reset role');await q("delete from private.data_access_grants where capability='privacy_cases'");
  await role(admin);await denied(()=>q('select public.nakgo_privacy_queue()'));
  await db.exec('reset role');await db.exec('set role anon');await denied(()=>q("select public.nakgo_privacy_request('deletion')"));
  console.log('PASS privacy request idempotency, 30-day tracking, account isolation, separate revocable grants, anonymous denial');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

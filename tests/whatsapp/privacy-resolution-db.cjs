'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin,user}=await setup();
 const role=async(id)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 try{
  await role(user);const id=(await q("select public.nakgo_privacy_request('deletion') v"))[0].v.id;
  await assert.rejects(()=>q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic completion reference')",[id]),e=>e.code==='42501');
  await db.exec('reset role');await q("insert into private.data_access_grants values($1,'privacy_cases')",[admin]);
  await role(admin);await assert.rejects(()=>q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic completion reference')",[id]),e=>e.code==='42501');
  await db.exec('reset role');await q('update private.privacy_settings set account_deletion_enabled=true');
  // New unknown FK records must block deletion without changing the resolver.
  await q('create table public.synthetic_dependency(id bigint,user_id uuid references auth.users(id) on delete cascade)');
  await q('insert into public.synthetic_dependency values(1,$1)',[user]);
  await role(admin);let result=(await q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic completion reference') v",[id]))[0].v;
  assert.equal(result.completed,false);assert.ok(result.relations.includes('public.synthetic_dependency'));
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from auth.users where id=$1',[user]))[0].n,1);
  await q('delete from public.synthetic_dependency');
  await role(admin);result=(await q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic completion reference') v",[id]))[0].v;assert.equal(result.completed,true);
  await db.exec('reset role');assert.equal((await q('select count(*)::int n from auth.users where id=$1',[user]))[0].n,0);assert.equal((await q('select count(*)::int n from public.profiles where id=$1',[user]))[0].n,0);
  const request=(await q('select * from private.privacy_requests where id=$1',[id]))[0];assert.equal(request.subject_id,null);assert.equal(request.status,'completed');
  const evidence=(await q('select * from private.account_erasure_events where request_id=$1',[id]))[0];assert.equal(evidence.subject_hash,require('node:crypto').createHash('sha256').update(user).digest('hex'));assert.equal(evidence.subject_id,undefined);await assert.rejects(()=>q('delete from private.account_erasure_events'),e=>e.code==='42501');
  await role(admin);await assert.rejects(()=>q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic duplicate completion')",[id]),e=>e.code==='40001');
  const own=(await q("select public.nakgo_privacy_request('deletion') v"))[0].v.id;
  result=(await q("select public.nakgo_privacy_resolve($1,0,'completed','Synthetic protected administrator') v",[own]))[0].v;assert.equal(result.completed,false);assert.ok(result.relations.includes('protected_administrator'));
  console.log('PASS deletion disabled default, scoped resolution, unknown cascade block, isolated account removal, audit survival, stale result and protected admin');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

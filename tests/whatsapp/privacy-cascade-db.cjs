'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const setup=require('./capacity-fixture.cjs');

// Local PGlite only. Model a new business relation attached to a deletable profile.
(async()=>{
 const {db,q,admin,user}=await setup();
 const as=async(id,sql,args=[])=>{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
  try{return await q(sql,args);}finally{await db.exec('reset role');}
 };
 try{
  if(!process.argv.includes('--baseline')){
   await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/pending/privacy-cascade-protection.sql'),'utf8'));
  }
  await q("insert into private.data_access_grants values($1,'privacy_cases')",[admin]);
  await q('update private.privacy_settings set account_deletion_enabled=true');
  const id=(await as(user,"select public.nakgo_privacy_request('deletion') v"))[0].v.id;
  await db.exec('create table public.synthetic_business(id bigint primary key, profile_id uuid references public.profiles(id) on delete cascade)');
  await q('insert into public.synthetic_business values(1,$1)',[user]);
  const resolve=(actor)=>as(actor,"select public.nakgo_privacy_resolve($1,0,'completed','Synthetic completion reference') v",[id]);
  // The authenticated caller cannot gain authority from user-controlled JWT metadata.
  await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,user_metadata:{role:'admin',privacy_cases:true}})]);
  await assert.rejects(()=>resolve(user),error=>error.code==='42501');
  const outcome=(await resolve(admin))[0].v;
  assert.equal(outcome.completed,false,'indirect cascade must require review');
  assert.ok(outcome.relations.includes('public.synthetic_business'));
  const [state]=await q(`select
   (select count(*)::int from auth.users where id=$1) as subjects,
   (select count(*)::int from public.synthetic_business where profile_id=$1) as business,
   (select revision from private.privacy_requests where id=$2) as revision,
   (select count(*)::int from private.account_erasure_events where request_id=$2) as evidence`,[user,id]);
  assert.deepEqual(state,{subjects:1,business:1,revision:0,evidence:0});
  await q('delete from public.synthetic_business where profile_id=$1',[user]);
  assert.equal((await resolve(admin))[0].v.completed,true,'an unrelated schema dependency alone does not block deletion');
  console.log('PASS: forged metadata denied and indirect cascade preserves account, business row and request state');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

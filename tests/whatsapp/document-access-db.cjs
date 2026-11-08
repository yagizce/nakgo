'use strict';
const assert=require('node:assert/strict');
const setup=require('./capacity-fixture.cjs');

// Local PGlite only. Model known IDs and paths without giving callers another user's role.
(async()=>{
 const {db,q,admin,user}=await setup();
 const fileId='20000000-0000-4000-8000-000000000001';
 const as=async(id,sql,args=[])=>{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
  try{return await q(sql,args);}finally{await db.exec('reset role');}
 };
 const denied=fn=>assert.rejects(fn,error=>error.code==='42501');
 try{
  const [{id:app}]=await as(user,"select (public.nakgo_create_carrier_application('CE')).id");
  const [{object_path:objectPath}]=await as(user,"select (public.nakgo_reserve_document($1,'src',$2)).object_path",[app,fileId]);
  const upload="insert into storage.objects(bucket_id,name,owner_id,metadata) values('carrier-documents',$1,$2,'{\"mimetype\":\"image/jpeg\",\"size\":100}')";
  await as(user,upload,[objectPath,user]);
  await as(user,'select public.nakgo_finalize_document($1)',[fileId]);
  const revision=async()=>(await q('select revision from public.carrier_applications where id=$1',[app]))[0].revision;
  const originalRevision=await revision();

  // General administrator authority is separate from document review.
  await denied(()=>as(admin,"select public.nakgo_review_documents($1,'approved','',$2)",[app,originalRevision]));
  await q('insert into private.document_reviewers(user_id) values($1)',[admin]);
  for(const sql of [
   'select id from public.carrier_document_files where id=$1',
   'select id from storage.objects where name=$1',
   'delete from storage.objects where name=$1 returning id'
  ]){
   assert.deepEqual(await as(admin,sql,[sql.includes('storage.objects')?objectPath:fileId]),[]);
  }
  await denied(()=>as(admin,'select public.nakgo_finalize_document($1)',[fileId]));
  await denied(()=>as(admin,'select public.nakgo_remove_document($1)',[fileId]));
  await denied(()=>as(admin,"select public.nakgo_reserve_document($1,'src',$2)",[app,fileId]));
  assert.equal(await revision(),originalRevision,'denied calls leave the original revision intact');

  const [retry]=await as(user,'select (public.nakgo_finalize_document($1)).status',[fileId]);
  assert.equal(retry.status,'ready');
  assert.equal(await revision(),originalRevision,'lost-response retry does not advance revision twice');
  assert.equal((await q('select id from storage.objects where name=$1',[objectPath])).length,1);
  console.log('PASS: known document IDs cannot bypass RPC or draft Storage access; finalize retry preserves state');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

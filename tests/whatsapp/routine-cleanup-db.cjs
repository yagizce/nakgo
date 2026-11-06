'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin}=await setup();
 try{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  await db.exec('set role service_role');
  await q('select public.nakgo_wa_ingest($1::jsonb)',[JSON.stringify([{messageId:'cleanup-complete',text:'İstanbul Ankara kapalı tır 20 ton palet bugün +90 532 123 45 67',timestamp:1793900000,fromPhone:'+905300000000'}])]);
  const job=(await q('select public.nakgo_wa_claim() v'))[0].v;
  const fields=require('../../server/whatsapp/review-parser.cjs').parseListings(job.text);
  await q('select public.nakgo_wa_finish($1,$2::uuid,$3::jsonb)',[job.id,job.lease,JSON.stringify(fields)]);
  await db.exec('reset role');
  assert.ok((await q('select original_text from private.wa_sources where id=$1',[job.id]))[0].original_text);
  await db.exec('set role service_role');await q('select public.nakgo_wa_purge()');await db.exec('reset role');
  assert.ok((await q('select original_text from private.wa_sources where id=$1',[job.id]))[0].original_text);
  const draftId=(await q('select id from private.wa_drafts where source_id=$1',[job.id]))[0].id;
  await q("insert into private.wa_audit(draft_id,actor,action,before_value,after_value) values($1,$2,'save',$3::jsonb,$3::jsonb)",[draftId,admin,JSON.stringify({revision:0,status:'draft',fields:{contactPhone:'+905321234567',description:'Synthetic private content'}})]);
  await q("update private.wa_sources set received_at=now()-interval '73 hours' where id=$1",[job.id]);
  await q("update private.wa_drafts set created_at=now()-interval '73 hours' where source_id=$1",[job.id]);
  await db.exec('set role service_role');await q('select public.nakgo_wa_purge()');await q('select public.nakgo_wa_purge()');await db.exec('reset role');
  const source=(await q('select original_text,sender from private.wa_sources where id=$1',[job.id]))[0];assert.equal(source.original_text,null);assert.equal(source.sender,null);
  const draft=(await q('select * from private.wa_drafts where source_id=$1',[job.id]))[0];assert.deepEqual(draft.fields,{});assert.equal(draft.status,'purged');
  const evidence=(await q('select before_value,after_value from private.wa_audit where draft_id=$1',[draft.id]))[0];assert.equal(evidence.before_value.fields,undefined);assert.equal(evidence.after_value.fields,undefined);assert.equal((await q('select count(*)::int n from private.wa_erasure_events'))[0].n,2);await assert.rejects(()=>q('delete from private.wa_erasure_events'),e=>e.code==='42501');
  await db.exec('set role authenticated');await assert.rejects(()=>q('select public.nakgo_wa_detail($1)',[draft.id]));await assert.rejects(()=>q('select public.nakgo_wa_purge()'),e=>e.code==='42501');
  await db.exec('reset role');await db.exec('set role service_role');
  await q('select public.nakgo_wa_ingest($1::jsonb)',[JSON.stringify([{messageId:'cleanup-pending',text:'Synthetic pending input',timestamp:1793900000}])]);
  await db.exec('reset role');await q("update private.wa_sources set received_at=now()-interval '90 days' where message_id='cleanup-pending'");
  await db.exec('set role service_role');await q('select public.nakgo_wa_purge()');await db.exec('reset role');
  assert.equal((await q("select original_text from private.wa_sources where message_id='cleanup-pending'"))[0].original_text,'Synthetic pending input');
  console.log('PASS bounded completed-message cleanup, fresh/pending preservation, idempotency, retired detail and unauthorized purge denial');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

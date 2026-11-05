'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin}=await setup({skipMigration:'20261106010000_whatsapp_storage.sql'});
 try{
  const role=async(name)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await db.exec('set role '+name);};
  await role('service_role');await q('select public.nakgo_wa_ingest($1::jsonb)',[JSON.stringify([{messageId:'storage-fixture',text:'İstanbul yükleme Ankara kapalı tır 20 ton palet bugün +90 532 123 45 67',fromPhone:'+905300000000',timestamp:1793900000}])]);
  const job=(await q('select public.nakgo_wa_claim() v'))[0].v;
  const parsed=require('../../server/whatsapp/review-parser.cjs').parseListings(job.text);
  await q('select public.nakgo_wa_finish($1,$2::uuid,$3::jsonb)',[job.id,job.lease,JSON.stringify(parsed)]);
  await role('authenticated');
  await db.exec('reset role');const draft=(await q('select * from private.wa_drafts where source_id=$1',[job.id]))[0];
  assert.equal(draft.revision,0);assert.equal(draft.status,'draft');
  await role('authenticated');
  // Simulate an active publication predating the dedupe-key migration.
  await q('select public.nakgo_wa_change($1,0,$2,$3::jsonb,$4)',[draft.id,'publish',JSON.stringify(draft.fields),'Synthetic documented prior publication permission']);
  await db.exec('reset role');await q('delete from private.wa_publication_keys where listing_id=(select listing_id from private.wa_drafts where id=$1)',[draft.id]);
  const evidence=(await q('select to_jsonb(a) v from private.wa_audit a where draft_id=$1 order by id',[draft.id])).map(r=>r.v);
  const migration=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../supabase/migrations/20261106010000_whatsapp_storage.sql'),'utf8');
  const original=(await q("select pg_get_functiondef('private.wa_change_core(bigint,integer,text,jsonb,text)'::regprocedure) v"))[0].v;
  await db.exec(original.replace('declare d private.wa_drafts','-- synthetic unexpected validator edit\ndeclare d private.wa_drafts'));
  await assert.rejects(()=>db.exec(migration),/Reviewed validator body changed/);
  await db.exec('rollback');await db.exec(original);
  await db.exec(migration);
  assert.equal((await q('select count(*)::int n from private.wa_publication_keys'))[0].n,1);
  assert.deepEqual((await q('select to_jsonb(a) v from private.wa_audit a where draft_id=$1 order by id',[draft.id])).map(r=>r.v),evidence);
  await role('authenticated');
  for(const [action,revision,fields,status] of [['withdraw',1,null,'withdrawn'],['save',2,draft.fields,'draft'],['publish',3,draft.fields,'published'],['reject',4,null,'rejected']]){
   const result=(await q('select public.nakgo_wa_change($1,$2,$3,$4::jsonb,$5) v',[draft.id,revision,action,fields?JSON.stringify(fields):null,action==='publish'?'Synthetic documented storage fixture permission':null]))[0].v;
   assert.equal(result.revision,revision+1);assert.equal(result.status,status);
  }
  await db.exec('reset role');const audit=await q('select * from private.wa_audit where draft_id=$1 order by id',[draft.id]);assert.equal(audit.length,5);
  for(let i=0;i<audit.length;i++){assert.equal(audit[i].before_value.revision,i);assert.equal(audit[i].after_value.revision,i+1);assert.ok(audit[i].before_value.fields.description);assert.ok(audit[i].after_value.fields.contactPhone);}
  assert.equal((await q('select original_text from private.wa_sources where id=$1',[job.id]))[0].original_text,job.text);
  console.log('storage mutation: save/publish/withdraw/reject each advances once; full before/after evidence and source preserved');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

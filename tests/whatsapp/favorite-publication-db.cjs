'use strict';
// Disposable, in-memory PGlite only. No credentials, network, CPU load or restore.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{
 const {db,q,admin,user}=await setup();let checks=0;
 const ok=(v,m)=>{assert.ok(v,m);checks++;};
 const role=async id=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const sql=()=>fs.readFileSync(path.join(__dirname,'../../supabase/pending/favorite-publication-access.sql'),'utf8');
 try{
  await db.exec(sql());await role(user);
  const id=(await q("insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent) values('load','İstanbul','Ankara','Tır','Kapalı kasa',20,'Synthetic','bugün','+905321234567',true) returning id"))[0].id;
  const before=(await q('select published_at,expires_at from public.listings where id=$1',[id]))[0];
  await q("update public.listings set note='Synthetic edit' where id=$1",[id]);
  const after=(await q('select published_at,expires_at from public.listings where id=$1',[id]))[0];
  ok(String(before.published_at)===String(after.published_at),'edit/view preserve publication start');
  ok(String(before.expires_at)===String(after.expires_at),'edit/view preserve six-hour deadline');
  await role(admin);await assert.doesNotReject(()=>q('select public.nakgo_set_favorite($1,true)',[id]),'first active save');
  ok((await q('select * from public.listing_favorites')).length===1,'active publication can be saved');
  await role(user);ok((await q('select * from public.listing_favorites')).length===0,'owner cannot read another account bookmarks');
  for(const reader of [admin,user]){
   await role(reader);
   await assert.rejects(()=>q('select contact_phone from public.listings where id=$1',[id]),e=>e.code==='42501');checks++;
   ok((await q('select public.nakgo_listing_contact($1) v',[id]))[0].v!=null,'active contact remains available through checked RPC');
   await assert.rejects(()=>q('select id from auth.users'),e=>e.code==='42501');checks++;
   await assert.rejects(()=>q('select owner_label from public.listings where id=$1',[id]),e=>e.code==='42501');checks++;
  }
  await db.exec('reset role');await db.exec('alter table public.listings disable trigger user');
  await q("update public.listings set published_at=statement_timestamp()+interval '1 hour',expires_at=statement_timestamp()+interval '7 hours',note='Synthetic public text marker',loading_text='Synthetic timing',items='[]' where id=$1",[id]);
  // A relation timestamp in the future must not bypass the publication boundary.
  await q("update public.listing_favorites set created_at=statement_timestamp()+interval '2 hours' where listing_id=$1",[id]);
  await db.exec('alter table public.listings enable trigger user');
  for(const reader of [admin,user]){
   await role(reader);
   ok((await q('select id,owner_id,note,cargo,loading_text,items,image_data from public.listings where id=$1',[id])).length===0,'future listing and free text hidden even from owner');
   ok((await q('select * from public.listing_favorites')).length===0,'future publication bookmark hidden');
   await assert.rejects(()=>q('select public.nakgo_listing_contact($1)',[id]),e=>e.code==='42501');checks++;
   await assert.rejects(()=>q('select public.nakgo_set_favorite($1,true)',[id]),e=>e.code==='42501');checks++;
  }
  await db.exec('reset role');
  await q("update public.listing_favorites set created_at=statement_timestamp() where listing_id=$1",[id]);
  await db.exec('reset role');
  for(const age of [6*3600-1,6*3600,6*3600+1,198*3600-1,198*3600,198*3600+1]){
   await db.exec('alter table public.listings disable trigger user');
   await q("update public.listings set published_at=statement_timestamp()-$2*interval '1 second',expires_at=statement_timestamp()+(21600-$2)*interval '1 second' where id=$1",[id,age]);
   await db.exec('alter table public.listings enable trigger user');
   await role(admin);
   ok((await q('select * from public.listing_favorites')).length===(age<21600?1:0),'favorite boundary '+age);
   ok((await q('select id from public.listings where id=$1',[id])).length===(age<21600?1:0),'public boundary '+age);
   if(age>=21600){
    for(const reader of [admin,user]){
     await role(reader);
     await assert.rejects(()=>q('select contact_phone from public.listings where id=$1',[id]),e=>e.code==='42501');checks++;
     ok((await q('select owner_id,note,cargo,loading_text,items,image_data from public.listings where id=$1',[id])).length===0,'expired direct personal-data/free-text read denied '+age);
     ok((await q('select f.listing_id,l.note from public.listing_favorites f join public.listings l on l.id=f.listing_id where l.id=$1',[id])).length===0,'expired favorite join leaks no free text '+age);
     await assert.rejects(()=>q('select public.nakgo_listing_contact($1)',[id]),e=>e.code==='42501');checks++;
     await assert.rejects(()=>q('select public.nakgo_set_favorite($1,true)',[id]),e=>e.code==='42501');checks++;
    }
    await db.exec('reset role');await db.exec('set role anon');
    await assert.rejects(()=>q('select contact_phone from public.listings where id=$1',[id]),e=>e.code==='42501');checks++;
    await assert.rejects(()=>q('select public.nakgo_listing_contact($1)',[id]),e=>e.code==='42501');checks++;
   }
   await db.exec('reset role');await q("insert into private.data_access_grants values($1,'listing_archive') on conflict do nothing",[admin]);await role(admin);
   const archive=(await q('select public.nakgo_archive_list() v'))[0].v;
   ok(archive.length===(age>=21600&&age<198*3600?1:0),'eight-day archive boundary '+age);
   ok(archive.every(r=>!('user_id' in r)&&!('contact_phone' in r)&&!('favorites' in r)),'archive has no saver identity or contact');
   if(archive.length){
    await db.exec('reset role');await q("insert into private.data_access_grants values($1,'archive_contact') on conflict do nothing",[admin]);await role(admin);
    const detail=(await q('select public.nakgo_archive_detail($1) v',[id]))[0].v;
    ok(!('contact_phone' in detail)&&!('favorites' in detail),'archive detail excludes phone and saved relationships');
   }
   await db.exec('reset role');
  }
  await db.exec('alter table public.listings disable trigger user');
  await q("update public.listings set published_at=statement_timestamp()-interval '5 hours',expires_at=statement_timestamp()+interval '1 hour' where id=$1",[id]);
  await db.exec('alter table public.listings enable trigger user');
  await role(user);await q("select public.nakgo_close_listing($1,'closed')",[id]);
  await db.exec('reset role');
  await q("update public.listings set status='active' where id=$1",[id]);
  await role(admin);ok((await q('select * from public.listing_favorites')).length===0,'republishing never revives old bookmark');
  await assert.doesNotReject(()=>q('select public.nakgo_set_favorite($1,true)',[id]),'explicit resave');ok((await q('select * from public.listing_favorites')).length===1,'explicit resave targets new publication');
  await q('select public.nakgo_set_favorite($1,false)',[id]);ok((await q('select * from public.listing_favorites')).length===0,'explicit unsave');
  await role(user);await assert.rejects(()=>q('select public.nakgo_archive_detail($1)',[id]),e=>e.code==='42501');checks++;
  await db.exec('reset role');await db.exec('alter table public.listings disable trigger user');
  await q('update public.listings set published_at=null,expires_at=null where id=$1',[id]);
  await db.exec('alter table public.listings enable trigger user');await role(admin);
  await assert.rejects(()=>q('select public.nakgo_set_favorite($1,true)',[id]),e=>e.code==='42501');checks++;
  ok((await q('select * from public.listing_favorites')).length===0,'missing publication metadata never creates an accessible bookmark');
  console.log(checks+' favorite/public/archive PostgreSQL checks passed; pending SQL only in memory');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

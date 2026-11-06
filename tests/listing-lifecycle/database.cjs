'use strict';
// Isolated PostgreSQL fixture: no network or real credentials.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
(async()=>{
 const db=new PGlite();let checks=0;const q=async(s,a=[])=>(await db.query(s,a)).rows;
 const ok=(v,m)=>{assert.ok(v,m);checks++;};const fail=async(fn,code)=>{await assert.rejects(fn,e=>!code||e.code===code);checks++;};
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const name of fs.readdirSync(path.join(__dirname,'../../supabase/migrations')).sort())await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',name),'utf8'));
 const admin='10000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000002';
 await q('insert into auth.users values($1,now()),($2,now())',[admin,user]);
 for(const id of [admin,user]){await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await q("insert into public.profiles(id,display_name) values($1,'Synthetic account')",[id]);}
 await q('insert into private.admin_members(user_id) values($1)',[admin]);
 const as=async(role,id,sql,args=[])=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);try{return await q(sql,args);}finally{await db.exec('reset role');}};
 const rpc=async(name,args=[],id=admin,role='authenticated')=>(await as(role,id,'select public.nakgo_wa_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args))[0].value;
 const service=(name,args=[])=>rpc(name,args,null,'service_role');

 const insert="insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent) values('load','İstanbul','Ankara','Tır','Tenteli',20,'Palet','bugün',$1,$2) returning id,contact_phone,published_at,expires_at";
 await fail(()=>as('authenticated',user,insert,[null,true]),'23514');
 await fail(()=>as('authenticated',user,insert,['0532 123 45 67',false]),'23514');
 const manual=(await as('authenticated',user,insert,['0532 123 45 67',true]))[0];
 ok(manual.contact_phone==='+905321234567','Turkish phone normalized');
 ok(new Date(manual.expires_at)-new Date(manual.published_at)===21600000,'exactly six hours');
 ok((await as('authenticated',admin,'select id from public.listings where id=$1',[manual.id])).length===1,'immediate publication');
 await fail(()=>as('authenticated',admin,'select owner_label from public.listings'),'42501');
 await fail(()=>as('authenticated',user,"update public.listings set expires_at=now()+interval '1 year' where id=$1",[manual.id]),'42501');
 for(const [role,id] of [['anon',null],['authenticated',user],['authenticated',admin]]){
  for(const rpcName of ['nakgo_message_unread_count()','nakgo_open_conversation(1)',"nakgo_send_message(1,'blocked','00000000-0000-4000-8000-000000000001'::uuid)",'nakgo_read_conversation(1,1)'])await fail(()=>as(role,id,'select public.'+rpcName),'42501');
  for(const table of ['listing_conversations','conversation_messages','message_inbox']){
   await fail(()=>as(role,id,'select * from public.'+table),'42501');
   ok(!(await q('select has_table_privilege($1,$2,$3) allowed',[role,'public.'+table,'SELECT,INSERT,UPDATE,DELETE']))[0].allowed,'retired history has no client read/write grants: '+role+'/'+table);
  }
 }
 await fail(()=>rpc('permission',['synthetic-auto','05321234567','Synthetic recorded permission',new Date(Date.now()+86400000).toISOString(),true],user),'42501');
 const msg={messageId:'synthetic-auto',text:'İstanbul yükleme Ankara Tır tenteli 20 ton palet bugün; 0532 123 45 67',fromPhone:'+905000000001',timestamp:1791800000};
 const candidates=parseListings(msg.text);ok(candidates.length===1&&candidates[0].issues.length===0,'complete body-only parser candidate');
 await service('ingest',[JSON.stringify([msg])]);let job=await service('claim');await service('finish',[job.id,job.lease,JSON.stringify(candidates)]);
 ok((await rpc('page',[0])).drafts[0].status==='draft','no permission remains private draft');
 const until=new Date(Date.now()+86400000).toISOString();
 ok(await rpc('permission',[msg.messageId,'05329999999','Synthetic documented permission',until,true])===0,'mismatched phone cannot publish');
 ok(await rpc('permission',[msg.messageId,'05321234567','Synthetic documented permission',until,true])===1,'matching documented permission publishes');
 ok(await rpc('permission',[msg.messageId,'05321234567','Synthetic documented permission',until,true])===0,'permission retry does not duplicate publication or require second approval');
 const draft=await rpc('detail',[(await rpc('page',[0])).drafts[0].id]);
 const published=(await as('authenticated',user,'select id,note,contact_phone from public.listings where id=$1',[draft.listing_id]))[0];
 ok(published&&published.contact_phone==='+905321234567'&&published.note==='','public contact from body only, raw text private');
 await rpc('permission',[msg.messageId,'05321234567','Synthetic permission withdrawn',until,false]);
 ok((await q('select status from public.listings where id=$1',[draft.listing_id]))[0].status==='closed','permission revocation withdraws');
 const second={...msg,messageId:'synthetic-preauthorized'};
 await rpc('permission',[second.messageId,'05321234567','Synthetic preauthorized permission',until,true]);
 await service('ingest',[JSON.stringify([second])]);job=await service('claim');await service('finish',[job.id,job.lease,JSON.stringify(candidates)]);
 ok((await rpc('page',[0])).drafts.find(d=>d.source_id===job.id)?.status==='published','worker finish automatically publishes with prior permission');

 for(const table of ['wa_publication_permissions','listing_lifecycle_audit'])await fail(()=>as('authenticated',user,'select * from private.'+table),'42501');
 for(const [key,variant] of [['missing',{...candidates[0],fields:{...candidates[0].fields,contactPhone:null}}],['ambiguous',{...candidates[0],issues:['contact_review']}],['uncertain',{...candidates[0],confidence:.9}]]){
  const message={...msg,messageId:'synthetic-'+key};
  await rpc('permission',[message.messageId,'05321234567','Synthetic permission only',until,true]);
  await service('ingest',[JSON.stringify([message])]);const claimed=await service('claim');await service('finish',[claimed.id,claimed.lease,JSON.stringify([variant])]);
  ok((await rpc('page',[0])).drafts.find(d=>d.source_id===claimed.id).status==='draft','permission cannot override '+key);
 }
 for(const value of ['05321234567','+90 (532) 123-45-67','00905321234567','905321234567'])ok((await q('select public.nakgo_normalize_phone($1) phone',[value]))[0].phone==='+905321234567','SQL normalized '+value);
 for(const value of ['',null,'123','5555555555','+447700900123','05321234567x'])ok((await q('select public.nakgo_normalize_phone($1) phone',[value]))[0].phone===null,'SQL invalid phone rejected');

 const shortUntil=new Date(Date.now()+3600000).toISOString();
 await rpc('permission',[second.messageId,'05321234567','Synthetic shortened permission',shortUntil,true]);
 ok((await rpc('page',[0])).drafts.find(d=>d.source_id===job.id).status==='withdrawn','shorter permission cannot leave publication beyond permission');

 const expiryMessage={...msg,messageId:'synthetic-wa-expiry'};
 await rpc('permission',[expiryMessage.messageId,'05321234567','Synthetic six hour permission',until,true]);
 await service('ingest',[JSON.stringify([expiryMessage])]);const expiryJob=await service('claim');await service('finish',[expiryJob.id,expiryJob.lease,JSON.stringify(candidates)]);
 const waListing=(await q('select listing_id from private.wa_drafts where source_id=$1',[expiryJob.id]))[0].listing_id;
 ok((await q("select expires_at-published_at=interval '6 hours' exact from public.listings where id=$1",[waListing]))[0].exact,'WhatsApp publication lifetime exactly six hours');
 ok((await as('authenticated',user,'select id from public.listings where id=$1',[waListing])).length===1,'WhatsApp visible before deadline');
 // Time travel is confined to this disposable fixture, never a remote database.
 await db.exec('alter table public.listings disable trigger listing_lifecycle');
 await q("update public.listings set expires_at=now()-interval '1 second' where id in ($1,$2)",[manual.id,waListing]);
 await db.exec('alter table public.listings enable trigger listing_lifecycle');
 for(const [id,reader,label] of [[manual.id,admin,'manual'],[waListing,user,'WhatsApp']]){
  ok((await as('authenticated',reader,'select id from public.listings where id=$1',[id])).length===0,label+' hidden by RLS before Cron');
  await fail(()=>as('authenticated',reader,'select public.nakgo_listing_contact($1)',[id]),'42501');
  await fail(()=>as('authenticated',reader,'select public.nakgo_request_transport($1)',[id]));
  await fail(()=>as('authenticated',reader,'select public.nakgo_set_favorite($1,true)',[id]),'42501');
 }
 await fail(()=>as('authenticated',user,'select public.nakgo_expire_listings()'),'42501');
 await q('insert into private.account_moderation(user_id,suspended) values($1,true)',[user]);
 ok((await as('service_role',null,'select public.nakgo_expire_listings() n'))[0].n===2,'service archives manual and WhatsApp records including suspended owner');
 for(const id of [manual.id,waListing])ok((await q('select status from public.listings where id=$1',[id]))[0].status==='archived','archived listing retained');
 ok((await as('service_role',null,'select public.nakgo_expire_listings() n'))[0].n===0,'repeated Cron is idempotent');
 ok((await q('select count(*)::int n from private.listing_lifecycle_audit'))[0].n===2,'one expiry audit per archived listing');
 ok((await q('select count(*)::int n from private.wa_drafts where source_id=$1',[expiryJob.id]))[0].n===1,'source-linked WhatsApp history retained');
 console.log(checks+' listing lifecycle PostgreSQL checks passed');await db.close();
})().catch(e=>{console.error(e.stack,e.code);process.exitCode=1;});

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

 const create=async()=> (await as('authenticated',user,`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,note,owner_label,contact_phone,contact_consent,items,image_data)
 values('load','İstanbul','Ankara','Tır','Tenteli',20,'Synthetic cargo','bugün','Synthetic private note','Synthetic name','05321234567',true,'[{"n":"Synthetic item","q":1,"u":"adet"}]','data:image/jpeg;base64,/9j/AAAA') returning id`))[0].id;
 // Time travel only in this disposable database; never disable remote triggers.
 const age=async(id,days)=>{
  await db.exec('alter table public.listings disable trigger listings_write_guard;alter table public.listings disable trigger listing_lifecycle');
  try{await q("update public.listings set created_at=now()-$2::int*interval '1 day',published_at=now()-$2::int*interval '1 day',expires_at=now()-$2::int*interval '1 day'+interval '6 hours' where id=$1",[id,days]);}
  finally{await db.exec('alter table public.listings enable trigger listings_write_guard;alter table public.listings enable trigger listing_lifecycle');}
 };
 const redact=()=>as('service_role',null,'select public.nakgo_redact_listings() n');
 const row=async id=>(await q('select * from public.listings where id=$1',[id]))[0];
 const manual=await create(),young=await create(),held=await create(),jobListing=await create(),conversation=await create(),moderated=await create(),wa=await create();
 await as('authenticated',admin,'select public.nakgo_request_transport($1)',[jobListing]);
 await as('postgres',admin,'select public.nakgo_open_conversation($1)',[conversation]);
 await q("insert into private.listing_moderation(listing_id,reason) values($1,'Synthetic moderation evidence')",[moderated]);
 await q("insert into private.listing_retention_holds(listing_id,reason_reference) values($1,'Synthetic hold reference')",[held]);
 for(const id of [manual,held,jobListing,conversation,moderated,wa])await age(id,30);
 await age(young,29);
 const source=(await q("insert into private.wa_sources(message_id,sender,original_text,sent_at,received_at,state) values('synthetic-retention','+905000000001','Synthetic source',now(),now()-interval '31 days','done') returning id"))[0].id;
 const draft=(await q("insert into private.wa_drafts(source_id,ordinal,fields,issues,confidence,fingerprint,status,listing_id,legal_basis) values($1,1,'{\"contactPhone\":\"+905321234567\",\"description\":\"Synthetic body\"}','[]',1,repeat('a',64),'published',$2,'Synthetic legal evidence') returning id",[source,wa]))[0].id;
 await q("insert into private.wa_audit(draft_id,actor,action,before_value,created_at) values($1,$2,'publish','{\"evidence\":\"synthetic\"}',now()-interval '100 days')",[draft,admin]);
 await q("insert into private.wa_publication_permissions values('synthetic-retention','+905321234567','Synthetic permission evidence',now()+interval '1 day',$1,true,now())",[admin]);
 const evidence=JSON.stringify(await q('select * from private.wa_audit'));
 const permission=JSON.stringify(await q('select * from private.wa_publication_permissions'));
 const protectedBefore=JSON.stringify(await q('select * from public.listings where id=any($1::bigint[]) order by id',[[held,jobListing,conversation,moderated]]));
 for(const role of ['anon','authenticated'])await fail(()=>as(role,user,'select public.nakgo_redact_listings()'),'42501');
 await fail(()=>as('authenticated',user,'select public.nakgo_retention_status()'),'42501');
 await fail(()=>as('anon',null,'select public.nakgo_retention_status()'),'42501');
 await fail(()=>as('authenticated',user,"update public.listings set content_redacted_at=now() where id=$1",[manual]),'42501');
 await fail(()=>as('authenticated',admin,'select * from private.listing_retention_holds'),'42501');
 // An interrupted transaction must not partially clear content or advance the cursor.
 await db.exec('begin');await redact();await db.exec('rollback');
 ok((await row(manual)).contact_phone!==null,'rollback restores personal fields');
 ok((await q('select total_redacted from private.listing_retention_state'))[0].total_redacted===0,'rollback restores progress');
 await q('insert into private.account_moderation(user_id,suspended) values($1,true)',[user]);
 ok((await redact())[0].n===2,'exact 30-day boundary: manual and WhatsApp cleaned, suspended owner supported');
 for(const id of [manual,wa]){
  const l=await row(id);
  ok(l.status==='archived'&&l.content_redacted_at!==null,'archived tombstone retained');
  ok(l.contact_phone===null&&!l.contact_consent&&l.note===''&&l.image_data===''&&l.items.length===0&&l.owner_label==='İlan sahibi'&&l.loading_text==='Temizlendi','personal/free text/image content removed');
  ok((await as('authenticated',admin,'select id from public.listings where id=$1',[id])).length===0,'other account cannot read redacted listing');
  await fail(()=>as('authenticated',admin,'select public.nakgo_listing_contact($1)',[id]),'42501');
 }
 ok((await row(young)).content_redacted_at===null,'29-day listing untouched');
 ok(JSON.stringify(await q('select * from public.listings where id=any($1::bigint[]) order by id',[[held,jobListing,conversation,moderated]]))===protectedBefore,'held, job, conversation and moderation rows byte-for-byte preserved');
 await service('purge');
 ok((await q('select original_text,sender from private.wa_sources where id=$1',[source]))[0].original_text===null,'old source content removed');
 ok((await q('select fields,status,legal_basis from private.wa_drafts where id=$1',[draft]))[0].status==='purged','redacted linked draft cannot republish');
 ok(JSON.stringify(await q('select * from private.wa_audit'))===evidence,'audit evidence preserved even past 90 days');
 ok(JSON.stringify(await q('select * from private.wa_publication_permissions'))===permission,'permission evidence preserved');
 ok((await redact())[0].n===0,'repeated Cron is idempotent');
 ok((await q("select count(*)::int n from private.listing_lifecycle_audit where action='content_redacted_30d'"))[0].n===2,'one audit marker per redaction without content copies');
 await q('update private.account_moderation set suspended=false');
 await fail(()=>as('authenticated',user,"update public.listings set status='active',contact_phone='05321234567',contact_consent=true where id=$1",[manual]),'42501');
 await fail(()=>as('authenticated',user,"update public.listings set note='restored' where id=$1",[manual]),'42501');
 await fail(()=>as('postgres',admin,"update public.listings set status='active' where id=$1",[wa]),'42501');
 const stats=(await as('authenticated',admin,'select public.nakgo_retention_status() value'))[0].value;
 ok(stats.redacted===2&&stats.held===4&&stats.due===0&&stats.state.last_success_at,'aggregate status reports held and successful cleanup');
 ok(!JSON.stringify(stats).includes('0532')&&!JSON.stringify(stats).includes(user),'monitoring contains no phone or user ID');
 ok(stats.databaseBytes>0&&stats.listingRelationBytes>0&&stats.storageObjectCount===0,'database and object storage measured separately');
 // A held source and failed queue item must survive legacy purge callers too.
 await q("insert into private.wa_sources(message_id,sender,original_text,sent_at,received_at,state) values('synthetic-failed','sender','Unprocessed work',now(),now()-interval '100 days','failed')");
 const heldSource=(await q("insert into private.wa_sources(message_id,sender,original_text,sent_at,received_at,state) values('synthetic-held','sender','Held evidence',now(),now()-interval '100 days','done') returning id"))[0].id;
 await q("insert into private.wa_drafts(source_id,ordinal,fields,issues,confidence,fingerprint,status,listing_id) values($1,1,'{}','[]',1,repeat('b',64),'published',$2)",[heldSource,held]);
 await service('purge');
 ok((await q("select count(*)::int n from private.wa_sources where message_id in ('synthetic-failed','synthetic-held') and original_text is not null"))[0].n===2,'holds and unprocessed queue survive purge');
 const unlinked=(await q("insert into private.wa_sources(message_id,sender,original_text,sent_at,received_at,state) values('synthetic-unlinked','sender','Old private draft',now(),now()-interval '100 days','done') returning id"))[0].id;
 await q("insert into private.wa_drafts(source_id,ordinal,fields,issues,confidence,fingerprint,created_at,updated_at,legal_basis) values($1,1,'{\"contactPhone\":\"+905321234567\",\"company\":\"Synthetic\",\"description\":\"Private text\"}','[]',1,repeat('c',64),now()-interval '100 days',now()-interval '100 days','Synthetic preserved legal basis')",[unlinked]);
 await service('purge');
 const cleanedDraft=(await q('select * from private.wa_drafts where source_id=$1',[unlinked]))[0];
 ok(cleanedDraft.status==='purged'&&Object.keys(cleanedDraft.fields).length===0&&cleanedDraft.legal_basis==='Synthetic preserved legal basis','unpublished legacy retention preserved without deleting basis');
 const truck=(await as('authenticated',user,"insert into public.listings(kind,from_city,to_city,vehicle,body,amount,available_on,contact_phone,contact_consent) values('truck','İstanbul','Ankara','Tır','Tenteli',20,current_date+1,'05321234567',true) returning id"))[0].id;
 await age(truck,31);ok((await redact())[0].n===1,'truck retention works with calendar constraints');
 ok(new Date((await row(truck)).available_on).toISOString().slice(0,10)==='1970-01-01','truck calendar content replaced with archived sentinel');
 await q("insert into storage.objects(bucket_id,name,metadata) values('synthetic','synthetic-only','{\"size\":1024}'),('synthetic','unknown-size','{}')");
 const storageStats=(await as('authenticated',admin,'select public.nakgo_retention_status() value'))[0].value;
 ok(storageStats.storageObjectCount===2&&storageStats.storageMetadataBytes===1024&&storageStats.unprocessedOldSources===1,'storage bytes and stuck old queue observable without content');
 // Bounded batch and backlog; remaining rows are not silently skipped forever.
 const ids=[];for(let i=0;i<101;i++){const id=await create();ids.push(id);await age(id,31);}
 ok((await redact())[0].n===100,'bounded first batch');
 ok((await redact())[0].n===1,'backlog completes on next run');
 ok((await redact())[0].n===0,'empty batch no-op');
 ok((await q('select count(*)::int n from public.listings'))[0].n===109,'no physical listing deletion');
 console.log(checks+' retention PostgreSQL checks passed');await db.close();
})().catch(e=>{console.error(e.message,e.code,e.position,e.internalQuery);process.exitCode=1;});

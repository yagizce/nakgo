/** Local PostgreSQL regression harness. Engine: PGlite via NODE_PATH by default, or a local real PostgreSQL
 * when NAKGO_PG_HOST is set (a throwaway database per run, see db-lib.cjs).
 * Uses synthetic auth/storage schemas; never connects to Supabase or a network database. */
const {openDb,finish,assertTestRoles}=require('./db-lib.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const db=await openDb();let checks=0,primary=null;
 try{
 const check=(condition,label)=>{assert.ok(condition,label);checks++;};
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const as=async(id,sql,args=[],role='authenticated')=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);try{return await query(sql,args);}finally{await db.exec('reset role');}};
 const denied=async(fn,code,label)=>{try{await fn();assert.fail(label+' unexpectedly succeeded');}catch(error){assert.equal(error.code,code,label+': '+error.message);checks++;}};
 const ids=Array.from({length:5},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 const [admin,partner,owner,carrier,unverified]=ids;
 await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text unique,phone text unique,banned_until timestamptz,raw_user_meta_data jsonb not null default '{}');
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,provider text);
 create table auth.refresh_tokens(id bigserial primary key,user_id varchar(255),token text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;`);
 await assertTestRoles(db);
 // Production'daki depo dışı nesne: Supabase panelinin "RLS'yi otomatik aç" ayarı bu fonksiyonu misafir ve üyeye açık oluşturur.
 await db.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path='' as $$begin end$$;
 grant execute on function public.rls_auto_enable() to public,anon,authenticated;`);
 for(const f of fs.readdirSync(path.join(root,'supabase/migrations')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 for(const r of ['public','anon','authenticated'])check(!(await query(`select has_function_privilege($1,'public.rls_auto_enable()','EXECUTE') x`,[r]))[0].x,'rls_auto_enable kapalı: '+r);
 for(const id of ids){await query('insert into auth.users values($1,$2)',[id,id===unverified?null:new Date().toISOString()]);await as(id,"insert into public.profiles(id,display_name,account_type) values($1,$2,'carrier')",[id,id===owner?'Test Owner':'Test User']);}
 await query('insert into private.admin_members(user_id,active) values($1,true),($2,false),($3,false)',[admin,partner,unverified]);
 const page=(id,section='users')=>as(id,'select public.nakgo_admin_page($1,0,\'\') data',[section]);
 const moderate=(id,kind,target,action,rev=0,reason='Synthetic test reason')=>as(id,'select public.nakgo_admin_moderate($1,$2,$3,$4,$5) data',[kind,String(target),action,reason,rev]);
 check((await page(admin))[0].data.length===5,'admin sees users');await denied(()=>page(partner),'42501','other account has no general admin access');
 check((await as(admin,'select public.nakgo_admin_role() authorized'))[0].authorized===true,'single administrator role true');
 check((await as(owner,'select public.nakgo_admin_role() authorized'))[0].authorized===false,'ordinary account role false');
 // Several administrators are allowed, but only through nakgo_admin_moderate by an active administrator (see accounts-admins.sql).
 await denied(()=>as(partner,'update private.admin_members set active=true where user_id=$1',[partner]),'42501','member cannot activate itself');
 await denied(()=>page(owner),'42501','ordinary user cannot read panel');await denied(()=>page(unverified),'42501','unverified member cannot read panel');
 await denied(()=>as(null,"select public.nakgo_admin_page('overview',0,'')",[],'anon'),'42501','anonymous panel access denied');
 await denied(()=>as(owner,'insert into private.admin_members(user_id) values($1)',[owner]),'42501','cannot self-grant');
 await denied(()=>moderate(owner,'user',carrier,'suspend'),'42501','ordinary mutation denied');
 await denied(()=>moderate(admin,'user',admin,'suspend'),'42501','protect active administrator');
 await denied(()=>moderate(admin,'user',admin,'suspend'),'42501','protect self');
 await denied(()=>moderate(admin,'user',owner,'suspend',0,'x'),'22023','reason required');
 const createListing=async id=>(await as(id,"insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on) values('load','İzmir','Manisa','Tır','Tenteli',10,'Test','Owner',current_date+2) returning id"))[0].id;
 const listing=await createListing(owner);
 const moderated=await moderate(admin,'listing',listing,'remove');check(moderated[0].data.revision===1,'listing removal advances revision');
 check((await as(carrier,'select id from public.listings where id=$1',[listing])).length===0,'removed listing hidden from other users');
 await denied(()=>as(owner,"update public.listings set status='active' where id=$1",[listing]),'42501','owner cannot republish removed listing');
 await denied(()=>moderate(admin,'listing',listing,'restore',0),'40001','stale partner rejected');
 await moderate(admin,'listing',listing,'restore',1);
 check((await query('select status from public.listings where id=$1',[listing]))[0].status==='closed','restored listing stays closed');
 await as(owner,"update public.listings set status='active' where id=$1",[listing]);
 check((await moderate(admin,'user',carrier,'suspend'))[0].data.revision===1,'suspend account');
 await denied(()=>createListing(carrier),'42501','suspended listing creation denied');
 await denied(()=>as(carrier,"update public.profiles set display_name='Changed' where id=$1",[carrier]),'42501','suspended profile mutation denied');
 await denied(()=>as(carrier,'select public.nakgo_set_favorite($1,true)',[listing]),'42501','suspended favorite insert denied');
 await denied(()=>moderate(admin,'user',carrier,'resume',0),'40001','stale account action rejected');
 await moderate(admin,'user',carrier,'resume',1);
 await as(carrier,'select public.nakgo_set_favorite($1,true)',[listing]);
 check((await query('select count(*)::int n from public.listing_favorites where user_id=$1',[carrier]))[0].n===1,'resumed favorite succeeds');
 const auditBefore=(await page(admin,'moderation'))[0].data.length;
 check((await moderate(admin,'user',carrier,'resume',2))[0].data.changed===false,'same-state retry is no-op');
 check((await page(admin,'moderation'))[0].data.length===auditBefore,'no duplicate audit for no-op');
 check(auditBefore===4,'audit contains only four successful changes');
 await denied(()=>as(owner,'select * from private.admin_audit'),'42501','audit private');
 await denied(()=>as(admin,'select public.nakgo_admin_page(\'users\',-1,\'\')'),'22023','negative page denied');
 await query('update private.admin_members set active=false where user_id=$1',[admin]);
 await denied(()=>page(admin),'42501','revoked administrator denied on next request');
 await denied(()=>moderate(admin,'user',owner,'suspend'),'42501','revoked administrator mutation denied');
 check((await as(admin,'select public.nakgo_admin_role() authorized'))[0].authorized===false,'revoked administrator role false');
 await query('update private.admin_members set active=true where user_id=$1',[admin]);
 // Execute the repository SQL fixtures against the complete migrated schema.
 // Counts must match after every fixture's ROLLBACK; sequences may advance.
 const inventory=async()=>JSON.stringify((await query(`select
  (select count(*) from auth.users) users,
  (select count(*) from public.profiles) profiles,
  (select count(*) from public.listings) listings,
  (select count(*) from public.transport_jobs) jobs,
  (select count(*) from public.listing_favorites) favorites,
  (select count(*) from public.listing_conversations) conversations,
  (select count(*) from public.conversation_messages) messages,
  (select count(*) from public.carrier_applications) applications,
  (select count(*) from public.carrier_document_files) files,
  (select count(*) from storage.objects) objects,
  (select count(*) from private.admin_members where active) active_admins`))[0]);
 for(const fixture of fs.readdirSync(path.join(root,'supabase/tests')).filter(f=>f.endsWith('.sql')).sort()){
  await db.exec('reset role');await query("select set_config('request.jwt.claim.sub','',false)");
  const before=await inventory();
  try{await db.exec(fs.readFileSync(path.join(root,'supabase/tests',fixture),'utf8'));}
  catch(error){await db.exec('rollback;reset role').catch(()=>{});throw Error(fixture+': '+error.message,{cause:error});}
  assert.equal(await inventory(),before,fixture+' must roll back its fixtures');
  console.log('SQL fixture PASS: '+fixture+'; rows unchanged after rollback');
 }
 console.log(checks+' PostgreSQL moderation checks passed ('+db.engine+'; synthetic auth/storage; not live Supabase).');
 }catch(error){primary=error;throw error;}
 finally{await finish(db,primary);}
 await require('./storage-service-check.cjs');
})().catch(error=>{console.error(error);process.exitCode=1;});

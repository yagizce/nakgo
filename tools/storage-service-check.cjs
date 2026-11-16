const {openDb}=require('./db-lib.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=(async()=>{
 const db=await openDb();let checks=0;
 const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const check=(v,msg)=>{assert.ok(v,msg);checks++;};
 const denied=async(fn,msg)=>{try{await fn();assert.fail(msg+' unexpectedly allowed');}catch(e){assert.equal(e.code,'42501',msg+': '+e.message);checks++;}};
 const as=async(role,id,sql,args=[])=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);try{return await q(sql,args);}finally{await db.exec('reset role');}};
 await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
 create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text,phone text,banned_until timestamptz,raw_user_meta_data jsonb not null default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,service_role;`);
 const root=path.resolve(__dirname,'..');
 for(const f of fs.readdirSync(path.join(root,'supabase/migrations')).sort()){
  if(process.argv.includes('--legacy')&&(f==='20261027010000_storage_service_activity.sql'||f==='20261115181551_document_storage_cleanup.sql'))continue;
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 }
 for(const id of [owner,other]){await q('insert into auth.users(id,email_confirmed_at) values($1,now())',[id]);await as('authenticated',id,"insert into public.profiles(id,display_name,account_type) values($1,'Synthetic','carrier')",[id]);}
 // Legacy document rows are seeded directly: the upload RPCs are not part of the product.
 await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const app=(await q("insert into public.carrier_applications(owner_id,owner_label,license_class) values($1,'Synthetic','CE') returning id",[owner]))[0].id;
 let serial=10;
 const reserve=async kind=>{const id='00000000-0000-4000-8000-'+String(++serial).padStart(12,'0');await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  return (await q("insert into public.carrier_document_files(id,application_id,owner_id,kind,object_path) values($1::uuid,$2::bigint,$3::uuid,$4,$3::text||'/'||$2::text||'/'||$1::text||'.jpg') returning *",[id,app,owner,kind]))[0];};
 const file=await reserve('src');
 const insert=(role,id,ownerID=owner,name=file.object_path)=>as(role,id,"insert into storage.objects(bucket_id,name,owner_id,metadata) values('carrier-documents',$1,$2,'{\"mimetype\":\"image/jpeg\",\"size\":100}') returning id",[name,ownerID]);
 if(process.argv.includes('--legacy')){await denied(()=>insert('service_role',null),'legacy trusted completion rejected with no JWT sub');console.log('REPRODUCED: legacy guard rejects internal Storage completion');await db.close();return;}
 await denied(()=>insert('authenticated',null),'missing caller rejected');
 await denied(()=>insert('authenticated',other),'other caller denied by unchanged RLS');
 await denied(()=>insert('service_role',null,other),'trusted completion owner mismatch');
 await denied(()=>insert('service_role',null,owner,'unreserved.jpg'),'trusted completion unreserved path');
 await insert('service_role',null);checks++;
 check((await q('select count(*)::int n from storage.objects'))[0].n===1,'trusted completion stored the object');
 check((await as('authenticated',other,'select count(*)::int n from storage.objects'))[0].n===0,'other user cannot read');
 await q('insert into private.account_moderation(user_id,suspended) values($1,true)',[owner]);
 await denied(()=>as('service_role',null,"update storage.objects set metadata=metadata where name=$1",[file.object_path]),'suspended internal completion denied');
 await denied(()=>as('service_role',null,"delete from storage.objects where name=$1",[file.object_path]),'suspended internal delete denied');
 await q('update private.account_moderation set suspended=false where user_id=$1',[owner]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await q("update public.carrier_applications set status='submitted' where id=$1",[app]);
 await denied(()=>as('service_role',null,"update storage.objects set metadata=metadata where name=$1",[file.object_path]),'submitted completion denied');
 await denied(()=>as('service_role',null,"delete from storage.objects where name=$1",[file.object_path]),'submitted internal delete denied');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await q("update public.carrier_applications set status='draft' where id=$1",[app]);
 await denied(()=>as('service_role',null,"update storage.objects set name='moved.jpg' where name=$1",[file.object_path]),'internal rename denied');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await q("update public.carrier_document_files set created_at=now()-interval '25 hours' where id=$1",[file.id]);
 await denied(()=>as('service_role',null,"update storage.objects set metadata=metadata where name=$1",[file.object_path]),'expired reservation denied');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await q('update public.carrier_document_files set created_at=now() where id=$1',[file.id]);
 await as('service_role',null,'delete from storage.objects where name=$1',[file.object_path]);checks++;
 check((await q('select count(*)::int n from storage.objects'))[0].n===0,'draft internal delete completed');
 // Account erasure: the document row goes, the file is queued and only a trusted role can remove it.
 const kept=await reserve('kb');
 await insert('service_role',null,owner,kept.object_path);checks++;
 await as('authenticated',owner,'select public.nakgo_delete_my_account()');
 check((await q('select count(*)::int n from public.carrier_document_files where owner_id=$1',[owner]))[0].n===0,'erasure removes document rows');
 check((await q('select count(*)::int n from private.storage_cleanup where object_path=$1 and done_at is null',[kept.object_path]))[0].n===1,'erasure queues the stored file');
 await denied(()=>as('authenticated',other,'select * from public.nakgo_storage_cleanup_pending(10)'),'users cannot read the cleanup queue');
 await denied(()=>as('anon',null,"select public.nakgo_storage_cleanup_result('carrier-documents',$1,true)",[kept.object_path]),'anon cannot mark cleanup');
 check((await as('authenticated',other,'delete from storage.objects where name=$1 returning id',[kept.object_path])).length===0,'other user cannot delete queued file');
 check((await as('authenticated',owner,'delete from storage.objects where name=$1 returning id',[kept.object_path])).length===0,'erased owner cannot delete queued file');
 check((await as('service_role',null,'select * from public.nakgo_storage_cleanup_pending(10)')).some(r=>r.object_path===kept.object_path),'service role sees pending file');
 await as('service_role',null,"select public.nakgo_storage_cleanup_result('carrier-documents',$1,false,'network')",[kept.object_path]);
 check((await q('select attempts,last_error,done_at from private.storage_cleanup where object_path=$1',[kept.object_path]))[0].last_error==='network','failed delete stays queued with its error');
 await as('service_role',null,'delete from storage.objects where name=$1',[kept.object_path]);checks++;
 await as('service_role',null,"select public.nakgo_storage_cleanup_result('carrier-documents',$1,true)",[kept.object_path]);
 check((await q('select count(*)::int n from storage.objects where name=$1',[kept.object_path]))[0].n===0,'queued file removed by trusted role');
 check(!(await as('service_role',null,'select * from public.nakgo_storage_cleanup_pending(10)')).some(r=>r.object_path===kept.object_path),'cleaned file leaves the queue');
 await denied(()=>as('service_role',null,"insert into storage.objects(bucket_id,name,owner_id) values('carrier-documents',$1,$2)",[kept.object_path,owner]),'done entry does not allow re-upload');
 console.log('PASS: '+checks+' Storage service-context checks');await db.close();
})().catch(e=>{console.error(e.message);process.exit(1);});

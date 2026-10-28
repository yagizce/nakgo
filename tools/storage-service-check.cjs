const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=(async()=>{
 const db=new PGlite();let checks=0;
 const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const check=(v,msg)=>{assert.ok(v,msg);checks++;};
 const denied=async(fn,msg)=>{try{await fn();assert.fail(msg+' unexpectedly allowed');}catch(e){assert.equal(e.code,'42501',msg+': '+e.message);checks++;}};
 const as=async(role,id,sql,args=[])=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);try{return await q(sql,args);}finally{await db.exec('reset role');}};
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,service_role;`);
 const root=path.resolve(__dirname,'..');
 for(const f of fs.readdirSync(path.join(root,'supabase/migrations')).sort()){
  if(process.argv.includes('--legacy')&&f==='20261027010000_storage_service_activity.sql')continue;
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 }
 for(const id of [owner,other]){await q('insert into auth.users values($1,now())',[id]);await as('authenticated',id,"insert into public.profiles(id,display_name,account_type) values($1,'Synthetic','carrier')",[id]);}
 const app=(await as('authenticated',owner,"select (public.nakgo_create_carrier_application('CE')).id"))[0].id;
 let serial=10;
 const reserve=async()=> (await as('authenticated',owner,"select (public.nakgo_reserve_document($1,'src',$2)).*",[app,'00000000-0000-4000-8000-'+String(++serial).padStart(12,'0')]))[0];
 const file=await reserve();
 const insert=(role,id,ownerID=owner,name=file.object_path)=>as(role,id,"insert into storage.objects(bucket_id,name,owner_id,metadata) values('carrier-documents',$1,$2,'{\"mimetype\":\"image/jpeg\",\"size\":100}') returning id",[name,ownerID]);
 if(process.argv.includes('--legacy')){await denied(()=>insert('service_role',null),'legacy trusted completion rejected with no JWT sub');console.log('REPRODUCED: legacy guard rejects internal Storage completion');await db.close();return;}
 await denied(()=>insert('authenticated',null),'missing caller rejected');
 await denied(()=>insert('authenticated',other),'other caller denied by unchanged RLS');
 await denied(()=>insert('service_role',null,other),'trusted completion owner mismatch');
 await denied(()=>insert('service_role',null,owner,'unreserved.jpg'),'trusted completion unreserved path');
 await insert('service_role',null);checks++;
 check((await as('authenticated',owner,'select count(*)::int n from storage.objects'))[0].n===1,'owner reads completed object');
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
 console.log('PASS: '+checks+' Storage service-context checks');await db.close();
})().catch(e=>{console.error(e.message);process.exit(1);});

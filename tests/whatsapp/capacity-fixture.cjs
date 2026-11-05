'use strict';
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path');
module.exports=async()=>{
 const db=new PGlite();const q=async(s,a=[])=>(await db.query(s,a)).rows;
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

 return {db,q,admin,user};
};

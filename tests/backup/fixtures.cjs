/** B7 testleri için sentetik veri. Gerçek kullanıcı verisi yok; telefonlar ve e-postalar uydurma.
 * Yerel Auth taklidini Supabase'e biraz daha yaklaştırır: auth.mfa_factors (enum tipleriyle) ve auth.schema_migrations.
 * Bu ekler yalnız testte ve geçici veritabanında yapılır; db-lib'in ortak taklidi değişmez. */
'use strict';
const crypto=require('node:crypto');

const AUTH_EXTRAS=`
do $$ begin
  if to_regtype('auth.factor_type') is null then create type auth.factor_type as enum ('totp','webauthn','phone'); end if;
  if to_regtype('auth.factor_status') is null then create type auth.factor_status as enum ('unverified','verified'); end if;
end $$;
create table if not exists auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,factor_type auth.factor_type not null,status auth.factor_status not null,secret text,created_at timestamptz not null default now());
create table if not exists auth.schema_migrations(version varchar(255) primary key);
insert into auth.schema_migrations values ('20261030120000') on conflict do nothing;
alter table auth.mfa_factors enable row level security;
alter table auth.schema_migrations enable row level security;`;

/** Kullanıcılar, profiller, ilanlar, favoriler, rota alarmları ve bir MFA faktörü. Döndürür: kullanıcı kimlikleri. */
async function seed(db,{users=4,listingsPerUser=2}={}){
  await db.exec(AUTH_EXTRAS);
  const ids=[];
  for(let i=0;i<users;i++){
    const id=crypto.randomUUID();ids.push(id);
    await db.query(`insert into auth.users(id,email_confirmed_at,email) values($1,now(),$2)`,[id,`test${i}@example.invalid`]);
    await db.query(`insert into auth.identities(user_id,provider) values($1,$2)`,[id,i%2?'google':'email']);
  }
  for(const [i,id] of ids.entries()){
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);
    await db.exec(`set role authenticated`);
    try{
      await db.query(`insert into public.profiles(id,display_name,account_type) values($1,$2,'owner')`,[id,'Test '+i]);
      for(let k=0;k<listingsPerUser;k++){
        await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent)
          values('load','İstanbul','Ankara','Tır','Tenteli',$1,'Test yük','Test '||$2::text,'bugün','+905000000000',true)`,[100+k,i]);
      }
    }finally{await db.exec(`reset role`);}
  }
  const l=(await db.query(`select id from public.listings order by id limit 1`)).rows[0].id;
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[ids[1]]);
  await db.exec(`set role authenticated`);
  try{await db.query(`select public.nakgo_set_favorite($1,true)`,[l]);await db.query(`select public.nakgo_save_route_alert('load','Ankara',null,null,null)`);}
  finally{await db.exec(`reset role`);await db.query(`select set_config('request.jwt.claim.sub','',false)`);}
  await db.query(`insert into auth.mfa_factors(user_id,friendly_name,factor_type,status,secret) values($1,'test','totp','verified','TESTONLYSECRET')`,[ids[0]]);
  await db.query(`insert into auth.sessions(user_id) values($1)`,[ids[0]]);
  return ids;
}

module.exports={AUTH_EXTRAS,seed};

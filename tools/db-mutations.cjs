/** Veritabanı kurallarının kasıtlı bozma denetimi (B2 telefon görüntüleme sınırı). Her kural tek tek bozulur, ilgili test
 * dosyası çalıştırılır ve bozmanın yakalandığı doğrulanır. Dosya her denemeden sonra geri yazılır. Elle çalıştırılır:
 *   NODE_PATH=... NAKGO_PG_HOST=... node tools/db-mutations.cjs     (eşzamanlılık bozmaları gerçek PostgreSQL ister)
 * Çıkış kodu: kaçan bozma varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const MIG='supabase/migrations/20261118020000_b2_contact_limit.sql';
const DB=['--test','tests/db/contact-limit.test.cjs'],UNIT=['tests/run.js'];
const MUTATIONS=[
  [MIG,"perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7311));","",DB],
  [MIG,"if in_hour>=30 or in_day>=100 then","if in_hour>=31 or in_day>=100 then",DB],
  [MIG,"if in_hour>=30 or in_day>=100 then","if in_hour>=30 or in_day>=101 then",DB],
  [MIG,"filter(where viewed_at>t-interval '60 minutes')","filter(where viewed_at>t-interval '30 minutes')",DB],
  [MIG,"where user_id=actor and viewed_at>t-interval '24 hours';","where user_id=actor and viewed_at>t-interval '12 hours';",DB],
  [MIG,"if not exists(select 1 from private.contact_views where user_id=actor and listing_id=p_id) then","if true then",DB],
  [MIG,"   on conflict(user_id,kind,hour) do nothing;\n   return null;","   on conflict(user_id,kind,hour) do nothing;\n   return l.contact_phone;",DB],
  [MIG,"   insert into private.security_events(user_id,kind,hour)\n   values(actor,case when in_day>=100 then 'contact_limit_day' else 'contact_limit_hour' end,date_trunc('hour',t,'UTC'))\n   on conflict(user_id,kind,hour) do nothing;\n","",DB],
  [MIG,"case when in_day>=100 then 'contact_limit_day' else 'contact_limit_hour' end","'contact_limit_hour'",DB],
  [MIG,"date_trunc('hour',t,'UTC'))\n   on conflict","date_trunc('second',clock_timestamp(),'UTC'))\n   on conflict",DB],
  [MIG,"insert into private.contact_views(user_id,listing_id,viewed_at) values(actor,p_id,t);","",DB],
  [MIG," if tg_op='UPDATE' then raise exception 'Security events are append-only' using errcode='42501'; end if;","",DB],
  [MIG," if tg_op='TRUNCATE' then raise exception 'Security events cannot be truncated' using errcode='42501'; end if;"," if tg_op='TRUNCATE' then return null; end if;",DB],
  [MIG," if old.at>statement_timestamp()-interval '1 year' then raise",' if false then raise',DB],
  [MIG,"delete from private.security_events where at<statement_timestamp()-interval '1 year';","delete from private.security_events where at<statement_timestamp()-interval '300 days';",DB],
  [MIG,"delete from private.contact_views where viewed_at<statement_timestamp()-interval '25 hours';","delete from private.contact_views where viewed_at<statement_timestamp()-interval '23 hours';",DB],
  [MIG,"revoke all on private.contact_views,private.security_events from public,anon,authenticated;","grant select on private.contact_views,private.security_events to authenticated;",DB],
  [MIG,"revoke all on function private.contact_retention(),private.security_events_immutable() from public,anon,authenticated;","",DB],
  [MIG,"user_id uuid not null references auth.users(id) on delete cascade,","user_id uuid not null,",DB],
  [MIG,"  if f not in('''',''contact_limit_hour'',''contact_limit_day'') then raise exception ''Invalid query'' using errcode=''22023''; end if;\\n'","'",DB],
  ['src/js/screens/details.js','if (raw === null) return toast(','if (false) return toast(',UNIT],
];
let escaped=0;
for(const [file,from,to,args] of MUTATIONS){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+file+' '+from.slice(0,60));
  fs.writeFileSync(file,src.replace(from,to));
  let caught;
  try{
    if(file.startsWith('src/'))spawnSync(process.execPath,['tools/bundle.js'],{encoding:'utf8'});
    const r=spawnSync(process.execPath,args,{encoding:'utf8',env:process.env});
    caught=r.status!==0;
  }finally{fs.writeFileSync(file,src);if(file.startsWith('src/'))spawnSync(process.execPath,['tools/bundle.js'],{encoding:'utf8'});}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.replace(/\s+/g,' ').slice(0,70));
}
console.log(`kaçan: ${escaped} / ${MUTATIONS.length}`);
process.exitCode=escaped?1:0;

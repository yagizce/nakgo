/** B3-b2 hesap okuma uçlarının kasıtlı bozma denetimi; tests/db/api-v1-account.test.cjs (ve varsa HTTP testi) yakalamalı.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-account-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118060000_b3b2_api_account.sql';
const TESTS=['--test','tests/db/api-v1-account.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-account-http.test.cjs']:[])];
const M=[
  [" select * into p from public.profiles where id=actor;"," select * into p from public.profiles order by id limit 1;"],
  ["'about',p.about,'phone',p.phone));","'about',p.about,'phone',p.phone,'id',p.id));"],
  ["   where f.user_id=actor and (c is null or f.listing_id<c) order by f.listing_id desc limit 51) f) s","   where (c is null or f.listing_id<c) order by f.listing_id desc limit 51) f) s"],
  ["  and (exists(select 1 from private.api_visible_listings v where v.id=l.id) or (l.owner_id=actor and l.redacted_at is null));",";"],
  ["or (l.owner_id=actor and l.redacted_at is null));","or (l.owner_id=actor));"],
  ["or (l.owner_id=actor and l.redacted_at is null));","or (l.redacted_at is null));"],
  ["private.api_listing_json(l,true,actor,false) end)","private.api_listing_json(l,true,actor,true) end)"],
  ["   where x.user_id=actor and (c is null or x.listing_id<c) order by x.listing_id desc limit 201) x) f;","   where (c is null or x.listing_id<c) order by x.listing_id desc limit 201) x) f;"],
  ["   where x.user_id=actor and (c is null or x.id<c) order by x.id desc limit 21) x) a;","   where (c is null or x.id<c) order by x.id desc limit 21) x) a;"],
  ["filter(where a.rn<=20),'[]'::jsonb),\n  min(a.id) filter(where a.rn<=20)","filter(where a.rn<=21),'[]'::jsonb),\n  min(a.id) filter(where a.rn<=21)"],
  ["grant execute on function api.profile_v1(),api.favorites_v1(text),api.favorite_ids_v1(text),api.route_alerts_v1(text) to authenticated;","grant execute on function api.profile_v1(),api.favorites_v1(text),api.favorite_ids_v1(text),api.route_alerts_v1(text) to anon,authenticated;"],
  [" perform private.api_begin('route_alerts_v1');\n actor:=private.api_actor(false);"," perform private.api_begin('route_alerts_v1');\n actor:=auth.uid();"],
];
let escaped=0;
for(const [from,to] of M){
  const src=fs.readFileSync(F,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,70));
  fs.writeFileSync(F,src.replace(from,to));
  let caught;
  try{caught=spawnSync(process.execPath,TESTS,{encoding:'utf8',env:process.env}).status!==0;}
  finally{fs.writeFileSync(F,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+from.replace(/\s+/g,' ').slice(0,90));
}
console.log(`kaçan: ${escaped} / ${M.length}`);
process.exitCode=escaped?1:0;

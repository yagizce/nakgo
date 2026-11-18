/** B3-b1 ilan okuma uçlarının kasıtlı bozma denetimi: görünürlük, alan, sayfalama ve yetki kuralları tek tek bozulur;
 * tests/db/api-v1-listings.test.cjs (ve varsa yerel PostgREST testi) bunu yakalamalı. Dosya her denemeden sonra geri yazılır.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-listings-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118050000_b3b1_api_listings.sql';
const TESTS=['--test','tests/db/api-v1-listings.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-listings-http.test.cjs']:[])];
const M=[
  ["where l.status='active' and l.expires_at>now()\n  and (l.loading_text","where l.status='active'\n  and (l.loading_text"],
  ["  and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)\n  and not exists","  and not exists"],
  ["  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)\n",""],
  ["  and not private.account_suspended(l.owner_id);","  and true;"],
  ["'status',l.status,'created_at',private.api_ts(l.created_at),'has_photo',l.image_data<>'')","'status',l.status,'created_at',private.api_ts(l.created_at),'has_photo',l.image_data<>'','owner_label',l.owner_label)"],
  ["||case when p_member and p_detail then","||case when p_member then"],
  ["'mine',l.owner_id=p_actor,","'mine',true,"],
  ["'contact_allowed',l.contact_consent) else","'contact_allowed',l.contact_consent,'phone',l.contact_phone) else"],
  [" if auth.uid() is null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then return null; end if;"," if auth.uid() is null then return null; end if;"],
  ["where (c is null or v.id<c) and (p_kind is null or v.kind=p_kind) order by v.id desc limit 51) v) s","where (c is null or v.id<c) and (p_kind is null or v.kind=p_kind) order by v.id limit 51) v) s"],
  ["filter(where s.rn<=50),'[]'::jsonb),\n  min(l.id) filter(where s.rn<=50),count(*)\n into","filter(where s.rn<=49),'[]'::jsonb),\n  min(l.id) filter(where s.rn<=49),count(*)\n into"],
  ["return private.api_page(items,case when n>50 then last end);\nend $$;\n\n-- Ayrıntı","return private.api_page(items,null);\nend $$;\n\n-- Ayrıntı"],
  ["where (c is null or v.id<c) and (p_kind is null or v.kind=p_kind)","where (c is null or v.id<=c) and (p_kind is null or v.kind=p_kind)"],
  ["and (p_kind is null or v.kind=p_kind) order by v.id desc limit 51","order by v.id desc limit 51"],
  ["or (actor is not null and l.owner_id=actor and l.redacted_at is null));","or (actor is not null and l.owner_id=actor));"],
  ["or (actor is not null and l.owner_id=actor and l.redacted_at is null));","or (actor is not null and l.redacted_at is null));"],
  ["   where x.owner_id=actor and x.redacted_at is null and (c is null or x.id<c)","   where x.redacted_at is null and (c is null or x.id<c)"],
  ["   where x.owner_id=actor and x.redacted_at is null and (c is null or x.id<c)","   where x.owner_id=actor and (c is null or x.id<c)"],
  ["return private.api_page(items,case when n>50 then last end);\nend $$;\n\nrevoke","return private.api_page(items,null);\nend $$;\n\nrevoke"],
  ["grant execute on function api.my_listings_v1(text) to authenticated;","grant execute on function api.my_listings_v1(text) to anon,authenticated;"],
  [" if p_id is null or p_id<1 then perform private.api_raise('invalid_argument'); end if;",""],
  [" if p_kind is not null and p_kind not in('load','truck') then perform private.api_raise('invalid_argument'); end if;",""],
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

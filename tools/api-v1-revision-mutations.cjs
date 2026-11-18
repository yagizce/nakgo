/** B3-c2 tamsayı revision'ın kasıtlı bozma denetimi; tests/db/api-v1-revision.test.cjs ve tests/db/api-v1-write.test.cjs
 * (varsa HTTP testi) yakalamalı. Eşzamanlılık bozması (FOR UPDATE) yalnız gerçek PostgreSQL'de yakalanır.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-revision-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118080000_b3c2_listing_revision.sql';
const TESTS=['--test','tests/db/api-v1-revision.test.cjs','tests/db/api-v1-write.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-write-http.test.cjs']:[])];
const real=Boolean(process.env.NAKGO_PG_HOST);
const M=[
  [" if tg_op='INSERT' then new.revision:=0; else new.revision:=old.revision+1; end if;"," if tg_op='UPDATE' and new.revision=old.revision then new.revision:=old.revision+1; end if;"],
  [" if tg_op='INSERT' then new.revision:=0; else new.revision:=old.revision+1; end if;"," if tg_op='INSERT' then new.revision:=0; else new.revision:=old.revision+2; end if;"],
  ["create trigger listings_revision before insert or update on public.listings","create trigger listings_revision before insert on public.listings"],
  [" if r.revision<>p_revision then perform private.api_raise('conflict'); end if;\n",""],
  [" if r.revision<>p_revision then"," if r.revision<p_revision then"],
  ["p_revision is null or p_revision<0 or","p_revision is null or"],
  ["   'revision',case when l.owner_id=p_actor then l.revision end)","   'revision',l.revision)"],
  [" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;"," select * into r from public.listings l where l.id=p_id and l.redacted_at is null for update;"],
  [" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;"," select * into r from public.listings l where l.id=p_id and l.owner_id=actor for update;"],
  ...(real?[[" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;"," select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null;"]]:[]),
  ["not keys <@ (private.api_listing_fields()||'status'::text)","not keys <@ (private.api_listing_fields()||'status'::text||'revision'::text||'kind'::text)"],
  ["grant execute on function api.listing_update_v1(bigint,bigint,jsonb) to authenticated;","grant execute on function api.listing_update_v1(bigint,bigint,jsonb) to anon,authenticated;"],
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

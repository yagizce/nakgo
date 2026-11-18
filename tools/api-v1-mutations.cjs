/** API v1 çerçevesinin kasıtlı bozma denetimi: yardımcıların her kuralı tek tek bozulur ve tests/db/api-v1.test.cjs'in
 * (ve varsa yerel PostgREST testinin) bunu yakaladığı doğrulanır. Dosya her denemeden sonra geri yazılır.
 * Elle:  NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-mutations.cjs   Çıkış: kaçan varsa 1.
 * Yetki, ad, SECURITY DEFINER ve search_path bozmaları tools/contract-mutations.cjs içindedir (CI'da çalışır). */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118040000_b3a_api_framework.sql';
const TESTS=['--test','tests/db/api-v1.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-http.test.cjs']:[])];
const MUTATIONS=[
  ["if actor is null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then","if actor is null then"],
  ["if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then perform private.api_raise('account_unverified'); end if;",""],
  ["  if private.account_suspended(actor) then perform private.api_raise('account_suspended'); end if;\n  begin perform private.require_activity(actor);\n  exception when insufficient_privilege then perform private.api_raise('account_suspended');\n  end;",""],
  ["if not private.is_nakgo_admin() then perform private.api_raise('admin_required'); end if;",""],
  ["if not p_allow_disabled and not coalesce((select v1_enabled from private.api_settings where id=1),false) then perform private.api_raise('api_disabled'); end if;",""],
  [" on conflict(hour,version,fn,shard) do update set calls=private.api_usage.calls+1;"," on conflict(hour,version,fn,shard) do nothing;"],
  ["if p_cursor !~ '^[1-9][0-9]{0,15}$' then perform private.api_raise('invalid_cursor'); end if;",""],
  ["raise exception using errcode=e.sqlstate,message=e.key,detail=e.detail,hint='nakgo.api';","raise exception using errcode=e.sqlstate,message=e.detail,detail=e.key,hint='nakgo.api';"],
  ["if not found then raise exception 'unknown api error key: %',p_key using errcode='XX000'; end if;",""],
  ["revoke all on function private.api_raise(text),private.api_begin(text,boolean),private.api_actor(boolean),private.api_admin(),","grant execute on function private.api_actor(boolean) to authenticated; revoke all on function private.api_raise(text),private.api_begin(text,boolean),private.api_admin(),"],
  ["revoke all on private.api_errors,private.api_settings,private.api_usage from public,anon,authenticated;","grant select on private.api_usage to authenticated;"],
  [" perform private.api_begin('status_v1',true);"," perform private.api_begin('status_v1');"],
  ["select jsonb_build_object('data',coalesce(p_items,'[]'::jsonb),'page',jsonb_build_object('next',case when p_next is null then null else p_next::text end))","select jsonb_build_object('data',coalesce(p_items,'[]'::jsonb),'next',p_next)"],
  ["delete from private.api_usage where hour<now()-interval '400 days';","delete from private.api_usage where hour<now()-interval '40 days';"],
];
let escaped=0;
for(const [from,to] of MUTATIONS){
  const src=fs.readFileSync(F,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,60));
  fs.writeFileSync(F,src.replace(from,to));
  let caught;
  try{caught=spawnSync(process.execPath,TESTS,{encoding:'utf8',env:process.env}).status!==0;}
  finally{fs.writeFileSync(F,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+from.replace(/\s+/g,' ').slice(0,90));
}
console.log(`kaçan: ${escaped} / ${MUTATIONS.length}`);
process.exitCode=escaped?1:0;

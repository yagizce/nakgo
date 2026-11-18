/** B3-c yazma uçlarının kasıtlı bozma denetimi; tests/db/api-v1-write.test.cjs (ve varsa HTTP testi) yakalamalı.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-write-mutations.cjs   Çıkış: kaçan varsa 1.
 * Eşzamanlılık bozmaları (FOR UPDATE) yalnız gerçek PostgreSQL'de yakalanır; PGlite'ta atlanır. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118070000_b3c_api_write.sql';
const TESTS=['--test','tests/db/api-v1-write.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-write-http.test.cjs']:[])];
const real=Boolean(process.env.NAKGO_PG_HOST);
const M=[
  // Kimlik ve hesap durumu
  [" perform private.api_begin('listing_create_v1');\n actor:=private.api_actor(true);"," perform private.api_begin('listing_create_v1');\n actor:=auth.uid();"],
  [" perform private.api_begin('favorite_remove_v1');\n actor:=private.api_actor(false);"," perform private.api_begin('favorite_remove_v1');\n actor:=private.api_actor(true);"],
  [" perform private.api_begin('route_alert_delete_v1');\n actor:=private.api_actor(false);"," perform private.api_begin('route_alert_delete_v1');\n actor:=private.api_actor(true);"],
  [" perform private.api_begin('profile_update_v1');\n actor:=private.api_actor(true);"," perform private.api_begin('profile_update_v1');\n actor:=auth.uid();"],
  // İlan oluşturma: beyaz liste, sahip, ad, durum, tekrar
  ["or not keys <@ (private.api_listing_fields()||'kind'::text) or","or"],
  ["  'available_time','loading_text','items','image_data','contact_phone','contact_consent'] $$;","  'available_time','loading_text','items','image_data','contact_phone','contact_consent','owner_label','expires_at'] $$;"],
  ["select $1,$2,''active'',x.kind%s","select $1,$2,''closed'',x.kind%s"],
  ["using actor,coalesce(label,'NakGo kullanıcısı'),p_listing into r;","using actor,'NakGo kullanıcısı',p_listing into r;"],
  ["  if q.fn<>'listing_create_v1' or q.body_md5<>h then perform private.api_raise('conflict'); end if;","  if q.fn<>'listing_create_v1' then perform private.api_raise('conflict'); end if;"],
  [" insert into private.api_requests(user_id,request_id,fn,body_md5) values(actor,p_request_id,'listing_create_v1',h) on conflict do nothing;\n if not found then"," if false then"],
  [" update private.api_requests set ref=r.id where user_id=actor and request_id=p_request_id;\n",""],
  ["begin delete from private.api_requests where created_at<now()-interval '24 hours';","begin delete from private.api_requests where created_at<now()-interval '24 days';"],
  // Güncelleme: sahiplik, karartma, revision, kilit, beyaz liste
  [" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts",
   " select * into r from public.listings l where l.id=p_id and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts"],
  [" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts",
   " select * into r from public.listings l where l.id=p_id and l.owner_id=actor for update;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts"],
  [" if private.api_ts(r.updated_at)<>p_revision then perform private.api_raise('conflict'); end if;\n",""],
  ...(real?[[" select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts",
   " select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null;\n if not found then perform private.api_raise('not_found'); end if;\n if private.api_ts"]]:[]),
  ["not keys <@ (private.api_listing_fields()||'status'::text)","not keys <@ (private.api_listing_fields()||'status'::text||'owner_label'::text||'kind'::text)"],
  // Kapatma
  [" if r.status<>'active' then return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true),'changed',false)); end if;\n",""],
  ["select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if r.status",
   "select * into r from public.listings l where l.id=p_id and l.redacted_at is null for update;\n if not found then perform private.api_raise('not_found'); end if;\n if r.status"],
  // Profil doğrulaması
  ["  or exists(select 1 from jsonb_each(p_changes) e where jsonb_typeof(e.value)<>'string')\n",""],
  ["char_length(coalesce(d->>'display_name',''))>60","char_length(coalesce(d->>'display_name',''))>100"],
  ["array['display_name','account_type','city','about','phone']","array['display_name','account_type','city','about','phone','created_at']"],
  // Favori: görünürlük
  ["   and (exists(select 1 from private.api_visible_listings v where v.id=l.id) or (l.owner_id=actor and l.redacted_at is null))) then","   ) then"],
  // Rota uyarısı: tekrar ve silme
  ["  if found then return private.api_ok(jsonb_build_object('alert',private.api_route_alert_json(r),'created',false)); end if;\n  exit when i=2;","  exit when i=2;"],
  ["   if st<>'23505' then perform private.api_rethrow(st,msg,hn); end if;","   perform private.api_rethrow(st,msg,hn);"],
  ["  if st='42501' and msg='Route alert unavailable' then return private.api_ok(jsonb_build_object('id',p_id,'removed',false)); end if;\n",""],
  // Telefon
  ["  'limited',phone is null and not exists(select 1 from public.listings l where l.id=p_id and l.owner_id=actor)));","  'limited',false));"],
  ["(p_channel is not null and p_channel not in('call','whatsapp'))","false"],
  // Hata eşlemesi
  [" if p_state='54000' then perform private.api_raise('limit_reached'); end if;\n",""],
  [" if left(p_state,2)='22' or p_state in('23502','23514') then perform private.api_raise('invalid_argument'); end if;\n",""],
  ["   when p_msg in('Listing unavailable','Route alert unavailable') then 'not_found'\n",""],
  // Hesap silme
  [" delete from private.api_requests where user_id=actor;\n return private.api_ok(jsonb_build_object('deleted',true));"," return private.api_ok(jsonb_build_object('deleted',true));"],
  // Yetki
  [" api.route_alerts_seen_v1(),api.listing_contact_v1(bigint,text),api.account_delete_v1() to authenticated;"," api.route_alerts_seen_v1(),api.listing_contact_v1(bigint,text),api.account_delete_v1() to anon,authenticated;"],
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

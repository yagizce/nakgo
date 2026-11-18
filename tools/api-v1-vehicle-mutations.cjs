/** B10 araç verilerinin kasıtlı bozma denetimi: migration (katalog, girdi doğrulaması, filtreler, rota alarmı) ve istemcideki
 * tonaj birimi bozulunca testler yakalamalı.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/api-v1-vehicle-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118090000_b10_vehicle_data.sql',C='src/js/cloud.js';
const DB=['--test','tests/db/api-v1-vehicle.test.cjs','tests/db/api-v1-write.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/api-v1-vehicle-http.test.cjs']:[])];
const M=[
  [F,"'vehicles',jsonb_build_array('Tır','Kırkayak',","'vehicles',jsonb_build_array('Tır','TIR','Kırkayak',"],
  [F,"'Damperli','Tanker','Lowbed','Konteyner'),\n  'amount'","'Damperli','Tanker','Lowbed'),\n  'amount'"],
  [F,"'amount',jsonb_build_object('unit','ton',","'amount',jsonb_build_object('unit','kg',"],
  [F," if (p ? 'amount_unit' and not p ? 'amount')\n  or "," if "],
  [F,"jsonb_typeof(p->'amount')<>'number' or ",""],
  [F," or jsonb_typeof(p->'amount_unit') is distinct from 'string' or p->>'amount_unit'<>'ton'))","))"],
  [F," or p->>'amount_unit'<>'ton'))","))"],
  [F," p_listing:=private.api_vehicle_input(p_listing);\n",""],
  [F," p_changes:=private.api_vehicle_input(p_changes);\n",""],
  [F,"  or (v is not null and not private.listing_catalog()->'vehicles' ? v) or (b is not null and not private.listing_catalog()->'bodies' ? b) then","  then"],
  [F,"(p_vehicle is null or x.vehicle=p_vehicle) and ","" ],
  [F,"(p_min_amount is null or x.amount>=p_min_amount)","(p_min_amount is null or x.amount>p_min_amount)"],
  [F,"(p_max_amount is null or x.amount<=p_max_amount)","(p_max_amount is null or x.amount<p_max_amount)"],
  [F,"  or (p_min_amount is not null and p_max_amount is not null and p_min_amount>p_max_amount) then","  then"],
  [F,"(p_vehicle is not null and not private.listing_catalog()->'vehicles' ? p_vehicle) or ",""],
  [F,"grant execute on function api.listing_catalog_v1() to anon,authenticated;","grant execute on function api.listing_catalog_v1() to authenticated;"],
  [C,"const withUnit=x=>Object.prototype.hasOwnProperty.call(x,'amount')?{...x,amount_unit:'ton'}:x;","const withUnit=x=>x;"],
];
const run=(F)=>F===C?(spawnSync(process.execPath,['tools/bundle.js']).status!==0||spawnSync(process.execPath,['tests/run.js'],{encoding:'utf8'}).status!==0)
  :spawnSync(process.execPath,DB,{encoding:'utf8',env:process.env}).status!==0;
let escaped=0;
for(const [file,from,to] of M){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,70));
  fs.writeFileSync(file,src.replace(from,to));
  let caught;
  try{caught=run(file);}finally{fs.writeFileSync(file,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.replace(/\s+/g,' ').slice(0,80));
}
spawnSync(process.execPath,['tools/bundle.js']);
console.log(`kaçan: ${escaped} / ${M.length}`);
process.exitCode=escaped?1:0;

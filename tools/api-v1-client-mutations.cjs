/** B3-d istemci geçişinin kasıtlı bozma denetimi: src/js/cloud.js ve ayrıntı ekranındaki v1/v0 mantığı bozulunca testler
 * (tests/run.js; NAKGO_PG_HOST + NAKGO_POSTGREST_BIN + supabase-js varsa gerçek SDK testi de) yakalamalı.
 *   node tools/api-v1-client-mutations.cjs   Çıkış: kaçan varsa 1. Her bozmadan sonra dosya geri yazılır ve paket yeniden üretilir. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const http=Boolean(process.env.NAKGO_PG_HOST&&process.env.NAKGO_POSTGREST_BIN);
const C='src/js/cloud.js',D='src/js/screens/details.js';
const M=[
  [C,"v1Absent:key === 'api_disabled' || e?.code === 'PGRST106' || e?.code === 'PGRST202'","v1Absent:e?.code === 'PGRST106' || e?.code === 'PGRST202'"],
  [C,"v1Absent:key === 'api_disabled' || e?.code === 'PGRST106' || e?.code === 'PGRST202'","v1Absent:key === 'api_disabled' || e?.code === 'PGRST202'"],
  [C,"            if (!e?.v1Absent) throw e;\n",""],
  [C,".then(r => !r.error && r.data?.data?.enabled === true ? 'v1' : 'v0', () => 'v0');",".then(r => !r.error ? 'v1' : 'v0', () => 'v0');"],
  [C,"if (apiPreference !== 'auto' || !client","if (!client"],
  [C,"            if (config.api === 'v0') apiPreference = 'v0';\n",""],
  [C,"        if (state.user?.id !== user.id) resetApi();\n",""],
  [C,"limit_reached:'54000'","limit_reached:'22023'"],
  [C,"conflict:'conflict', internal_error","conflict:'40001', internal_error"],
  [C,"            if(key!==createKey){createKey=key;createId=requestId();}","            createId=requestId();"],
  [C,"                createKey=uncertainKey='';","                uncertainKey='';"],
  [C,"const {owner_label,...listing}=values,","const listing=values,"],
  [C,"owner_id:x.mine===true?owner:null","owner_id:owner"],
  [C,"image_data:x.photo||'',has_photo","image_data:'',has_photo"],
  [C,"loading_text:x.date?.text??null","loading_text:null"],
  [C,"const r=values.status==='closed'&&Object.keys(values).length===1?","const r=false?"],
  [C,"p_revision:Number.isSafeInteger(revision)?revision:null","p_revision:0"],
  [C,"revision:Number.isSafeInteger(x.revision)?x.revision:null,","revision:null,"],
  [C,"            if(key===uncertainKey)throw Object.assign(Error('Create outcome unknown'),{code:'create_uncertain'});\n",""],
  [C,"                else if(!e?.apiKey&&!e?.v1Absent)uncertainKey=key;\n",""],
  [C,"if(e?.apiKey&&!e.v1Absent)uncertainKey='';","if(e?.apiKey)uncertainKey='';"],
  [C,"                if(e?.apiKey==='conflict')try{e.current=v0Listing((await v1('listing_v1',{p_id:id},account)).data,account.id);}catch(ignored){}\n",""],
  [C,"            if(!d.created)throw Object.assign(Error('Route alert exists'),{code:'23505'});\n",""],
  [C,"            if(!d.removed)throw Object.assign(Error('Route alert unavailable'),{code:'42501'});\n",""],
  [C,"{p_id:id,p_channel:counted?channel:null}","{p_id:id,p_channel:null}"],
  [C,"saved?await v1('favorite_add_v1',{p_listing_id:id},account):await v1('favorite_remove_v1',{p_listing_id:id},account)","await v1('favorite_add_v1',{p_listing_id:id},account)"],
  [C,"from_district:x.from?.district??null","from_district:null"],
  [C,"rev:Number.isSafeInteger(r.revision)?r.revision:null,","rev:null,"],
  [D,"detailPhotoFor === id && owner === nakgoMarket.token()","owner === nakgoMarket.token()"],
  [D,"detailPhotoFor === id && owner === nakgoMarket.token()","detailPhotoFor === id"],
  [D,"        if (imgOk(photo)) { l.img = photo;","        if (photo !== undefined) { l.img = photo;"],
  [D,"Promise.race([nakgoAuth.listingPhoto(id), late])","nakgoAuth.listingPhoto(id)"],
  [D,"    : l.hasPhoto && l._remote && nakgoMarket.active() ?","    : l.hasPhoto && l._remote ?"],
  [C,"const currentApi=()=>apiPreference==='auto'&&apiMode==='v1'?'v1':'v0';","const currentApi=()=>'v1';"],
  ['src/js/data.js',"decimals(text) <= 3 && decimals(String(n)) <= 3","decimals(String(n)) <= 3"],
  ['src/js/data.js',"decimals(text) <= 3 && decimals(String(n)) <= 3","decimals(text) <= 4 && decimals(String(n)) <= 4"],
  ['src/js/data.js',"return !/e/i.test(String(n)) && ","return "],
  ['src/js/data.js',"nakgoAuth.apiMode() === \"v1\" && ",""],
  ['src/js/screens/post.js',"error=postError(value,true)||v1TonError($(\"#w\").value);","error=postError(value,true);"],
  ['src/js/screens/post.js',"postError(l) || (nakgoMarket.active() ? v1TonError($(\"#w\").value) : \"\")","postError(l)"],
  ['src/js/features/listings.js',"        if (!L && nakgoMarket.active() && v1TonError($(\"#ep\").value))\n            return toast(v1TonError($(\"#ep\").value));\n",""],
];
const tests=()=>{
  if(spawnSync(process.execPath,['tools/bundle.js'],{encoding:'utf8'}).status!==0)return true;
  if(spawnSync(process.execPath,['tests/run.js'],{encoding:'utf8',env:process.env}).status!==0)return true;
  return http&&spawnSync(process.execPath,['--test','tests/db/api-v1-client-http.test.cjs'],{encoding:'utf8',env:process.env}).status!==0;
};
let escaped=0;
for(const [F,from,to] of M){
  const src=fs.readFileSync(F,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,70));
  fs.writeFileSync(F,src.replace(from,to));
  let caught;
  try{caught=tests();}
  finally{fs.writeFileSync(F,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+F.split('/').pop()+': '+from.replace(/\s+/g,' ').slice(0,80));
}
spawnSync(process.execPath,['tools/bundle.js']);
console.log(`kaçan: ${escaped} / ${M.length}`);
process.exitCode=escaped?1:0;

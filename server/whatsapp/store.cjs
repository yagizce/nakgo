'use strict';
// Only server-side code may import this module. No raw response/errors in logs.
function createStore({env=process.env,fetchImpl=fetch}={}){
 const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url||'')||!key)throw Error('store_not_configured');
 const expected=env.VERCEL_ENV==='production'?'fimlifldsivecezbxwuo':'axkotffqrsddbrazhcwj';
 if(url!==`https://${expected}.supabase.co`)throw Error('store_environment_mismatch');
 async function rpc(name,args){
  const response=await fetchImpl(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(6000),redirect:'error'});
  if(!response.ok)throw Error('store_unavailable');return response.json();
 }
 return {enqueue:messages=>rpc('nakgo_wa_ingest',{p_messages:messages}),claim:()=>rpc('nakgo_wa_claim',{}),complete:(id,lease,drafts)=>rpc('nakgo_wa_finish',{p_id:id,p_lease:lease,p_drafts:drafts}),fail:(id,lease)=>rpc('nakgo_wa_fail',{p_id:id,p_lease:lease}),purge:()=>rpc('nakgo_wa_purge',{})};
}
module.exports={createStore};

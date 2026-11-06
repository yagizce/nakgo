'use strict';
// Local workerd only. Even PROD-shaped requests are intercepted, never sent to Supabase.
const assert=require('node:assert/strict'),path=require('node:path');
const {Miniflare,convertV4MiniflareOptions,Response}=require('../../cloudflare/node_modules/miniflare');
const bindings={NAKGO_ENV:'production',NAKGO_AUTH_ENABLED:'true',NAKGO_PRODUCTION_AUTH_ENABLED:'true',NAKGO_PRODUCTION_RELEASE_ENABLED:'true',SUPABASE_URL:'https://fimlifldsivecezbxwuo.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_production_only',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_production_only',WHATSAPP_WORKER_SECRET:'synthetic-production-worker-key-'.repeat(2),WHATSAPP_ENABLED:'false',WHATSAPP_CRON_ENABLED:'false',PRODUCTION_MAINTENANCE_ENABLED:'false',LISTING_RETENTION_ENABLED:'false'};
let calls=[],pending=true;
const options={modules:true,scriptPath:path.resolve(__dirname,'../../cloudflare/dist/production-worker.mjs'),compatibilityDate:'2026-10-23',bindings,outboundService:async req=>{
 const url=new URL(req.url);assert.equal(url.origin,bindings.SUPABASE_URL);assert.equal(req.headers.get('apikey'),bindings.SUPABASE_SERVICE_ROLE_KEY);assert.equal(req.headers.get('authorization'),null);
 const name=url.pathname.split('/').pop();calls.push(name);
 if(name==='nakgo_wa_claim'){const job=pending?{id:1,lease:'00000000-0000-4000-8000-000000000001',text:'İstanbul Ankara Tır 20 ton palet bugün'}:null;pending=false;return Response.json(job);}
 if(name==='nakgo_wa_finish')return new Response(null,{status:204});
 throw Error('unexpected_maintenance_or_rpc');
}};
(async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions(options));
 const call=(route,init)=>mf.dispatchFetch('https://app.nakgolojistik.com/api/'+route,init);
 const workerRequest={method:'POST',headers:{Authorization:'Bearer '+bindings.WHATSAPP_WORKER_SECRET}};
 const set=vars=>mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...bindings,...vars}}));
 try{
  const config=await (await call('auth/config')).json();assert.equal(config.url,bindings.SUPABASE_URL);assert.ok(!JSON.stringify(config).includes('sb_secret_'));
  assert.equal((await call('auth/config',{method:'HEAD'})).status,200);assert.equal((await call('auth/config',{method:'POST'})).status,405);
  assert.equal((await call('whatsapp/worker',workerRequest)).status,503);assert.deepEqual(calls,[]);
  assert.equal((await (await mf.getWorker()).scheduled({cron:'* * * * *'})).outcome,'ok');assert.deepEqual(calls,[],'maintenance false means zero writes, including expiry');
  for(const vars of [{NAKGO_ENV:'dev'},{SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co'},{VERCEL_ENV:'preview'},{NAKGO_PRODUCTION_RELEASE_ENABLED:'false'},{NAKGO_AUTH_ENABLED:'false'},{NAKGO_PRODUCTION_AUTH_ENABLED:'false'}]){
   await set({...vars,WHATSAPP_ENABLED:'true'});assert.equal((await call('auth/config')).status,503);assert.equal((await call('whatsapp/worker',workerRequest)).status,503);assert.deepEqual(calls,[],'bad environment cannot send a database request');
  }
  await set({SUPABASE_PUBLISHABLE_KEY:'sb_secret_never_browser'});assert.equal((await call('auth/config')).status,503);assert.deepEqual(calls,[]);
  await set({PRODUCTION_MAINTENANCE_ENABLED:'invalid'});assert.equal((await (await mf.getWorker()).scheduled({cron:'* * * * *'})).outcome,'exception');assert.deepEqual(calls,[]);
  await set({WHATSAPP_ENABLED:'true'});assert.equal((await call('whatsapp/worker',{method:'POST'})).status,401);assert.deepEqual(calls,[]);
  const reply=await call('whatsapp/worker',workerRequest);assert.equal(reply.status,200);assert.deepEqual(await reply.json(),{completed:1,failed:0});assert.deepEqual(calls,['nakgo_wa_claim','nakgo_wa_finish'],'one-message batch, no purge');
  assert.equal((await call('messages',{method:'POST'})).status,404);assert.equal((await call('retention',{method:'POST'})).status,404);
  console.log('Production workerd: strict environment/release/Auth, public config, disabled Meta/maintenance, RPC target/auth, batch one, no purge and retired routes passed; no external network.');
 }finally{await mf.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});

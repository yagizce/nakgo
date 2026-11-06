'use strict';
// Actual local workerd HTTP/Cron; every outbound hop is synthetic and pinned.
const assert=require('node:assert/strict'),path=require('node:path');
const {Miniflare,convertV4MiniflareOptions,Response}=require('../../cloudflare/node_modules/miniflare');
const origin='https://nakgo-app-dev.yagizyedek8.workers.dev';
const bindings={NAKGO_ENV:'dev',SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',NAKGO_AUTH_ENABLED:'true',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_capacity',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_capacity',WHATSAPP_WORKER_SECRET:'synthetic-capacity-secret-'.repeat(2),WHATSAPP_CRON_ENABLED:'false',WHATSAPP_DISPATCH_ENABLED:'false',LISTING_RETENTION_ENABLED:'false',NAKGO_WORKER_ORIGIN:origin};
let mf,queue=[],next=0,completed=new Set(),calls=[],expiries=0,failMode=false;
const fill=n=>{queue=Array.from({length:n},()=>({id:++next,lease:crypto.randomUUID(),text:'İstanbul yükleme Ankara kapalı tır 20 ton palet bugün'}));};
const options={modules:true,scriptPath:path.resolve(__dirname,'../../cloudflare/dist/worker.mjs'),compatibilityDate:'2026-10-23',bindings,outboundService:async req=>{
 const url=new URL(req.url);
 assert.equal(url.origin,bindings.SUPABASE_URL);assert.equal(req.headers.get('apikey'),bindings.SUPABASE_SERVICE_ROLE_KEY);
 const name=url.pathname.split('/').pop(),args=await req.json();calls.push(name);
 if(name==='nakgo_wa_claim')return Response.json(queue.shift()||null);
 if(name==='nakgo_wa_finish'){
  if(failMode)return new Response(null,{status:503});
  assert.ok(!completed.has(args.p_id));completed.add(args.p_id);return new Response(null,{status:204});
 }
 if(name==='nakgo_wa_fail')return new Response(null,{status:204});
 if(name==='nakgo_expire_listings'){expiries++;return Response.json(0);}
 throw Error('unexpected_or_destructive_rpc');
}};
(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions(options));
 const call=(path,auth=true)=>mf.dispatchFetch(origin+'/api/whatsapp/'+path,{method:'POST',headers:auth?{Authorization:'Bearer '+bindings.WHATSAPP_WORKER_SECRET}:{}});
 try{
  for(const route of ['single','drain'])assert.equal((await call(route,false)).status,401);
  assert.deepEqual(calls,[]);
  fill(7);const first=await call('drain');assert.equal(first.status,200);const result=await first.json();assert.equal(result.completed,7);assert.equal(result.empty,true);assert.equal(completed.size,7);assert.equal(expiries,0);assert.ok(result.calls<=16);
  fill(80);const before=calls.length;await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...bindings,WHATSAPP_CRON_ENABLED:'true',WHATSAPP_DISPATCH_ENABLED:'true'}}));
  assert.equal((await (await mf.getWorker()).scheduled({cron:'* * * * *'})).outcome,'ok');
  assert.equal(calls.length-before,33);assert.equal(expiries,1);assert.equal(queue.length,64);assert.ok(16*3+1<=50,'parent invocation stays below Free subrequest quota');
  for(let i=0;i<2;i++){const both=await Promise.all([call('drain'),call('drain')]);for(const response of both)assert.equal(response.status,200);}assert.equal(queue.length,0);assert.equal(completed.size,87,'overlapping controllers do not finish the same lease twice');
  assert.ok(!calls.some(x=>/purge|redact/.test(x)));
  fill(1);failMode=true;const failure=await call('drain');assert.equal(failure.status,200);assert.equal((await failure.json()).failed,1);assert.ok(calls.includes('nakgo_wa_fail'));
  console.log('workerd group dispatch: auth, 16-job cap, worst-case 49 RPCs, overlap, no public self-fetch, failure signalling and zero purge passed');
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});

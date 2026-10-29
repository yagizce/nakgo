// Actual workerd runtime; outbound RPC is a synthetic stub, never real Supabase.
const assert=require('node:assert/strict'),{createHmac}=require('node:crypto'),path=require('node:path');
const {Miniflare,convertV4MiniflareOptions,Response}=require('../../cloudflare/node_modules/miniflare');
const bindings={NAKGO_ENV:'dev',SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',NAKGO_AUTH_ENABLED:'true',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_only',META_APP_SECRET:'synthetic-meta-test',WHATSAPP_VERIFY_TOKEN:'synthetic-verify-test',WHATSAPP_WORKER_SECRET:'w'.repeat(32),WHATSAPP_CRON_ENABLED:'true'};
let queued=null,done=0,ingests=0,purges=0,failMode=false,redirectMode=false,failCount=0,lastDraft;
async function rpc(req){
 const u=new URL(req.url);assert.equal(u.origin,bindings.SUPABASE_URL);assert.equal(req.headers.get('apikey'),bindings.SUPABASE_SERVICE_ROLE_KEY);assert.equal(req.headers.get('authorization'),null);
 if(redirectMode)return new Response(null,{status:302,headers:{Location:'https://fimlifldsivecezbxwuo.supabase.co/'}});
 const args=await req.json();const name=u.pathname.split('/').pop();
 if(name==='nakgo_wa_ingest'){ingests++;queued={id:1,lease:'00000000-0000-4000-8000-000000000001',text:args.p_messages[0].text};return Response.json(1);}
 if(name==='nakgo_wa_claim'){const q=queued;queued=null;return Response.json(q);}
 if(name==='nakgo_wa_finish'){if(failMode)return new Response('',{status:503});lastDraft=args.p_drafts;done++;return new Response(null,{status:204});}
 if(name==='nakgo_wa_fail'){failCount++;return new Response(null,{status:204});}
 if(name==='nakgo_wa_purge'){purges++;return new Response(null,{status:204});}
 throw Error('unexpected_rpc');
}
const options={modules:true,scriptPath:path.resolve(__dirname,'../../cloudflare/dist/worker.mjs'),compatibilityDate:'2026-10-23',bindings,outboundService:rpc};
(async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions(options));
 try{
 const call=(p,init)=>mf.dispatchFetch('https://dev.example/api/'+p,init);
 let r=await call('auth/config');assert.equal(r.status,200);const cfg=await r.json();assert.equal(cfg.url,bindings.SUPABASE_URL);assert.equal(cfg.publishableKey,bindings.SUPABASE_PUBLISHABLE_KEY);assert.equal(JSON.stringify(cfg).includes('sb_secret'),false);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal((await call('auth/config',{method:'HEAD'})).status,200);
 assert.equal(await (await call('auth/config',{method:'HEAD'})).text(),'');
 assert.equal((await call('auth/config',{method:'POST'})).status,405);
 assert.equal((await call('unknown')).status,404);
 r=await call('whatsapp/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-test&hub.challenge=123');assert.equal(await r.text(),'123');
 assert.equal((await call('whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123')).status,403);
 assert.equal((await call('whatsapp/webhook',{method:'POST',body:'{}'})).status,401);assert.equal(ingests,0);
 assert.equal((await call('whatsapp/worker',{method:'POST'})).status,401);
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{messages:[{id:'synthetic-cf-runtime',from:'905000000001',timestamp:'1793203200',type:'text',text:{body:'İzmir Ankara 18 ton sac tenteli yarın'}}]}}]}]});
 const sig='sha256='+createHmac('sha256',bindings.META_APP_SECRET).update(body).digest('hex');
 r=await call('whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body});assert.equal(r.status,200,'ingests='+ingests);assert.equal(ingests,1);
 r=await call('whatsapp/worker',{method:'POST',headers:{Authorization:'Bearer '+bindings.WHATSAPP_WORKER_SECRET}});assert.deepEqual(await r.json(),{completed:1,failed:0});assert.equal(done,1);assert.equal(lastDraft[0].fields.from.city,'İzmir');assert.equal(lastDraft[0].fields.destinations[0].city,'Ankara');
 queued={id:2,lease:'00000000-0000-4000-8000-000000000002',text:'Ankara İzmir 10 ton yükleme'};
 const w=await mf.getWorker();await w.scheduled({cron:'* * * * *',scheduledTime:Date.now()});assert.equal(done,2);assert.ok(purges>=2);
 redirectMode=true;r=await call('whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body});assert.equal(r.status,503);assert.equal(ingests,1);redirectMode=false;
 failMode=true;queued={id:3,lease:'00000000-0000-4000-8000-000000000003',text:'Ankara İzmir 10 ton yükleme'};
 const failed=await w.scheduled({cron:'* * * * *',scheduledTime:Date.now()});assert.equal(failed.outcome,'exception');assert.equal(failCount,1);
 await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...bindings,WHATSAPP_CRON_ENABLED:'false'}}));await (await mf.getWorker()).scheduled({cron:'* * * * *'});assert.equal(done,2);
 await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...bindings,SUPABASE_URL:'https://fimlifldsivecezbxwuo.supabase.co'}}));assert.equal((await call('auth/config')).status,503);assert.equal((await call('whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body})).status,503);assert.equal(ingests,1);
 assert.equal((await (await mf.getWorker()).scheduled({cron:'* * * * *'})).outcome,'exception');assert.equal(done,2);
 console.log('workerd: Auth GET/HEAD/methods, secret isolation, DEV-only, HMAC, handshake, parser, void RPC, worker auth, Cron success/failure/disabled passed');
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});

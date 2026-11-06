const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../tools/cloudflare-whatsapp-dev/scheduler.mjs');
const env={NAKGO_ENV:'dev',SCHEDULER_ENABLED:'true',WHATSAPP_WORKER_SECRET:'x'.repeat(32)};
const config=()=>Response.json({enabled:true,url:'https://axkotffqrsddbrazhcwj.supabase.co'});
test('DEV timer disabled and Production rejected without network',async()=>{
 const {tick}=await load();const no=()=>assert.fail('network forbidden');
 assert.deepEqual(await tick({...env,SCHEDULER_ENABLED:'false'},no),{skipped:true});
 await assert.rejects(tick({...env,NAKGO_ENV:'production'},no),/dev_environment_required/);
 await assert.rejects(tick({...env,SCHEDULER_ENABLED:undefined},no),/explicit_enable_required/);
 await assert.rejects(tick({...env,WHATSAPP_WORKER_SECRET:'short'},no),/worker_secret_required/);
});
test('DEV timer pins host, checks DB before sending secret, disallows redirects',async()=>{
 const {tick,DEV_ORIGIN}=await load();let calls=0;
 const result=await tick(env,async(url,options)=>{
  assert.equal(options.redirect,'error');assert.ok(options.signal);calls++;
  if(calls===1){assert.equal(url,DEV_ORIGIN+'/api/auth/config');assert.equal(options.headers,undefined);return config();}
  assert.equal(url,DEV_ORIGIN+'/api/whatsapp/worker');assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,'Bearer '+env.WHATSAPP_WORKER_SECRET);return Response.json({completed:1,failed:0});
 });assert.equal(calls,2);assert.deepEqual(result,{completed:1,failed:0});
});
test('DEV timer does not send secret through protection or incorrect public config',async()=>{
 const {tick}=await load();
 for(const response of [new Response('login',{status:401}),new Response('<html>'),Response.json({enabled:true,url:'https://fimlifldsivecezbxwuo.supabase.co'}),Response.json({enabled:false,url:'https://axkotffqrsddbrazhcwj.supabase.co'})]){
  let n=0;await assert.rejects(tick(env,async()=>{assert.equal(++n,1);return response;}),/^Error: dev_worker_check_failed$/);
 }
});
test('DEV timer reports application failure and malformed responses as failed cron',async()=>{
 const {tick}=await load();
 for(const result of [new Response('private details',{status:503}),Response.json({completed:0,failed:1}),Response.json({completed:9,failed:0}),Response.json({ok:true})]){
  let n=0;await assert.rejects(tick(env,async()=>++n===1?config():result),/^Error: dev_worker_check_failed$/);
 }
 let n=0;await assert.rejects(tick(env,async()=>{if(++n===1)return config();throw Error('secret must not leak');}),/^Error: dev_worker_check_failed$/);
});

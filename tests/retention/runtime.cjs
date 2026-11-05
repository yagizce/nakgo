// Actual local workerd; all outbound DB calls are intercepted synthetic responses.
const assert=require('node:assert/strict'),path=require('node:path');
const {Miniflare,convertV4MiniflareOptions,Response}=require('../../cloudflare/node_modules/miniflare');
const bindings={NAKGO_ENV:'dev',SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_only',WHATSAPP_CRON_ENABLED:'false',LISTING_RETENTION_ENABLED:'true'};
let calls=[],fail=false;
const options={modules:true,scriptPath:path.resolve(__dirname,'../../cloudflare/dist/worker.mjs'),compatibilityDate:'2026-10-23',bindings,outboundService:async req=>{
 const url=new URL(req.url);assert.equal(url.origin,bindings.SUPABASE_URL);
 assert.equal(req.headers.get('apikey'),bindings.SUPABASE_SERVICE_ROLE_KEY);
 const name=url.pathname.split('/').pop();calls.push(name);
 assert.ok(['nakgo_expire_listings','nakgo_redact_listings','nakgo_wa_purge'].includes(name));
 if(fail&&name==='nakgo_redact_listings')return new Response('',{status:503});
 return Response.json(0);
}};
(async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions(options));
 try{
  const run=async vars=>{calls=[];await mf.setOptions(convertV4MiniflareOptions({...options,bindings:{...bindings,...vars}}));return (await mf.getWorker()).scheduled({cron:'* * * * *'});};
  assert.equal((await run({})).outcome,'ok');
  assert.deepEqual(calls,['nakgo_expire_listings','nakgo_redact_listings','nakgo_wa_purge'],'retention independent of WhatsApp queue toggle');
  assert.equal((await run({LISTING_RETENTION_ENABLED:'false'})).outcome,'ok');assert.deepEqual(calls,['nakgo_expire_listings']);
  assert.equal((await run({LISTING_RETENTION_ENABLED:'yes'})).outcome,'exception');assert.deepEqual(calls,['nakgo_expire_listings']);
  fail=true;assert.equal((await run({})).outcome,'exception');assert.deepEqual(calls,['nakgo_expire_listings','nakgo_redact_listings']);fail=false;
  assert.equal((await run({})).outcome,'ok','next Cron can retry after DB failure');
  assert.equal((await run({SUPABASE_URL:'https://fimlifldsivecezbxwuo.supabase.co'})).outcome,'exception');assert.deepEqual(calls,[],'no Production outbound request');
  assert.equal((await run({NAKGO_ENV:'production'})).outcome,'exception');assert.deepEqual(calls,[]);
  await run({});assert.equal((await mf.dispatchFetch('https://dev.example/api/retention',{method:'POST'})).status,404,'no public maintenance route');
  console.log('Retention workerd: flag isolation, expiry ordering, WhatsApp disabled, failure/retry, DEV-only and no public cleanup endpoint passed');
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});

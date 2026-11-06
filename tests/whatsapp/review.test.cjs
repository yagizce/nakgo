'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
const {createWebhook}=require('../../server/whatsapp/webhook.cjs');
const {processBatch,createWorker}=require('../../server/whatsapp/worker.cjs');
const {createStore}=require('../../server/whatsapp/store.cjs');
test('requested examples preserve uncertainty and multiple stops',()=>{
 const a=parseListings('MARAŞ ANTEP AÇIK TIR SINIRSIZ PROFİL MALZEMESİ HEMEN YÜKLER')[0];assert.equal(a.fields.kind,'load');assert.equal(a.fields.from.city,'Kahramanmaraş');assert.equal(a.fields.destinations[0].city,'Gaziantep');assert.equal(a.fields.body,'Açık kasa');assert.equal(a.fields.weightMax,null);
 const b=parseListings('TUZLA YÜKLEME ERZURUM+VAN KAPALI TIR 0-15 TON')[0];assert.deepEqual(b.fields.from,{city:'İstanbul',district:'Tuzla'});assert.equal(b.fields.destinations.length,2);assert.equal(b.fields.weightMin,0);assert.equal(b.fields.weightMax,15);assert.equal(b.fields.amount,null);
 const c=parseListings('DERİNCE YÜKLEME MALATYA 3 YER TIR 0-22 TON ARAÇ 2011 VE ÜSTÜ MODEL OLMALI')[0];assert.equal(c.fields.from.district,'Derince');assert.equal(c.fields.vehicleCount,null);assert.match(c.fields.conditions,/2011/);
 const d=parseListings('GAZİPAŞA KAPALI TIR\nKORKUTELİ+SERİK KAPALI TIR\nDENİZLİ KAPALI TIR');assert.equal(d.length,3);assert.ok(d.every(x=>x.fields.kind===null));assert.equal(d[0].fields.from.city,null);assert.ok(d[0].issues.includes('route_incomplete'));
});
test('shared footer; sender independent duplicate fingerprint; XSS kept private',()=>{
 const a=parseListings('🚚 İzmir Ankara 20 ton sac bugün yük var\nBursa Konya 10 ton demir yarın yük var\nÖrnek Lojistik\n0500 000 00 01');assert.equal(a.length,2);assert.ok(a.every(x=>x.fields.contactPhone==='+905000000001'&&x.fields.company==='Örnek Lojistik'));
 assert.equal(a[0].fingerprint,parseListings('İzmir Ankara 20 ton sac bugün yük var\n0500 000 00 02')[0].fingerprint);
 assert.equal(parseListings('<script>İzmir Ankara</script> boş araç')[0].fields.from.city,null);
 assert.equal(parseListings('İzmir Ankara boş araç')[0].fields.kind,'truck');
});
test('durable webhook acknowledges only committed enqueue and does not expose storage failure',async()=>{
 const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{messages:[{id:'test-id',from:'905000000001',timestamp:'1791800000',type:'text',text:{body:'İzmir Ankara yük var'}}]}}]}]};
 const raw=JSON.stringify(payload),secret='synthetic',signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 const request=()=>new Request('https://example.invalid',{method:'POST',body:raw,headers:{'x-hub-signature-256':signature}});
 let writes=0;const handler=createWebhook({env:{META_APP_SECRET:secret},ingest:async messages=>{writes++;assert.equal(messages.length,1);}});assert.equal((await handler(request())).status,200);assert.equal(writes,1);
 const failure=createWebhook({env:{META_APP_SECRET:secret},ingest:async()=>{throw Error('private secret');}});const response=await failure(request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private/);
 const invalid=new Request('https://example.invalid',{method:'POST',body:raw});assert.equal((await handler(invalid)).status,401);assert.equal(writes,1);
});
test('worker fails safely; lease completion and retry use only IDs',async()=>{
 let count=0,failed=0;const store={claim:async()=>++count===1?{id:1,lease:'lease',text:'İzmir Ankara yük var'}:null,complete:async()=>{throw Error('database timeout');},fail:async(id,lease)=>{assert.equal(id,1);assert.equal(lease,'lease');failed++;}};assert.deepEqual(await processBatch(store),{completed:0,failed:1});assert.equal(failed,1);
 const h=createWorker({env:{WHATSAPP_WORKER_SECRET:'a'.repeat(32)},storeFactory:()=>{throw Error('not reachable');}});assert.equal((await h(new Request('https://example.invalid',{method:'POST'}))).status,401);
 assert.equal((await h(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32)}}))).status,503);
});
test('server environment isolation and no database secrets needed for fixtures',()=>{
 assert.throws(()=>createStore({env:{}}));assert.throws(()=>createStore({env:{SUPABASE_URL:'https://fimlifldsivecezbxwuo.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',VERCEL_ENV:'preview'}}));
});
test('modern secret keys use apikey only; legacy JWT keeps bearer compatibility',async()=>{
 for(const key of ['sb_secret_synthetic_only','eyJsynthetic.jwt.signature']){
  let headers;
  const store=createStore({env:{SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',SUPABASE_SERVICE_ROLE_KEY:key,VERCEL_ENV:'preview'},fetchImpl:async(url,options)=>{headers=options.headers;assert.match(url,/nakgo_wa_claim$/);return Response.json(null);}});
  await store.claim();assert.equal(headers.apikey,key);assert.equal(headers.Authorization,key.startsWith('sb_secret_')?undefined:'Bearer '+key);
 }
});
test('PostgREST void RPC 204/empty replies are successful, not parse failures',async()=>{
 for(const response of [new Response(null,{status:204}),new Response('',{status:200})]){
  const store=createStore({env:{SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_only',VERCEL_ENV:'preview'},fetchImpl:async()=>response});assert.equal(await store.purge(),null);
 }
});

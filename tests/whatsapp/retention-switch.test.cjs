'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createWorker}=require('../../server/whatsapp/worker.cjs');

for(const flag of [undefined,'false','true','invalid']){
 test('HTTP worker retention switch '+String(flag),async()=>{
  let claims=0,purges=0;
  const handler=createWorker({env:{WHATSAPP_WORKER_SECRET:'x'.repeat(32),LISTING_RETENTION_ENABLED:flag},
   storeFactory:()=>({claim:async()=>{claims++;return null;},purge:async()=>{purges++;}})});
  const response=await handler(new Request('https://dev.invalid/api/whatsapp/worker',{
   method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(32)}}));
  assert.equal(response.status,flag==='invalid'?503:200);
  assert.equal(claims,flag==='invalid'?0:1);
  assert.equal(purges,flag==='true'?1:0);
 });
}
test('unauthorized worker never claims or purges',async()=>{
 const handler=createWorker({env:{WHATSAPP_WORKER_SECRET:'x'.repeat(32),LISTING_RETENTION_ENABLED:'true'},
  storeFactory:()=>{throw Error('unauthorized store access');}});
 assert.equal((await handler(new Request('https://dev.invalid',{method:'POST'}))).status,401);
});

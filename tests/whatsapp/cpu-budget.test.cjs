'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {processBatch,createWorker}=require('../../server/whatsapp/worker.cjs');
test('a one-message CPU budget leaves remaining messages unclaimed',async()=>{
 const pending=[1,2,3],finished=[];
 const store={claim:async()=>{const id=pending.shift();return id?{id,lease:'lease',text:'İzmir Ankara 20 ton palet bugün yük var'}:null;},complete:async id=>finished.push(id),fail:async()=>assert.fail('unexpected failure')};
 assert.deepEqual(await processBatch(store,1),{completed:1,failed:0});
 assert.deepEqual(finished,[1]);assert.deepEqual(pending,[2,3]);
 assert.deepEqual(await processBatch(store,1),{completed:1,failed:0});
 assert.deepEqual(finished,[1,2]);assert.deepEqual(pending,[3]);
});
test('invalid CPU budgets cannot create a store or claim work',async()=>{
 const secret='synthetic-call-key-'.repeat(3);
 for(const value of ['0','6','1.5','01','',1,null]){
  const handler=createWorker({env:{WHATSAPP_WORKER_SECRET:secret,WHATSAPP_BATCH_SIZE:value,LISTING_RETENTION_ENABLED:'false'},storeFactory:()=>assert.fail('invalid budget reached database')});
  const response=await handler(new Request('https://example.test/worker',{method:'POST',headers:{Authorization:'Bearer '+secret}}));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'invalid_batch_size'});
 }
});
test('the smaller batch keeps authentication before all database access',async()=>{
 const handler=createWorker({env:{WHATSAPP_WORKER_SECRET:'synthetic-call-key-'.repeat(3),WHATSAPP_BATCH_SIZE:'1'},storeFactory:()=>assert.fail('unauthorized store access')});
 assert.equal((await handler(new Request('https://example.test/worker',{method:'POST'}))).status,401);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {dispatchQueue}=require('../../server/whatsapp/dispatch.cjs');
const {parseLoad}=require('../../server/whatsapp/parser.cjs');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
test('Cargo/weight projection preserves full parser results across normal and adversarial inputs',()=>{
 const samples=['İstanbul yükleme Ankara kapalı tır 20 ton palet bugün +90 532 123 45 67','<script>İzmir 99 ton</script> Tuzla Van 12,5 ton demir yarın','Ankara İzmir 25-30 ton profil','15.000 kg çimento 50000 TL','05001234567 18 ton palet','İstanbul Ankara <svg onload=alert(1)> 30 ton kum','5 ton 10 ton palet demir','',null,'x'.repeat(4097)];
 for(let n=0;n<30;n++)for(const input of samples){const a=parseLoad(input),b=parseLoad(input,{freightOnly:true});assert.equal(b.cargo,a.cargo);assert.equal(b.weightTon,a.weightTon);}
 assert.equal(parseListings(samples[0])[0].fields.contactPhone,'+905321234567');
});
test('Dispatch bounds concurrent claims, worst-case RPC budget and stops when empty',async()=>{
 let active=0,peak=0,left=7,ids=0;const seen=new Set();
 const result=await dispatchQueue({processOne:async()=>{
  peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;
  if(left-->0){seen.add(++ids);return {completed:1,failed:0};}return {completed:0,failed:0};
 }});assert.equal(result.completed,7);assert.equal(seen.size,7);assert.equal(result.empty,true);assert.ok(peak<=2);assert.ok(result.calls<=12);
 const capped=await dispatchQueue({processOne:async()=>({completed:1,failed:0})});assert.equal(capped.calls,16);assert.equal(capped.limited,true);assert.ok(capped.calls*3+1<=50);
});
test('Dispatch rejects invalid results/budgets, waits for all started work and respects deadline',async()=>{
 for(const value of [{completed:2,failed:0},{completed:-1,failed:0},{completed:'1',failed:0},{},null])await assert.rejects(()=>dispatchQueue({processOne:async()=>value}));
 for(const options of [{maxCalls:17},{concurrency:3},{wallBudgetMs:50001}])await assert.rejects(()=>dispatchQueue({...options,processOne:async()=>({completed:1,failed:0})}));
 await assert.rejects(()=>dispatchQueue({}));
 let calls=0,settled=false;await assert.rejects(()=>dispatchQueue({processOne:async()=>{if(++calls===1)throw Error('synthetic');await new Promise(r=>setTimeout(r,10));settled=true;return {completed:1,failed:0};}}));assert.equal(settled,true);
 let clock=0;const result=await dispatchQueue({wallBudgetMs:10,now:()=>clock,processOne:async()=>{clock+=5;return {completed:1,failed:0};}});assert.equal(result.calls,2);assert.equal(result.limited,true);
});

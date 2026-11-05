'use strict';
// Bounded in-process orchestration: no public self-fetch or separate CPU allowance.
// At most 16 * (claim + finish + fail) + one scheduled expiry = 49 RPCs.
async function dispatchQueue({processOne,concurrency=2,maxCalls=16,wallBudgetMs=50000,now=Date.now}={}){
 if(typeof processOne!=='function')throw Error('dispatch_not_configured');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>16||!Number.isInteger(wallBudgetMs)||wallBudgetMs<1||wallBudgetMs>50000)throw Error('invalid_dispatch_budget');
 const start=now();let calls=0,completed=0,failed=0,empty=false;
 while(calls<maxCalls&&now()-start<wallBudgetMs){
  const size=Math.min(concurrency,maxCalls-calls);calls+=size;
  // Settle every started lease before returning an orchestration failure.
  const settled=await Promise.allSettled(Array.from({length:size},()=>Promise.resolve().then(processOne)));
  if(settled.some(r=>r.status!=='fulfilled'))throw Error('dispatch_unavailable');
  const results=settled.map(r=>r.value);
  if(results.some(r=>!r||!Number.isInteger(r.completed)||!Number.isInteger(r.failed)||r.completed<0||r.failed<0||r.completed+r.failed>1))throw Error('invalid_dispatch_response');
  const done=results.reduce((n,r)=>n+r.completed,0),errors=results.reduce((n,r)=>n+r.failed,0);
  completed+=done;failed+=errors;
  if(done+errors===0){empty=true;break;}
 }
 return {calls,completed,failed,empty,limited:!empty&&(calls>=maxCalls||now()-start>=wallBudgetMs)};
}
module.exports={dispatchQueue};

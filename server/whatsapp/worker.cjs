'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {parseListings}=require('./review-parser.cjs');
const {createStore}=require('./store.cjs');
function batchSize(env){
 const value=env.WHATSAPP_BATCH_SIZE;
 if(value===undefined)return 5;
 if(typeof value!=='string'||!/^[1-5]$/.test(value))throw Error('invalid_batch_size');
 return Number(value);
}
async function processBatch(store,limit=5){
 if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('invalid_batch_size');
 let completed=0,failed=0;
 // One lease per claim: killed workers recover after expiry, no fire-and-forget work.
 for(let i=0;i<limit;i++){
  const job=await store.claim();if(!job)break;
  try{await store.complete(job.id,job.lease,parseListings(job.text));completed++;}
  catch{await store.fail(job.id,job.lease);failed++;}
 }
 return {completed,failed};
}
function authorizeWorker(request,env){
 const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,{error:'method'});
 const secret=env.WHATSAPP_WORKER_SECRET,header=request.headers.get('authorization')||'';
 if(!secret||secret.length<32)return reply(503,{error:'not_configured'});
 if(header.length>512||!timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+secret).digest()))return reply(401,{error:'unauthorized'});
 return null;
}
function createWorker({env=process.env,storeFactory=()=>createStore({env})}={}){return async request=>{
 const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const denied=authorizeWorker(request,env);if(denied)return denied;
 const retention=env.LISTING_RETENTION_ENABLED;
 if(retention!==undefined && retention!=='true' && retention!=='false')return reply(503,{error:'invalid_retention_flag'});
 let limit;try{limit=batchSize(env);}catch{return reply(503,{error:'invalid_batch_size'});}
 try{
  const store=storeFactory();const result=await processBatch(store,limit);
  if(retention==='true')await store.purge();
  return reply(200,result);
 }catch{return reply(503,{error:'retry_later'});}
};}
module.exports={processBatch,createWorker,batchSize,authorizeWorker};

'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {parseListings}=require('./review-parser.cjs');
const {createStore}=require('./store.cjs');
async function processBatch(store){
 let completed=0,failed=0;
 // One lease per claim: killed workers recover after expiry, no fire-and-forget work.
 for(let i=0;i<5;i++){
  const job=await store.claim();if(!job)break;
  try{await store.complete(job.id,job.lease,parseListings(job.text));completed++;}
  catch{await store.fail(job.id,job.lease);failed++;}
 }
 return {completed,failed};
}
function createWorker({env=process.env,storeFactory=()=>createStore({env})}={}){return async request=>{
 const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,{error:'method'});
 const secret=env.WHATSAPP_WORKER_SECRET,header=request.headers.get('authorization')||'';
 if(!secret||secret.length<32)return reply(503,{error:'not_configured'});
 if(header.length>512||!timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+secret).digest()))return reply(401,{error:'unauthorized'});
 try{const store=storeFactory();const result=await processBatch(store);await store.purge();return reply(200,result);}catch{return reply(503,{error:'retry_later'});}
};}
module.exports={processBatch,createWorker};

import {publicAuthConfig} from '../api/auth/config.mjs';
import webhook from '../server/whatsapp/webhook.cjs';
import worker from '../server/whatsapp/worker.cjs';
import database from '../server/whatsapp/store.cjs';
import dispatch from '../server/whatsapp/dispatch.cjs';
const json=(status,value,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
export function createRuntime({normalizeEnv,environmentError='dev_not_configured',storeFactory=env=>database.createStore({env,fetchImpl:(url,init)=>fetch(url,{...init,redirect:'manual'})})}={}) {
 if(typeof normalizeEnv!=='function')throw Error('environment_guard_required');
 return {
  async fetch(request,env) {
   const path=new URL(request.url).pathname;
   if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
   let safe;try{safe=normalizeEnv(env);}catch{return json(503,{error:environmentError});}
   if(path==='/api/auth/config') {
    if(!['GET','HEAD'].includes(request.method))return json(405,{error:'method'},{Allow:'GET, HEAD'});
    const config=publicAuthConfig(safe),response=json(config?200:503,config||{enabled:false});
    return request.method==='HEAD'?new Response(null,response):response;
   }
   if(path==='/api/whatsapp/webhook')return webhook.createWebhook({env:safe,ingest:messages=>storeFactory(safe).enqueue(messages)})(request);
   if(path==='/api/whatsapp/worker')return worker.createWorker({env:safe,storeFactory:()=>storeFactory(safe)})(request);
   if(path==='/api/whatsapp/single')return worker.createWorker({env:{...safe,WHATSAPP_BATCH_SIZE:'1',LISTING_RETENTION_ENABLED:'false'},storeFactory:()=>storeFactory(safe)})(request);
   if(path==='/api/whatsapp/drain'){
    const denied=worker.authorizeWorker(request,safe);if(denied)return denied;
    try{const store=storeFactory(safe);return json(200,await dispatch.dispatchQueue({processOne:()=>worker.processBatch(store,1)}));}
    catch{return json(503,{error:'queue_dispatch_failed'});}
   }
   return json(404,{error:'not_found'});
  },
  async scheduled(_controller,env) {
   const safe=normalizeEnv(env);
   await storeFactory(safe).expire();
   if(safe.LISTING_RETENTION_ENABLED==='true') {
    const retention=storeFactory(safe);await retention.redact();await retention.purge();
   }else if(safe.LISTING_RETENTION_ENABLED && safe.LISTING_RETENTION_ENABLED!=='false')throw Error('invalid_retention_flag');
   if(safe.WHATSAPP_CRON_ENABLED==='false')return;
   if(safe.WHATSAPP_CRON_ENABLED!=='true')throw Error('explicit_cron_enable_required');
   if(safe.WHATSAPP_DISPATCH_ENABLED==='true'){
    const expected=safe.NAKGO_ENV==='dev'?'https://nakgo-app-dev.yagizyedek8.workers.dev':'https://app.nakgolojistik.com';
    if(safe.NAKGO_WORKER_ORIGIN!==expected)throw Error('dispatch_environment_mismatch');
    const store=storeFactory(safe),result=await dispatch.dispatchQueue({processOne:()=>worker.processBatch(store,1)});
    if(result.failed)throw Error('queue_jobs_failed');
    return;
   }
   if(safe.WHATSAPP_DISPATCH_ENABLED&&safe.WHATSAPP_DISPATCH_ENABLED!=='false')throw Error('invalid_dispatch_flag');
   try {
    const store=storeFactory(safe),result=await worker.processBatch(store,worker.batchSize(safe));
    if(result.failed)throw Error('failed_jobs');
   }catch{throw Error('dev_queue_run_failed');}
  }
 };
}

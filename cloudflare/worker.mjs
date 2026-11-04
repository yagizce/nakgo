import {publicAuthConfig} from '../api/auth/config.mjs';
import webhook from '../server/whatsapp/webhook.cjs';
import worker from '../server/whatsapp/worker.cjs';
import database from '../server/whatsapp/store.cjs';
const DEV_URL='https://axkotffqrsddbrazhcwj.supabase.co';
function devEnv(env) {
 if(env.NAKGO_ENV!=='dev'||env.SUPABASE_URL!==DEV_URL||env.VERCEL_ENV==='production')throw Error('dev_only');
 return {...env,VERCEL_ENV:'preview',VERCEL:'1'};
}
const json=(status,value,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
export function createAdapter({storeFactory=env=>database.createStore({env,fetchImpl:(url,init)=>fetch(url,{...init,redirect:'manual'})})}={}) {
 return {
  async fetch(request,env) {
   const path=new URL(request.url).pathname;
   if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
   let safe;try{safe=devEnv(env);}catch{return json(503,{error:'dev_not_configured'});}
   if(path==='/api/auth/config') {
    if(!['GET','HEAD'].includes(request.method))return json(405,{error:'method'},{Allow:'GET, HEAD'});
    const config=publicAuthConfig(safe),response=json(config?200:503,config||{enabled:false});
    return request.method==='HEAD'?new Response(null,response):response;
   }
   if(path==='/api/whatsapp/webhook')return webhook.createWebhook({env:safe,ingest:messages=>storeFactory(safe).enqueue(messages)})(request);
   if(path==='/api/whatsapp/worker')return worker.createWorker({env:safe,storeFactory:()=>storeFactory(safe)})(request);
   return json(404,{error:'not_found'});
  },
  async scheduled(_controller,env) {
   const safe=devEnv(env);
   if(safe.WHATSAPP_CRON_ENABLED==='false')return;
   if(safe.WHATSAPP_CRON_ENABLED!=='true')throw Error('explicit_cron_enable_required');
   try {
    const store=storeFactory(safe),result=await worker.processBatch(store);await store.purge();
    if(result.failed)throw Error('failed_jobs');
   }catch{throw Error('dev_queue_run_failed');}
  }
 };
}
export default createAdapter();

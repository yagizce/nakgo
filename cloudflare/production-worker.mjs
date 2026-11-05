import {createRuntime} from './runtime.mjs';
const PROD_URL='https://fimlifldsivecezbxwuo.supabase.co';
function productionEnv(env){
 if(env.NAKGO_ENV!=='production'||env.SUPABASE_URL!==PROD_URL||
    (env.VERCEL_ENV!==undefined&&env.VERCEL_ENV!=='production')||
    env.NAKGO_PRODUCTION_RELEASE_ENABLED!=='true'||env.NAKGO_AUTH_ENABLED!=='true'||
    env.NAKGO_PRODUCTION_AUTH_ENABLED!=='true')throw Error('production_not_configured');
 return {...env,VERCEL_ENV:'production',VERCEL:'1',WHATSAPP_BATCH_SIZE:env.WHATSAPP_BATCH_SIZE??'1'};
}
export function createProductionAdapter(options={}){
 const runtime=createRuntime({...options,normalizeEnv:productionEnv,environmentError:'production_not_configured'});
 return {
  async fetch(request,env){
   // Stored future Meta credentials alone must not activate ingestion or queue work.
   if(new URL(request.url).pathname.startsWith('/api/whatsapp/')&&env.WHATSAPP_ENABLED!=='true')
    return Response.json({error:'whatsapp_disabled'},{status:503,headers:{'Cache-Control':'no-store'}});
   return runtime.fetch(request,env);
  },
  async scheduled(controller,env){
   productionEnv(env);
   if(env.PRODUCTION_MAINTENANCE_ENABLED==='false')return;
   if(env.PRODUCTION_MAINTENANCE_ENABLED!=='true')throw Error('maintenance_enable_required');
   if(env.WHATSAPP_CRON_ENABLED==='true'&&env.WHATSAPP_ENABLED!=='true')throw Error('whatsapp_disabled');
   return runtime.scheduled(controller,env);
  }
 };
}
export default createProductionAdapter();

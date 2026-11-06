import {createRuntime} from './runtime.mjs';
const DEV_URL='https://axkotffqrsddbrazhcwj.supabase.co';
function devEnv(env) {
 if(env.NAKGO_ENV!=='dev'||env.SUPABASE_URL!==DEV_URL||env.VERCEL_ENV==='production')throw Error('dev_only');
 return {...env,WHATSAPP_BATCH_SIZE:env.WHATSAPP_BATCH_SIZE??'1',VERCEL_ENV:'preview',VERCEL:'1'};
}
export function createAdapter(options={}){return createRuntime({...options,normalizeEnv:devEnv,environmentError:'dev_not_configured'});}
export default createAdapter();

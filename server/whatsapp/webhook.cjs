'use strict';
const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {prepareDrafts}=require('./messages.cjs');
const MAX_BODY=128*1024;
function verifySignature(raw,signature,secret){
  if(typeof secret!=='string'||!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/i.test(signature))return false;
  const expected=createHmac('sha256',secret).update(raw).digest();
  return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
const tokenEqual=(actual,expected)=>typeof actual==='string'&&actual.length<=256&&timingSafeEqual(createHash('sha256').update(actual).digest(),createHash('sha256').update(expected).digest());
const reply=(status,text)=>new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request){
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))throw Error('body_limit');
  if(!request.body)return Buffer.alloc(0);
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();throw Error('body_limit');}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks,size);
}
function createWebhook({env=process.env,allowUnsignedLocal=false,inspectDrafts}={}){
  return async request=>{
    try{
      if(request.method==='GET'){
        const token=env.WHATSAPP_VERIFY_TOKEN;
        if(typeof token!=='string'||!token||token.length>256)return reply(503,'Not configured');
        const q=new URL(request.url).searchParams;
        if(['hub.mode','hub.verify_token','hub.challenge'].some(k=>q.getAll(k).length!==1)||q.get('hub.mode')!=='subscribe'||!tokenEqual(q.get('hub.verify_token'),token))return reply(403,'Forbidden');
        const challenge=q.get('hub.challenge');
        if(!/^\d{1,128}$/.test(challenge)||challenge===token)return reply(400,'Invalid challenge');
        return reply(200,challenge);
      }
      if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, POST','Cache-Control':'no-store'}});
      const secret=env.META_APP_SECRET;
      const mock=allowUnsignedLocal===true&&!env.VERCEL&&!env.VERCEL_ENV&&['test','development'].includes(env.NODE_ENV);
      if(!secret&&!mock)return reply(503,'Not configured');
      let raw;try{raw=await readBody(request);}catch(e){return reply(e.message==='body_limit'?413:400,'Invalid body');}
      if(secret&&!verifySignature(raw,request.headers.get('x-hub-signature-256'),secret))return reply(401,'Unauthorized');
      let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{return reply(400,'Invalid JSON');}
      const drafts=prepareDrafts(payload);
      // Saf hazırlık; kalıcı yazma, gerçek ilan ve dış mesaj yok. Test gözlemcisi yalnız local mock'ta.
      if(mock&&typeof inspectDrafts==='function')inspectDrafts(drafts);
      return reply(200,'OK');
    }catch{return reply(400,'Invalid request');}
  };
}
module.exports={createWebhook,verifySignature,readBody,MAX_BODY};

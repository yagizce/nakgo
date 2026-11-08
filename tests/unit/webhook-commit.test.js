/* Exercise the webhook and RPC adapter together with a synthetic HTTP transport. */
module.exports=({test})=>{
  test('Webhook acknowledges only a valid enqueue result',async()=>{
    const {createHmac}=require('node:crypto');
    const {createWebhook}=require('../../server/whatsapp/webhook.cjs');
    const {createStore}=require('../../server/whatsapp/store.cjs');
    const env={
      META_APP_SECRET:'synthetic-hmac-secret',
      SUPABASE_URL:'https://axkotffqrsddbrazhcwj.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_only'
    };
    const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[
      {field:'messages',value:{messages:[
        {type:'text',id:'wamid.synthetic',from:'905000000001',timestamp:'1791800000',text:{body:'Synthetic load'}}
      ]}}
    ]}]});
    const signature='sha256='+createHmac('sha256',env.META_APP_SECRET).update(body).digest('hex');
    const post=(raw,header=signature)=>new Request('https://nakgo.example/api/whatsapp/webhook',{
      method:'POST',headers:{'x-hub-signature-256':header},body:raw
    });
    let calls=0,upstream;
    const store=createStore({env,fetchImpl:async()=>{calls++;return upstream;}});
    const handler=createWebhook({env,ingest:store.enqueue});
    const invalidSignature=await handler(post(body.replace('Synthetic load','Injected load')));
    const invalidBeforeWrite=invalidSignature.status===401&&calls===0;
    const checks=[[invalidBeforeWrite,'tampered delivery never reaches the enqueue transport']];
    for(const [response,label] of [
      [new Response(null,{status:204}),'empty upstream success'],
      [Response.json({queued:1}),'unexpected upstream payload'],
      [Response.json(2),'impossible inserted count']
    ]){
      upstream=response;
      const reply=await handler(post(body));
      checks.push([reply.status===503&&await reply.text()==='Retry later',label+' must request retry']);
    }
    for(const inserted of [1,0]){
      upstream=Response.json(inserted);
      checks.push([(await handler(post(body))).status===200,'valid insert or idempotent replay can be acknowledged: '+inserted]);
    }
    return checks;
  });
};

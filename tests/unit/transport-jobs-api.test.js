module.exports=({test,fs,path,ROOT})=>{
 test('Transport job RPCs whitelist actions and reject stale sessions',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
  let callback,call,error=null,finish=null,delay=false;
  const sdk={async rpc(name,args){call={name,args};const result=()=>({error,data:{id:1,status:'wait'}});if(delay)return new Promise(resolve=>{finish=()=>resolve(result());});return result();},auth:{onAuthStateChange(cb){callback=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'account-a',email:'test@example.test'}},error:null};}},from(table){
   const request={table,filters:[]};call=request;
   const result=()=>({error,data:table==='profiles'?{id:'account-a',display_name:'Account A'}:request.mode==='read'?[{id:1}]:{id:1,...request.values}});
   const q={select(){return q;},order(k,v){request.order=[k,v];return q;},limit(n){request.limit=n;return q;},eq(k,v){request.filters.push([k,v]);return q;},lt(k,v){request.before=[k,v];return q;},insert(v){request.mode='insert';request.values=v;return q;},update(v){request.mode='update';request.values=v;return q;},async maybeSingle(){return result();},async single(){if(delay)return new Promise(resolve=>{finish=()=>resolve(result());});return result();},then(resolve,reject){request.mode='read';return Promise.resolve(result()).then(resolve,reject);}};return q;
  }};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
  await ctx.auth.requestTransport(17,{owner_id:'forged',carrier_id:'forged'});
  ok(call.name==='nakgo_request_transport'&&JSON.stringify(call.args)==='{"p_listing_id":17}','request only sends listing id, never client-owned participants');
  await ctx.auth.transitionTransport(1,'accept');
  ok(call.name==='nakgo_transition_transport'&&JSON.stringify(call.args)==='{"p_job_id":1,"p_action":"accept"}','transition only sends whitelisted action and job id');
  await ctx.auth.listJobs(50);ok(call.table==='transport_jobs'&&call.limit===50&&JSON.stringify(call.before)==='["id",50]','job reads use bounded cursor pagination');
  let denied=false;try{await ctx.auth.transitionTransport(1,'admin');}catch{denied=true;}ok(denied,'arbitrary action rejected');
  denied=false;try{await ctx.auth.requestTransport(-1);}catch{denied=true;}ok(denied,'invalid listing id rejected');
  error={code:'42501'};denied=false;try{await ctx.auth.transitionTransport(1,'confirm');}catch{denied=true;}ok(denied,'database denial propagates');
  error=null;delay=true;const pending=ctx.auth.requestTransport(17);callback('SIGNED_OUT');finish();denied=false;try{await pending;}catch{denied=true;}ok(denied,'RPC response after sign-out rejected');
  denied=false;try{await ctx.auth.listJobs();}catch{denied=true;}ok(denied,'signed-out job access denied');
  return out;
 });
};

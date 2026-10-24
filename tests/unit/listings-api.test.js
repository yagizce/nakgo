module.exports=({test,fs,path,ROOT})=>{
 test('Supabase listings adapter excludes private fields and rejects stale sessions',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
  let callback,call,error=null,finish=null,delay=false;
  const sdk={auth:{onAuthStateChange(cb){callback=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'account-a',email:'test@example.test'}},error:null};}},from(table){
   const request={table,filters:[]};call=request;
   const result=()=>({error,data:table==='profiles'?{id:'account-a',display_name:'Account A'}:request.mode==='read'?[{id:1}]:{id:1,...request.values}});
   const q={select(){return q;},order(k,v){request.order=[k,v];return q;},limit(n){request.limit=n;return q;},eq(k,v){request.filters.push([k,v]);return q;},lt(k,v){request.before=[k,v];return q;},insert(v){request.mode='insert';request.values=v;return q;},update(v){request.mode='update';request.values=v;return q;},async maybeSingle(){return result();},async single(){if(delay)return new Promise(resolve=>{finish=()=>resolve(result());});return result();},then(resolve,reject){request.mode='read';return Promise.resolve(result()).then(resolve,reject);}};return q;
  }};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
  await ctx.auth.createListing({kind:'load',from_city:'Ankara',to_city:'İzmir',amount:12,owner_id:'attacker',phone:'05555555555',premium:true,created_at:'forged',status:'archived'});
  ok(call.values.owner_label==='Account A'&&!('owner_id' in call.values)&&!('phone' in call.values)&&!('premium' in call.values)&&!('created_at' in call.values)&&!('status' in call.values),'creation keeps identity and private fields server-owned');
  await ctx.auth.updateListing(1,{note:'Updated',owner_id:'b',kind:'truck',status:'closed'});
  ok(JSON.stringify(call.values)==='{"note":"Updated","status":"closed"}'&&JSON.stringify(call.filters)==='[["id",1],["owner_id","account-a"]]','update is explicitly scoped and whitelisted');
  await ctx.auth.listListings({own:true,before:50});
  ok(call.limit===50&&JSON.stringify(call.before)==='["id",50]'&&call.filters[0][1]==='account-a','bounded own listings pagination');
  let denied=false;try{await ctx.auth.updateListing(-1,{note:'x'});}catch{denied=true;}ok(denied,'invalid identifiers rejected');
  error={code:'network'};denied=false;try{await ctx.auth.createListing({kind:'truck'});}catch{denied=true;}ok(denied,'write failure propagates instead of false success');
  error=null;delay=true;const pending=ctx.auth.updateListing(1,{status:'closed'});callback('SIGNED_OUT');finish();denied=false;try{await pending;}catch{denied=true;}ok(denied,'late result cannot cross sign-out');
  denied=false;try{await ctx.auth.listListings();}catch{denied=true;}ok(denied,'signed-out listing access denied');
  return out;
 });
};

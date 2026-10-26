module.exports=({test,fs,path,ROOT})=>{
 test('Favorite API paginates private joins and sends only desired state',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);let event,call,fail=false,delay=false,finish;
  const sdk={auth:{onAuthStateChange(cb){event=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'a'}},error:null};}},from(table){
   call={table,filters:[]};const request=call;
   const result=()=>({error:fail?Error('offline'):null,data:table==='profiles'?{id:'a',display_name:'A'}:[{listing_id:17,listing:null}]});
   const q={select(columns){request.columns=columns;return q;},eq(k,v){request.filters.push([k,v]);return q;},lt(k,v){request.before=[k,v];return q;},order(k,v){request.order=[k,v];return q;},limit(n){request.limit=n;return q;},async maybeSingle(){return result();},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return q;
  },async rpc(name,args){call={name,args};const result=()=>({error:fail?Error('offline'):null,data:{listing_id:args.p_listing_id,saved:args.p_saved}});if(delay)return new Promise(done=>finish=()=>done(result()));return result();}};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
  await ctx.auth.listFavorites();ok(call.columns==='listing_id'&&call.limit===200,'membership reads only IDs in bounded pages');
  await ctx.auth.listFavorites({before:100,details:true});ok(call.table==='listing_favorites'&&call.limit===50&&JSON.stringify(call.before)==='["listing_id",100]','saved listing page has separate stable pagination');
  ok(call.columns.startsWith('listing_id,listing:listings(')&&!call.columns.includes('!inner')&&!call.columns.includes('phone'),'left join retains unavailable bookmarks without copying private contacts');
  await ctx.auth.setFavorite(17,false);ok(JSON.stringify(call)==='{"name":"nakgo_set_favorite","args":{"p_listing_id":17,"p_saved":false}}','unsave uses explicit false and never accepts a client user ID');
  let denied=0;for(const [id,saved] of [[0,true],[17,'true'],[NaN,false]])try{await ctx.auth.setFavorite(id,saved);}catch{denied++;}ok(denied===3,'invalid arguments fail before sending');
  fail=true;denied=false;try{await ctx.auth.setFavorite(17,true);}catch{denied=true;}ok(denied,'database errors are propagated');
  fail=false;delay=true;const pending=ctx.auth.setFavorite(17,true);event('SIGNED_OUT');finish();denied=false;try{await pending;}catch{denied=true;}ok(denied,'write results after sign out are rejected');
  denied=false;try{await ctx.auth.listFavorites();}catch{denied=true;}ok(denied,'signed-out reads are rejected');
  return out;
 });
};

module.exports=({test,fs,path,ROOT})=>{
 test('Private message API keeps identity server-derived and bounds every page',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);let event,call,fail=false,delay=false,finish;
  const sdk={auth:{onAuthStateChange(cb){event=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'a'}},error:null};}},from(table){
   call={table,filters:[],orders:[]};const req=call;const result=()=>({error:fail?Error('offline'):null,data:table==='profiles'?{id:'a',display_name:'A'}:[]});
   const q={select(columns){req.columns=columns;return q;},eq(k,v){req.filters.push([k,v]);return q;},lt(k,v){req.before=[k,v];return q;},or(v){req.cursor=v;return q;},order(k,v){req.orders.push([k,v]);return q;},limit(n){req.limit=n;return q;},async maybeSingle(){return result();},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return q;
  },async rpc(name,args){call={name,args};const result=()=>({error:fail?Error('offline'):null,data:name==='nakgo_message_unread_count'?2:{id:7}});if(delay)return new Promise(done=>finish=()=>done(result()));return result();}};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
  await ctx.auth.listConversations({activity:100,id:9});ok(call.table==='message_inbox'&&call.limit===50&&call.cursor==='last_message_id.lt.100,and(last_message_id.eq.100,id.lt.9)','inbox uses stable compound cursor and bounded private view');
  ok(!call.columns.includes('phone')&&!call.columns.includes('email'),'private contacts are absent');
  await ctx.auth.listMessages(7,40);ok(call.table==='conversation_messages'&&call.limit===50&&JSON.stringify(call.filters)==='[["conversation_id",7]]'&&JSON.stringify(call.before)==='["id",40]','history pages are conversation scoped');
  await ctx.auth.openConversation(16);ok(JSON.stringify(call)==='{"name":"nakgo_open_conversation","args":{"p_listing_id":16}}','client never submits participant IDs or labels');
  const nonce='00000000-0000-4000-8000-000000000001';await ctx.auth.sendMessage(7,' Hello ',nonce);ok(JSON.stringify(call.args)==='{"p_conversation_id":7,"p_body":"Hello","p_client_nonce":"'+nonce+'"}','explicit trimmed body and idempotency nonce');
  await ctx.auth.readConversation(7,40);ok(call.name==='nakgo_read_conversation'&&call.args.p_through_id===40,'read marker uses observed message boundary');
  ok(await ctx.auth.unreadMessages()===2,'unread summary is server scoped');
  let rejected=0;for(const f of [()=>ctx.auth.listConversations({activity:'1,unsafe',id:9}),()=>ctx.auth.sendMessage(7,'',nonce),()=>ctx.auth.sendMessage(7,'x'.repeat(501),nonce),()=>ctx.auth.sendMessage(7,'Hello','invalid'),()=>ctx.auth.listMessages(0),()=>ctx.auth.readConversation(7,0)])try{await f();}catch{rejected++;}ok(rejected===6,'invalid cursors, bodies and IDs fail before requests');
  fail=true;let denied=false;try{await ctx.auth.sendMessage(7,'Hi',nonce);}catch{denied=true;}ok(denied,'database failures propagate');
  fail=false;delay=true;const pending=ctx.auth.sendMessage(7,'Hi',nonce);event('SIGNED_OUT');finish();denied=false;try{await pending;}catch{denied=true;}ok(denied,'late writes after sign out are rejected');
  return out;
 });
};

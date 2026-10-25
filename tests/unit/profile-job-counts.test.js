module.exports=({run,test,fs,path,ROOT})=>{
 run('Profile counts use complete account totals and preserve loading and error states',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"A"}});window.reads=0;nakgoAuth.jobCounts=async()=>{window.reads++;return {active:75,done:126};};');
  await r('return nakgoJobs.refreshSummary()');
  r('offers=[{status:"ok",stage:3}];tab="me";render();');
  ok(r('return main().includes("<b>75</b><span>Devam eden iş")&&main().includes("<b>126</b><span>Onaylanan iş")'),'full totals are independent of demo arrays and 50-row list pagination');
  ok(r('return !main().includes("İşler, mesajlar, favoriler")'),'account explanation no longer claims jobs unavailable');
  r('nakgoAuth.snapshot=()=>({user:{id:"b"},profile:null});nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});render();');
  ok(r('return !nakgoJobs.summary().ready&&!main().includes("<b>126</b>")&&main().includes("<b>…</b><span>Onaylanan iş")'),'switch clears counts without falsely displaying zero before profile readiness');
  r('nakgoAuth.snapshot=()=>({user:{id:"b"},profile:{display_name:"B"}});nakgoAuth.jobCounts=async()=>{window.reads++;throw Error("offline");};');
  await r('return nakgoJobs.refreshSummary()');
  r('render();render();');
  ok(r('return window.reads===2&&!!nakgoJobs.summary().error&&main().includes("<b>—</b><span>Onaylanan iş")'),'failure is visible and does not trigger an endless render retry');
  r('nakgoAuth.jobCounts=async()=>({active:0,done:0});');await r('return el("#profile-jobs-retry").onclick()');
  ok(r('return nakgoJobs.summary().ready&&main().includes("<b>0</b><span>Onaylanan iş")'),'explicit retry can show a verified zero');
 },{win:{}});
 run('Late counts cannot overwrite another account or a newer job transition',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{}});nakgoAuth.jobCounts=()=>new Promise(done=>window.finishCounts=done);');
  const pending=r('return nakgoJobs.refreshSummary()');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});window.finishCounts({active:99,done:99});');await pending;
  ok(r('return !nakgoJobs.summary().ready&&nakgoJobs.summary().done===0'),'late counts never leak across accounts');
  const reading=r('return nakgoJobs.refreshSummary()');
  r('nakgoAuth.transitionTransport=async()=>({id:1,status:"ok",stage:3});');await r('return nakgoJobs.transition(1,"confirm")');
  r('window.finishCounts({active:1,done:0});');await reading;
  ok(r('return !nakgoJobs.summary().ready'),'pre-transition count response is invalidated');
 },{win:{}});
 test('Count API uses exact RLS reads with no pagination and rejects stale sessions',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);let event,queries=[],fail=false,delay=false,finishes=[];
  const sdk={auth:{onAuthStateChange(cb){event=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'a'}},error:null};}},from(table){
   const request={table,filters:[]};if(table==='transport_jobs')queries.push(request);
   const q={select(columns,options){request.columns=columns;request.options=options;return q;},eq(k,v){request.filters.push([k,v]);return q;},lt(k,v){request.filters.push(['lt',k,v]);return q;},async maybeSingle(){return {data:{id:'a',display_name:'A'},error:null};},then(resolve,reject){const result=()=>({data:null,count:request.filters.some(x=>x[0]==='lt')?75:126,error:fail?Error('offline'):null});if(delay)return new Promise(done=>finishes.push(()=>done(result()))).then(resolve,reject);return Promise.resolve(result()).then(resolve,reject);}};return q;
  }};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
  const counts=await ctx.auth.jobCounts();
  ok(counts.active===75&&counts.done===126,'returns full counts beyond the first page');
  ok(queries.length===2&&queries.every(q=>q.options.count==='exact'&&q.options.head===true&&q.filters.some(x=>x[0]==='status'&&x[1]==='ok')),'counts only accepted jobs via exact HEAD queries');
  ok(queries[0].filters.some(x=>x.join(',')==='lt,stage,3')&&queries[1].filters.some(x=>x.join(',')==='stage,3'),'active and confirmed stages are distinct');
  fail=true;let denied=false;try{await ctx.auth.jobCounts();}catch{denied=true;}ok(denied,'read failure is not converted to zero');
  fail=false;delay=true;const pending=ctx.auth.jobCounts();await Promise.resolve();event('SIGNED_OUT');finishes.forEach(f=>f());denied=false;try{await pending;}catch{denied=true;}ok(denied,'late count after sign out is rejected');
  return out;
 });
};


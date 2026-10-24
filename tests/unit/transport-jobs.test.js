module.exports=({run})=>{
 run('Jobs wait for profile readiness without caching a false error',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});window.jobReads=0;nakgoAuth.snapshot=()=>({user:{id:"a"},profile:null});nakgoAuth.listJobs=async()=>{window.jobReads++;return [];};');
  await r('return nakgoJobs.refresh()');
  ok(r('return window.jobReads===0&&!nakgoJobs.state().error&&!nakgoJobs.state().ready'),'pending profile sends no request and records no error');
  r('nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"Test"}});');
  await r('return nakgoJobs.refresh()');
  ok(r('return window.jobReads===1&&nakgoJobs.state().ready'),'ready profile allows jobs to load');
  r('nakgoAuth.listJobs=async()=>{window.jobReads++;throw Error("offline");};');
  await r('return nakgoJobs.refresh()');
  r('tab="mine";render();render();');
  ok(r('return window.jobReads===2&&!!nakgoJobs.state().error'),'real network errors are not automatically retried on render');
 },{win:{}});

 run('Transport jobs are account-scoped, idempotent and never saved into demo',async(r,ok)=>{
  const original=r('return JSON.stringify(stateData())');
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});window.calls=0;nakgoAuth.requestTransport=()=>{window.calls++;return new Promise(done=>window.jobDone=done);};');
  const first=r('return nakgoJobs.request(10)');const duplicate=await r('return nakgoJobs.request(10)');
  ok(duplicate===null&&r('return window.calls')===1,'pending duplicate sends only one request');
  ok(r('return nakgoJobs.state().rows.length')===0,'no optimistic success before server response');
  r('window.jobDone({id:1,listing_id:10,owner_id:"b",carrier_id:"a",status:"wait",stage:0,listing_snapshot:{cargo:"Private"}});');await first;
  ok(r('return nakgoJobs.state().rows[0].status')==='wait','server result enters only the account session');
  ok(r('return JSON.stringify(JSON.parse(localStorage.getItem("yy2")))')===original,'job is never persisted to the generic demo store');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});');
  ok(r('return nakgoJobs.state().rows.length')===0,'account switch clears private jobs');
  r('nakgoMarket.sync({marketplace:true,user:null});');
  ok(r('return JSON.stringify(stateData())')===original,'demo data is restored unchanged');
 },{win:{}});
 run('Transport job failures and stale writes never report success',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.transitionTransport=async()=>{throw Error("offline");};');
  let denied=false;try{await r('return nakgoJobs.transition(1,"accept")');}catch{denied=true;}
  ok(denied&&r('return nakgoJobs.state().rows.length')===0,'failed mutation creates no local job');
  r('nakgoAuth.requestTransport=()=>new Promise(done=>window.finishJob=done);');const pending=r('return nakgoJobs.request(10)');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});window.finishJob({id:1,carrier_id:"a",listing_snapshot:{cargo:"Private A"}});');
  denied=false;try{await pending;}catch{denied=true;}
  ok(denied&&r('return nakgoJobs.state().rows.length')===0,'late mutation cannot enter another account');
  r('nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"Test"}});nakgoAuth.listJobs=()=>new Promise(done=>window.finishRead=done);');const reading=r('return nakgoJobs.refresh()');
  r('nakgoMarket.sync({marketplace:true,user:{id:"c"},profile:null});window.finishRead([{id:2,carrier_id:"b",listing_snapshot:{cargo:"Private B"}}]);');await reading;
  ok(r('return nakgoJobs.state().rows.length')===0,'late read cannot enter another account');
 },{win:{}});
 run('Transport job refresh cannot replace a newer successful mutation',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"Test"}});nakgoAuth.listJobs=()=>new Promise(done=>window.finishRead=done);');
  const reading=r('return nakgoJobs.refresh()');
  r('nakgoAuth.transitionTransport=async()=>({id:1,status:"ok",stage:1,listing_snapshot:{}});');await r('return nakgoJobs.transition(1,"loaded")');
  r('window.finishRead([{id:1,status:"ok",stage:0,listing_snapshot:{}}]);');await reading;
  ok(r('return nakgoJobs.state().rows[0].stage')===1,'stale read preserves newer server-confirmed loading stage');
  r('nakgoAuth.listJobs=async()=>{throw Error("network");};');await r('return nakgoJobs.refresh()');
  ok(r('return nakgoJobs.state().rows[0].stage===1&&!!nakgoJobs.state().error'),'read failure preserves current data with visible error');
 },{win:{}});
 run('Real jobs expose only the participant actions and escape listing text',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"owner"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"owner"}});window.job={id:1,owner_id:"owner",carrier_id:"carrier",carrier_label:"<img onerror=bad>",listing_snapshot:{from:"İstanbul",to:"Ankara",cargo:"<script>bad</script>",ton:10,owner:"Owner"},status:"wait",stage:0,expires_at:new Date(Date.now()+864e5).toISOString()};nakgoJobs.state=()=>({rows:[window.job],ready:true,busy:false,error:"",more:false});tab="mine";render();');
  ok(r(`return main().includes('data-job-action="accept"')&&!main().includes('data-job-action="loaded"')`),'owner sees decisions, not carrier loading action');
  ok(r('return main().includes("&lt;script&gt;")&&!main().includes("<script>bad")'),'untrusted job text remains escaped');
  r('nakgoAuth.snapshot=()=>({user:{id:"carrier"}});window.job.status="ok";render();');
  ok(r(`return main().includes('data-job-action="loaded"')&&!main().includes('data-job-action="confirm"')`),'carrier can report loading but cannot self-confirm');
  r('nakgoAuth.snapshot=()=>({user:{id:"owner"}});window.job.stage=1;render();');
  ok(r(`return main().includes('data-job-action="confirm"')`),'owner can confirm reported loading');
  r('window.job.stage=3;render();');ok(r('return !main().includes("data-job-action=")&&main().includes("Yükleme onaylandı")'),'confirmed job has no repeated mutation controls');
 },{win:{}});
};

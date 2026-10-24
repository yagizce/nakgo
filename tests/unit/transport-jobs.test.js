module.exports=({run})=>{
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
  r('nakgoAuth.listJobs=()=>new Promise(done=>window.finishRead=done);');const reading=r('return nakgoJobs.refresh()');
  r('nakgoMarket.sync({marketplace:true,user:{id:"c"},profile:null});window.finishRead([{id:2,carrier_id:"b",listing_snapshot:{cargo:"Private B"}}]);');await reading;
  ok(r('return nakgoJobs.state().rows.length')===0,'late read cannot enter another account');
 },{win:{}});
 run('Transport job refresh cannot replace a newer successful mutation',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.listJobs=()=>new Promise(done=>window.finishRead=done);');
  const reading=r('return nakgoJobs.refresh()');
  r('nakgoAuth.transitionTransport=async()=>({id:1,status:"ok",stage:1,listing_snapshot:{}});');await r('return nakgoJobs.transition(1,"loaded")');
  r('window.finishRead([{id:1,status:"ok",stage:0,listing_snapshot:{}}]);');await reading;
  ok(r('return nakgoJobs.state().rows[0].stage')===1,'stale read preserves newer server-confirmed loading stage');
  r('nakgoAuth.listJobs=async()=>{throw Error("network");};');await r('return nakgoJobs.refresh()');
  ok(r('return nakgoJobs.state().rows[0].stage===1&&!!nakgoJobs.state().error'),'read failure preserves current data with visible error');
 },{win:{}});
};

module.exports=({run})=>{
 run('Real listings isolate accounts, drafts and demo persistence',async(r,ok)=>{
  const original=r('return JSON.stringify(stateData())');
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});');
  ok(r('return loads.length===0 && trucks.length===0 && offers.length===0 && favs.length===0'),'signed-in view starts empty, not seeded');
  ok(r('return !save()'),'generic demo persistence is refused for real accounts');
  ok(r('return JSON.stringify(JSON.parse(localStorage.getItem("yy2")))')===original,'device demo remains unchanged');
  r('postDrafts={load:{fields:{c:"private A"}}};nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});');
  ok(r('return !getPostDrafts().load'),'account change clears drafts');
  r('nakgoMarket.sync({marketplace:true,user:null});');
  ok(r('return JSON.stringify(stateData())')===original,'sign-out restores original demo exactly');
  ok(r('return !nakgoMarket.active()'),'sign-out exits real mode');
 });
 run('Real listings preserve photos, ownership and date ranges; failures never publish',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});');
  r('nakgoAuth.createListing=async p=>({id:800,owner_id:"a",owner_label:"A",status:"active",created_at:new Date().toISOString(),...p});');
  await r('return nakgoMarket.create({from:"İstanbul",to:"Ankara",veh:"Tır",body:"Tenteli",ton:22,cargo:"Test",date:"Bu hafta",img:"data:image/jpeg;base64,/9j/AA=="});');
  ok(r('return loads.length===1 && loads[0].mine && loads[0]._remote && loads[0].img.endsWith("/9j/AA==")'),'verified server row and JPEG survive mapping');
  r('nakgoAuth.updateListing=async (id,p)=>{window.lastPatch=p;return {id,owner_id:"a",owner_label:"A",kind:"load",status:"active",created_at:new Date().toISOString(),from_city:"İstanbul",to_city:"Ankara",vehicle:"Tır",body:"Tenteli",amount:22,cargo:"Test",available_on:loads[0].date,available_until:loads[0].dateEnd,...p};};');
  const end=r('return loads[0].dateEnd');
  await r('return nakgoMarket.update("l",800,{date:loads[0].date,note:"Edited"});');
  ok(r('return window.lastPatch.available_until')===end,'unchanged weekly date keeps its end');
  await r('return nakgoMarket.update("l",800,{closed:true});');
  ok(r('return loads[0].closed'),'close uses persisted server state');
  await r('return nakgoMarket.update("l",800,{archived:true});');
  ok(r('return loads.length===0'),'archived row leaves list');
  r('nakgoAuth.createListing=async()=>{throw Error("offline");};');
  let rejected=false;try{await r('return nakgoMarket.create({from:"İstanbul",to:"Ankara",veh:"Tır",body:"Tenteli",ton:22,cargo:"Test",date:"Bugün"});');}catch{rejected=true;}
  ok(rejected&&r('return loads.length===0'),'failed create does not insert a local ghost');
 },{win:{}});
 run('Late listing reads and writes cannot enter the next account',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.createListing=()=>new Promise(resolve=>window.complete=resolve);');
  const write=r('return nakgoMarket.create({from:"İstanbul",to:"Ankara",veh:"Tır",body:"Tenteli",ton:22,cargo:"Private",date:"Bugün"});');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});window.complete({id:801,kind:"load",owner_id:"a",cargo:"Private"});');
  let denied=false;try{await write;}catch{denied=true;}
  ok(denied&&r('return loads.length===0'),'late write rejected after account switch');
  r('window.reads=[];nakgoAuth.listListings=()=>new Promise(resolve=>window.reads.push(resolve));');
  const read=r('return nakgoMarket.refresh();');
  r('nakgoMarket.sync({marketplace:true,user:{id:"c"},profile:null});window.reads.forEach(done=>done([{id:802,kind:"load",owner_id:"b",cargo:"Private B"}]));');
  await read;
  ok(r('return loads.length===0'),'late read rejected after account switch');
 },{win:{}});
};

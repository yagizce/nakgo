module.exports=({run})=>{
 const setup='nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"A"}});';
 run('Favorite membership spans cursor pages and stays outside demo storage',async(r,ok)=>{
  const demo=r('return localStorage.getItem("yy2")');
  r(setup+'window.cursors=[];nakgoAuth.listFavorites=async p=>{window.cursors.push(p.before);return p.before===null?Array.from({length:200},(_,i)=>({listing_id:300-i})):[{listing_id:100}];};');
  await r('return nakgoFavorites.refresh()');
  ok(r('return nakgoFavorites.state().ready&&nakgoFavorites.state().count===201&&nakgoFavorites.has(100)'),'membership continues past the first 200 records');
  ok(r('return JSON.stringify(window.cursors)')==='[null,101]','stable listing cursor used');
  ok(r('return favs.length===0&&localStorage.getItem("yy2")')===demo,'account favorites never modify demo preferences');
  r('nakgoMarket.sync({marketplace:true,user:null});');
  ok(r('return localStorage.getItem("yy2")')===demo,'sign-out preserves demo storage');
 },{win:{}});
 run('Favorite write confirms server result, deduplicates clicks and survives failures',async(r,ok)=>{
  r(setup+'nakgoAuth.listFavorites=async()=>[];');await r('return nakgoFavorites.refresh()');
  r('window.writes=0;nakgoAuth.setFavorite=(id,saved)=>{window.writes++;return new Promise(done=>window.finish=()=>done({listing_id:id,saved}));};');
  const saving=r('return nakgoFavorites.setSaved(17,true)');
  const duplicate=await r('return nakgoFavorites.setSaved(17,true)');
  ok(duplicate===null&&r('return window.writes===1&&!nakgoFavorites.has(17)&&nakgoFavorites.disabled(17)'),'no optimistic success and no duplicate write');
  r('window.finish();');await saving;
  ok(r('return nakgoFavorites.has(17)&&!nakgoFavorites.disabled(17)'),'success reflects server state');
  r('nakgoAuth.setFavorite=async()=>{throw Error("offline");};');let failed=false;
  try{await r('return nakgoFavorites.setSaved(17,false)');}catch{failed=true;}
  ok(failed&&r('return nakgoFavorites.has(17)&&!nakgoFavorites.disabled(17)'),'failed removal preserves saved state and allows retry');
  r('nakgoAuth.setFavorite=async(id,saved)=>({listing_id:id,saved});');await r('return nakgoFavorites.setSaved(17,false)');
  ok(r('return !nakgoFavorites.has(17)'),'explicit remove succeeds');
 },{win:{}});
 run('Account switches and newer writes reject stale favorite responses',async(r,ok)=>{
  r(setup+'nakgoAuth.listFavorites=async()=>[];');await r('return nakgoFavorites.refresh()');
  r('nakgoAuth.listFavorites=()=>new Promise(done=>window.readDone=done);nakgoAuth.setFavorite=async(id,saved)=>({listing_id:id,saved});');
  const reading=r('return nakgoFavorites.refresh()');await r('return nakgoFavorites.setSaved(17,true)');
  r('window.readDone([]);');await reading;
  ok(r('return nakgoFavorites.has(17)'),'older refresh cannot erase successful save');
  r('nakgoAuth.setFavorite=()=>new Promise(done=>window.writeDone=done);');const writing=r('return nakgoFavorites.setSaved(18,true)');
  r('nakgoAuth.snapshot=()=>({user:{id:"b"},profile:null});nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});window.writeDone({listing_id:18,saved:true});');
  let denied=false;try{await writing;}catch{denied=true;}
  ok(denied&&r('return !nakgoFavorites.has(17)&&!nakgoFavorites.has(18)&&!nakgoFavorites.state().ready'),'late write cannot enter another account');
  r('nakgoAuth.snapshot=()=>({user:{id:"b"},profile:{}});');const next=r('return nakgoFavorites.refresh()');
  r('nakgoAuth.snapshot=()=>({user:null});nakgoMarket.sync({marketplace:true,user:null});window.readDone([{listing_id:99}]);');await next;
  ok(r('return !nakgoFavorites.has(99)&&!nakgoFavorites.state().ready'),'late read after sign out is discarded');
 },{win:{}});
 run('Saved listings load independently of the feed and hide inaccessible records',async(r,ok)=>{
  r(setup+'nakgoAuth.listFavorites=async()=>[{listing_id:17},{listing_id:18},{listing_id:19}];');await r('return nakgoFavorites.refresh()');
  r('window.savedLoad={id:17,kind:"load",owner_id:"owner",owner_label:"Owner",from_city:"İstanbul",to_city:"Ankara",cargo:"Saved outside feed",amount:10,vehicle:"Tır",body:"Tenteli",available_on:dateFields("Bugün").date,status:"active",created_at:new Date().toISOString()};nakgoAuth.listFavorites=async()=>[{listing_id:17,listing:window.savedLoad},{listing_id:18,listing:{...window.savedLoad,id:18,kind:"truck",cargo:""}},{listing_id:19,listing:null}];');
  await r('return nakgoFavorites.refreshPage()');
  r('F=F0();F.fav=true;tab="list";mode="load";render();');
  ok(r('return loads.length===0&&main().includes("Saved outside feed")'),'saved page contains records absent from the feed');
  r('openLoad(17);');ok(r('return sheet().includes("Saved outside feed")'),'saved-only record opens details');
  r('mode="truck";render();openTruck("t18");');ok(r('return main().includes("data-tid=\\"t18\\"")&&sheet().includes("Boş araç ilanı")'),'truck mapping and details work');
  ok(r('return main().includes("data-unsave=\\"19\\"")&&nakgoFavorites.unavailable().length===1'),'unavailable saved record exposes removal without listing data');
  r('nakgoFavorites.updateListing({...window.savedLoad,status:"closed"});mode="load";render();');
  ok(r('return !main().includes("Saved outside feed")&&nakgoFavorites.unavailable().includes(17)'),'closed listing disappears from active saved cards');
 },{win:{}});
 run('Favorite network errors remain retryable without claiming an empty list',async(r,ok)=>{
  r(setup+'window.reads=0;nakgoAuth.listFavorites=async()=>{window.reads++;throw Error("offline");};');await r('return nakgoFavorites.refresh()');
  r('nakgoFavorites.ensure();nakgoFavorites.ensure();');
  ok(r('return window.reads===1&&!nakgoFavorites.state().ready&&!!nakgoFavorites.state().error'),'error does not automatically loop or become a ready empty state');
  ok(r('return profileToolsHTML().includes("Kayıtlar yüklenemedi")'),'profile does not claim zero before a successful read');
  r('nakgoAuth.listFavorites=async()=>[];');await r('return nakgoFavorites.refresh()');
  ok(r('return nakgoFavorites.state().ready&&nakgoFavorites.state().count===0&&!nakgoFavorites.state().error'),'explicit retry can confirm a real empty account');
 },{win:{}});
};

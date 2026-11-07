module.exports=({test,run,boot,fs,path,ROOT})=>{
 test('Default opening is Loads for every saved role',()=>{
  const out=[];
  for(const role of ['', 'owner', 'carrier']){
   const r=boot({win:{},initialStore:{'yy-role':role}});
   out.push([r('return tab==="list"&&mode==="load"'),'default Loads for '+(role||'new account')]);
  }
  return out;
 });
 run('Foreground refresh preserves filters and does not rebuild profile drafts',async(r,ok)=>{
  ok(r('return typeof resumeListingFeed==="function"'),'foreground refresh is available');
  if(!r('return typeof resumeListingFeed==="function"'))return;
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});window.feedReads=0;window.savedReads=0;nakgoMarket.refresh=async()=>window.feedReads++;nakgoFavorites.refresh=async()=>window.savedReads++;F.from="İstanbul";q="Synthetic";tab="list";document.visibilityState="visible";');
  await r('return resumeListingFeed()');
  ok(r('return window.feedReads===1&&window.savedReads===1&&F.from==="İstanbul"&&q==="Synthetic"'),'feed and saved counts refresh without resetting filters');
  r('document.visibilityState="hidden";resumeListingFeed();');
  ok(r('return window.feedReads===1'),'hidden windows do not request the feed');
  r('document.visibilityState="visible";tab="me";el("#profile-name").value="Unsaved";resumeListingFeed();');
  ok(r('return window.feedReads===1&&el("#profile-name").value==="Unsaved"'),'profile draft is not replaced on resume');
  r('tab="list";navigator.onLine=false;resumeListingFeed();');
  ok(r('return window.feedReads===1'),'offline resume never claims a fresh server read');
 },{win:{}});
 test('Shell navigation revalidates HTTP cache and never intercepts account APIs',async()=>{
  const vm=require('node:vm'),events={},out=[];let response;
  const fresh={ok:true,redirected:false,clone:()=>({})},stale={old:true};
  const ctx={URL,Response,location:{origin:'https://test'},self:{registration:{scope:'https://test/'},addEventListener:(n,f)=>events[n]=f},caches:{open:async()=>({put:async()=>{}})},fetch:async(r,options)=>options?.cache==='no-cache'?fresh:stale};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),ctx);
  events.fetch({request:{url:'https://test/',method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil(){}});
  out.push([await response===fresh,'online opening does not reuse an unvalidated HTTP shell']);
  response=null;
  events.fetch({request:{url:'https://test/api/auth/config',method:'GET',mode:'cors'},respondWith:p=>response=p});
  out.push([response===null,'auth/session response is never a shell cache entry']);
  return out;
 });
};

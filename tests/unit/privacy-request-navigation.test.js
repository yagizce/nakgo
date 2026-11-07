module.exports=({test,fs,path,ROOT})=>{
 test('Reopened privacy requests ignore earlier reads and submissions',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
  for(const outcome of ['rows','error','submission']){
   const pending=[],elements={},body={dataset:{},innerHTML:''};
   const ctx={nakgoMarket:{active:()=>true,token:()=>'same-account'},nakgoAuth:{privacyRPC:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},esc:String,
    $:selector=>selector==='#sheetBody'?body:elements[selector]||(elements[selector]={classList:{add(){}},value:'access'})};
   vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/features/account.js'),'utf8'),ctx);
   let earlier=ctx.openPrivacyRequests();
   if(outcome==='submission'){
    pending.shift().resolve([]);await earlier;
    earlier=elements['#privacy-request'].onsubmit({preventDefault(){}});
   }
   const old=pending.shift(),current=ctx.openPrivacyRequests();
   pending.shift().resolve([{id:22,kind:'access',status:'reviewing',due_at:'2026-11-20'}]);await current;
   const latest=body.innerHTML;
   if(outcome==='error')old.reject(Error('offline'));else old.resolve([{id:11,kind:'access',status:'open',due_at:'2026-11-19'}]);
   // A stale submission must not start another read of the reopened screen.
   const settling=earlier;await Promise.resolve();await Promise.resolve();
   ok(pending.length===0,'stale '+outcome+' does not start another request');
   pending.splice(0).forEach(p=>p.resolve([]));await settling;
   ok(body.innerHTML===latest,'stale '+outcome+' preserves the newer request list');
  }
  return out;
 });
};

module.exports=({test,fs,path,ROOT})=>{
 const vm=require('node:vm');
 function panel(){
  let nodes=[],html='',account='admin';
  const body={dataset:{},get innerHTML(){return html;},set innerHTML(value){
   html=value;nodes=[];
   for(const match of value.matchAll(/<\w+\b([^>]*)>/g)){
    const attributes=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    nodes.push({id:attributes.id,dataset:Object.fromEntries(Object.entries(attributes).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),value:attributes.value||'',checked:true,textContent:''});
   }
  },querySelectorAll(selector){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return nodes.filter(n=>key in n.dataset);}};
  const get=selector=>selector==='#sheetBody'?body:selector==='#sheet'?{classList:{add(){}}}:nodes.find(n=>n.id===selector.slice(1))||null;
  const auth={dataCapabilities:async()=>['privacy_cases','listing_archive'],adminPage:async()=>({users:1,listings:0,documents:0,jobs:0}),maintenanceStatus:async()=>[],
   privacyRPC:async()=>[{id:1,kind:'access',status:'open',revision:0}],archiveList:async()=>[{id:7,kind:'load',from_city:'Ankara',to_city:'İzmir'}],whatsappRPC:async()=>({drafts:[],pending:0,failed:0})};
  const context={nakgoMarket:{active:()=>true,token:()=>account},nakgoAuth:auth,$:get,esc:String,closeSheet(){body.dataset.k='';},normalizeListingPhone:()=>'+905321234567'};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/screens/admin.js'),'utf8'),context);
  const section=async name=>{await body.querySelectorAll('[data-admin-section]').find(n=>n.dataset.adminSection===name).onclick();await Promise.resolve();await Promise.resolve();};
  return {body,get,auth,context,section,setAccount(value){account=value;}};
 }
 for(const kind of ['privacy','archive','permission'])test('Admin '+kind+' ignores write responses after leaving its form',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  for(const success of [false,true]){
   const p=panel();await p.context.openAdminPanel();let finish;
   const pending=new Promise((resolve,reject)=>finish=()=>success?resolve({requires_review:true}):reject(Error('offline')));
   let form,back;
   if(kind==='privacy'){
    await p.section('privacy');p.body.querySelectorAll('[data-privacy-resolve]')[0].onclick();
    p.get('#privacy-result').value='Synthetic outcome';p.get('#privacy-state').value='reviewing';
    p.auth.privacyRPC=async name=>name==='resolve'?pending:[{id:1,kind:'access',status:'open',revision:0}];form='#privacy-resolve';back='#privacy-back';
   }else if(kind==='archive'){
    await p.section('archive');p.body.querySelectorAll('[data-archive-review]')[0].onclick();
    p.get('#archive-reference').value='Synthetic reference';p.get('#archive-state').value='reviewing';p.auth.archiveAction=()=>pending;form='#archive-action';back='#archive-cancel';
   }else{
    await p.section('whatsapp');p.get('#wa-permission').onclick();p.get('#permission-until').value='2027-01-01T12:00';
    p.auth.whatsappRPC=async name=>name==='permission'?pending:{drafts:[],pending:0,failed:0};form='#wa-permission-form';back='#permission-back';
   }
   const writing=p.get(form).onsubmit({preventDefault(){}});
   await p.get(back).onclick();await Promise.resolve();
   const previous=p.body.innerHTML;finish();
   let error;try{await writing;}catch(e){error=e;}
   ok(!error,'late '+(success?'success':'failure')+' does not throw');
   ok(p.body.innerHTML===previous,'late response preserves current screen');
  }
  return out;
 });
};

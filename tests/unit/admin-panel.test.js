module.exports=({test,fs,path,ROOT})=>{
 test('Admin entry follows only the server role and clears on account changes',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);let token='owner',role=false,finish;
  const ctx={nakgoMarket:{active:()=>true,token:()=>token},nakgoAuth:{adminRole:()=>role==='pending'?new Promise(r=>finish=r):Promise.resolve(role)},tab:'me',render(){}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/screens/admin.js'),'utf8'),ctx);
  const run=s=>vm.runInContext(s,ctx);
  ok(!run('nakgoAdminAccess.isAdmin()'),'entry hidden before authorization');
  await run('nakgoAdminAccess.refresh()');ok(!run('nakgoAdminAccess.isAdmin()'),'ordinary account entry hidden');
  role=true;await run('nakgoAdminAccess.refresh()');ok(run('nakgoAdminAccess.isAdmin()'),'verified server role exposes entry');
  token='other';ok(!run('nakgoAdminAccess.isAdmin()'),'old role cannot expose entry for another account');
  role='pending';const pending=run('nakgoAdminAccess.refresh()');token='third';run('nakgoAdminAccess.reset()');finish(true);await pending;
  ok(!run('nakgoAdminAccess.isAdmin()'),'late role discarded after account change');
  role='admin';await run('nakgoAdminAccess.refresh()');ok(!run('nakgoAdminAccess.isAdmin()'),'non-boolean role never authorizes');return out;
 });
 test('Admin panel fails closed and discards responses after account changes',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
  let token='first',resolve,mode='deny';const elements={};
  const body={dataset:{},innerHTML:'',querySelectorAll:()=>[]};elements['#sheetBody']=body;
  const ctx={nakgoMarket:{active:()=>true,token:()=>token},nakgoAuth:{adminPage:()=>mode==='deny'?Promise.reject(Error('Denied')):new Promise(r=>{resolve=r;})},
   $:key=>elements[key]||(elements[key]={classList:{add(){}},onclick:null}),closeSheet(){body.dataset.k='';},esc:s=>String(s),console};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/screens/admin.js'),'utf8'),ctx);
  await ctx.openAdminPanel();ok(body.innerHTML.includes('Yetkini')&&!body.innerHTML.includes('Genel bakış'),'denied RPC renders no administration data or sections');
  mode='pending';const task=ctx.openAdminPanel();token='second';resolve({users:987,listings:1,documents:1,jobs:1});await task;
  ok(!body.innerHTML.includes('987'),'old account response cannot render for another account');
  token='first';const closing=ctx.openAdminPanel();body.dataset.k='other';resolve({users:654});await closing;
  ok(!body.innerHTML.includes('654'),'closed panel ignores pending responses');return out;
 });
};

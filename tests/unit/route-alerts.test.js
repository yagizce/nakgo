/* Additional tests, discovered by the existing npm test runner. */
// Rota alarmı API'si yalnız sunucu fonksiyonlarını kullanır; eşleşme yalnız alarmdan sonra gelen ilanları sayar.
module.exports=({test,run,fs,path,ROOT})=>{
 test('Rota alarmı API ve eşleşme kuralları',async()=>{
  const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);let call=null,calls=[];
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  let rows=[{id:7,kind:'load',from_city:'İstanbul',to_city:null,vehicle:'Tır',body:null,active:true,created_at:iso(now-3600e3),seen_at:iso(now-1800e3)},
   {id:8,kind:'truck',from_city:null,to_city:'İzmir',vehicle:null,body:null,active:false,created_at:iso(now-3600e3),seen_at:iso(now-3600e3)}];
  const sdk={auth:{onAuthStateChange(){},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'a'}},error:null};}},
   from(table){const request={table};call=request;calls.push(request);const q={select(c){request.columns=c;return q;},eq(){return q;},order(k){request.order=k;return q;},limit(n){request.limit=n;return q;},
    async maybeSingle(){return {data:{id:'a',display_name:'A'},error:null};},then(res){return Promise.resolve({data:table==='route_alerts'?rows:[],error:null}).then(res);}};return q;},
   async rpc(name,args){call={name,args};calls.push(call);return {data:name==='nakgo_route_alerts_seen'?1:{id:9},error:null};}};
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},toast(){},bell(){},F:{},
   loads:[],trucks:[],availableListing:l=>!l.closed,
   location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},
   document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},
   window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst',marketplaceEnabled:false})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;this.alerts=nakgoAlerts;this.market=nakgoMarket;',ctx);await ctx.auth.init();
  await ctx.auth.saveRouteAlert({kind:'load',from:' İstanbul ',to:'',veh:'Tır',body:''});
  ok(JSON.stringify(call)==='{"name":"nakgo_save_route_alert","args":{"p_kind":"load","p_from":"İstanbul","p_to":null,"p_vehicle":"Tır","p_body":null}}','kayıt yalnız alarm alanlarını gönderir, kullanıcı kimliği göndermez');
  let denied=0;for(const input of [{kind:'boat',from:'A'},{kind:'load',from:'',to:' '},null])try{await ctx.auth.saveRouteAlert(input);}catch{denied++;}
  for(const [id,a] of [[0,true],[3,'true']])try{await ctx.auth.setRouteAlert(id,a);}catch{denied++;}
  ok(denied===5,'geçersiz alarm sunucuya gitmeden reddedilir');
  await ctx.auth.setRouteAlert(7,false);ok(call.name==='nakgo_set_route_alert'&&call.args.p_active===false,'durdurma açık durum gönderir');
  await ctx.auth.removeRouteAlert(7);ok(call.name==='nakgo_remove_route_alert'&&call.args.p_id===7,'kaldırma');
  await ctx.auth.listRouteAlerts();ok(call.table==='route_alerts'&&call.limit===20&&!call.columns.includes('user_id'),'liste sınırlı ve kullanıcı kimliği okunmaz');
  // Eşleşme: pazar etkin, alarm listesi yüklü.
  vm.runInContext("nakgoMarket.active=()=>true",ctx);
  await ctx.alerts.refresh();
  ctx.loads=[{remoteId:1,from:'İstanbul',to:'Ankara',veh:'Tır',ts:now-600e3},{remoteId:2,from:'İstanbul',to:'Bursa',veh:'Tır',ts:now-7200e3},
   {remoteId:3,from:'İstanbul',to:'Bursa',veh:'Kamyon',ts:now-600e3},{remoteId:4,from:'İstanbul',to:'Bursa',veh:'Tır',ts:now-2400e3},
   {remoteId:5,from:'İstanbul',to:'İzmir',veh:'Tır',ts:now-600e3,mine:true},{remoteId:6,from:'İstanbul',to:'İzmir',veh:'Tır',ts:now-600e3,closed:true}];
  vm.runInContext("loads=this.loads;trucks=[{remoteId:9,from:'Ankara',to:'İzmir',ts:Date.now()}]",ctx);
  const m=ctx.alerts.matches();
  ok(m.map(x=>x.listing.remoteId).join()==='1,4','yalnız alarmdan sonra gelen, uyan, açık ve başkasına ait ilanlar');
  ok(m.find(x=>x.listing.remoteId===1).fresh&&!m.find(x=>x.listing.remoteId===4).fresh,'görüldü zamanından sonrakiler yeni sayılır');
  ok(!m.some(x=>x.alert.id===8),'durdurulan alarm bildirim üretmez');
  await ctx.alerts.markSeen();ok(call.name==='nakgo_route_alerts_seen'&&!ctx.alerts.matches().some(x=>x.fresh),'zil açılınca görüldü sunucuya yazılır ve tekrar bildirilmez');
  return out;
 });
 run('Misafir alarm kurmak isteyince hesap ister; demo alarmı değişmez',(r,ok)=>{
  ok(r("let asked=0;const g=nakgoMarket.guest,q=nakgoMarket.requireAccount;nakgoMarket.guest=()=>true;nakgoMarket.requireAccount=()=>{asked++;return false;};addAlert();openAlertForm();nakgoMarket.guest=g;nakgoMarket.requireAccount=q;return asked")===2,'misafir hesap açmaya yönlendirilir');
  ok(r("tab='me';render();return main()").includes('Rota alarmlarım'),'profil kartı duruyor');
 });
};

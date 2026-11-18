/* Şikâyet: istemci çağrısı (v0/v1), argüman denetimi, ekran akışı ve hata mesajları. Sunucu kuralları tests/db/reports.test.cjs. */
module.exports=({test,run,fs,path,ROOT})=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
 const ME='00000000-0000-4000-8000-000000000001';
 function harness({v1=null,v0=null}={}){
  const calls={v1:[],v0:[]};let callback;
  const sdk={auth:{onAuthStateChange(cb){callback=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:ME,email:'a@test.invalid'}},error:null};}},
   from(table){const o={select(){return o;},eq(){return o;},async maybeSingle(){return {data:table==='profiles'?{id:ME,display_name:'A'}:null,error:null};}};return o;},
   async rpc(fn,args){calls.v0.push({fn,args});return v0?v0(fn,args):{data:{report:{id:4,subject:args.p_subject,listing_id:args.p_listing_id,reason:args.p_reason,status:'open',created_at:'x'},created:true},error:null};}};
  if(v1)sdk.schema=()=>({async rpc(fn,args){calls.v1.push({fn,args});return fn==='status_v1'?{data:{data:{enabled:true}},error:null}:v1(fn,args);}});
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,crypto:globalThis.crypto,Uint8Array,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},
   document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},
   window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(source+';this.auth=nakgoAuth;',ctx);
  return {auth:ctx.auth,calls,signOut:()=>callback('SIGNED_OUT')};
 }

 test('Şikâyet istemcisi: v0 çağrısı, kimlik gönderilmez, geçersiz argüman sunucuya gitmez',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const h=harness();await h.auth.init();
  const r=await h.auth.reportListing(17,'listing','fraud','  Kapora istedi  ');
  ok(JSON.stringify(h.calls.v0.at(-1))==='{"fn":"nakgo_report_listing","args":{"p_listing_id":17,"p_subject":"listing","p_reason":"fraud","p_note":"Kapora istedi"}}','v0: yalnız ilan, konu, sebep, kırpılmış not');
  ok(r.created===true&&r.report.id===4,'sunucu yanıtı aynen döner');
  let denied=0;
  for(const a of [[0,'listing','fraud',''],[17,'user','fraud',''],[17,'listing','Sahte ilan',''],[17,'listing','fraud','x'.repeat(201)],[17,'listing','fraud',null]])
   try{await h.auth.reportListing(...a);}catch{denied++;}
  ok(denied===5&&h.calls.v0.length===1,'geçersiz argüman gönderilmeden reddedilir');
  h.signOut();denied=false;try{await h.auth.reportListing(17,'listing','fraud','');}catch{denied=true;}
  ok(denied&&h.calls.v0.length===1,'oturum yoksa gönderilmez');
  return out;
 });

 test('Şikâyet: ilan ayrıntısı ve profil sunucu ilan kimliğini geçirir',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const d=fs.readFileSync(path.join(ROOT,'src/js/screens/details.js'),'utf8'),a=fs.readFileSync(path.join(ROOT,'src/js/features/account.js'),'utf8');
  ok(d.includes('openReport("l", l.id, l.remoteId)')&&d.includes('openReport("t", t.id, t.remoteId)'),'yük ve boş araç: remoteId');
  ok(d.includes('listingId: l.remoteId })')&&d.includes('listingId: t.remoteId })')&&a.includes('openReport("u", o.uid, o.listingId)'),'hesap şikâyeti: profilin açıldığı ilan');
  return out;
 });

 test('Şikâyet istemcisi: v1 açıkken report_create_v1; iş hataları v0\'a devredilmez',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  let answer={data:{data:{report:{id:9,subject:'account',listing_id:17,reason:'fake',status:'open',created_at:'x'},created:false}},error:null};
  const h=harness({v1:()=>answer});await h.auth.init();
  const r=await h.auth.reportListing(17,'account','fake','');
  ok(h.calls.v1.at(-1).fn==='report_create_v1'&&JSON.stringify(h.calls.v1.at(-1).args)==='{"p_listing_id":17,"p_subject":"account","p_reason":"fake","p_note":""}','v1 argümanları');
  ok(r.created===false&&r.report.id===9,'tekrar: mevcut kayıt, created=false');
  answer={data:null,error:{code:'PT429',message:'limit_reached',hint:'nakgo.api'}};
  let e=null;try{await h.auth.reportListing(18,'listing','fake','');}catch(x){e=x;}
  ok(e&&e.code==='54000'&&!h.calls.v0.length,'sınır: bugünkü kod, v0\'a ikinci gönderim yok');
  answer={data:null,error:{code:'42501',message:'not_allowed',hint:'nakgo.api'}};
  e=null;try{await h.auth.reportListing(18,'listing','fake','');}catch(x){e=x;}
  ok(e&&e.apiKey==='not_allowed'&&!h.calls.v0.length,'kendi ilanı: anahtar korunur');
  answer={data:null,error:{code:'PGRST202',message:'x'}};
  await h.auth.reportListing(18,'listing','fake','');
  ok(h.calls.v0.length===1&&h.calls.v0[0].fn==='nakgo_report_listing','uç yoksa aynı istek bir kez v0 ile');
  return out;
 });

 const market='nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"A"}});';
 run('Şikâyet ekranı: gerçek hesapta sunucuya gider, sonuç ve hatalar açık; demo kaydı değişmez',async(r,ok)=>{
  const demo=r('return localStorage.getItem("yy2")');
  r(market+'window.closed=0;const close0=closeSheet;closeSheet=()=>{window.closed++;close0();};window.sent=[];window.answer=null;nakgoAuth.reportListing=async(...a)=>{window.sent.push(a);if(window.answer instanceof Error)throw window.answer;return window.answer;};');
  const send=async(kind,id,remote,reason,note)=>{
   r('window.closed=0;$("#rg").disabled=false;$("#toast").textContent="";openReport('+JSON.stringify(kind)+','+JSON.stringify(id)+','+JSON.stringify(remote)+');$("#rr").value='+JSON.stringify(reason)+';$("#rn").value='+JSON.stringify(note)+';$("#rg").onclick();');
   await new Promise(done=>setTimeout(done,0));
   return {toast:r('return $("#toast").textContent'),open:r('return window.closed===0')};
  };
  r('window.answer={report:{id:3},created:true};');
  let s=await send('t','t17',17,'Dolandırıcılık şüphesi',' Kapora ');
  ok(r('return JSON.stringify(window.sent.at(-1))')==='[17,"listing","fraud","Kapora"]','boş araç ilanı: sunucu kimliği ve sebep kodu');
  ok(/iletildi/.test(s.toast)&&!s.open,'başarı mesajı, sayfa kapanır');
  r('window.answer={report:{id:3},created:false};');
  s=await send('u','uid-b',17,'Sahte ilan','');
  ok(r('return JSON.stringify(window.sent.at(-1))')==='[17,"account","fake",""]','hesap şikâyeti ilan üzerinden');
  ok(/zaten var/.test(s.toast),'tekrar mesajı');
  for(const [err,re] of [['Object.assign(Error("x"),{code:"54000"})',/Çok fazla/],['Object.assign(Error("not_found"),{apiKey:"not_found"})',/yayında değil/],
   ['Error("Own listing")',/Kendi ilanını/],['Error("offline")',/gönderilemedi/]]){
   r('window.answer='+err+';');s=await send('l',17,17,'Diğer','');
   ok(re.test(s.toast)&&s.open&&r('return !$("#rg").disabled'),'hata mesajı '+re+'; sayfa açık kalır, yeniden denenebilir');
  }
  r('window.answer={};');s=await send('l',17,17,'Diğer','');
  ok(/gönderilemedi/.test(s.toast)&&s.open,'biçimsiz yanıt başarı sayılmaz');
  r('window.sent=[];$("#toast").textContent="";$("#sheetBody").innerHTML="";openReport("l",17);');
  ok(r('return window.sent.length===0&&$("#sheetBody").innerHTML===""&&/henüz hazır değil/.test($("#toast").textContent)'),'sunucu kimliği olmadan şikâyet ekranı açılmaz');
  r('window.sent=[];nakgoAuth.reportListing=(...a)=>{window.sent.push(a);return new Promise(d=>window.done=d);};$("#rg").disabled=false;openReport("l",17,17);$("#rg").onclick();$("#rg").onclick();');
  ok(r('return window.sent.length===1'),'yanıt beklenirken ikinci tıklama gönderilmez');
  r('window.done({report:{id:1},created:true});');await new Promise(done=>setTimeout(done,0));
  ok(r('return reports.length===0&&localStorage.getItem("yy2")')===demo,'gerçek hesap şikâyeti cihaz kaydına yazılmaz');
 },{win:{}});
};

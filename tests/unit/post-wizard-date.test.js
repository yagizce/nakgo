module.exports=({run})=>{
 run('Load timing is required free text; notes step and truck calendar stay unchanged',async(r,ok)=>{
  r("window.loadDraft={from:'İstanbul',to:'Ankara',veh:'Tır',body:'Tenteli',ton:10,cargo:'Synthetic',date:'',time:'',dateText:''};");
  ok(r('return postError(window.loadDraft,false,1)===""'),'notes transition does not require timing');
  for(const value of ['', '   '])ok(r('return !!postError({...window.loadDraft,dateText:'+JSON.stringify(value)+'})'),'empty timing cannot publish');
  for(const value of ['bugün','yarın sabah','Haftaya uygun olduğunda','28.10.2026 25:70','2020-01-01','<img src=x onerror=alert(1)>']){
   r('window.value='+JSON.stringify(value)+';');
   ok(r('return postError({...window.loadDraft,dateText:window.value})===""'),'nonempty timing accepted: '+value);
   ok(r('return dateLabel(normalizeListing({...window.loadDraft,id:800,mine:true,dateText:window.value}))===window.value'),'stored timing remains literal');
  }
  ok(r("return !!postError({...window.loadDraft,cap:10,...parsePostDate('yarın sabah')},true)"),'truck calendar validation remains strict');
  r("postMode='load';el('#f').value='İstanbul';el('#t').value='Ankara';el('#v').value='Tır';el('#b').value='Tenteli';el('#w').value='10';el('#c').value='Synthetic';el('#n').value='';el('#d').value='yarın sabah';");
  ok(r("return postValues().dateText==='yarın sabah'&&postValues().date===''"),'form does not invent a calendar day');
  r('nakgoMarket.sync({marketplace:true,user:{id:"owner"},profile:null});nakgoAuth.createListing=async p=>{window.sent=p;return {id:800,owner_id:"owner",owner_label:"Owner",status:"active",created_at:new Date().toISOString(),...p};};');
  await r('return nakgoMarket.create({...window.loadDraft,dateText:"yarın sabah"});');
  ok(r('return window.sent.loading_text==="yarın sabah"&&window.sent.available_on===null'),'cloud payload stores text without invented date');
  ok(r('return dateLabel(loads[0])==="yarın sabah"'),'server response maps literal timing');
  r('nakgoAuth.updateListing=async(id,p)=>{window.patch=p;return {id,kind:"load",owner_id:"owner",created_at:new Date().toISOString(),...window.sent,...p};};');
  await r('return nakgoMarket.update("l",800,{dateText:"Gelecek hafta"});');
  ok(r('return window.patch.loading_text==="Gelecek hafta"&&window.patch.available_on===null&&dateLabel(loads[0])==="Gelecek hafta"'),'cloud edit preserves text and clears calendar fields');
 },{win:{}});
};

/* Six-hour listings, consented contact and removed public identity / messaging. */
module.exports=({run})=>{
 run('Telefon zorunlu, izinli ve Türkiye biçiminde',(r,ok)=>{
  for(const value of ['0532 123 45 67','+90 (532) 123-45-67','00905321234567','5321234567','905321234567'])ok(r('return normalizeListingPhone('+JSON.stringify(value)+')')==='+905321234567','mobile: '+value);
  ok(r("return normalizeListingPhone('0212 123 45 67')")==='+902121234567','geographic number');
  for(const value of ['','+44 7700 900123','123','05321234567 dahili 1','5555555555','+905321234567<script>'])ok(r('return !normalizeListingPhone('+JSON.stringify(value)+')'),'reject invalid: '+value);
  r("window.draft={from:'İstanbul',to:'Ankara',veh:'Tır',body:'Tenteli',ton:10,cargo:'Palet',dateText:'bugün',phone:'05321234567',contactConsent:true}");
  ok(r("return postError(window.draft)===''"),'phone-only contact, no name required');
  ok(r("return !!postError({...window.draft,phone:''})&&!!postError({...window.draft,contactConsent:false})"),'missing phone or consent cannot publish');
  ok(r("return postError({...window.draft,phone:'',contactConsent:false},false,1)===''"),'notes step remains accessible');
 },{win:{}});
 run('Altı saat sınırı yükleme metninden bağımsız',(r,ok)=>{
  ok(r("const now=Date.now();return !expired({ts:now-6*36e5+1000})&&expired({ts:now-6*36e5})&&expired({ts:now-6*36e5-1000})"),'boundary before/equal/after');
  ok(r("return expired({ts:Date.now(),expiresAt:Date.now()-1})"),'server expiry overrides local creation');
  ok(r("return !expired({ts:Date.now(),dateText:'istediğim zaman'})"),'free loading text preserved');
  r("loads[0].owner='Hidden owner';loads[0].phone='05321234567';loads[0].expiresAt=Date.now()+3600000;tab='list';render();openLoad(loads[0].id)");
  ok(!r('return main()+sheet()').includes('Hidden owner'),'public card and detail hide owner');
  ok(r("return main().includes('dk kaldı')&&sheet().includes('id=\"wa\"')&&sheet().includes('id=\"call\"')"),'remaining time and contact actions');
  r("loads[0].expiresAt=Date.now()-1;render()");ok(!r('return main()').includes('data-id="1"'),'expired listing removed from list');
 });
 run('Ara ve WhatsApp aynı izinli numaraya gider',async(r,ok)=>{
  r("loads[0].phone='0532 123 45 67';openLoad(loads[0].id)");
  await r("return el('#call').onclick()");ok(r('return window.location.href')==='tel:+905321234567','call normalized');
  await r("return el('#wa').onclick()");ok(r('return window.location.href')==='https://wa.me/905321234567','WhatsApp same number');
  r("window.location.href='unchanged';loads[0].expiresAt=Date.now()-1");await r("return el('#wa').onclick()");ok(r('return window.location.href')==='unchanged','expired contact cannot navigate');
  ok(r("return typeof openInbox==='undefined'&&typeof openChat==='undefined'&&typeof openCompare==='undefined'&&typeof nakgoAuth.sendMessage==='undefined'"),'retired UI and API absent');
 },{win:{location:{href:''}}});
};

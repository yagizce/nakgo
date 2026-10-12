/* Açık kayıt sınırları, form doğrulama ve gecikmeli iş durumu. */
module.exports = ({run,test,boot}) => {
  run("İş geri çekme açıkça kaydedilir ve hata geri alınır",(r,ok)=>{
    r("requestLoad(loads[0])");
    ok(r("return withdrawOffer(1)")===true,"bekleyen iş geri çekilir");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).offers.length")===0,"geri çekme cihazda kalıcı");
    r("requestLoad(loads[1]);localStorage.setItem=()=>{throw Error('quota')}");
    ok(r("return withdrawOffer(2)")===false,"başarısız yazma başarı sayılmaz");
    ok(r("return offers.some(o=>o.id===2)")===true,"iş geri gelir");
    ok(r("return el('#toast').textContent").includes("Kaydedilemedi"),"hata başarı bildirimiyle örtülmez");
  });
  run("Tamamlanan veya kaybolan iş geri çekilemez",(r,ok)=>{
    r("offers=[{...loads[0],status:'ok'}];save()");
    ok(r("return withdrawOffer(1)")===false,"kabul edilmiş iş korunur");
    ok(r("return withdrawOffer('missing')")===false,"eksik iş güvenle reddedilir");
    ok(r("return oup(undefined,{status:'ok'})")===false,"eksik iş güncellenemez");
  });
  run("Taşıyıcı ve yük sahibi değerlendirmeleri ayrıdır",(r,ok)=>{
    r("incoming=[{...loads[0],loadId:1,bidder:'carrier',ownerUid:'owner',status:'ok',stage:3}];rates=[{k:rkey(incoming[0],'owner'),stars:5}]");
    ok(!r("return incHTML()").includes('data-ir2='),"yük sahibi ikinci kez değerlendirmeye yönlendirilmez");
    ok(r("return stageUI(incoming[0])").includes('data-rt='),"karşı tarafın değerlendirmesi ayrı kalır");
  });
  run("Gecikmeli demo onayı güncel nesneye yazılır",(r,ok)=>{
    r("offers=[{...loads[0],status:'ok',loadId:1,stage:0}];save();setStage(offers[0],1);applyState(JSON.parse(savedState));flush()");
    ok(r("return offers[0].stage")===3,"geri yükleme sonrası onay kaybolmaz");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).offers[0].stage")===3,"onay kalıcı");
  });
  run("Yük ve araç formu ortak kurallarla doğrulanır",(r,ok)=>{
    r("loads[0]={id:1,from:'İstanbul',to:'Ankara',cargo:'Palet',ton:.5,cap:.5,veh:vehicles[0],body:bodies[0],date:'Bugün'}");
    ok(r("return postError(loads[0])")==="","ondalıklı pozitif tonaj geçerli");
    for(const value of ["0","-1","Infinity","NaN","1e308"])
      ok(r("return !!postError({...loads[0],ton:"+value+"})"),"geçersiz tonaj "+value);
    for(const patch of ["{from:'Olmayan şehir'}","{to:'İstanbul'}","{veh:''}","{body:''}","{date:''}","{date:'2020-01-01'}","{date:'2026-02-31'}"])
      ok(r("return !!postError({...loads[0],..."+patch+"})"),"bozuk seçim "+patch);
    ok(r("return !!postError({...loads[0],items:[{n:'Koli',q:0,u:'adet'}]})"),"kalem miktarı gerekli");
    ok(r("return !!postError({...loads[0],items:[{n:'Koli',q:2,u:'yanlış'}]})"),"kalem birimi geçerli olmalı");
    ok(r("return postTruck({...loads[0],id:'test',cap:Infinity})")===false,"araç kaydı doğrudan çağrıda da doğrulanır");
    ok(r("return normalizeListing({...loads[0],items:[{n:'Koli',q:Infinity,u:'adet'}]}).items[0].q")===0,"eski sonsuz miktar güvenle düzeltilir");
  });
  run("Haftalık ilan tarihini koruma ve yeniden açma",(r,ok)=>{
    r("loads[0]={...loads[0],mine:true,date:localDay(),dateEnd:dateFields('Bu hafta').dateEnd,closed:true};openEdit('l',loads[0].id,true);el('#ed').value=loads[0].date;el('#en').value='Yeni not';el('#es').onclick()");
    ok(r("return !loads[0].closed&&loads[0].dateEnd===dateFields('Bu hafta').dateEnd"),"aynı hafta aralığı korunur");
    r("openEdit('l',loads[0].id);el('#ed').value='Yarın';el('#en').value='Yeni gün';el('#es').onclick()");
    ok(r("return loads[0].date===dateFields('Yarın').date&&!loads[0].dateEnd"),"tek gün seçimi eski hafta sonunu kaldırır");
    r("loads[0].closed=true;loads[0].date='2020-01-01';save();openEdit('l',loads[0].id,true);el('#ed').value='2020-01-01';el('#es').onclick()");
    ok(r("return loads[0].closed"),"eski tarihle yeniden açılmaz");
  });
  run("Mazot hesabı sonlu ve geçerli sonuç üretir",(r,ok)=>{
    r("calc={km:500,cons:30,fuel:50,toll:100,other:50,back:false}");
    ok(r("return fuelEstimate(calc).total")===7650,"tek yön gideri");
    ok(r("return fuelEstimate({...calc,back:true}).total")===15150,"boş dönüş yalnız mesafeyi iki katına çıkarır");
    ok(r("return fuelEstimate({...calc,km:1e308})")===null,"taşan sayı reddedilir");
    ok(r("return fuelEstimate({...calc,toll:-1})")===null,"negatif gider reddedilir");
  });
  test("Açılışta normalizasyon çizime bağlı kalmaz",async()=>{
    const r=boot({initialStore:{yy2:JSON.stringify({loads:[],trucks:[],offers:[],calc:{km:1e308,cons:1e308,fuel:1e308}})}});
    return [[r("return !!fuelEstimate(calc)"),"bozuk hesap ayıklanır"],
      [r("return JSON.parse(localStorage.getItem('yy2')).version")===3,"şema açılışta kalıcılaşır"]];
  });
};

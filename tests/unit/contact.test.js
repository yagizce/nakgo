/* Doğrudan görüşme, iş yetkileri ve eski kayıt uyumluluğu */
module.exports = function register({run}) {
  run("Yüklemeyi taşıyıcı, onayı yük sahibi verir", (r,ok)=>{
    r("cloud=true;me='carrier';db={doc:()=>({update:()=>Promise.resolve(),set:()=>Promise.resolve()})};offers=[{...loads[0],status:'ok',loadId:1,bidder:'carrier',ownerUid:'owner',stage:0}];setStage(offers[0],3)");
    ok(r("return offers[0].stage")===0,"yükleme olmadan onay yok");
    r("me='owner';setStage(offers[0],1)");ok(r("return offers[0].stage")===0,"yük sahibi taşıyıcının yerine yükleyemez");
    r("me='carrier';setStage(offers[0],1);setStage(offers[0],3)");ok(r("return offers[0].stage")===1,"taşıyıcı kendi yüklemesini onaylayamaz");
    r("me='owner';setStage(offers[0],3);setStage(offers[0],1)");ok(r("return offers[0].stage===3&&offers[0].doneAt>0"),"yük sahibi onayı kaydedilir, tamamlanan iş geriye gitmez");
  });
  run("Eski tutarlar gizlenir, saklanan iş kaybolmaz",(r,ok)=>{
    r("offers=[{...loads[0],offer:28500,counter:30000,status:'counter',loadId:1,bidder:'',stage:0},{...loads[1],offer:14000,status:'ok',loadId:2,bidder:'',stage:2}];tab='mine';render()");
    const h=r("return main()");ok(!/28.500|30.000|14.000|Fotoğraf|Teslim ettim/.test(h),"eski fiyat ve teslim aşamaları ekranda yok");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).offers[0].counter")===30000,"eski veriler silinmez");
    r("tab='me';render();openInbox()");ok(r("return sheet()").includes('data-conv="0"'),"eski görüşmeye profil üzerinden erişilir");
  });
  run("Profil kullanıcı verileri güvenli ve kalıcı",(r,ok)=>{
    r("setCar({displayName:'<firma>',city:'Ankara',about:'<script>alert(1)</script>'});tab='me';render()");
    const h=r("return main()");ok(h.includes('&lt;firma&gt;')&&!h.includes('<script>alert(1)'),"tanıtım ve ad HTML çalıştırmaz");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).myCar.city")==='Ankara',"profil bilgileri cihazda korunur");
    r("carriers.u={city:'Ankara',about:'<script>alert(1)</script>'};openProfile({uid:'u',name:'Firma'})");ok(!r("return sheet()").includes('<script>alert(1)'),"herkese açık profil de kaçışlı");
  });
};

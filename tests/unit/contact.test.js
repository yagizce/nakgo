/* Doğrudan görüşme ve eski kayıt uyumluluğu */
module.exports = function register({run}) {
  run("Eski tutarlar gizlenir, saklanan iş kaybolmaz",(r,ok)=>{
    r("offers=[{...loads[0],offer:28500,counter:30000,status:'counter',loadId:1,bidder:'',stage:0},{...loads[1],offer:14000,status:'ok',loadId:2,bidder:'',stage:2}];save();tab='mine';render()");
    const h=r("return main()");ok(!/28.500|30.000|14.000|Fotoğraf|Teslim ettim/.test(h),"eski fiyat ve teslim aşamaları ekranda yok");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).offers[0].counter")===30000,"eski veriler silinmez");
    r("tab='me';render()");ok(r("return typeof openInbox==='undefined'")&&!r("return main()").includes('profile-messages'),"mesajlaşma giriş noktası kaldırıldı; iş geçmişi korunur");
  });
  run("Profil kullanıcı verileri güvenli ve kalıcı",(r,ok)=>{
    r("setCar({displayName:'<firma>',city:'Ankara',about:'<script>alert(1)</script>'});tab='me';render()");
    const h=r("return main()");ok(h.includes('&lt;firma&gt;')&&!h.includes('<script>alert(1)'),"tanıtım ve ad HTML çalıştırmaz");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).myCar.city")==='Ankara',"profil bilgileri cihazda korunur");
    r("carriers.u={city:'Ankara',about:'<script>alert(1)</script>'};openProfile({uid:'u',name:'Firma'})");ok(!r("return sheet()").includes('<script>alert(1)'),"herkese açık profil de kaçışlı");
  });
};

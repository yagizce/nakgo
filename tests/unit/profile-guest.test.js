/* Hesaplar açıkken girişsiz ziyaretçi Profil'de cihazdaki demo profili değil, kayıt çağrısını görür. */
module.exports=({run})=>{
 run('Girişsiz ziyaretçi profilde demo formu yerine kayıt çağrısı görür',(r,ok)=>{
  r(`myCar.displayName='Demo Kişi';myCar.phone='0555 111 22 33';
   nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:null,profile:null});
   nakgoMarket.guest=()=>true;nakgoMarket.active=()=>false;
   window.asked=0;nakgoMarket.requireAccount=()=>{window.asked++;};
   tab='me';renderProfile(el('#main'));`);
  ok(r('return !main().includes("profile-name")&&!main().includes("profile-save")&&!main().includes("myph")'),'profil ve telefon formu gösterilmez');
  ok(r('return !main().includes("Demo Kişi")&&!main().includes("0555 111 22 33")'),'demo profil bilgisi görünmez');
  ok(r('return main().includes("Ücretsiz hesapla")&&!main().includes("demoya aittir")&&main().includes("Misafir")&&!main().includes("Premium üyelik")&&!main().includes("Demo modu")'),'misafir başlığı var, demo notu ve Premium kartı yok');
  r('el("#profile-signin").onclick();');
  ok(r('return window.asked===1'),'kayıt düğmesi giriş ekranını açar');
 },{win:{}});
};

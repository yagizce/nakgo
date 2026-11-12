/* Yönetim paneli yalnız admin sitesindedir: uygulama yönetici rolünü sormaz, giriş göstermez. */
module.exports=({run})=>{
 run('Uygulama profili yönetici rolünü sormaz ve yönetici girişi göstermez',async(r,ok)=>{
  r(`window.roleCalls=0;
   nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:'admin-user'},profile:{id:'admin-user',display_name:'Admin',account_type:'owner'}});
   nakgoMarket.active=()=>true;nakgoMarket.token=()=> 'admin-user:1';
   nakgoAuth.adminRole=async()=>{window.roleCalls++;return true;};
   tab='me';renderProfile(el('#main'));`);
  await Promise.resolve();await Promise.resolve();
  ok(r('return window.roleCalls===0'),'profil yönetici rolü isteği göndermez');
  ok(r('return !main().includes("profile-admin")&&!main().includes("Yönetici paneli")&&!main().includes("admin.nakgolojistik")'),'uygulamada yönetici girişi veya bağlantısı yok');
 },{win:{}});
};

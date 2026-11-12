/* Yönetici adresi: profil yüklenmeden gelen hata kalıcı ret sayılmaz, profil gelince rol yeniden sorulur. */
module.exports=({run})=>{
 run('Yönetici adresi profil yüklenince rolü yeniden sorar',async(r,ok)=>{
  r(`window.roleCalls=0;window.profileReady=false;
   nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:{id:"u-1"},profile:{id:"u-1",display_name:"A"},recovery:false});
   nakgoAuth.adminRole=async()=>{window.roleCalls++;if(!window.profileReady)throw Error('Sign in required');return true;};
   nakgoAdminAccess.reset();nakgoAdminAccess.ensure();`);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  ok(r('return window.roleCalls===1&&!nakgoAdminAccess.checked()&&!nakgoAdminAccess.isAdmin()'),'profil yokken ret kaydedilmez');
  r('window.profileReady=true;nakgoAdminAccess.ensure();');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  ok(r('return window.roleCalls===2&&nakgoAdminAccess.isAdmin()'),'profil gelince yönetici tanınır');
  r('nakgoAdminAccess.reset();nakgoAuth.adminRole=async()=>{throw Error("Denied")};nakgoAdminAccess.ensure();');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  ok(r('return nakgoAdminAccess.checked()&&!nakgoAdminAccess.isAdmin()'),'diğer hatalar yetkisiz olarak kapanır');
 },{win:{}});
};

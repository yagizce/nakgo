/* admin.* adresi yalnız yönetici paneli olarak açılır. */
module.exports = ({run}) => {
    run('Yönetici adresi giriş, yetki ve panel durumlarını ayırır',(r,ok)=>{
        ok(r('return ADMIN_HOST')===false,'normal adres yönetici modunda değil');
        ok(r('const m=$("#main");renderAdminHost(m);return m.innerHTML').includes('admin-signin'),'girişsiz: yalnız giriş düğmesi');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:{id:"u-1"},profile:{id:"u-1",display_name:"A"},recovery:false})');
        const pending=r('nakgoAuth.adminRole=()=>new Promise(()=>{});nakgoAdminAccess.reset();const m=$("#main");renderAdminHost(m);return m.innerHTML');
        ok(pending.includes('Yetki kontrol ediliyor')&&!pending.includes('admin-open'),'yetki doğrulanmadan panel açılmaz');
    });
};

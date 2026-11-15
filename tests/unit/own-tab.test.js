/* İlanlarım sekmesi: ilan yönetimi ve alarmlar yalnız burada; Profil hesap ve araçlar için. */
module.exports = ({run}) => {
    run('İlanlarım sekmesi ve sadeleşen Profil',(r,ok)=>{
        r("tab='me';render()");const profile=r('return main()');
        ok(profile.includes('id="profile-own"')&&!profile.includes('data-me=')&&!profile.includes('Rota alarmlarım')&&!profile.includes('id="mine-favorites"'),'Profil ilan, alarm ve kayıt listesi göstermez; İlanlarım bağlantısı var');
        ok(profile.includes('id="profile-fuel"')&&profile.includes('fuel-tool')&&profile.includes('id="profile-map"'),'Profil araçları duruyor; mazot kartı geniş');
        r("tab='own';render()");const own=r('return main()');
        ok(own.includes('Rota alarmlarım')&&own.includes('id="mine-favorites"')&&own.includes('İlanlarım')&&!own.includes('id="mine-post"'),'İlanlarım alarm, kaydedilenler ve ilanları gösterir; ayrı ilan ver kısayolu yok');
        ok(r("return FAQ.some(f=>f[1].includes('İlanlarım sekmesinden'))&&!FAQ.some(f=>f[1].includes(\"Profil'deki İlanlarım\"))"),'SSS ilan yönetimini yeni sekmede anlatır');
    });
};

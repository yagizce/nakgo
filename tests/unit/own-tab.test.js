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
    run('İlanlarım: süre, durum ve yeniden yayınlama',(r,ok)=>{
        r(`const base={from:'İzmir',to:'Ankara',veh:'Tır',body:'Tenteli',ton:10,cap:10,cargo:'Deneme',mine:true,uid:me,_remote:true,items:[],date:'',dateEnd:''};
           loads.push({...base,id:9101,remoteId:9101,ts:Date.now(),closed:false,shut:false,expiresAt:Date.now()+2*36e5+5*6e4},
                      {...base,id:9102,remoteId:9102,ts:Date.now()-7*36e5,closed:true,shut:false,expiresAt:Date.now()-36e5},
                      {...base,id:9103,remoteId:9103,ts:Date.now()-36e5,closed:true,shut:true,expiresAt:Date.now()+5*36e5});`);
        const html=r('return myListHTML()');
        ok(/Yayında · 2 sa \d+ dk kaldı/.test(html),'yayındaki ilanda kalan süre');
        ok(html.includes('Süresi doldu')&&html.includes('Kapattın'),'süresi dolan ile kapatılan ayrılır');
        ok((html.match(/Yeniden yayınla/g)||[]).length===2&&!html.includes('Yeniden aç'),'yayında olmayan iki ilanda yeniden yayınla düğmesi');
        ok(html.indexOf('Yayında · ')<html.indexOf('Süresi doldu'),'yayındaki ilanlar önce');
        r("loads.find(l=>l.id===9101).expiresAt=Date.now()-1");
        ok(r("return expired(loads.find(l=>l.id===9101),'load')")&&r('return myListHTML()').split('Süresi doldu').length===3,'uygulama açıkken süresi dolan ilan kapanmış sayılır');
        r("loads=loads.filter(l=>![9101,9102,9103].includes(l.id))");
    });
    run('İlan listesi: Son yayınlanan sıralaması',(r,ok)=>{
        const order=r(`const a={_remote:true,id:1,ts:Date.now()-20*36e5,expiresAt:Date.now()+5*36e5},
            b={_remote:true,id:2,ts:Date.now()-36e5,expiresAt:Date.now()+2*36e5},c={id:3,ts:Date.now()-3*36e5};
            sort='fresh';const out=sortL([b,c,a]).map(x=>x.id);sort='new';return out.join(',');`);
        ok(order==='1,3,2','yeniden yayınlanan eski ilan, son yayınlanma zamanına göre üste çıkar');
        ok(r("sort='new';const x=[{id:2},{id:1}];return sortL(x)===x"),'En yeni eklenen sırası değişmez');
        r("mode='load';tab='list';F=F0();render()");
        ok(r('return main()').includes('<option value="fresh"'),'sıralama menüsünde Son yayınlanan var');
    });
};

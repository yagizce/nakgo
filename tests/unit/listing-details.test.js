/* Additional tests, discovered by the existing npm test runner. */
module.exports = ({run,fs,path,ROOT}) => {
    run('İlan kartı kalem sayısını ve Türkiye saatiyle yayın zamanını gösterir',(r,ok)=>{
        const ts=Date.UTC(2026,10,10,21,30);
        ok(r(`return postedAt({ts:${ts}},true)`)==='11 Kasım 2026 00:30','yayın zamanı Türkiye saatiyle');
        ok(r(`return postedAt({ts:${ts}})`)==='11 Kas 00:30','kartta kısa yayın zamanı');
        ok(r('return postedAt({})')==='','zamanı olmayan ilanda boş');
        r(`loads.unshift({id:903,from:'İzmir',to:'Bursa',cargo:'Koli',ton:3,veh:'Kamyon',body:'Tenteli',date:'Cuma',ts:Date.now()-3600e3,items:[{n:'Palet',q:2,u:'adet'}]});mode='load';tab='list';F=F0();render()`);
        const h=r('return main()');
        ok(h.includes('· +1 kalem')&&!h.includes('· 1 kalem'),'kalem sayısı +1 kalem olarak');
        ok(/kaldı · \d{1,2} \S+ \d{2}:\d{2}/.test(h),'kartta kalan süre ve yayın saati');
        r("mode='truck';render()");
        const t=r('return main()');
        ok(t.includes('boş araç')&&t.includes('bugün müsait')&&!t.includes('ton kapasite'),'pazar özetinde ton kapasitesi yok');
    });
    run('Mazot ve Gider Hesaplama araç tipi seçimi içermez',(r,ok)=>{
        const src=fs.readFileSync(path.join(ROOT,'src/js/ui/helpers.js'),'utf8');
        ok(src.includes('<b>Mazot ve Gider Hesaplama</b>')&&!src.includes('<b>Mazot hesabı</b>'),'yeni ekran adı');
        ok(!src.includes('id="cv"')&&!src.includes('Araç tipi'),'araç tipi seçimi kaldırıldı');
        ok(r('return fuelEstimate({km:100,cons:30,fuel:50,toll:0,other:0,back:false}).total')===1500,'hesap mantığı değişmedi');
    });
};

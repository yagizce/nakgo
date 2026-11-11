/* Additional tests, discovered by the existing npm test runner. */
// Şehir, araç ve kasa filtreleri birlikte çalışır; sayaç ile liste aynı sonucu verir.
module.exports = ({run}) => {
    run('Şehir, araç tipi ve kasa tipi filtreleri birlikte uygulanır',(r,ok)=>{
        r(`const now=Date.now();loads.unshift(
            {id:941,from:'Kayseri',to:'Sivas',cargo:'A',ton:3,veh:'Kamyon',body:'Tenteli',date:'Bugün',ts:now},
            {id:942,from:'Kayseri',to:'Sivas',cargo:'B',ton:3,veh:'Tır',body:'Tenteli',date:'Bugün',ts:now},
            {id:943,from:'Kayseri',to:'Sivas',cargo:'C',ton:3,veh:'Kamyon',body:'Frigorifik',date:'Bugün',ts:now},
            {id:944,from:'Kayseri',to:'Tokat',cargo:'D',ton:3,veh:'Kamyon',body:'Tenteli',date:'Bugün',ts:now});
            mode='load';tab='list';F=F0();F.from='Kayseri';F.to='Sivas';F.veh=['Kamyon'];F.body=['Tenteli'];render()`);
        const ids=r(`return listingSource(false).filter(x=>visibleListing(x,false)).map(x=>x.id)`);
        ok(ids.length===1&&ids[0]===941,'yalnız dört koşulu da sağlayan ilan kalır');
        const h=r('return main()');
        ok(h.includes('data-id="941"')&&!/data-id="94[234]"/.test(h),'liste aynı sonucu gösterir');
        r(`F.veh=['Kamyon','Tır'];render()`);
        ok(r(`return listingSource(false).filter(x=>visibleListing(x,false)).map(x=>x.id).sort().join()`)==='941,942','aynı grupta birden çok seçim "veya" olarak çalışır');
        r('openFilter()');ok(r('return document.querySelector("#fs").textContent').startsWith('2 '),'filtre penceresindeki sayaç sonucu doğru gösterir');
        r(`closeSheet();F=F0();render()`);
    });
};

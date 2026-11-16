/* İlan kartı: yayın süresi kısa ve göreli, bugün yüklenecek yükte rozet, ilan ekranında demo notu yok. */
module.exports = ({run}) => {
    run('İlan kartı: göreli süre ve bugün rozeti',(r,ok)=>{
        ok(r('return ago({ts:Date.now()-12*6e4})')==='12 dk önce','dakika');
        ok(r('return ago({ts:Date.now()-3*36e5})')==='3 sa önce','saat');
        ok(r('return ago({ts:Date.now()-2*864e5})')==='2 gün önce','gün');
        ok(r('return ago({ts:Date.now()})')==='az önce'&&r('return ago({})')==='','az önce ve zamansız ilan');
        ok(r("return lCard(loads.find(x=>x.date==='Bugün'))").includes('Bugün yükleniyor'),'bugün yüklenecek yükte rozet');
        ok(!r("return lCard(loads.find(x=>x.date==='Yarın'))").includes('Bugün yükleniyor'),'yarınki yükte rozet yok');
        r("tab='list';mode='load';render()");
        ok(!r('return main()').includes('Demo modu'),'ilan ekranında demo notu yok');
        ok(/Yükler <span class="seg-count">\d+<\/span>/.test(r('return main()')),'sekmede ilan sayısı');
    });
};

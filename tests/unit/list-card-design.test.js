/* İlan kartı: yayın süresi kısa ve göreli, bugün yüklenecek yükte rozet, ilan ekranında demo notu yok. */
module.exports = ({run}) => {
    run('İlan kartı: göreli süre ve bugün rozeti',(r,ok)=>{
        ok(r('return ago({ts:Date.now()-12*6e4})')==='12 dk önce','dakika');
        ok(r('return ago({ts:Date.now()-3*36e5})')==='3 sa önce','saat');
        ok(r('return ago({ts:Date.now()-2*864e5})')==='2 gün önce','gün');
        ok(r('return ago({ts:Date.now()})')==='az önce'&&r('return ago({})')==='','az önce ve zamansız ilan');
        ok(r("return lCard(loads.find(x=>x.date==='Bugün'))").includes('Bugün yükleniyor'),'bugün yüklenecek yükte rozet');
        ok(!r("return lCard(loads.find(x=>x.date==='Yarın'))").includes('Bugün yükleniyor'),'yarınki yükte rozet yok');
        ok(r("return loadsToday({dateText:'Bugün öğleden sonra',ts:Date.now()})"),'WhatsApp metninde bugün yazan bugünkü ilan');
        ok(!r("return loadsToday({dateText:'bugün akşam',ts:Date.now()-2*864e5})"),'dünden kalan bugün metni sayılmaz');
        ok(!r("return loadsToday({dateText:'Yarın sabah',ts:Date.now()})"),'yarın yazan metin sayılmaz');
        ok(r("return lCard({...loads[0],date:null,dateText:'bugün',ts:Date.now()})").includes('Bugün yükleniyor'),'metinle gelen ilanda rozet');
        ok(r("const d=new Date();return loadsToday({dateText:d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear()})"),'bugünün tarihi yazılmış ilan');
        ok(!r("const d=new Date(Date.now()+864e5);return loadsToday({dateText:d.getDate()+'.'+(d.getMonth()+1)+'.'+d.getFullYear()})"),'yarının tarihi sayılmaz');
        r("tab='list';mode='load';render()");
        const h=r('return main()');
        ok(h.indexOf('listing-search')<h.indexOf('list-actions')&&h.indexOf('list-actions')<h.indexOf('listing-grid'),'filtreler arama kutusunun altında');
        ok(!r('return main()').includes('Demo modu'),'ilan ekranında demo notu yok');
        ok(/Yükler <span class="seg-count">\d+<\/span>/.test(r('return main()')),'sekmede ilan sayısı');
    });
    run('İlan verme: Bugün seçimi',(r,ok)=>{
        r("tab='post';postMode='load';render()");
        if(r("return !el('#d-today')")) r("el('#post-next')&&el('#post-next').onclick&&el('#post-next').onclick()");
        ok(r("return !!el('#d-today')"),'yükleme tarihinin yanında Bugün düğmesi');
        r("el('#d-today').onclick()");
        ok(r("return el('#d').value==='Bugün'"),'Bugün seçimi metni doldurur');
    });
};

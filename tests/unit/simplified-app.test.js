/* Additional tests, discovered by the existing npm test runner. */
// Ürün kararıyla kaldırılan İşlerim, taşıma talebi, puan, karşılaştırma ve belge özellikleri geri gelmez.
module.exports = ({run,fs,path,ROOT}) => {
    run('Kaldırılan iş, puan, karşılaştırma ve belge giriş noktaları yok',(r,ok)=>{
        ok(r(`return ['requestLoad','withdrawOffer','setStage','openCompare','toggleCmp','ratingOf','openRate','cOk','carCard','vbadge','lvU','lvT','nakgoJobs','nakgoDocuments'].every(n=>new Function('return typeof '+n)()==='undefined')`),'eski fonksiyon ve modüller tanımlı değil');
        const nav=fs.readFileSync(path.join(ROOT,'src/index.template.html'),'utf8');
        ok(!nav.includes('data-t="mine"')&&nav.includes('data-t="list"')&&nav.includes('data-t="post"')&&nav.includes('data-t="me"'),'alt menüde İşlerim yok, diğer sekmeler duruyor');
    });
    run('İlan listesi ve detayında puan, rozet, karşılaştırma ve talep yok',(r,ok)=>{
        r("mode='load';tab='list';F=F0();render()");
        const list=r('return main()');
        ok(!/★|Belgeli|Onaylı|cmpbar|cmpgo|value="rate"/.test(list),'kartlarda puan/rozet, listede karşılaştırma ve puan sıralaması yok');
        r('openFilter()');const filter=r('return sheet()');
        ok(!filter.includes('data-r=')&&!filter.includes('id="fo"')&&!filter.includes('belgeli'),'filtrede puan ve belgeli seçimi yok');
        r('closeSheet();openLoad(loads[0].id)');const detail=r('return sheet()');
        ok(!/request-job|Taşıma talebi|id="cp2"|★|Belgeli|Onaylı/.test(detail)&&detail.includes('id="call"')&&detail.includes('id="mg"'),'detayda talep, karşılaştır ve puan yok; ara ve mesaj duruyor');
        r("closeSheet();mode='truck';render();openTruck(trucks[0].id)");const truck=r('return sheet()');
        ok(!/★|Belgeli|Onaylı/.test(truck),'araç detayında rozet ve puan yok');
    });
    run('Profil ve yardım güncel özellikleri anlatır',(r,ok)=>{
        r("tab='me';render()");const me=r('return main()');
        ok(!/Taşıyıcı belgeleri|Devam eden iş|Onaylanan iş|değerlendirme|Değerlendirmelerimi/.test(me),'profilde belge, iş ve puan alanı yok');
        ok(me.includes('Yardım ve destek')&&me.includes('Mazot ve Gider Hesaplama'),'yardım ve hesaplama girişi duruyor');
        const faq=r('return FAQ.map(x=>x.join(" ")).join(" ")');
        ok(!/puan|belge|rozet|taşıma talebi|İşlerim/i.test(faq)&&faq.includes('Mesaj gönder'),'yardım soruları kaldırılan özelliklerden söz etmez');
        r("openProfile({uid:'u-9',name:'Firma'})");
        ok(!/★|değerlendirme|Onaylanan iş|Yorum/.test(r('return sheet()')),'herkese açık profilde puan ve iş sayısı yok');
    });
    run('Bildirimler taşıma talebi üretmez',(r,ok)=>{
        r("incoming=[{...loads[0],loadId:loads[0].id,bidder:'x',ownerUid:'me',status:'wait',stage:0,ots:Date.now()}];offers=[{...loads[1],loadId:loads[1].id,status:'ok',stage:1}]");
        ok(r("return notifs().every(x=>x.k.startsWith('a'))"),'yalnız rota alarmı bildirimleri kalır');
    });
    run('Kaldırılan özellikler sunucuya istek göndermez',(r,ok)=>{
        const src=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+fs.readFileSync(path.join(ROOT,'src/js/screens/admin.js'),'utf8');
        ok(!/nakgo_request_transport|nakgo_transition_transport|transport_jobs|carrier_document|nakgo_reserve_document|nakgo_carrier_verifications|admin-documents/.test(src),'taşıma işi ve belge çağrıları kaldırıldı');
        ok(r('return true'),'uygulama açılır');
    });
};

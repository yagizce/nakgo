/* Premium erişimi, harita koordinatları ve profil tekrarları */
module.exports = function register({run}) {
  run('Premium olmadan iki iletişim yolu da kapalı',(r,ok)=>{
    r("prem.until=0;openLoad(1);el('#mg').onclick()");
    ok(r("return sheet().includes('NakGo Premium')&&!sheet().includes('id=\"mi\"')&&Object.keys(chats).length===0&&offers.length===0"),'sohbet, mesaj ve talep oluşturulmaz');
    r("openTruck(trucks[0].id);el('#mg').onclick()");ok(r("return sheet().includes('NakGo Premium')&&Object.keys(chats).length===0"),'boş araç sohbeti de üyelik ister');
    r("callTo('')");ok(r("return sheet().includes('NakGo Premium')"),'telefon eksik olsa da üyelik kontrol edilir');
    r("openChat('otest','Firma')");ok(!r("return sheet()").includes('id="mi"'),'profil görüşmesi doğrudan açılarak atlanamaz');
  });
  run('Üyelik mesaj gönderirken yeniden kontrol edilir',(r,ok)=>{
    r("prem.until=Date.now()+10000;openChat('test','Firma',()=>offers.push({loadId:1}));el('#mi').value='Mesaj';prem.until=0;el('#ms').onclick()");
    ok(r("return !chats.test.some(x=>x.me)&&offers.length===0&&sheet().includes('NakGo Premium')"),'süresi dolan üyelik mesaj veya taşıma talebi yazamaz');
  });
  run('Harita gerçek coğrafi koordinatları kullanır',(r,ok)=>{
    ok(r("return cities.every(c=>{const p=roadUnproject(roadProject(LL[c],12),12);return Math.abs(p[0]-LL[c][0])<1e-7&&Math.abs(p[1]-LL[c][1])<1e-7})"),'81 şehir Web Mercator dönüşümünde kaybolmaz');
    ok(r("return ROAD_STOPS.length===0&&!roadStopValid({name:'Uydurma',kind:'tire',coordinates:[35,39]})&&!roadStopValid({name:'Yanlış',kind:'tire',coordinates:[39,100],source:'https://example.com',verifiedAt:1})"),'kaynağı olmayan ve yanlış konumdaki işletme gösterilmez');
    ok(r("return routeMapHTML('Afyonkarahisar','Kahramanmaraş').includes('OpenStreetMap')&&!routeMapHTML('Ankara','İstanbul').includes('animateMotion')"),'kaynak görünür, yapay navigasyon rotası çizilmez');
    r("tab='me';render()");const h=r('return main()');ok(h.includes('id="profile-map"')&&!h.includes('id="profile-jobs"')&&!h.includes('data-ro='),'harita profildeki tekrarların yerini alır');
    ok(!h.includes('undefined'),'boş profil adı yerine Profilim görünür');
  });
  run('Harita kısa ekranlarda ve aynı şehirde sonlu görünüm hesaplar',(r,ok)=>{
    ok(r("return [0,40,360,430].every(size=>{const v=roadFitViewport([LL.Ankara,LL.Ankara],size,size);return Number.isFinite(v.zoom)&&v.zoom>=ROAD_MAP.minZoom&&v.zoom<=12&&v.center.every(Number.isFinite)})"),'dar ve sıfır boyutta geçerli yakınlık ve merkez');
    ok(r("return [360,390,430,1280].every(width=>{const v=roadFitViewport([[25.6,35.7],[44.9,42.3]],width,500);return v.center[0]>25&&v.center[0]<45&&v.center[1]>35&&v.center[1]<43})"),'Türkiye görünümü gerçek sınırlar içinde kalır');
    ok(r("return roadStopsFor('tire').length===0&&roadStopsFor('rest').length===0"),'boş kategoriler örnek işletmeyle doldurulmaz');
  });
};

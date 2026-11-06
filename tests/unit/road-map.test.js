/* Premium erişimi, harita koordinatları ve profil tekrarları */
module.exports = function register({run}) {
  run('Doğrudan iletişim üyelik istemez; mesajlaşma kaldırıldı',(r,ok)=>{
    r("prem.until=0;openLoad(1)");
    ok(r("return sheet().includes('id=\"call\"')&&sheet().includes('id=\"wa\"')&&!sheet().includes('id=\"mg\"')"),'Ara ve WhatsApp düğmeleri');
    ok(r("return typeof openChat==='undefined'&&typeof nakgoMessages==='undefined'"),'mesaj API ve ekran modülü kaldırıldı');
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

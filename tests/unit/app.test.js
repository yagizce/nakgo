/* Uygulama mantığı: ilan listesi, teklifler, profil, güven, istatistik, premium ve öne çıkan ilan */
module.exports = function register({ run, test, boot, html, ROOT, fs, path }) {
  // ===== listings =====
  run("Tüm sekmeler hatasız çizilir", (r, ok) => {
    ok(r(`for(const md of ["load","truck"]){mode=md;tab="list";render();tab="post";postMode="load";render();postMode="truck";render()}tab="mine";render();tab="me";render();return true`), "list/post/mine/me");
  });

  run("81 il ve mesafe hesabı", (r, ok) => {
    ok(r("return cities.length") === 81, "81 il");
    ok(r("return cities.includes('Zonguldak')&&cities.includes('Şanlıurfa')"), "Türkçe adlar");
    ok(r("return dist('İstanbul','Ankara')") === 450, "tablo mesafesi");
    const d = r("return [dist('Adana','Zonguldak'),dist('Zonguldak','Adana')]"); ok(d[0] > 0 && d[0] === d[1], "yaklaşık mesafe simetrik " + d[0]);
    ok(r("let a=0;for(let i=0;i<cities.length;i+=7)for(let j=0;j<cities.length;j+=5)if(i!==j&&!routeMapHTML(cities[i],cities[j]))a++;return a") === 0, "harita çizimi");
  });

  run("İlanlarda ücret pazarlığı bulunmaz", (r,ok)=>{
    r("tab='list';render();openFilter()");
    ok(!/Ücret|₺\/km/.test(r("return main()")), "liste taşıma ücreti göstermez");
    ok(!r("return sheet()").includes('priceMin'), "ücret filtresi bulunmaz");
  });

  run("Filtre", (r, ok) => {
    const n = r("mode='load';F=F0();const a=loads.filter(x=>match(x,0)).length;F.veh=['Tır'];const b=loads.filter(x=>match(x,0)).length;return [a,b]");
    ok(n[1] > 0 && n[1] < n[0], "araç tipi filtresi");
  });

  run("İlan süresi (TTL)", (r, ok) => {
    r("loads.unshift({id:901,from:'İzmir',to:'Bursa',cargo:'Eski',ton:3,veh:'Kamyon',price:9000,date:'Cuma',ts:Date.now()-20*864e5});loads.unshift({id:902,from:'İzmir',to:'Bursa',cargo:'Yeni',ton:3,veh:'Kamyon',price:9000,date:'Cuma',ts:Date.now()-2*864e5});mode='load';tab='list';F=F0();render()");
    const h = r("return main()"); ok(!h.includes('data-id="901"'), "14 günü geçen ilan gizli"); ok(h.includes('data-id="902"') && h.includes("2 gün önce"), "yeni ilan ve yaş");
    ok(r("return offerExp({status:'wait',ots:Date.now()-4*864e5})") === true && r("return offerExp({status:'wait',ots:Date.now()-864e5})") === false, "teklif süresi");
  });

  run("Yükleniyor görünümü", (r, ok) => {
    r("loaded=false;mode='load';tab='list';render()"); ok(r("return main()").includes("sk"), "iskelet kartlar");
    r("loaded=true;render()"); ok(!r("return main()").includes('class="load sk"'), "iskelet kalkar");
  });

  run("Sayfalama ve puan sıralaması", (r, ok) => {
    const cards = h => (h.match(/class="load[ "]/g) || []).length;
    r("for(let i=0;i<30;i++)loads.push({id:2000+i,from:'İzmir',to:'Bursa',cargo:'T'+i,ton:3,veh:'Kamyon',price:9000+i,date:'Cuma'});mode='load';tab='list';F=F0();render()");
    let h = r("return main()"); ok(cards(h) === 20 && h.includes('id="more"'), "ilk 20 ilan ve daha fazla düğmesi (" + cards(h) + ")");
    r("shown+=20;render()"); h = r("return main()"); ok(cards(h) === 40, "20 ilan daha (" + cards(h) + ")");
    r("q='Zzz';render();q='';render()"); ok(r("return shown") === 20, "filtre değişince sıfırlanır");
    ok(r("sort='rate';return sortL([{rate:3},{rate:5},{rate:4}]).map(x=>x.rate).join()") === "5,4,3", "puana göre sıralama");
  });

  run("Yakınımdaki yükler", (r, ok) => {
    r("navigator.geolocation={getCurrentPosition:(s)=>s({coords:{latitude:39.93,longitude:32.86}})};mode='load';tab='list';F=F0();render();toggleNear()");
    ok(r("return [nearOn,myCity].join()") === "true,Ankara", "konum alınır, en yakın il Ankara");
    const h = r("return main()"); ok(h.includes("Sana ") && h.includes('data-nr="100"'), "mesafe etiketi ve yarıçap çipleri");
    const all = r("return loads.filter(l=>!l.closed).length"); r("nearR=100;render()");
    const few = (r("return main()").match(/class="load"/g) || []).length; ok(few < all, "100 km yarıçap listeyi daraltır (" + few + "/" + all + ")");
    r("toggleNear()"); ok(r("return nearOn") === false, "kapatılır");
    r("navigator.geolocation={getCurrentPosition:(s,e)=>e({code:1})};myPos=null;toggleNear()"); ok(r("return nearOn") === false, "izin reddedilirse açılmaz");
  });

  run("İlan karşılaştırma", (r, ok) => {
    r("toggleCmp(1);toggleCmp(2);mode='load';tab='list';F=F0();render()");
    ok(r("return cmp.join()") === "1,2" && r("return main()").includes('id="cmpgo"'), "iki ilan seçilir, çubuk görünür");
    r("openCompare()"); const h = r("return sheet()"); ok(h.includes("İlanları karşılaştır") && h.includes('class="win"'), "tablo ve kazanan vurgusu");
    r("toggleCmp(3)"); ok(r("return cmp.join()") === "2,3", "üçüncü seçim en eskisini çıkarır");
  });

  // ===== offers =====
  run("Teslim, puan, rozet, alarm", (r, ok) => {
    r("offers=[{...loads[1],offer:14000,status:'ok',loadId:loads[1].id,bidder:'',stage:3}];tab='mine';render()");
    ok(r("return main()").includes("Yük sahibini puanla"), "puanlama düğmesi");
    r("setCar({lic:'CE',src:true,kb:true,ruh:true})"); ok(r("return cOk(myCar)") === true, "belge tamam");
    ok(r("return [lvT({approved:true}),lvT({verified:true}),lvT({})].join()") === "2,1,0", "rozet seviyeleri");
    r("F=F0();F.from='İstanbul';addAlert();loads.unshift({id:920,from:'İstanbul',to:'İzmir',cargo:'Y',ton:2,veh:'Kamyon',price:8000,date:'Bugün'})");
    ok(r("return notifs().filter(x=>x.k.startsWith('a')&&!seen.has(x.k)).length") === 1, "alarm bildirimi");
  });

  // ===== safety =====
  run("Şikayet, engelleme, yardım", (r, ok) => {
    r("loads.unshift({id:910,from:'İzmir',to:'Bursa',cargo:'X',ton:3,veh:'Kamyon',price:9000,date:'Cuma',uid:'bad'});mode='load';tab='list';F=F0();render()");
    ok(r("return main()").includes('data-id="910"'), "engel öncesi görünür");
    r("blockUser('bad')"); ok(!r("return main()").includes('data-id="910"'), "engellenen kullanıcının ilanı gizli");
    r("openReport('l',910)"); ok(r("return sheet()").includes("Şikayet et"), "şikayet ekranı");
    r("el('#rr').value='Sahte ilan';el('#rn').value='test';el('#rg').onclick()"); ok(r("return reports.length") === 1, "şikayet kaydı");
    r("tab='me';render()"); const h = r("return main()"); ok(h.includes("Yardım ve destek") && h.includes("Engellenenler"), "profil kartları");
  });

  // ===== profile =====
  run("Herkese açık profil ve iş özeti", (r, ok) => {
    r("rates=[{k:'a',to:'u1',by:'x',stars:5,text:'Harika',ts:1},{k:'b',to:'u1',by:'y',stars:3,text:'<b>iyi</b>',ts:2}];openProfile({uid:'u1',name:'Ali',lv:2})");
    const h = r("return sheet()"); ok(h.includes("★ 4.0 (2 değerlendirme)") && h.includes("✓ Onaylı"), "puan ortalaması ve rozet");
    ok(h.includes("&lt;b&gt;iyi") && !h.includes("<b>iyi"), "yorum kaçışlı");
    r("openProfile({name:'Örnek',rate:4.6})"); ok(r("return sheet()").includes("★ 4.6"), "örnek profil");
    r("offers=[{...loads[0],offer:20000,status:'ok',loadId:1,bidder:'',stage:3},{...loads[1],offer:9000,status:'ok',loadId:2,bidder:'',stage:1}];tab='me';render()");
    const m = r("return main()"); ok(m.includes("Devam eden iş") && m.includes("Onaylanan iş") && !m.includes("Kazancım"), "kazanç yerine iş özeti");
  });

  run("İki aşamalı iş onayı ve eski kayıtlar", (r,ok)=>{
    r("offers=[{...loads[0],offer:20000,status:'ok',loadId:1,bidder:'',stage:2}];setStage(offers[0],3)");
    ok(r("return offers[0].doneAt")>0, "onay zamanı kaydedilir");
    ok(r("return jobStage({stage:2})===1&&jobStage({stage:3})===3"), "eski yüklenmiş ve onaylanmış işler korunur");
    r("tab='mine';render()");const h=r("return main()");
    ok(h.includes('Onaylandı')&&!/Teslim ettim|Fotoğrafı gör|data-chat|data-cl=/.test(h), "gereksiz iş adımları ve iletişim düğmeleri yok");
  });

  run("İlk açılış tanıtımı ve rol", (r, ok) => {
    ok(r("return el('#onb').innerHTML.length") > 0, "ilk açılışta tanıtım çizilir");
    r("setRole('owner',1)"); ok(r("return [mode,postMode].join()") === "truck,load", "yük sahibi: boş araç listesi, yük ilanı formu");
    r("setRole('carrier',1)"); ok(r("return [mode,postMode].join()") === "load,truck", "taşıyıcı: yük listesi, boş araç formu");
    ok(r("return localStorage.getItem('yy-role')") === "carrier", "rol kaydedilir");
  }, { onboarded: false });

  // ===== stats =====
  run("İlan istatistikleri", (r, ok) => {
    r("loads.unshift({id:700,from:'İzmir',to:'Bursa',cargo:'Test',ton:3,veh:'Kamyon',price:10000,date:'Cuma',uid:'ME',ts:Date.now()-3*864e5})");
    const d = r("return statsOf(loads[0])"); ok(d.demo === true && d.views > 0, "yerel modda örnek veri");
    r("cloud=true;me='ME';events=[{t:'v',loadId:700,uid:'a',ts:Date.now()},{t:'v',loadId:700,uid:'b',ts:Date.now()-864e5},{t:'v',loadId:700,uid:'ME',ts:Date.now()},{t:'s',loadId:700,uid:'a',ts:1},{t:'c',loadId:700,uid:'b',ts:1}];allO=[{loadId:700,bidder:'a',offer:8000,status:'wait'},{loadId:700,bidder:'b',offer:9000,status:'wait'}]");
    const s = r("return statsOf(loads[0])");
    ok(s.views === 2 && s.saves === 1 && s.calls === 1 && s.offers === 2, "bulutta gerçek sayılar, kendi görüntülemem sayılmaz");
    ok(s.daily[6] === 1 && s.daily[5] === 1, "günlük dağılım");
    r("openStats(700)"); const h = r("return sheet()"); ok(h.includes("İlan performansı") && h.includes("Talep oranı") && h.includes("%100"), "istatistik penceresi");
    ok(!/En yüksek teklif|İlan ücreti/.test(h), "ilan performansında taşıma ücretleri yok");
    r("tab='me';render()"); ok(r("return main()").includes('data-st2="700"'), "İlanlarım'da İstatistik düğmesi");
  });

  // ===== premium =====
  run("Premium ve arama", (r, ok) => {
    ok(r("return isPrem()") === false, "başta üye değil");
    r("callTo(phoneOf(loads[0]))"); ok(r("return sheet()").includes("NakGo Premium"), "paywall açılır");
    ok(/299/.test(r("return sheet()")) && /3\.099/.test(r("return sheet()")), "iki plan");
    r("el('#buy').onclick()"); ok(r("return isPrem()") === true, "satın alma (test)");
    r("callTo(phoneOf(loads[0]))"); ok(r("return sheet()").includes("Örnek telefon")&&!r("return sheet()").includes("tel:"), "demo numarası aranmaz");
    r("callTo('0555 123 45 67')"); ok(r("return sheet()").includes("tel:05551234567"), "gerçek numara için arama ekranı");
    r("el('#myph').value='0532 111 22 33';savePhone()"); ok(r("return myCar.phone") === "0532 111 22 33", "geçerli numara");
    r("el('#myph').value='123';savePhone()"); ok(r("return myCar.phone") === "0532 111 22 33", "geçersiz numara reddedilir");
  });

  run("Öne çıkan ilan ve boş araç ilanı", (r, ok) => {
    ok(r("return [3,6,12,24,72].map(h=>featPrice('l',h)).join()") === "19,32,61,99,267", "sabit fiyat listesi (yük)");
    ok(r("return [3,6,12,24,72].map(h=>featPrice('t',h)).join()") === "19,32,61,99,267", "sabit fiyat listesi (boş araç)");
    ok(!/hourMult|FEAT\.peak|FEAT\.low/.test(html), "saat çarpanı kodu kalmadı");
    ok(r("const a=featPrice('l',6);return a")===32 && r("return featPrice('l',24)")===99, "fiyat saatten bağımsız");
    r("loads.unshift({id:800,from:'İzmir',to:'Bursa',cargo:'Öne',ton:3,veh:'Kamyon',price:9000,date:'Cuma',mine:true});trucks.unshift({id:'t900',from:'İzmir',to:'Ankara',veh:'Tır',cap:10,body:'Tenteli',date:'Yarın',mine:true,rate:'Yeni'})");
    r("openFeature('l',800)"); let h = r("return sheet()"); ok(h.includes("İlanını öne çıkar") && h.includes("3 gün") && !h.includes("Yoğun"), "yük için fiyat ekranı, saat çubuğu yok");
    r("el('#fbuy').onclick()"); ok(r("return isF(findIt('l',800))") === true && r("return findIt('l',800).featPaid") === 32, "yük öne çıkar, 6 saat 32 ₺");
    r("openFeature('t','t900')"); h = r("return sheet()"); ok(h.includes("Boş araç ilanını öne çıkar"), "boş araç için fiyat ekranı");
    r("el('#fbuy').onclick()"); ok(r("return isF(findIt('t','t900'))") === true && r("return findIt('t','t900').featPaid") === 32, "boş araç öne çıkar");
    r("mode='load';tab='list';F=F0();render()"); let m = r("return main()"); ok(m.indexOf('data-id="800"') < m.indexOf('data-id="1"') && m.includes("Öne çıkan"), "yük listesinde başta ve etiketli");
    r("mode='truck';render()"); m = r("return main()"); ok(m.indexOf('data-tid="t900"') < m.indexOf('data-tid="t1"') && m.includes("Öne çıkan"), "boş araç listesinde başta ve etiketli");
    r("tab='me';render()"); m = r("return main()"); ok(m.includes('data-ft="l|800"') && m.includes('data-ft="t|t900"') && m.includes("Uzat"), "İlanlarım'da iki türde de Uzat");
    r("openFeature('l',800)"); ok(r("return sheet()").includes("yeni süre bitince başlar"), "aktifken yeni süre bitişten başlar");
  });

  run("Öne çıkarmanın etkisi", (r, ok) => {
    r("loads.unshift({id:810,from:'İzmir',to:'Bursa',cargo:'Etki',ton:3,veh:'Kamyon',price:10000,date:'Cuma',uid:'ME',ts:Date.now()-20*36e5,featWin:[[Date.now()-10*36e5,Date.now()-4*36e5]],featFrom:Date.now()-10*36e5,featUntil:Date.now()-4*36e5,featPaid:32})");
    r("cloud=true;me='ME';const n=Date.now();events=[];for(let i=0;i<9;i++)events.push({t:'v',loadId:810,uid:'a'+i,ts:n-9*36e5+i*1e5});for(let i=0;i<3;i++)events.push({t:'v',loadId:810,uid:'b'+i,ts:n-15*36e5+i*1e5});allO=[{loadId:810,bidder:'a1',offer:9000,status:'wait',ts:n-8*36e5},{loadId:810,bidder:'a2',offer:9100,status:'wait',ts:n-7*36e5},{loadId:810,bidder:'b1',offer:8000,status:'wait',ts:n-15*36e5}]");
    const fx = r("return statsOf(loads[0]).fx"); ok(fx && fx.enough && fx.lift > 100, "gerçek verilerden ilgi artışı hesaplanır (%" + (fx && fx.lift) + ")");
    ok(fx.oF === 2 && Math.round(fx.hF) === 6, "öne çıkarma sırasında gelen teklifler ve saat");
    r("openStats(810)"); const h = r("return sheet()"); ok(h.includes("Öne çıkarmanın etkisi") && h.includes("saatlik") && !h.includes("Örnek veri"), "istatistik ekranında etki kutusu");
    r("events=events.slice(0,2)"); ok(r("return statsOf(loads[0]).fx.lift") === null, "az veride sonuç vermez");
    r("openStats(810)"); ok(r("return sheet()").includes("Henüz yeterli veri yok. Anlamlı"), "yetersiz veri uyarısı");
    r("tab='me';render()"); const m = r("return main()"); ok(m.includes('data-st2="810"') && m.includes('data-me="l|810"'), "profilde ilan yönetimi korunur");
    r("cloud=false;loads.unshift({id:811,from:'İzmir',to:'Bursa',cargo:'Demo',ton:3,veh:'Kamyon',price:10000,date:'Cuma',mine:true,featFrom:Date.now(),featUntil:Date.now()+6*36e5,featPaid:32});openStats(811)");
    ok(r("return sheet()").includes("Örnek veri"), "yerel modda örnek veri olarak işaretlenir");
    r("openFeature('l',811)");r("el('#fbuy').onclick()"); ok(r("const x=findIt('l',811);return isF(x)&&x.featUntil>Date.now()+11*36e5&&x.featWin.length===2")===true, "aktifken uzatma kesintisiz sürer, pencere kaydedilir");
  });
};

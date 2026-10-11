/* İlan yenilemesi: filtrelerin birlikte çalışması ve teklif işleminin korunması */
module.exports = function register({ run }) {
  run("Güzergâh filtresi ve kaldırılabilir etiketler", (r, ok) => {
    r("F=F0();F.from='İstanbul';F.to='Ankara';F.veh=['Tır'];tab='list';mode='load';render()");
    let h = r("return main()");
    ok(h.includes('id="route-from"') && h.includes('value="İstanbul" selected'), "arama alanı mevcut filtreden değer alır");
    ok(h.includes('data-id="1"') && !h.includes('data-id="2"'), "güzergâh ve araç filtresi birlikte uygulanır");
    r("rmF('from','')");
    ok(r("return F.from===''&&F.to==='Ankara'&&F.veh[0]==='Tır'"), "tek etiket kaldırılınca diğer filtreler korunur");
    r("el('#route-swap').onclick()");
    ok(r("return F.from==='Ankara'&&F.to===''"), "güzergâh değişimi gerçek filtreyi günceller");
    r("q='Sonuçsuz';nearOn=true;render();el('#rs').onclick()");
    ok(r("return q===''&&!nearOn&&fcount()===0"), "boş sonuçtan sıfırlama arama ve yakınlığı da temizler");
  });
  run("İlan önceliği ve demo açıklaması", (r, ok) => {
    r("tab='list';mode='load';render()");
    const h = r("return main()"), card = r("return lCard(loads.find(x=>x.date==='Bugün'))");
    ok(h.indexOf('route-search') < h.indexOf('class="seg"') && h.indexOf('market-stats') > h.indexOf('data-id="1"'), "arama başta, istatistik ilanlardan sonra");
    ok(h.includes('id="fuel-home"') && h.includes('Demo modu'), "mazot hesabı kısayolu erişilir, demo açıklaması görünür");
    ok(card.includes('Bugün') && !card.includes('Acil'), "Bugün ayrı aciliyet verisi olmadan Acil olmaz");
    ok(!card.includes("Taşıma ücreti") && card.includes("Ara veya mesajlaş"), "fiyat yerine iletişim vurgusu gelir");
    r("cloud=true;render()");
    ok(!r("return main()").includes('Demo modu'), "bulut modunda demo açıklaması görünmez");
  });
  run("Detaydan tutarsız taşıma talebi ve kalıcılık", (r,ok)=>{
    r("openLoad(1)");const h=r("return sheet()");
    ok(['Yük bilgileri','Taşıma bilgileri','Yük sahibi','Tahmini mesafe','Mazot hesabı'].every(t=>h.includes(t)), "bilgi grupları ve hesap erişimi");
    ok(h.includes('dual-contact')&&['cc','sh','call','pf','cp2','rp','close','mg'].every(id=>h.includes('id=\"'+id+'\"'))&&!h.includes('id=\"o\"'), "tutar alanı yerine arama ve mesajlaşma");
    r("el('#send').onclick();tab='mine';render()");
    ok(r("return offers[0].offer===0&&offers[0].loadId===1&&offers[0].status==='wait'"), "talep tutarsız kaydedilir");
    ok(r("return JSON.parse(localStorage.getItem('yy2')).offers[0].loadId")===1, "yerel saklama korunur");
    r("openLoad(1);el('#send').onclick()");ok(r("return offers.length")===1, "aynı talep yinelenmez");
  });
};

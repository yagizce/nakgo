/**
 * Yol haritası ekranı
 * Şehir seçimi, kategori durumu ve açıldığı ilana geri dönüş.
 */

function openRoadMap(from="",to="",returnToDetail=null) {
    roadMapDispose(true);
    const body=$('#sheetBody');body.dataset.k='';
    body.innerHTML=`<div class="load-detail road-detail">
        <div class="detail-top">
            ${returnToDetail?`<button class="chip road-back" id="map-back">${uiIcon('back')} İlana dön</button>`:'<b>Yol haritası</b>'}
            <button class="chip detail-close" id="close">Kapat ×</button>
        </div>
        <div class="road-heading">
            <span class="eyebrow">TÜRKİYE · YOLDA YANINDA</span>
            <h2>${from?esc(from)+' → '+esc(to):'Yolunu keşfet'}</h2>
            <div class="road-city-field">${uiIcon('map')}<label class="sr-only" for="map-city">Haritada şehir bul</label>
                <select id="map-city"><option value="">${from?'Güzergâhın tamamı':'Türkiye geneli'}</option>${opt2(cities,'')}</select>
            </div>
        </div>
        ${roadMapHTML(from,to)}
        <div class="road-footer">
            <div class="road-categories" role="group" aria-label="Yol noktası türü">
                <button class="chip on" data-map-kind="" aria-pressed="true">Tümü</button>
                ${Object.entries(ROAD_KINDS).map(([kind,label])=>`<button class="chip" data-map-kind="${kind}" aria-pressed="false">${label}</button>`).join('')}
            </div>
            <p id="map-poi-note" role="status"></p>
            <small class="road-hint${from?' road-route-note':''}">${from?'Kesikli çizgi şehir merkezlerini bağlar; navigasyon rotası değildir.':'Kaydırarak gezin · İki parmakla yakınlaştır'}</small>
        </div>
    </div>`;
    syncDetailViewport();$('#sheet').classList.add('open');$('#close').onclick=closeSheet;
    if(returnToDetail)$('#map-back').onclick=returnToDetail;
    roadMapBind(body,null,()=>{$('#map-city').value='';});

    function updateNote(kind) {
        const count=roadStopsFor(kind).length;
        $('#map-poi-note').textContent=count?count+' doğrulanmış yol noktası gösteriliyor.':
            'Henüz '+(kind?ROAD_KINDS[kind].toLocaleLowerCase('tr-TR'):'yol noktası')+' eklenmedi. Doğruladığımız işletmeler burada yer alacak.';
    }
    updateNote('');
    body.querySelectorAll('[data-map-kind]').forEach(button=>button.onclick=()=>{
        body.querySelectorAll('[data-map-kind]').forEach(item=>{
            item.classList.toggle('on',item===button);item.setAttribute('aria-pressed',String(item===button));
        });
        roadMaps.forEach(controller=>controller.category(button.dataset.mapKind));updateNote(button.dataset.mapKind);
    });
    $('#map-city').onchange=event=>roadMaps.forEach(controller=>controller.focus(event.target.value));
}

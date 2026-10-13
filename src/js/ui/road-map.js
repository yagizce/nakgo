/**
 * Harita bileşeni
 * Ortak harita işaretlemesi, detaydan büyütme ve etkin kontrolcülerin temizliği.
 */

function roadMapHTML(from="",to="") {
    const fitLabel=from?'Çıkış ve varışı göster':'Türkiye genelini göster';
    return `<div class="road-map" data-from="${esc(from)}" data-to="${esc(to)}">
        <div class="road-viewport" tabindex="0" role="region" aria-label="Türkiye yol haritası. Ok tuşlarıyla kaydır; artı ve eksiyle yakınlaştır.">
            <div class="road-pane"><div class="road-tiles"></div><div class="road-pins"></div></div>
        </div>
        <div class="road-controls" role="group" aria-label="Harita kontrolleri">
            <button type="button" data-map-action="fit" aria-label="${fitLabel}" title="${fitLabel}">${uiIcon('fit')}</button>
            <button type="button" data-map-action="in" aria-label="Haritayı yakınlaştır" title="Yakınlaştır">${uiIcon('plus')}</button>
            <button type="button" data-map-action="out" aria-label="Haritayı uzaklaştır" title="Uzaklaştır">${uiIcon('minus')}</button>
        </div>
        <div class="road-status" role="status"><span>Harita yükleniyor…</span><button class="chip" data-map-action="retry" hidden>Yeniden dene</button></div>
        <div class="road-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıda bulunanlar</div>
    </div>`;
}
function routeMapHTML(a,b) {
    if(!LL[a]||!LL[b])return "";
    return `${roadMapHTML(a,b)}<div class="road-caption"><span>A · Çıkış: ${esc(a)}<br>B · Varış: ${esc(b)}</span><button class="chip" data-map-expand>Haritayı büyüt ↗</button></div><p class="estimate-note">Kesikli çizgi şehir merkezlerini bağlar; yol veya tıra uygun navigasyon rotası değildir. Mesafe tahminidir.</p>`;
}
function roadMapDispose(all=false) {
    roadMaps.forEach(controller=>{
        if(all||!controller.el.isConnected) {controller.dispose();roadMaps.delete(controller);}
    });
}

function roadMapBind(root,returnToDetail=null,onViewChange=()=>{}) {
    roadMapDispose();
    root.querySelectorAll('.road-map').forEach(el=>{
        if(el.dataset.bound)return;
        el.dataset.bound='1';
        roadMaps.add(createRoadMapController(el,onViewChange));
    });
    root.querySelectorAll('[data-map-expand]').forEach(button=>button.onclick=()=>{
        const map=button.closest('.detail-group').querySelector('.road-map');
        openRoadMap(map.dataset.from,map.dataset.to,returnToDetail);
    });
}

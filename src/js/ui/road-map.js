/**
 * Gerçek yol haritası
 * Web Mercator harita, dokunmatik gezinme ve doğrulanmış yol noktaları; yalnızca görünen döşemeler yüklenir.
 */

const ROAD_MAP = {tiles:"https://tile.openstreetmap.org/{z}/{x}/{y}.png",minZoom:4,maxZoom:17};
// Doğrulanmış işletmeler burada tutulacak. OSM üzerindeki genel POI'ler NakGo onayı anlamına gelmez.
// Biçim: {id,name,kind:'tire'|'repair'|'rest',coordinates:[boylam,enlem],source,verifiedAt}.
const ROAD_STOPS = [];
const ROAD_KINDS = {tire:"Lastikçi",repair:"Tamirci",rest:"Dinlenme tesisi"};
const roadMaps = new Set();

function roadProject([lon,lat],z) {
    const size=256*2**z,s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);
    return [(lon+180)/360*size,(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*size];
}
function roadUnproject([x,y],z) {
    const size=256*2**z;
    return [x/size*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI];
}
function roadStopValid(s) {
    return !!(s&&ROAD_KINDS[s.kind]&&s.name&&s.source&&s.verifiedAt&&Array.isArray(s.coordinates)&&s.coordinates.length===2&&s.coordinates.every(Number.isFinite)&&s.coordinates[0]>=25&&s.coordinates[0]<=45&&s.coordinates[1]>=35&&s.coordinates[1]<=43);
}
function roadMapHTML(a="",b="") {
    return `<div class="road-map" data-from="${esc(a)}" data-to="${esc(b)}"><div class="road-viewport" tabindex="0" role="region" aria-label="Türkiye yol haritası. Ok tuşlarıyla kaydır; artı ve eksiyle yakınlaştır."><div class="road-pane"><div class="road-tiles"></div><div class="road-pins"></div></div></div><div class="road-controls"><button type="button" data-map-action="in" aria-label="Haritayı yakınlaştır">+</button><button type="button" data-map-action="out" aria-label="Haritayı uzaklaştır">−</button><button type="button" data-map-action="fit" aria-label="${a?'Çıkış ve varışı göster':'Türkiye genelini göster'}">⌖</button></div><div class="road-status" role="status"><span>Harita yükleniyor…</span><button class="chip" data-map-action="retry" hidden>Yeniden dene</button></div><div class="road-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıda bulunanlar</div></div>`;
}
function routeMapHTML(a,b) {
    if(!LL[a]||!LL[b])return "";
    return `${roadMapHTML(a,b)}<div class="road-caption"><span>● Çıkış: ${esc(a)}<br>● Varış: ${esc(b)}</span><button class="chip" data-map-expand>Haritayı büyüt ↗</button></div><p class="estimate-note">Şehir merkezleri gösterilir. Mesafe tahminidir; tıra uygun navigasyon rotası değildir.</p>`;
}
function roadMapDispose(all=false) {
    roadMaps.forEach(c=>{if(all||!c.el.isConnected){c.dispose();roadMaps.delete(c);}});
}
function roadMapBind(root) {
    roadMapDispose();
    root.querySelectorAll('.road-map').forEach(el=>{
        if(el.dataset.bound)return;
        el.dataset.bound='1';
        const viewport=el.querySelector('.road-viewport'),pane=el.querySelector('.road-pane'),tiles=el.querySelector('.road-tiles'),pins=el.querySelector('.road-pins'),status=el.querySelector('.road-status span'),retry=el.querySelector('[data-map-action=retry]');
        const a=el.dataset.from,b=el.dataset.to,route=LL[a]&&LL[b],points=route?[LL[a],LL[b]]:[[25.6,35.7],[44.9,42.3]];
        let z=4,center=[35.25,39],width=0,height=0,active=false,disposed=false,category="",serial=0;
        let ro,io,frame;const fingers=new Map();let gesture=null;
        const clamp=()=>{center=[Math.max(24,Math.min(46,center[0])),Math.max(34,Math.min(44,center[1]))];};
        const fit=()=>{
            const p=points.map(x=>roadProject(x,0)),dx=Math.abs(p[0][0]-p[1][0]),dy=Math.abs(p[0][1]-p[1][1]);
            z=Math.max(ROAD_MAP.minZoom,Math.min(12,Math.floor(Math.log2(Math.min((width-90)/Math.max(dx,.5),(height-90)/Math.max(dy,.5))))));
            center=roadUnproject([(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2],0);clamp();
        };
        const draw=()=>{
            if(!active||disposed||width<1)return;
            pane.style.transform='';pane.style.transformOrigin='';el.dataset.zoom=z;el.dataset.center=center.map(x=>x.toFixed(5)).join(',');
            const [cx,cy]=roadProject(center,z),left=cx-width/2,top=cy-height/2,n=2**z,keep=new Set();
            const ticket=++serial;let pending=0,failed=0;
            const settle=()=>{if(ticket!==serial||disposed)return;status.textContent=failed?'Bazı harita parçaları yüklenemedi. İnternet bağlantını kontrol et.':pending?'Harita yükleniyor…':'';retry.hidden=!failed;};
            for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++){
                if(x<0||y<0||x>=n||y>=n)continue;
                const key=z+'-'+x+'-'+y;keep.add(key);
                let img=tiles.querySelector(`[data-tile="${key}"]`);
                if(!img){img=document.createElement('img');img.dataset.tile=key;img.alt='';img.draggable=false;img.referrerPolicy='strict-origin-when-cross-origin';tiles.appendChild(img);img.src=ROAD_MAP.tiles.replace('{z}',z).replace('{x}',x).replace('{y}',y);}
                img.style.transform=`translate(${Math.round(x*256-left)}px,${Math.round(y*256-top)}px)`;
                if(img.complete){if(!img.naturalWidth)failed++;}else{pending++;img.onload=()=>{pending--;settle();};img.onerror=()=>{pending--;failed++;settle();};}
            }
            tiles.querySelectorAll('img').forEach(img=>{if(!keep.has(img.dataset.tile)){img.onload=img.onerror=null;img.remove();}});
            const markers=route?[{name:a,coordinates:LL[a],label:'Çıkış',className:'start'},{name:b,coordinates:LL[b],label:'Varış',className:'finish'}]:[];
            markers.push(...ROAD_STOPS.filter(s=>roadStopValid(s)&&(!category||category===s.kind)).map(s=>({...s,label:ROAD_KINDS[s.kind],className:'stop'})));
            pins.innerHTML=markers.map(s=>{const [x,y]=roadProject(s.coordinates,z),sx=x-left,sy=y-top;if(sx<0||sy<0||sx>width||sy>height)return '';return `<div class="road-pin ${s.className}" style="left:${sx}px;top:${sy}px"><i></i><span><small>${esc(s.label)}</small>${esc(s.name)}</span></div>`;}).join('');
            el.querySelector('[data-map-action=in]').disabled=z>=ROAD_MAP.maxZoom;el.querySelector('[data-map-action=out]').disabled=z<=ROAD_MAP.minZoom;settle();
        };
        const zoom=(delta,anchor=[width/2,height/2])=>{
            const next=Math.max(ROAD_MAP.minZoom,Math.min(ROAD_MAP.maxZoom,z+delta));if(next===z)return;
            const c=roadProject(center,z),geo=roadUnproject([c[0]+anchor[0]-width/2,c[1]+anchor[1]-height/2],z);z=next;
            const p=roadProject(geo,z);center=roadUnproject([p[0]-anchor[0]+width/2,p[1]-anchor[1]+height/2],z);clamp();draw();
        };
        el.querySelectorAll('[data-map-action]').forEach(btn=>btn.onclick=()=>{
            const act=btn.dataset.mapAction;
            if(act==='in'||act==='out')zoom(act==='in'?1:-1);
            if(act==='fit'){fit();draw();}
            if(act==='retry'){tiles.querySelectorAll('img').forEach(img=>{if(img.complete&&!img.naturalWidth)img.remove();});draw();}
        });
        const position=e=>{const rect=viewport.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];};
        const begin=()=>{const p=[...fingers.values()],mid=p.length>1?[(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2]:p[0];gesture={mid,center:roadProject(center,z),distance:p.length>1?Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1]):0};};
        viewport.onpointerdown=e=>{if(e.button&&e.button!==0)return;viewport.setPointerCapture(e.pointerId);fingers.set(e.pointerId,position(e));begin();};
        viewport.onpointermove=e=>{if(!fingers.has(e.pointerId)||!gesture)return;fingers.set(e.pointerId,position(e));const p=[...fingers.values()],mid=p.length>1?[(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2]:p[0];const ratio=p.length>1&&gesture.distance?Math.max(.25,Math.min(4,Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1])/gesture.distance)):1;pane.style.transformOrigin=gesture.mid[0]+'px '+gesture.mid[1]+'px';pane.style.transform=`translate(${mid[0]-gesture.mid[0]}px,${mid[1]-gesture.mid[1]}px) scale(${ratio})`;};
        const end=e=>{
            if(!fingers.has(e.pointerId)||!gesture)return;
            const p=[...fingers.values()],mid=p.length>1?[(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2]:p[0];
            center=roadUnproject([gesture.center[0]-mid[0]+gesture.mid[0],gesture.center[1]-mid[1]+gesture.mid[1]],z);clamp();
            if(p.length>1&&gesture.distance){const ratio=Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1])/gesture.distance;zoom(Math.round(Math.log2(Math.max(.25,ratio))),mid);}
            fingers.delete(e.pointerId);gesture=null;if(fingers.size)begin();draw();
        };
        viewport.onpointerup=end;viewport.onpointercancel=()=>{fingers.clear();gesture=null;pane.style.transform='';};
        viewport.onkeydown=e=>{const actions={'+':()=>zoom(1),'=':()=>zoom(1),'-':()=>zoom(-1),'0':()=>{fit();draw();}};if(actions[e.key]){e.preventDefault();actions[e.key]();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const p=roadProject(center,z);p[0]+=e.key==='ArrowLeft'?-80:e.key==='ArrowRight'?80:0;p[1]+=e.key==='ArrowUp'?-80:e.key==='ArrowDown'?80:0;center=roadUnproject(p,z);clamp();draw();}};
        viewport.onwheel=e=>{if(!e.ctrlKey)return;e.preventDefault();zoom(e.deltaY<0?1:-1,position(e));};
        const size=()=>{const rect=viewport.getBoundingClientRect();if(rect.width<1||rect.height<1)return;const initial=!width;width=rect.width;height=rect.height;if(initial)fit();draw();};
        const activate=()=>{if(active||disposed)return;active=true;size();if(typeof ResizeObserver!=='undefined'){ro=new ResizeObserver(size);ro.observe(viewport);}};
        if(typeof IntersectionObserver!=='undefined'){io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){activate();io.disconnect();}},{rootMargin:'30px'});io.observe(el);}else frame=requestAnimationFrame(activate);
        const controller={el,category:value=>{category=value;draw();},focus:city=>{if(LL[city]){center=LL[city].slice();z=11;draw();}else{fit();draw();}},dispose:()=>{disposed=true;io?.disconnect();ro?.disconnect();if(frame)cancelAnimationFrame(frame);tiles.querySelectorAll('img').forEach(img=>img.onload=img.onerror=null);fingers.clear();}};
        roadMaps.add(controller);
    });
    root.querySelectorAll('[data-map-expand]').forEach(btn=>btn.onclick=()=>{const map=btn.closest('.detail-group').querySelector('.road-map');openRoadMap(map.dataset.from,map.dataset.to);});
}
function openRoadMap(a="",b="") {
    roadMapDispose(true);
    const B=$('#sheetBody');B.dataset.k='';
    B.innerHTML=`<div class="load-detail road-detail"><div class="detail-top"><b>Yol haritası</b><button class="chip detail-close" id="close">Kapat ×</button></div><div class="road-heading"><span class="eyebrow">TÜRKİYE · YOLDA YANINDA</span><h2>${a?esc(a)+' → '+esc(b):'Yolunu keşfet'}</h2><p>${a?'Çıkış ve varış şehir merkezleri.':'Şehirleri ve yolları keşfet; iki parmakla yakınlaştır.'}</p><label class="sr-only" for="map-city">Haritada şehir bul</label><select id="map-city"><option value="">Türkiye geneli</option>${opt2(cities,'')}</select></div>${roadMapHTML(a,b)}<div class="road-footer"><div class="road-categories"><button class="chip on" data-map-kind="">Tümü</button>${Object.entries(ROAD_KINDS).map(([k,v])=>`<button class="chip" data-map-kind="${k}">${v}</button>`).join('')}</div><p id="map-poi-note" role="status"></p></div></div>`;
    syncDetailViewport();$('#sheet').classList.add('open');$('#close').onclick=closeSheet;roadMapBind(B);
    const note=k=>{const count=ROAD_STOPS.filter(s=>roadStopValid(s)&&(!k||s.kind===k)).length;$('#map-poi-note').textContent=count?count+' doğrulanmış yol noktası gösteriliyor.':'Henüz '+(k?ROAD_KINDS[k].toLocaleLowerCase('tr-TR'):'yol noktası')+' eklenmedi. Doğruladığımız işletmeler burada yer alacak.';};note('');
    B.querySelectorAll('[data-map-kind]').forEach(btn=>btn.onclick=()=>{B.querySelectorAll('[data-map-kind]').forEach(x=>x.classList.toggle('on',x===btn));roadMaps.forEach(c=>c.category(btn.dataset.mapKind));note(btn.dataset.mapKind);});
    $('#map-city').onchange=e=>roadMaps.forEach(c=>c.focus(e.target.value));
}

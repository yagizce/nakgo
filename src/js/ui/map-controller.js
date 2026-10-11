/**
 * Harita hareketleri ve yaşam döngüsü
 * Görünen döşemeler, dokunma, klavye, boyutlandırma ve kaynakların serbest bırakılması.
 */

const roadMaps = new Set();

function createRoadMapController(el,onViewChange=()=>{}) {
    const viewport=el.querySelector('.road-viewport'),pane=el.querySelector('.road-pane');
    const tiles=el.querySelector('.road-tiles'),pins=el.querySelector('.road-pins');
    const status=el.querySelector('.road-status span'),retry=el.querySelector('[data-map-action=retry]');
    const from=el.dataset.from,to=el.dataset.to,route=LL[from]&&LL[to];
    const points=route?[LL[from],LL[to]]:[[25.6,35.7],[44.9,42.3]];
    let zoomLevel=ROAD_MAP.minZoom,center=[35.25,39],width=0,height=0;
    let active=false,disposed=false,category='',serial=0,resizeObserver,intersectionObserver,frame;
    const fingers=new Map();
    let gesture=null;

    function clampCenter() {
        center=[Math.max(24,Math.min(46,center[0])),Math.max(34,Math.min(44,center[1]))];
    }
    function fit() {
        const view=roadFitViewport(points,width,height);
        zoomLevel=view.zoom;center=view.center;clampCenter();
    }
    function drawTiles(left,top) {
        const count=2**zoomLevel,keep=new Set(),ticket=++serial;
        let pending=0,failed=0;
        function settle() {
            if(ticket!==serial||disposed)return;
            status.textContent=failed?'Harita yüklenemedi.':pending?'Harita yükleniyor…':'';
            retry.hidden=!failed;
        }
        for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++) {
            for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++) {
                if(x<0||y<0||x>=count||y>=count)continue;
                const key=zoomLevel+'-'+x+'-'+y;keep.add(key);
                let img=tiles.querySelector(`[data-tile="${key}"]`);
                if(!img) {
                    img=document.createElement('img');img.dataset.tile=key;img.alt='';img.draggable=false;
                    img.referrerPolicy='strict-origin-when-cross-origin';tiles.appendChild(img);
                    img.src=ROAD_MAP.tiles.replace('{z}',zoomLevel).replace('{x}',x).replace('{y}',y);
                }
                img.style.transform=`translate(${Math.round(x*256-left)}px,${Math.round(y*256-top)}px)`;
                if(img.complete) {if(!img.naturalWidth)failed++;}
                else {pending++;img.onload=()=>{pending--;settle();};img.onerror=()=>{pending--;failed++;settle();};}
            }
        }
        tiles.querySelectorAll('img').forEach(img=>{
            if(!keep.has(img.dataset.tile)) {img.onload=img.onerror=null;img.remove();}
        });
        settle();
    }
    function drawPins(left,top) {
        const markers=route?[
            {name:from,coordinates:LL[from],label:'Çıkış',className:'start'},
            {name:to,coordinates:LL[to],label:'Varış',className:'finish'}
        ]:[];
        markers.push(...roadStopsFor(category).map(stop=>({...stop,label:ROAD_KINDS[stop.kind],className:'stop'})));
        pins.innerHTML=markers.map(marker=>{
            const point=roadProject(marker.coordinates,zoomLevel),x=point[0]-left,y=point[1]-top;
            if(x<0||y<0||x>width||y>height)return '';
            return `<div class="road-pin ${marker.className}" style="left:${x}px;top:${y}px"><i></i><span><small>${esc(marker.label)}</small>${esc(marker.name)}</span></div>`;
        }).join('');
    }
    function draw() {
        if(!active||disposed||width<1)return;
        pane.style.transform='';pane.style.transformOrigin='';
        el.dataset.zoom=zoomLevel;el.dataset.center=center.map(value=>value.toFixed(5)).join(',');
        const projected=roadProject(center,zoomLevel),left=projected[0]-width/2,top=projected[1]-height/2;
        drawTiles(left,top);drawPins(left,top);
        el.querySelector('[data-map-action=in]').disabled=zoomLevel>=ROAD_MAP.maxZoom;
        el.querySelector('[data-map-action=out]').disabled=zoomLevel<=ROAD_MAP.minZoom;
    }
    function zoom(delta,anchor=[width/2,height/2]) {
        const next=Math.max(ROAD_MAP.minZoom,Math.min(ROAD_MAP.maxZoom,zoomLevel+delta));
        if(next===zoomLevel)return;
        const projected=roadProject(center,zoomLevel);
        const geo=roadUnproject([projected[0]+anchor[0]-width/2,projected[1]+anchor[1]-height/2],zoomLevel);
        zoomLevel=next;
        const point=roadProject(geo,zoomLevel);
        center=roadUnproject([point[0]-anchor[0]+width/2,point[1]-anchor[1]+height/2],zoomLevel);
        clampCenter();draw();
    }
    function resetView() {fit();draw();onViewChange('');}
    el.querySelectorAll('[data-map-action]').forEach(button=>button.onclick=()=>{
        const action=button.dataset.mapAction;
        if(action==='in'||action==='out')zoom(action==='in'?1:-1);
        if(action==='fit')resetView();
        if(action==='retry') {
            tiles.querySelectorAll('img').forEach(img=>{if(img.complete&&!img.naturalWidth)img.remove();});draw();
        }
    });
    function position(event) {
        const rect=viewport.getBoundingClientRect();return [event.clientX-rect.left,event.clientY-rect.top];
    }
    function midpoint(points) {
        return points.length>1?[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2]:points[0];
    }
    function distance(points) {
        return points.length>1?Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]):0;
    }
    function beginGesture() {
        const points=[...fingers.values()];
        gesture={mid:midpoint(points),center:roadProject(center,zoomLevel),distance:distance(points)};
    }
    viewport.onpointerdown=event=>{
        if(event.button&&event.button!==0)return;
        viewport.setPointerCapture(event.pointerId);fingers.set(event.pointerId,position(event));beginGesture();
    };
    viewport.onpointermove=event=>{
        if(!fingers.has(event.pointerId)||!gesture)return;
        fingers.set(event.pointerId,position(event));
        const points=[...fingers.values()],mid=midpoint(points);
        const ratio=points.length>1&&gesture.distance?Math.max(.25,Math.min(4,distance(points)/gesture.distance)):1;
        pane.style.transformOrigin=gesture.mid[0]+'px '+gesture.mid[1]+'px';
        pane.style.transform=`translate(${mid[0]-gesture.mid[0]}px,${mid[1]-gesture.mid[1]}px) scale(${ratio})`;
    };
    viewport.onpointerup=event=>{
        if(!fingers.has(event.pointerId)||!gesture)return;
        const points=[...fingers.values()],mid=midpoint(points);
        center=roadUnproject([gesture.center[0]-mid[0]+gesture.mid[0],gesture.center[1]-mid[1]+gesture.mid[1]],zoomLevel);
        clampCenter();
        if(points.length>1&&gesture.distance)zoom(Math.round(Math.log2(Math.max(.25,distance(points)/gesture.distance))),mid);
        fingers.delete(event.pointerId);gesture=null;
        if(fingers.size)beginGesture();
        draw();onViewChange('');
    };
    viewport.onpointercancel=()=>{fingers.clear();gesture=null;pane.style.transform='';pane.style.transformOrigin='';};
    viewport.onkeydown=event=>{
        const actions={'+':()=>zoom(1),'=':()=>zoom(1),'-':()=>zoom(-1),'0':resetView};
        if(actions[event.key]) {event.preventDefault();actions[event.key]();return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();
        const point=roadProject(center,zoomLevel);
        point[0]+=event.key==='ArrowLeft'?-80:event.key==='ArrowRight'?80:0;
        point[1]+=event.key==='ArrowUp'?-80:event.key==='ArrowDown'?80:0;
        center=roadUnproject(point,zoomLevel);clampCenter();draw();onViewChange('');
    };
    viewport.onwheel=event=>{
        if(!event.ctrlKey)return;
        event.preventDefault();zoom(event.deltaY<0?1:-1,position(event));
    };
    function size() {
        const rect=viewport.getBoundingClientRect();
        if(rect.width<1||rect.height<1)return;
        const initial=!width;width=rect.width;height=rect.height;
        if(initial)fit();draw();
    }
    function activate() {
        if(active||disposed)return;
        active=true;size();
        if(typeof ResizeObserver!=='undefined') {resizeObserver=new ResizeObserver(size);resizeObserver.observe(viewport);}
    }
    if(typeof IntersectionObserver!=='undefined') {
        intersectionObserver=new IntersectionObserver(entries=>{
            if(entries.some(entry=>entry.isIntersecting)) {activate();intersectionObserver.disconnect();}
        },{rootMargin:'30px'});
        intersectionObserver.observe(el);
    } else frame=requestAnimationFrame(activate);

    return {
        el,
        category(value) {category=value;draw();},
        focus(city) {
            if(LL[city]) {center=LL[city].slice();zoomLevel=11;draw();}
            else resetView();
        },
        dispose() {
            disposed=true;intersectionObserver?.disconnect();resizeObserver?.disconnect();
            if(frame)cancelAnimationFrame(frame);
            tiles.querySelectorAll('img').forEach(img=>img.onload=img.onerror=null);
            el.querySelectorAll('[data-map-action]').forEach(button=>button.onclick=null);
            viewport.onpointerdown=viewport.onpointermove=viewport.onpointerup=viewport.onpointercancel=null;
            viewport.onkeydown=viewport.onwheel=null;
            fingers.clear();delete el.dataset.bound;
        }
    };
}

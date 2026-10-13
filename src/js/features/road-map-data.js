/**
 * Harita verisi ve geometri
 * Sağlayıcı, doğrulanmış yol noktaları ve DOM'dan bağımsız Web Mercator hesapları.
 */

const ROAD_MAP = {tiles:"https://tile.openstreetmap.org/{z}/{x}/{y}.png",minZoom:4,maxZoom:17};
// Biçim: {id,name,kind:'tire'|'repair'|'rest',coordinates:[boylam,enlem],source,verifiedAt}.
// Genel OSM işletmeleri NakGo doğrulaması anlamına gelmez; henüz doğrulanmış nokta yok.
const ROAD_STOPS = [];
const ROAD_KINDS = {tire:"Lastikçi",repair:"Tamirci",rest:"Dinlenme tesisi"};

function roadProject([lon,lat],z) {
    const size=256*2**z;
    const sin=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);
    return [(lon+180)/360*size,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size];
}

function roadUnproject([x,y],z) {
    const size=256*2**z;
    return [x/size*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI];
}

function roadStopValid(stop) {
    return !!(stop&&ROAD_KINDS[stop.kind]&&stop.name&&stop.source&&stop.verifiedAt
        &&Array.isArray(stop.coordinates)&&stop.coordinates.length===2
        &&stop.coordinates.every(Number.isFinite)
        &&stop.coordinates[0]>=25&&stop.coordinates[0]<=45
        &&stop.coordinates[1]>=35&&stop.coordinates[1]<=43);
}

function roadStopsFor(kind="") {
    return ROAD_STOPS.filter(stop=>roadStopValid(stop)&&(!kind||stop.kind===kind));
}

function roadFitViewport(points,width,height) {
    const projected=points.map(point=>roadProject(point,0));
    const dx=Math.abs(projected[0][0]-projected[1][0]);
    const dy=Math.abs(projected[0][1]-projected[1][1]);
    // Leave room for city labels, attribution and the existing touch controls.
    const padding={left:70,right:86,top:60,bottom:60};
    const scale=Math.min(Math.max(1,width-padding.left-padding.right)/Math.max(dx,.5),Math.max(1,height-padding.top-padding.bottom)/Math.max(dy,.5));
    const zoom=Math.max(ROAD_MAP.minZoom,Math.min(10,Math.floor(Math.log2(scale))));
    return {
        zoom,
        center:roadUnproject([(projected[0][0]+projected[1][0])/2+(padding.right-padding.left)/2/2**zoom,(projected[0][1]+projected[1][1])/2],0)
    };
}

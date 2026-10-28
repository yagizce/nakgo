'use strict';
// Review parser: never publishes; V1 exports remain compatible.
const {createHash}=require('node:crypto');
const {fold,normalizePhone,MAX_TEXT,parseLoad}=require('./parser.cjs');
const {cities,districts,vehicles}=require('./catalog.cjs');
const places={...Object.fromEntries(cities.map(x=>[fold(x),{city:x,district:null}])),...Object.fromEntries(Object.entries({...districts,Tuzla:'İstanbul',Derince:'Kocaeli',Gazipaşa:'Antalya',Korkuteli:'Antalya',Serik:'Antalya'}).map(([x,city])=>[fold(x),{city,district:x}]))};
for(const [name,city] of Object.entries({maras:'Kahramanmaraş',antep:'Gaziantep',urfa:'Şanlıurfa',afyon:'Afyonkarahisar',ist:'İstanbul',ank:'Ankara',erzrum:'Erzurum',diyarbkr:'Diyarbakır'}))places[name]={city,district:null,alias:true};
const locationRE=new RegExp('(?<![a-z])('+Object.keys(places).sort((a,b)=>b.length-a.length).join('|')+")(?:'?(?:dan|den|tan|ten|ya|ye))?(?![a-z])",'g');
function stops(text){const result=[];for(const m of fold(text).matchAll(locationRE)){const p={...places[m[1]],index:m.index};const last=result.at(-1);if(last&&last.city===p.city&&!last.district&&p.district){result[result.length-1]=p;}else result.push(p);}return result;}
const clean=s=>s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ');
const phoneRE=/(?:\+90|0090|0)?[ (]*5\d{2}[ )-]*\d{3}[ -]*\d{2}[ -]*\d{2}(?!\d)/g;
function contacts(text){return [...new Set((text.match(phoneRE)||[]).map(normalizePhone).filter(Boolean))];}
function parseListings(input){
 if(typeof input!=='string'||!input.trim()||input.length>MAX_TEXT)throw Error('invalid_text');
 const lines=clean(input).split(/\r?\n/).map(s=>s.trim()).filter(Boolean),allPhones=contacts(input);
 const companyLines=lines.filter(s=>/(lojistik|nakliyat|tasimacilik|firma\s*:)/.test(fold(s))&&!/\byukleme\b/.test(fold(s)));
 const company=companyLines.length===1?companyLines[0].replace(phoneRE,'').trim():null;
 const chunks=[];let current=[];
 for(const line of lines){if(companyLines.includes(line)||(/^[+\d\s().-]+$/.test(line)&&contacts(line).length))continue;
  if(stops(line).length&&current.length){chunks.push(current.join('\n'));current=[];}current.push(line);
 }
 if(current.length)chunks.push(current.join('\n'));if(!chunks.length)chunks.push(clean(input));
 return chunks.slice(0,30).map(text=>{
  const t=fold(text),loc=stops(text),v1=parseLoad(text),issues=chunks.length>30?['message_overflow_review']:[];
  const truck=/bos\s+(arac|tir|kamyon)|aracim\s+bos|bosum/.test(t),load=/yukleme|yukler|yuk\s+var|malzeme|profil|palet|yukumuz/.test(t);
  const kind=truck!==load?(truck?'truck':'load'):null;
  const point=p=>p?{city:p.city,district:p.district}:{city:null,district:null};
  let from=point(null),destinations=[];
  if(loc.length>=2&&t.includes('+')&&!/yukleme|yukler|yuk var|bos arac/.test(t)){destinations=loc.map(point);issues.push('origin_missing');}
  else if(loc.length>=2){from=point(loc[0]);destinations=loc.slice(1).map(point);if(!/yukleme|\s(?:→|->|>|dan|den)\s/.test(t))issues.push('route_order_review');}
  else issues.push('route_incomplete');
  if(loc.some(p=>p.alias))issues.push('location_alias_review');
  const range=t.match(/(?<!\d)(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*ton/);
  const n=s=>Number(s.replace(',','.'));
  const weightMin=range?n(range[1]):v1.weightTon,weightMax=range?n(range[2]):v1.weightTon;
  if(weightMax===null||weightMax<=0||weightMax>100||weightMin<0||weightMin>weightMax)issues.push('weight_review');
  const foundVehicles=vehicles.filter(v=>new RegExp('(?<![a-z])'+fold(v)+'(?![a-z])').test(t));
  const vehicle=foundVehicles.length===1?foundVehicles[0]:null;
  const bodies=[['acik','Açık kasa'],['kapali','Kapalı kasa'],['tenteli','Tenteli'],['frigorifik','Frigorifik'],['damperli','Damperli']].filter(([x])=>t.includes(x));
  const body=bodies.length===1?bodies[0][1]:null;
  const timing=text.match(/bugün[^\n,;]*|yarın[^\n,;]*|hemen|\d{1,2}[./]\d{1,2}[./]\d{4}/iu)?.[0]||null;
  const count=t.match(/(\d+)\s*(?:adet\s*)?(?:arac|tir|kamyon)(?![a-z])/);
  const localPhones=contacts(text),phones=localPhones.length?localPhones:allPhones;
  const cargo=/profil/.test(t)?'Profil malzemesi':v1.cargo;
  const conditions=lines.filter(s=>/olmali|sart|model|sinirsiz|\d+\s+yer/.test(fold(s))&&text.includes(s)).join('\n')||null;
  if(!kind)issues.push('kind_unknown');if(!vehicle||!body)issues.push('vehicle_review');if(!cargo&&kind!=='truck')issues.push('cargo_missing');if(!timing)issues.push('timing_missing');if(phones.length!==1)issues.push('contact_review');
  const fields={kind,from,destinations,vehicle,body,weightMin,weightMax,amount:range?null:v1.weightTon,cargo:kind==='truck'?'':cargo,timing,availableOn:null,availableUntil:null,availableTime:'',vehicleCount:count?Number(count[1]):null,conditions,company,contactPhone:phones.length===1?phones[0]:null,description:text,publicNote:'',ownerLabel:'NakGo ilan masası',items:[],imageData:null};
  const fingerprint=createHash('sha256').update(JSON.stringify([kind,from,destinations,vehicle,body,weightMin,weightMax,cargo,fold(timing||'')])).digest('hex');
  return {fields,issues,confidence:Number((Math.max(0,1-issues.length/10)).toFixed(2)),fingerprint,parserVersion:'rules-2'};
 });
}
// Future adapters must return review candidates; cannot write/publish or override source.
async function analyze(text,{adapter=null}={}){return adapter?adapter({text,rules:parseListings(text)}):parseListings(text);}
module.exports={parseListings,analyze,stops};

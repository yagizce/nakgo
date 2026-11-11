'use strict';
// Review parser: never publishes; V1 exports remain compatible.
const {createHash}=require('node:crypto');
const {fold,MAX_TEXT,parseLoad}=require('./parser.cjs');
const {cities,districts,allDistricts,vehicles}=require('./catalog.cjs');
const vehicleMatchers=vehicles.map(value=>({value,re:new RegExp('(?<![a-z])'+fold(value)+'(?![a-z])')}));
const places={...Object.fromEntries(cities.map(x=>[fold(x),{city:x,district:null}])),...Object.fromEntries(Object.entries({...districts,Tuzla:'İstanbul',Derince:'Kocaeli',Gazipaşa:'Antalya',Korkuteli:'Antalya',Serik:'Antalya'}).map(([x,city])=>[fold(x),{city,district:x}]))};
// Tüm ilçeler: tek ilde olan ve sıradan kelimeye benzemeyen ad tek başına; diğerleri yalnız "Şehir İlçe" biçiminde.
const districtCities={};for(const [city,list] of Object.entries(allDistricts))for(const d of list){if(fold(d)==='merkez')continue;(districtCities[fold(d)]=districtCities[fold(d)]||{name:d,cities:[]}).cities.push(city);}
const commonWords=new Set(['arac','cay','tut','can','han','orta','kure','olur','sur','bor','of','cat','guney','mut','bahce','maden','cinar','bala','ulus','genc','hani','dinar','hamur','kose','evren','kaman','kumlu','selim','susuz','emet','kale','pazar','saray','yenice','yenisehir']);
for(const [key,{name,cities:list}] of Object.entries(districtCities))if(list.length===1&&!commonWords.has(key)&&!places[key])places[key]={city:list[0],district:name};
const pairRE=new RegExp('(?<![a-z])('+Object.keys(allDistricts).map(fold).sort((a,b)=>b.length-a.length).join('|')+")[\\s,/-]+("+Object.keys(districtCities).sort((a,b)=>b.length-a.length).join('|')+')(?![a-z])','g');
for(const [name,city] of Object.entries({maras:'Kahramanmaraş',antep:'Gaziantep',urfa:'Şanlıurfa',afyon:'Afyonkarahisar',ist:'İstanbul',ank:'Ankara',erzrum:'Erzurum',diyarbkr:'Diyarbakır'}))places[name]={city,district:null,alias:true};
const locationRE=new RegExp('(?<![a-z])('+Object.keys(places).sort((a,b)=>b.length-a.length).join('|')+")(?:'?(?:dan|den|tan|ten|ya|ye))?(?![a-z])",'g');
function foldedStops(text){const result=[],spans=[];
 for(const m of text.matchAll(pairRE)){const city=cities.find(c=>fold(c)===m[1]),d=districtCities[m[2]];if(city&&d&&d.cities.includes(city)){result.push({city,district:d.name,index:m.index});spans.push([m.index,m.index+m[0].length]);}}
 for(const m of text.matchAll(locationRE)){if(spans.some(([a,b])=>m.index>=a&&m.index<b))continue;const p={...places[m[1]],index:m.index};const last=result.at(-1);if(last&&last.city===p.city&&!last.district&&p.district){result[result.length-1]=p;}else result.push(p);}return result.sort((x,y)=>x.index-y.index);}
function stops(text){return foldedStops(fold(text));}
const clean=s=>s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ');
const phoneRE=/(?<![+\d])(?:\+90|0090|90|0)?[ (]*[235]\d{2}[ ).-]*\d{3}[ .-]*\d{2}[ .-]*\d{2}(?!\d)/g;
function contacts(text){return [...new Set((text.match(phoneRE)||[]).map(value=>{let d=value.replace(/\D/g,'');if(d.startsWith('0090'))d=d.slice(4);else if(d.length===12&&d.startsWith('90'))d=d.slice(2);else if(d.length===11&&d.startsWith('0'))d=d.slice(1);return /^[235]\d{9}$/.test(d)&&!/^([0-9])\1{9}$/.test(d)?'+90'+d:null;}).filter(Boolean))];}
function parseListings(input){
 if(typeof input!=='string'||!input.trim()||input.length>MAX_TEXT)throw Error('invalid_text');
 // Per-message caches only: no contact/company data survives the invocation.
 const normalized=new Map(),locations=new Map(),candidates=new Map();
 const normalizedText=text=>{if(!normalized.has(text))normalized.set(text,fold(text));return normalized.get(text);};
 const messageStops=text=>{if(!locations.has(text))locations.set(text,foldedStops(normalizedText(text)));return locations.get(text);};
 const lines=clean(input).split(/\r?\n/).map(s=>s.trim()).filter(Boolean),allPhones=contacts(input);
 const companyLines=lines.filter(s=>/(lojistik|nakliyat|tasimacilik|firma\s*:)/.test(normalizedText(s))&&!/\byukleme\b/.test(normalizedText(s)));
 const company=companyLines.length===1?companyLines[0].replace(phoneRE,'').trim():null;
 const conditionLines=lines.filter(s=>/olmali|sart|model|sinirsiz|\d+\s+yer/.test(normalizedText(s)));
 const chunks=[];let current=[];
 // A line holding only one place (e.g. "ESKİŞEHİR SEYİTGAZİ 📍") continues on the next line as the same route.
 const placeOnly=line=>{const f=normalizedText(line);let rest=f;for(const m of f.matchAll(locationRE))rest=rest.replace(m[0],' ');for(const m of f.matchAll(pairRE))rest=rest.replace(m[0],' ');return messageStops(line).length===1&&!/[a-z0-9]/.test(rest.replace(/\b(yukleme|yukler|depo|depom|cikis|varis)\b/g,''));};
 for(const line of lines){if(companyLines.includes(line)||(/^[+\d\s().-]+$/.test(line)&&contacts(line).length))continue;
  const continues=current.length===1&&placeOnly(current[0]);
  if(messageStops(line).length&&current.length&&!continues){chunks.push(current.join('\n'));current=[];}current.push(line);
 }
 if(current.length)chunks.push(current.join('\n'));if(!chunks.length)chunks.push(clean(input));
 return chunks.slice(0,30).map(text=>{
  if(candidates.has(text))return structuredClone(candidates.get(text));
  const t=normalizedText(text),loc=messageStops(text),v1=parseLoad(text,{freightOnly:true}),issues=chunks.length>30?['message_overflow_review']:[];
  const truck=/bos\s+(arac|tir|kamyon)|aracim\s+bos|bosum/.test(t),load=/yukleme|yukler|yuk\s+var|malzeme|profil|palet|yukumuz/.test(t);
  // Group posts are loads unless they clearly offer an empty vehicle.
  const kind=truck&&!load?'truck':truck&&load?null:'load';
  const point=p=>p?{city:p.city,district:p.district}:{city:null,district:null};
  let from=point(null),destinations=[];
  if(loc.length>=2&&/[a-z]\s*\+\s*[a-z]/.test(t)&&!/yukleme|yukler|yuk var|bos arac/.test(t)){destinations=loc.map(point);issues.push('origin_missing');}
  else if(loc.length>=2){from=point(loc[0]);destinations=loc.slice(1).map(point);if(!/yukleme|\s(?:→|->|>|dan|den)\s/.test(t))issues.push('route_order_review');}
  else issues.push('route_incomplete');
  if(loc.some(p=>p.alias))issues.push('location_alias_review');
  const range=t.match(/(?<!\d)(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*ton/);
  const n=s=>Number(s.replace(',','.'));
  const weightMin=range?n(range[1]):v1.weightTon,weightMax=range?n(range[2]):v1.weightTon;
  if(weightMax===null||weightMax<=0||weightMax>100||weightMin<0||weightMin>weightMax)issues.push('weight_review');
  const foundVehicles=vehicleMatchers.filter(({re})=>re.test(t)).map(({value})=>value);
  const vehicle=foundVehicles.length===1?foundVehicles[0]:!foundVehicles.length&&/dorse/.test(t)?'Tır':null;
  const bodies=[[/acik/,'Açık kasa'],[/kapali/,'Kapalı kasa'],[/tenteli|tente/,'Tenteli'],[/frigo/,'Frigorifik'],[/damperli|damper/,'Damperli']].filter(([x])=>x.test(t));
  const body=bodies.length===1?bodies[0][1]:null;
  const timing=text.match(/bugün[^\n,;]*|yarın[^\n,;]*|hemen|\d{1,2}[./]\d{1,2}[./]\d{4}/iu)?.[0]||null;
  const calendar=text.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/);
  let availableOn=null;
  if(calendar){const iso=calendar[3]+'-'+calendar[2].padStart(2,'0')+'-'+calendar[1].padStart(2,'0');const date=new Date(iso+'T12:00:00Z');if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso)availableOn=iso;}
  if(truck&&!availableOn)issues.push('truck_calendar_review');
  const count=t.match(/(\d+)\s*(?:adet\s*)?(?:arac|tir|kamyon)(?![a-z])/);
  const localPhones=contacts(text),phones=localPhones.length?localPhones:allPhones;
  const cargo=/profil/.test(t)?'Profil malzemesi':v1.cargo;
  const conditions=conditionLines.filter(s=>text.includes(s)).join('\n')||null;
  if(conditions)issues.push('conditions_review');
  if(count&&Number(count[1])>1)issues.push('vehicle_count_review');
  if(/bugun/.test(t)&&/yarin/.test(t))issues.push('timing_ambiguous');
  if(allPhones.length>1&&!issues.includes('contact_review'))issues.push('contact_review');
  if(!kind)issues.push('kind_unknown');if(!vehicle||!body)issues.push('vehicle_review');if(!cargo&&kind!=='truck')issues.push('cargo_missing');if(!timing)issues.push('timing_missing');if(phones.length!==1)issues.push('contact_review');
  const fields={kind,from,destinations,vehicle,body,weightMin,weightMax,amount:range?null:v1.weightTon,cargo:kind==='truck'?'':cargo,timing,availableOn:truck?availableOn:null,availableUntil:null,availableTime:'',vehicleCount:count?Number(count[1]):null,conditions,company,contactPhone:phones.length===1?phones[0]:null,description:text,publicNote:'',ownerLabel:'NakGo ilan masası',items:[],imageData:null};
  const fingerprint=createHash('sha256').update(JSON.stringify([kind,from,destinations,vehicle,body,weightMin,weightMax,cargo,fold(timing||'')])).digest('hex');
  const candidate={fields,issues,confidence:Number((Math.max(0,1-issues.length/10)).toFixed(2)),fingerprint,parserVersion:'rules-2'};
  candidates.set(text,candidate);return candidate;
 });
}
// Future adapters must return review candidates; cannot write/publish or override source.
async function analyze(text,{adapter=null}={}){return adapter?adapter({text,rules:parseListings(text)}):parseListings(text);}
module.exports={parseListings,analyze,stops};

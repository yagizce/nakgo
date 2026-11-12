'use strict';
// Review parser: never publishes; V1 exports remain compatible.
const {createHash}=require('node:crypto');
const {fold,MAX_TEXT,parseLoad}=require('./parser.cjs');
const {cities,districts,allDistricts,vehicles}=require('./catalog.cjs');
const vehicleMatchers=vehicles.map(value=>({value,re:new RegExp('(?<![a-z])'+fold(value)+'(?![a-z])')}));
const places={...Object.fromEntries(cities.map(x=>[fold(x),{city:x,district:null}])),...Object.fromEntries(Object.entries({...districts,Tuzla:'İstanbul',Derince:'Kocaeli',Gazipaşa:'Antalya',Korkuteli:'Antalya',Serik:'Antalya'}).map(([x,city])=>[fold(x),{city,district:x}]))};
// Tüm ilçeler: tek ilde olan ve sıradan kelimeye benzemeyen ad tek başına; diğerleri yalnız "Şehir İlçe" biçiminde.
const districtCities={};for(const [city,list] of Object.entries(allDistricts))for(const d of list){if(fold(d)==='merkez')continue;(districtCities[fold(d)]=districtCities[fold(d)]||{name:d,cities:[]}).cities.push(city);}
const commonWords=new Set(['arac','cay','tut','can','han','orta','kure','olur','sur','bor','of','cat','guney','mut','bahce','maden','cinar','bala','ulus','genc','hani','dinar','hamur','kose','evren','kaman','kumlu','selim','susuz','emet','kale','pazar','saray','yenice','yenisehir','carsamba','persembe','talas','kavak','sogut']);
for(const [key,{name,cities:list}] of Object.entries(districtCities))if(list.length===1&&!commonWords.has(key)&&!places[key])places[key]={city:list[0],district:name};
// Well-known logistics localities that are not districts: the name itself is kept as the district text.
const localities={Hadımköy:'İstanbul',Değirmenköy:'İstanbul',Selimpaşa:'İstanbul',Halkalı:'İstanbul',İkitelli:'İstanbul',Aydınlı:'İstanbul',Habibler:'İstanbul',Kıraç:'İstanbul',Hoşdere:'İstanbul',Dudullu:'İstanbul',Orhanlı:'İstanbul',Yakuplu:'İstanbul',Akçaburgaz:'İstanbul',Mahmutbey:'İstanbul',Ostim:'Ankara',İvedik:'Ankara',Şekerpınar:'Kocaeli',Muallimköy:'Kocaeli',Velimeşe:'Tekirdağ',Mumcular:'Muğla',Eğriöz:'Kütahya'};
for(const [name,city] of Object.entries(localities))if(!places[fold(name)]&&!districtCities[fold(name)])places[fold(name)]={city,district:name,locality:true};
// Ambiguous district names (several provinces) count only when the same text names one of their provinces.
const ambiguous={};for(const [key,{name,cities:list}] of Object.entries(districtCities))if(list.length>1&&!commonWords.has(key)&&!places[key])ambiguous[key]={name,cities:list};
// "Şehir İlçe" pairs: plain space, slash/comma or a bare hyphen; " - " separates a route instead.
const pairRE=new RegExp('(?<![a-z])('+Object.keys(allDistricts).map(fold).sort((a,b)=>b.length-a.length).join('|')+")(?:[ \\t]*[,/][ \\t]*|[ \\t]+|-)("+Object.keys(districtCities).sort((a,b)=>b.length-a.length).join('|')+')(?![a-z])','g');
for(const [name,city] of Object.entries({maras:'Kahramanmaraş',antep:'Gaziantep',urfa:'Şanlıurfa',afyon:'Afyonkarahisar',ist:'İstanbul',ank:'Ankara',erzrum:'Erzurum',diyarbkr:'Diyarbakır'}))places[name]={city,district:null,alias:true};
const locationRE=new RegExp('(?<![a-z])('+[...Object.keys(places),...Object.keys(ambiguous)].sort((a,b)=>b.length-a.length).join('|')+")(?:'?(?:dan|den|tan|ten|ya|ye|da|de|ta|te)|'[ae]|(?<=[a-z]{5})[ae])?(?![a-z])",'g');
function foldedStops(text){const found=[],spans=[],pending=[];
 for(const m of text.matchAll(pairRE)){const city=cities.find(c=>fold(c)===m[1]),d=districtCities[m[2]];if(city&&d&&d.cities.includes(city)){found.push({city,district:d.name,index:m.index,end:m.index+m[0].length});spans.push([m.index,m.index+m[0].length]);}}
 for(const m of text.matchAll(locationRE)){if(spans.some(([a,b])=>m.index>=a&&m.index<b))continue;const end=m.index+m[0].length,suffixed=m[0].length>m[1].length;if(places[m[1]])found.push({...places[m[1]],index:m.index,end,suffixed});else pending.push({key:m[1],index:m.index,end,suffixed});}
 for(const a of pending){const city=found.map(p=>p.city).find(c=>ambiguous[a.key].cities.includes(c));if(city)found.push({city,district:ambiguous[a.key].name,index:a.index,end:a.end,suffixed:a.suffixed,resolved:true});}
 const result=[];
 for(const p of found.sort((x,y)=>x.index-y.index)){const last=result.at(-1),gap=last?text.slice(last.end,p.index):'';
  if(last&&!last.district&&p.district){
   if(last.city===p.city&&/^[ \t/,]*$/.test(gap)){result[result.length-1]={...p,index:last.index};continue;}
   // "ANK KARAPÜRÇEK", "EDİRNE HAVZA": a district of another province right after a city is a local place name.
   // A direction suffix ("AFYONDAN HADIMKÖYE") makes them two stops.
   if(last.city!==p.city&&!p.resolved&&!last.suffixed&&!p.suffixed&&/^[ \t]+$/.test(gap))continue;
  }
  // "BODRUM / MUMCULAR", "TUZLA / AYDINLI": a locality after its own district adds no stop.
  if(last&&last.district&&p.locality&&last.city===p.city&&/^[ \t/,]*$/.test(gap))continue;
  result.push(p);}
 return result;}
function stops(text){return foldedStops(fold(text));}
const clean=s=>s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ');
const phoneRE=/(?<![+\d])(?:\+90|0090|90|0)?[ (]*[235]\d{2}[ ).-]*\d{3}[ .-]*\d{2}[ .-]*\d{2}(?!\d)/g;
function contacts(text){return [...new Set((text.match(phoneRE)||[]).map(value=>{let d=value.replace(/\D/g,'');if(d.startsWith('0090'))d=d.slice(4);else if(d.length===12&&d.startsWith('90'))d=d.slice(2);else if(d.length===11&&d.startsWith('0'))d=d.slice(1);return /^[235]\d{9}$/.test(d)&&!/^([0-9])\1{9}$/.test(d)?'+90'+d:null;}).filter(Boolean))];}
// Trade names: 13.60/1360 and short dorse/damper are trailers; 10 teker/ortaboy are trucks.
const vehicleRules=[['Tır',/(?<![a-z0-9])(?:tir|dorse)(?![a-z])|(?<![\d.,])13[ .,/]?60(?![\d.,])|kisa damper/],['Kırkayak',/kirkayak/],['Kamyonet',/kamyonet/],['Kamyon',/kamyon(?!et)|(?<!\d)10 ?teker|ortaboy/],['Panelvan',/panelvan/],['Tanker',/(?<![a-z])tanker/],['Lowbed',/lowbed/],['Konteyner',/konteyner/]];
const arrowRE=/➡|→|-+>|(?<![<\d])>/;
const timingOf=s=>s.match(/(?:bug[üu]n|yar[ıiI]n)[ \t()\p{L}]*|\bhemen\b|\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}[:.]\d{2}[ \t]*(?:'?[ae][ \t]*)?kadar[ \t\p{L}]*|\b24[ \t]*saat[ \t\p{L}]*/iu)?.[0].trim().slice(0,32)||null;
// Reviewed public note: the useful lines of the post, without phones, fares, company lines or bare route lines.
const routeOnly=line=>stops(line).length>0&&fold(line).replace(/[^a-z0-9]+/g,' ').trim().split(' ').every(word=>stops(word).length>0);
function noteOf(lines){return lines.filter(line=>!contacts(line).length&&!/navlun|ucret|fiyat|odeme|\btl\b|kdv|nakit|pesin|mazot/.test(fold(line))&&!routeOnly(line))
 .map(line=>line.replace(/^[^\p{L}\p{N}]+/u,'').trim()).filter(Boolean).join('\n').slice(0,500);}
function parseListings(input){
 if(typeof input!=='string'||!input.trim()||input.length>MAX_TEXT)throw Error('invalid_text');
 // Per-message caches only: no contact/company data survives the invocation.
 const normalized=new Map(),locations=new Map();
 const normalizedText=text=>{if(!normalized.has(text))normalized.set(text,fold(text));return normalized.get(text);};
 const messageStops=text=>{if(!locations.has(text))locations.set(text,foldedStops(normalizedText(text)));return locations.get(text);};
 const allPhones=contacts(input);
 // Separator rules (———, ____, ⬇️⬇️) start a new block; blank lines carry no content.
 const lines=[],blocks=[];let block=0;
 for(const raw of clean(input).split(/\r?\n/).map(s=>s.trim())){if(/[\p{L}\p{N}]/u.test(raw)){lines.push(raw);blocks.push(block);}else if(raw.length>=3)block++;}
 const companyLines=lines.filter(s=>/(lojistik|nakliyat|tasimacilik|firma\s*:)/.test(normalizedText(s))&&!/\byukleme\b/.test(normalizedText(s))&&!messageStops(s).length);
 const company=companyLines.length===1?companyLines[0].replace(phoneRE,'').trim():null;
 const conditionLines=lines.filter(s=>/olmali|sart|model|sinirsiz|\d+\s*yer/.test(normalizedText(s)));
 // Field lines (📦 YÜK:, 💰 NAVLUN...) describe the load; "SÖĞÜT ODUNU" is not a place.
 const fieldLine=line=>/^(?:📦|💰|💵|⚖|📏|✅)/u.test(line)||/^\W*(?:yuk\s*:|navlun|odeme|olcu|tonaj)/.test(normalizedText(line));
 const lineStops=line=>fieldLine(line)?[]:messageStops(line);
 const rest=line=>{let r=normalizedText(line);for(const m of r.matchAll(pairRE))r=r.replace(m[0],' ');for(const m of r.matchAll(locationRE))r=r.replace(m[0],' ');return r;};
 const bare=line=>lineStops(line).length>0&&!/[a-z0-9]/.test(rest(line));
 const placeOnly=line=>lineStops(line).length===1&&!/[a-z0-9]/.test(rest(line).replace(/\b(yukleme|yukler|depo|depom|cikis|varis)\b/g,''));
 const headerLine=line=>lineStops(line).length===1&&/\byukle(?:me|r|nir|meli)\b/.test(normalizedText(line));
 const keptAt=lines.map((line,i)=>i).filter(i=>!companyLines.includes(lines[i])&&!(/^[+\d\s().-]+$/.test(lines[i])&&contacts(lines[i]).length));
 const kept=keptAt.map(i=>lines[i]),keptBlock=keptAt.map(i=>blocks[i]);
 const chunks=[];let section=null,pendingTiming=null;
 // Lines above the first route of a block ("13,60 AÇIK–KAPALI TIR", "TONAJ: 0/26") apply to every route in that block.
 let shared=[],sharedBlock=-1;
 kept.forEach((line,i)=>{
  if(keptBlock[i]!==sharedBlock){shared=[];sharedBlock=keptBlock[i];}
  if(!lineStops(line).length){
   // "BUGÜN YÜKLER" above routes dates the routes below it; inside a route it stays with that route.
   if(timingOf(line)&&kept.slice(i+1).some(next=>lineStops(next).length)&&!kept.slice(i+1,i+2).every(next=>!lineStops(next).length&&!timingOf(next))){pendingTiming=timingOf(line);return;}
   const open=chunks.at(-1);if(open&&open.block===keptBlock[i])open.lines.push(line);else shared.push(line);return;
  }
  // "ÇORLU YÜKLEME", "MALKARA YARIN YÜKLER": origin for the lines below it.
  if(headerLine(line)){section={origin:lineStops(line)[0],timing:timingOf(line)||pendingTiming};chunks.push({lines:[line],header:true,section,timing:section.timing,block:keptBlock[i],shared});return;}
  const current=chunks.at(-1);
  // A line holding only one place (e.g. "ESKİŞEHİR SEYİTGAZİ 📍") continues on the next line as the same route.
  if(current&&!current.header&&!current.section&&current.lines.length===1&&placeOnly(current.lines[0])){current.lines.push(line);return;}
  chunks.push({lines:[line],section,timing:pendingTiming,block:keptBlock[i],shared});
 });
 // Bare route lines in a row ("BANDIRMA KARAMAN\nMANYAS KARAMAN\n1360") share the lines under the last one.
 for(let k=0;k<chunks.length;k++){let m=k;
  while(m<chunks.length-1&&!chunks[m].header&&!chunks[m+1].header&&chunks[m].lines.length===1&&bare(chunks[m].lines[0])&&bare(chunks[m+1].lines[0]))m++;
  if(m>k){const shared=chunks[m].lines.slice(1);for(let j=k;j<m;j++)chunks[j].lines.push(...shared);k=m;}
 }
 // A header with routes under it is not a listing itself; its notes go to a single route below it.
 const listings=chunks.filter(chunk=>{
  if(!chunk.header)return true;
  const items=chunks.filter(c=>!c.header&&c.section===chunk.section);
  if(!items.length)return true;
  if(chunk.lines.length===1)return false;
  if(items.length===1){items[0].lines.unshift(...chunk.lines.slice(1));return false;}
  return true;
 });
 if(!listings.length)listings.push({lines:lines.length?lines:[clean(input)],section:null,timing:pendingTiming});
 const candidates=new Map();
 return listings.slice(0,30).map(chunk=>{
  const allLines=[...(chunk.shared||[]),...chunk.lines],text=allLines.join('\n'),stopText=chunk.lines.filter(line=>!fieldLine(line)).join('\n');
  const key=JSON.stringify([text,chunk.section?.origin,chunk.header,chunk.timing]);
  if(candidates.has(key))return structuredClone(candidates.get(key));
  const t=normalizedText(text),st=normalizedText(stopText),loc=messageStops(stopText),v1=parseLoad(text,{freightOnly:true}),issues=listings.length>30?['message_overflow_review']:[];
  const truck=/bos\s+(arac|tir|kamyon)|aracim\s+bos|bosum/.test(t),load=/yukleme|yukler|yuk\s+var|malzeme|profil|palet|yukumuz/.test(t);
  // Group posts are loads unless they clearly offer an empty vehicle.
  const kind=truck&&!load?'truck':truck&&load?null:'load';
  const point=p=>p?{city:p.city,district:p.district}:{city:null,district:null};
  const plus=/[a-z]\s*\+\s*[a-z]/.test(st),arrow=st.search(arrowRE);
  let from=point(null),destinations=[];
  if(chunk.header){from=point(chunk.section.origin);issues.push('route_incomplete');}
  else if(chunk.section&&(loc.length===1||plus)){from=point(chunk.section.origin);destinations=loc.map(point);}
  else if(arrow>=0&&loc.some(p=>p.index<arrow)&&loc.some(p=>p.index>arrow)){from=point(loc.find(p=>p.index<arrow));destinations=loc.filter(p=>p.index>arrow).map(point);}
  else if(loc.length>=2&&plus&&!/yukleme|yukler|yuk var|bos arac/.test(t)){destinations=loc.map(point);issues.push('origin_missing');}
  else if(loc.length>=2){from=point(loc[0]);destinations=loc.slice(1).map(point);if(!/yukleme|\s(?:→|->|>|dan|den)\s/.test(t)&&!/[-–]/.test(st.slice(loc[0].end,loc[1].index)))issues.push('route_order_review');}
  else{if(loc.length===1&&/^[ \t]*(?:-+|➡|→|>)/.test(st.slice(loc[0].end)))from=point(loc[0]);issues.push('route_incomplete');}
  if(loc.some(p=>p.alias))issues.push('location_alias_review');
  const range=t.match(/(?<!\d)(\d+(?:[.,]\d+)?)\s*[-–/]\s*(\d+(?:[.,]\d+)?)\s*ton/);
  const n=s=>Number(s.replace(',','.'));
  const weightMin=range?n(range[1]):v1.weightTon,weightMax=range?n(range[2]):v1.weightTon;
  if(weightMax!==null&&(weightMax<=0||weightMax>100||weightMin<0||weightMin>weightMax))issues.push('weight_review');
  // Phone digits ("... 13 60") must not read as a trailer size.
  const vt=t.replace(phoneRE,' '),foundVehicles=vehicleRules.filter(([,re])=>re.test(vt)).map(([value])=>value);
  const vehicle=foundVehicles.length===1?foundVehicles[0]:null;
  const bodies=[[/acik/,'Açık kasa'],[/kapali/,'Kapalı kasa'],[/tenteli|tente/,'Tenteli'],[/frigo/,'Frigorifik'],[/damperli|damper/,'Damperli']].filter(([x])=>x.test(t));
  const body=bodies.length===1?bodies[0][1]:null;
  const timing=timingOf(text)||chunk.timing||chunk.section?.timing||null;
  const calendar=(timing||'').match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/);
  let availableOn=null;
  if(calendar){const iso=calendar[3]+'-'+calendar[2].padStart(2,'0')+'-'+calendar[1].padStart(2,'0');const date=new Date(iso+'T12:00:00Z');if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso)availableOn=iso;}
  if(truck&&!availableOn)issues.push('truck_calendar_review');
  const count=t.match(/(\d+)\s*(?:adet\s*)?(?:arac|tir|kamyon)(?![a-z])/);
  // Only numbers written in the message; the first one is offered, more than one goes to review.
  const localPhones=contacts(text),phones=localPhones.length?localPhones:allPhones;
  const cargo=/profil/.test(t)?'Profil malzemesi':v1.cargo;
  const conditions=conditionLines.filter(s=>text.includes(s)).join('\n')||null;
  if(conditions)issues.push('conditions_review');
  if(count&&Number(count[1])>1)issues.push('vehicle_count_review');
  if(/bugun/.test(t)&&/yarin/.test(t))issues.push('timing_ambiguous');
    // Review is about the three essentials: phone, route and vehicle type. Cargo, weight and time are optional.
  if(!kind)issues.push('kind_unknown');if(!vehicle)issues.push('vehicle_review');if(phones.length!==1)issues.push('contact_review');
  const fields={kind,from,destinations,vehicle,body,weightMin,weightMax,amount:range?null:v1.weightTon,cargo:kind==='truck'?'':cargo,timing,availableOn:truck?availableOn:null,availableUntil:null,availableTime:'',vehicleCount:count?Number(count[1]):null,conditions,company,contactPhone:phones[0]||null,description:text,publicNote:noteOf(allLines),ownerLabel:'NakGo ilan masası',items:[],imageData:null};
  const fingerprint=createHash('sha256').update(JSON.stringify([kind,from,destinations,vehicle,body,weightMin,weightMax,cargo,fold(timing||'')])).digest('hex');
  const candidate={fields,issues,confidence:Number((Math.max(0,1-issues.length/10)).toFixed(2)),fingerprint,parserVersion:'rules-3'};
  candidates.set(key,candidate);return candidate;
 });
}
// Future adapters must return review candidates; cannot write/publish or override source.
async function analyze(text,{adapter=null}={}){return adapter?adapter({text,rules:parseListings(text)}):parseListings(text);}
module.exports={parseListings,analyze,stops};

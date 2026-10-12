/* Saf, deterministik taslak parser'ı. AI, HTTP, kayıt ve HTML render işlemi yok. */
'use strict';
const {createHash}=require('node:crypto');
const {cities,vehicles,bodies,districts}=require('./catalog.cjs');
const MAX_TEXT=4096,MAX_WEIGHT=100,MAX_PRICE=10000000;
const fold=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i').replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();
const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function normalizePhone(value){
  if(typeof value!=='string'||value.length>40||!/^[+\d\s().-]+$/.test(value))return null;
  let digits=value.replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  if(/^0\d{10}$/.test(digits))digits='90'+digits.slice(1);
  if(/^5\d{9}$/.test(digits))digits='90'+digits;
  return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
}
function words(text,term){return new RegExp('(?<![a-z0-9])'+escapeRE(fold(term))+'(?![a-z0-9])','g').test(text);}
function locations(text){
  const candidates=[];
  for(const [name,city] of [...cities.map(c=>[c,c]),...Object.entries(districts)]){
    const re=new RegExp('(?<![a-z])'+escapeRE(fold(name))+"(?:'?(?:dan|den|tan|ten|ya|ye|a|e))?(?![a-z])",'g');
    for(const m of text.matchAll(re))candidates.push({start:m.index,end:m.index+m[0].length,city,district:name===city?null:name,suffix:m[0].slice(fold(name).length).replace("'",'')});
  }
  candidates.sort((a,b)=>a.start-b.start||b.end-a.end);
  const grouped=[];
  for(const c of candidates){
    const prev=grouped.at(-1);
    if(prev&&c.start<prev.end)continue;
    // İzmir Aliağa / İzmir, Aliağa gibi şehir+ilçe tek duraktır.
    if(prev&&prev.city===c.city&&prev.district!==c.district&&(!prev.district||!c.district)&&/^[\s,/()-]*$/.test(text.slice(prev.end,c.start))){
      prev.district=prev.district||c.district;prev.end=c.end;prev.suffix=c.suffix||prev.suffix;
    }else grouped.push({...c});
  }
  return grouped;
}
function numberTR(raw){
  let s=raw;
  if(/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s))s=s.replace(/\./g,'');
  s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null;
}
function parseLoad(input){
  const draft={from:{city:null,district:null},to:{city:null,district:null},cargo:null,weightTon:null,vehicle:null,price:null,date:null,phone:null,confidence:0,issues:[]};
  if(typeof input!=='string'||!input.trim()){draft.issues.push('text_empty');return draft;}
  if(input.length>MAX_TEXT){draft.issues.push('text_too_long');return draft;}
  // Ham mesaj hiçbir zaman HTML olarak çizilmez. Tag/script içi yer adları parser'a da girmez.
  const text=fold(input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' '));
  const phoneMatches=[...text.matchAll(/(?<![\d])(?:\+90|0090|0)?[\s(]*5\d{2}[\s)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g)];
  if(phoneMatches.length===1)draft.phone=normalizePhone(phoneMatches[0][0]);
  const withoutPhone=text.replace(/(?<![\d])(?:\+90|0090|0)?[\s(]*5\d{2}[\s)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g,' ');
  const stops=locations(withoutPhone);
  if(stops.length<=2&&stops.filter(s=>['dan','den','tan','ten'].includes(s.suffix)).length<=1&&stops.filter(s=>['a','e','ya','ye'].includes(s.suffix)).length<=1){
    const origin=stops.find(s=>['dan','den','tan','ten'].includes(s.suffix)),destination=stops.find(s=>['a','e','ya','ye'].includes(s.suffix));
    for(const [i,s] of stops.entries()){
      const target=origin?s===origin?'from':'to':destination?s===destination?'to':'from':i===0?'from':'to';
      draft[target]={city:s.city,district:s.district};
    }
  }else draft.issues.push('route_ambiguous');
  const weights=[...withoutPhone.matchAll(/(?<![a-z\d.,])([+-]?\d+(?:[.,]\d+)*)(?:\s*)(ton|tonluk|t|kg|kilo|kilogram)(?![a-z])/g)];
  if(weights.length===1){const n=numberTR(weights[0][1]);draft.weightTon=n===null?null:n*(/^(kg|kilo|kilogram)$/.test(weights[0][2])?0.001:1);if(n===null)draft.issues.push('weight_invalid');}
  else if(weights.length>1)draft.issues.push('weight_ambiguous');
  const cargo=['Sac','Demir','Çelik','Çimento','Mermer','Kum','Çakıl','Palet','Mobilya','Gıda','Makine','Kereste','Pamuk','Kömür'].filter(c=>words(withoutPhone,c));
  if(cargo.length===1)draft.cargo=cargo[0];else if(cargo.length>1)draft.issues.push('cargo_ambiguous');
  const bodyMatches=bodies.filter(c=>words(withoutPhone,c)),vehicleMatches=vehicles.filter(c=>words(withoutPhone,c));
  if(bodyMatches.length===1)draft.vehicle=bodyMatches[0];else if(!bodyMatches.length&&vehicleMatches.length===1)draft.vehicle=vehicleMatches[0];
  else if(bodyMatches.length>1||vehicleMatches.length>1)draft.issues.push('vehicle_ambiguous');
  const today=words(text,'bugün'),tomorrow=words(text,'yarın');
  if(today!==tomorrow)draft.date=today?'today':'tomorrow';else if(today)draft.issues.push('date_ambiguous');
  let remainder=withoutPhone;
  for(const m of weights)remainder=remainder.replace(m[0],' ');
  const money=[...remainder.matchAll(/(?<![a-z\d.,])([+-]?\d+(?:[.,]\d+)*)(?:\s*)(bin|tl|try|₺|lira)(?![a-z])/g)];
  if(money.length===1){const n=numberTR(money[0][1]);draft.price=n===null?null:n*(money[0][2]==='bin'?1000:1);if(n===null)draft.issues.push('price_invalid');}
  else if(money.length>1)draft.issues.push('price_ambiguous');
  else {
    // Tek başına sayı ancak mesajın sonunda ve >=1000 ise tutar adayıdır; tarih/sayı uydurulmaz.
    const numbers=[...remainder.matchAll(/(?<![\d.,])([+-]?\d+(?:[.,]\d+)*)(?![\d.,])/g)];
    if(numbers.length===1&&remainder.slice(numbers[0].index+numbers[0][0].length).trim()===''){
      const n=numberTR(numbers[0][1]);if(n!==null&&Math.abs(n)>=1000)draft.price=n;else if(n===null)draft.issues.push('price_invalid');
    }
  }
  draft.confidence=Number(([draft.from.city,draft.to.city,draft.cargo,draft.weightTon,draft.vehicle,draft.price,draft.date].filter(v=>v!==null).length/7).toFixed(3));
  return draft;
}
function validateDraft(draft){
  const errors=[];
  if(!draft||typeof draft!=='object'||Array.isArray(draft))return {valid:false,errors:['draft_invalid']};
  if(Array.isArray(draft.issues))errors.push(...draft.issues);
  for(const k of ['from','to']){
    const p=draft[k];
    if(!p||!cities.includes(p.city))errors.push(k+'_city_missing_or_invalid');
    if(p?.district!=null&&districts[p.district]!==p.city)errors.push(k+'_district_invalid');
  }
  if(draft.from?.city&&draft.from.city===draft.to?.city&&draft.from.district===draft.to.district)errors.push('route_same');
  if(typeof draft.weightTon!=='number'||!Number.isFinite(draft.weightTon)||draft.weightTon<=0||draft.weightTon>MAX_WEIGHT)errors.push('weight_invalid');
  if(typeof draft.cargo!=='string'||!draft.cargo.trim()||draft.cargo.length>120||/[<>\u0000-\u001f]|javascript\s*:/i.test(draft.cargo))errors.push('cargo_missing_or_unsafe');
  if(draft.vehicle!==null&&![...vehicles,...bodies].includes(draft.vehicle))errors.push('vehicle_invalid');
  if(draft.price!==null&&(typeof draft.price!=='number'||!Number.isFinite(draft.price)||draft.price<0||draft.price>MAX_PRICE))errors.push('price_invalid');
  if(draft.date!==null&&!['today','tomorrow'].includes(draft.date))errors.push('date_invalid');
  if(draft.phone!==null&&normalizePhone(draft.phone)!==draft.phone)errors.push('phone_invalid');
  return {valid:errors.length===0,errors:[...new Set(errors)]};
}
function fingerprint(phone,draft){
  const place=p=>[fold(p?.city),fold(p?.district)];
  const weight=typeof draft?.weightTon==='number'&&Number.isFinite(draft.weightTon)?draft.weightTon:null;
  return createHash('sha256').update(JSON.stringify([normalizePhone(phone),place(draft?.from),place(draft?.to),fold(draft?.cargo),weight,fold(draft?.date)])).digest('hex');
}
module.exports={parseLoad,validateDraft,fingerprint,normalizePhone,fold,MAX_TEXT,MAX_WEIGHT,MAX_PRICE};

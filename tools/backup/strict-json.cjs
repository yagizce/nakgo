/** Katı JSON (elle yedek akışı: imza isteği, yanıt, kayıt, çapa, ölçüm dosyaları).
 *
 * JSON.parse yinelenen anahtarı sessizce birleştirir ve sayıları kayıplı okur; bu dosyalar imzaya girdiği için
 * kendi ayrıştırıcımız kullanılır. Kurallar (hepsi REDDEDER, düzeltmez):
 *   - UTF-8, BOM yok; dizgiler iyi biçimli (yalnız vekil karakter yok) ve NFC; kontrol karakteri yok (\t \n hariç değil:
 *     dizgide hiçbir kontrol karakteri kabul edilmez).
 *   - Yinelenen anahtar yok; NFC sonrası çakışan anahtar yok (anahtarlar zaten NFC olmak zorunda).
 *   - Sayılar yalnız tam sayı, Number.isSafeInteger (en çok Number.MAX_SAFE_INTEGER = 2^53-1); kesir, üs, başta sıfır, -0 yok.
 *   - Derinlik ve eleman sayısı sınırlı.
 *   - parseCanonical: dosyanın baytları, kanonik yazımla BİREBİR aynı olmalı (boşluk, sıra ve kaçış hilesi yok).
 * Kanonik yazım: anahtarlar UTF-16 kod birimi sırasıyla (JS varsayılan sort) sıralı, boşluksuz, JSON.stringify kaçışları. */
'use strict';
const crypto=require('node:crypto');

const LIMITS={depth:16,items:4096,string:1<<20};
const fail=m=>{throw Object.assign(Error('katı JSON: '+m),{code:'strict_json'});};

function checkString(s){
  if(!s.isWellFormed())fail('yalnız vekil karakter');
  if(/[\u0000-\u001f\u007f]/.test(s))fail('kontrol karakteri');
  if(s.normalize('NFC')!==s)fail('NFC olmayan dizgi');
  if(s.length>LIMITS.string)fail('dizgi çok uzun');
}

function parse(text){
  if(typeof text!=='string')fail('metin değil');
  if(text.charCodeAt(0)===0xfeff)fail('BOM');
  let i=0,items=0;
  const ws=()=>{while(i<text.length&&' \t\n\r'.includes(text[i]))i++;};
  const value=depth=>{
    if(depth>LIMITS.depth)fail('derinlik sınırı');
    if(++items>LIMITS.items)fail('eleman sınırı');
    ws();const c=text[i];
    if(c==='{'){
      i++;const o=Object.create(null);const seen=new Set();ws();
      if(text[i]==='}'){i++;return o;}
      for(;;){
        ws();if(text[i]!=='"')fail('anahtar bekleniyor');
        const k=str();if(seen.has(k))fail('yinelenen anahtar');
        if(seen.has(k.normalize('NFC')))fail('NFC sonrası çakışan anahtar');
        seen.add(k);ws();if(text[i]!==':')fail('":" bekleniyor');i++;
        o[k]=value(depth+1);ws();
        if(text[i]===','){i++;continue;}if(text[i]==='}'){i++;return o;}fail('"," ya da "}" bekleniyor');
      }
    }
    if(c==='['){
      i++;const a=[];ws();if(text[i]===']'){i++;return a;}
      for(;;){a.push(value(depth+1));ws();if(text[i]===','){i++;continue;}if(text[i]===']'){i++;return a;}fail('"," ya da "]" bekleniyor');}
    }
    if(c==='"')return str();
    if(text.startsWith('true',i)){i+=4;return true;}
    if(text.startsWith('false',i)){i+=5;return false;}
    if(text.startsWith('null',i)){i+=4;return null;}
    const m=/^-?(0|[1-9][0-9]*)/.exec(text.slice(i,i+32));
    if(!m)fail('beklenmeyen karakter');
    const after=text[i+m[0].length];
    if(after==='.'||after==='e'||after==='E')fail('yalnız tam sayı');
    if(m[0]==='-0')fail('-0');
    const n=Number(m[0]);if(!Number.isSafeInteger(n))fail('güvenli tam sayı sınırı aşıldı');
    i+=m[0].length;return n;
  };
  const str=()=>{
    // JSON dizgisi: kaçışları JSON.parse ile çöz (yalnız dizgi parçası verilir; yinelenen anahtar sorunu yok).
    let j=i+1;
    for(;j<text.length;j++){const ch=text[j];if(ch==='\\'){j++;continue;}if(ch==='"')break;if(ch.charCodeAt(0)<0x20)fail('dizgide kontrol karakteri');}
    if(j>=text.length)fail('kapanmayan dizgi');
    let s;try{s=JSON.parse(text.slice(i,j+1));}catch{fail('geçersiz dizgi kaçışı');}
    i=j+1;checkString(s);return s;
  };
  const v=value(0);ws();if(i!==text.length)fail('fazladan içerik');
  return v;
}

/** Kanonik yazım; yalnız katı modelin izin verdiği değerler. */
function canonical(v){
  if(v===null)return 'null';
  if(v===true||v===false)return String(v);
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))fail('yazılamayan sayı');return String(v);}
  if(typeof v==='string'){checkString(v);return JSON.stringify(v);}
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(typeof v==='object'){
    const keys=Object.keys(v).filter(k=>v[k]!==undefined).sort();
    for(const k of keys)checkString(k);
    return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  fail('desteklenmeyen tür');
}

/** Bayt dizisini katı ve kanonik olarak okur. */
function parseCanonical(buf){
  if(!Buffer.isBuffer(buf))fail('bayt dizisi değil');
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buf);}catch{fail('geçersiz UTF-8');}
  const v=parse(text);
  if(canonical(v)!==text)fail('kanonik biçimde değil');
  return v;
}

const sha256Hex=data=>crypto.createHash('sha256').update(data).digest('hex');
/** Alan adıyla bağlı hash: SHA-256(etiket + "\n" + kanonik(değer)). */
const domainHash=(label,value)=>{if(!/^[a-z0-9-]+\/v[0-9]+$/.test(label))fail('geçersiz etiket');return sha256Hex(Buffer.from(label+'\n'+canonical(value),'utf8'));};
const toBytes=v=>Buffer.from(canonical(v),'utf8');

module.exports={parse,parseCanonical,canonical,domainHash,sha256Hex,toBytes,LIMITS};

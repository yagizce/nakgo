/* İl/ilçe kataloğu (mobil ve diğer istemciler için sürümlü, statik JSON).
 * Tek kaynak: src/js/config.js (LL: 81 il, DISTRICTS: ilçeler). Bu araç kaynaktan catalog/locations-v1.json üretir;
 * elle düzenlenmez. Kodlar: il = plaka kodu ("01"–"81"); ilçe = il kodu + "-" + Türkçe karaktersiz küçük harf ad
 * ("34-kadikoy"). Ad (name) veritabanında ve filtrelerde kullanılan değerin kendisidir.
 * Sürüm: içeriğin SHA-256 özetinin ilk 16 hanesi; içerik değişmeden sürüm değişmez.
 *   node tools/location-catalog.cjs          üret
 *   node tools/location-catalog.cjs --check  depodaki dosya kaynakla aynı mı (npm test) */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'catalog/locations-v1.json');
const source=fs.readFileSync(path.join(root,'src/js/config.js'),'utf8');
function literal(name){
  const m=source.match(new RegExp('const '+name+' = (\\{[\\s\\S]*?\\n?\\});'));
  if(!m)throw Error('config.js içinde '+name+' bulunamadı');
  return JSON.parse(m[1]);
}
// Plaka kodları (Karayolları Trafik Yönetmeliği il trafik kodları).
const PLATES=['Adana','Adıyaman','Afyonkarahisar','Ağrı','Amasya','Ankara','Antalya','Artvin','Aydın','Balıkesir','Bilecik','Bingöl','Bitlis',
  'Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep',
  'Giresun','Gümüşhane','Hakkari','Hatay','Isparta','Mersin','İstanbul','İzmir','Kars','Kastamonu','Kayseri','Kırklareli','Kırşehir','Kocaeli',
  'Konya','Kütahya','Malatya','Manisa','Kahramanmaraş','Mardin','Muğla','Muş','Nevşehir','Niğde','Ordu','Rize','Sakarya','Samsun','Siirt','Sinop',
  'Sivas','Tekirdağ','Tokat','Trabzon','Tunceli','Şanlıurfa','Uşak','Van','Yozgat','Zonguldak','Aksaray','Bayburt','Karaman','Kırıkkale','Batman',
  'Şırnak','Bartın','Ardahan','Iğdır','Yalova','Karabük','Kilis','Osmaniye','Düzce'];
const slug=s=>s.toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]/g,c=>({ç:'c',ğ:'g',ı:'i',ö:'o',ş:'s',ü:'u',â:'a',î:'i',û:'u'})[c])
  .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function build(){
  const cities=Object.keys(literal('LL')),districts=literal('DISTRICTS');
  const missing=cities.filter(c=>!PLATES.includes(c)),extra=PLATES.filter(c=>!cities.includes(c));
  if(cities.length!==81||PLATES.length!==81||missing.length||extra.length)throw Error('İl listesi plaka tablosuyla uyuşmuyor: '+[...missing,...extra].join(', '));
  if(Object.keys(districts).sort().join()!==[...cities].sort().join())throw Error('DISTRICTS illeri LL ile aynı değil');
  const list=PLATES.map((name,i)=>{
    const code=String(i+1).padStart(2,'0'),seen=new Set();
    return {code,name,districts:districts[name].map(d=>{
      const c=code+'-'+slug(d);
      if(!slug(d)||seen.has(c))throw Error('İlçe kodu çakışıyor: '+name+' / '+d);
      seen.add(c);return {code:c,name:d};
    })};
  });
  const body={schema:1,source:'src/js/config.js',cities:list};
  const version=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,16);
  return JSON.stringify({version,...body},null,1)+'\n';
}
if(require.main===module){
  const text=build();
  if(process.argv.includes('--check')){
    const current=fs.existsSync(out)?fs.readFileSync(out,'utf8'):'';
    if(current!==text){console.error('catalog/locations-v1.json kaynakla aynı değil: node tools/location-catalog.cjs');process.exit(1);}
    console.log('İl/ilçe kataloğu güncel ('+JSON.parse(text).version+')');
  }else{fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,text);console.log('Yazıldı: catalog/locations-v1.json ('+JSON.parse(text).version+')');}
}
module.exports={build,slug,PLATES};

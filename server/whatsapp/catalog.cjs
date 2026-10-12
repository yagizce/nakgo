/* Şehir/araç tek kaynağı: mevcut frontend sabitlerinden JSON veri okur, kod çalıştırmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../src/js/config.js'),'utf8');
function literal(name,pattern){
  const match=source.match(new RegExp('const '+name+' = ('+pattern+');'));
  if(!match)throw Error('NakGo katalog biçimi desteklenmiyor');
  return JSON.parse(match[1]);
}
const cities=Object.freeze(Object.keys(literal('LL','\\{[^\\n]+\\}')));
const vehicles=Object.freeze(literal('vehicles','\\[[^\\n]+\\]'));
const bodies=Object.freeze(literal('bodies','\\[[^\\n]+\\]'));
// Yeni ve sınırlı ilçe eşlemesi; şehir/araç listesi kopyalanmaz. Kaynaklar docs/whatsapp-v1.md.
const districts=Object.freeze({Aliağa:'İzmir',Bornova:'İzmir',Kemalpaşa:'İzmir',Menemen:'İzmir',Torbalı:'İzmir',Gebze:'Kocaeli',Dilovası:'Kocaeli',Çorlu:'Tekirdağ',Çerkezköy:'Tekirdağ'});
if(cities.length!==81||Object.values(districts).some(c=>!cities.includes(c)))throw Error('NakGo katalog tutarsız');
module.exports={cities,vehicles,bodies,districts};

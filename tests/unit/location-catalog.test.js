/* İl/ilçe kataloğu (catalog/locations-v1.json): tek kaynakla (config.js), veritabanı il kısıtıyla, v0 filtreleriyle ve
   WhatsApp kataloğuyla tutarlı; kodlar benzersiz ve sabit; dosya elle değiştirilmemiş. */
module.exports=({test,fs,path,ROOT})=>{
 test('İl/ilçe kataloğu: tek kaynak, kodlar, veritabanı ve filtrelerle tutarlılık',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const tool=require(path.join(ROOT,'tools/location-catalog.cjs'));
  const text=fs.readFileSync(path.join(ROOT,'catalog/locations-v1.json'),'utf8'),cat=JSON.parse(text);
  ok(tool.build()===text,'dosya kaynaktan üretilenle aynı (elle düzenlenmemiş)');
  ok(tool.build()===tool.build(),'üretim belirlenimci');
  const crypto=require('node:crypto'),{version,...body}=cat;
  ok(/^[0-9a-f]{16}$/.test(version)&&crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0,16)===version,'sürüm içerik özetidir');
  const config=fs.readFileSync(path.join(ROOT,'src/js/config.js'),'utf8');
  const LL=JSON.parse(config.match(/const LL = (\{[^\n]+\});/)[1]),DISTRICTS=JSON.parse(config.match(/const DISTRICTS = (\{[\s\S]*?\n\});/)[1]);
  const names=cat.cities.map(c=>c.name);
  ok(names.length===81&&[...names].sort().join()===Object.keys(LL).sort().join(),'81 il, adlar config.js LL ile aynı');
  ok(/const cities = Object\.keys\(LL\)/.test(config),'v0 il seçimleri ve filtreleri aynı LL listesini kullanır');
  for(const c of cat.cities){
   const want=DISTRICTS[c.name]||[];
   if(JSON.stringify(c.districts.map(d=>d.name))!==JSON.stringify(want))ok(false,c.name+': ilçeler DISTRICTS ile aynı değil');
  }
  ok(cat.cities.reduce((n,c)=>n+c.districts.length,0)===973,'973 ilçe (DISTRICTS sırası korunur)');
  const codes=cat.cities.map(c=>c.code);
  ok(codes.join()===Array.from({length:81},(_,i)=>String(i+1).padStart(2,'0')).join(),'il kodları 01–81, sıralı ve benzersiz');
  const plate=Object.fromEntries(cat.cities.map(c=>[c.name,c.code]));
  ok(plate['Adana']==='01'&&plate['Ankara']==='06'&&plate['Mersin']==='33'&&plate['İstanbul']==='34'&&plate['İzmir']==='35'&&plate['Kahramanmaraş']==='46'&&
   plate['Şanlıurfa']==='63'&&plate['Aksaray']==='68'&&plate['Düzce']==='81','plaka kodları resmi tabloyla aynı (örnekler)');
  const dcodes=cat.cities.flatMap(c=>c.districts.map(d=>d.code));
  ok(new Set(dcodes).size===dcodes.length,'ilçe kodları benzersiz');
  ok(cat.cities.every(c=>c.districts.every(d=>d.code.startsWith(c.code+'-')&&/^\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/.test(d.code))),'ilçe kodu = il kodu + ASCII ad');
  ok(dcodes.includes('34-kadikoy')&&dcodes.includes('35-bornova')&&dcodes.includes('06-cankaya'),'Türkçe karakterler ASCII karşılığına çevrilir');
  // Veritabanı: ilan il kısıtı (v0 ve v1 aynı tabloya yazar) katalogdaki adlarla birebir.
  const mig=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261024010000_listings.sql'),'utf8');
  for(const col of ['from_city','to_city']){
   const m=mig.match(new RegExp(col+" text not null check\\("+col+" in \\(([^)]*)\\)\\)"));
   const db=m?[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]):[];
   ok(db.length===81&&[...db].sort().join()===[...names].sort().join(),'veritabanı '+col+' kısıtı katalogla aynı');
  }
  const dir=path.join(ROOT,'supabase/migrations');
  ok(fs.readdirSync(dir).filter(f=>/check\s*\(\s*(from|to)_city\s+in\s*\(/i.test(fs.readFileSync(path.join(dir,f),'utf8'))).join()==='20261024010000_listings.sql','il kısıtı tek migration\'da; sonradan değiştirilmemiş');
  const wa=require(path.join(ROOT,'server/whatsapp/catalog.cjs'));
  ok([...wa.cities].sort().join()===[...names].sort().join(),'WhatsApp kataloğu aynı il listesi');
  ok(Object.entries(wa.districts).every(([d,c])=>cat.cities.find(x=>x.name===c)?.districts.some(x=>x.name===d)),'WhatsApp ilçe eşlemesi katalogda var');
  return out;
 });
};

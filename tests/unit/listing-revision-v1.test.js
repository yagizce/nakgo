/* B3-d: ilan düzenlemede revision (son okunan updated_at) sunucuya gider; eşzamanlı düzenleme çakışmasında ilanın güncel
   hâli ekrana yüklenir ve onaylı uyarı metni gösterilir. */
module.exports=({test,boot})=>{
 test('İlan düzenleme: revision gönderilir; çakışmada güncel ilan yüklenir ve uyarı gösterilir',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const r=boot();
  const row={id:42,owner_id:'',kind:'truck',from_city:'İzmir',to_city:'Bursa',from_district:null,to_district:null,expires_at:new Date(Date.now()+3600e3).toISOString(),vehicle:'Kamyon',body:'Tenteli',
   amount:12,cargo:'',note:'Eski',owner_label:'Ayşe',available_on:new Date(Date.now()+3*3600e3).toISOString().slice(0,10),available_until:null,available_time:'',loading_text:null,items:[],
   image_data:'',has_photo:false,status:'active',created_at:new Date().toISOString(),updated_at:'2026-11-18T08:00:00.123Z',contact_consent:false};
  r(`nakgoMarket.active=()=>true;const x=nakgoMarket.mapped(${JSON.stringify(row)});x.mine=true;trucks=[x];loads=[];globalThis.__args=null;
     nakgoAuth.updateListing=async(...a)=>{globalThis.__args=a;return {...${JSON.stringify(row)},note:'Yeni',updated_at:'2026-11-18T08:05:00.000Z'};};`);
  ok(r(`return trucks[0].rev`)==='2026-11-18T08:00:00.123Z','kayıtta revision');
  await r(`return nakgoMarket.update('t','t42',{note:'Yeni'})`);
  ok(JSON.stringify(r(`return globalThis.__args`))==='[42,{"note":"Yeni"},"2026-11-18T08:00:00.123Z"]','güncellemeye revision verildi');
  ok(r(`return trucks[0].note`)==='Yeni'&&r(`return trucks[0].rev`)==='2026-11-18T08:05:00.000Z','yanıt sonrası yeni revision');
  r(`nakgoAuth.updateListing=async()=>{throw Object.assign(Error('conflict'),{code:'conflict',current:{...${JSON.stringify(row)},note:'Başka cihaz',updated_at:'2026-11-18T09:00:00.000Z'}});};`);
  let msg='';try{await r(`return nakgoMarket.update('t','t42',{note:'Benim'})`);}catch(e){msg=r(`return nakgoAuth.message({code:'conflict'})`);}
  ok(r(`return trucks[0].note`)==='Başka cihaz'&&r(`return trucks[0].rev`)==='2026-11-18T09:00:00.000Z','çakışmada güncel hâli yüklendi');
  ok(msg==='İlan başka bir yerde değişti; güncel hâli yüklendi, yeniden dene.','onaylı uyarı metni');
  return out;
 });
};

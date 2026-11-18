/* B3-d: v1 başkasının ilanında sahip kimliği vermez (veri minimizasyonu, onaylı karar). Arayüzdeki sonuç: başkasının ilan
   ayrıntısında cihaz içi "Engelle" düğmesi yok ve engellenen hesap filtresi v1 ilanlarına uygulanmaz; ilan sahibinin adı,
   "Profili gör", iletişim ve kendi ilanının tanınması sürer. v0 satırında (bugün) davranış aynen kalır. */
module.exports=({test,boot})=>{
 test('v1: sahip kimliği yokken ilan ayrıntısı ve engelleme davranışı',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const r=boot();
  const day=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
  const row=(id,owner)=>({id,owner_id:owner,kind:'load',from_city:'İstanbul',to_city:'Ankara',from_district:null,to_district:null,expires_at:new Date(Date.now()+3600e3).toISOString(),
   vehicle:'Tır',body:'Tenteli',amount:20,cargo:'Palet',note:'',owner_label:'Ayşe Nakliyat',available_on:day,available_until:null,available_time:'',loading_text:null,items:[],
   image_data:'',has_photo:false,status:'active',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),revision:null,contact_consent:true});
  r(`nakgoMarket.active=()=>true;loads=[nakgoMarket.mapped(${JSON.stringify(row(1,null))}),nakgoMarket.mapped(${JSON.stringify(row(2,'00000000-0000-4000-8000-0000000000aa'))})];trucks=[];
     blocked=['00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-0000000000bb'];`);
  ok(r(`return loads[0].uid`)===null&&r(`return loads[0].mine`)===false,'v1 satırı: sahip bilinmiyor, kendi ilanı değil');
  r(`openLoad(1)`);const v1html=r(`return $("#sheetBody").innerHTML`);
  ok(!v1html.includes('id="bk2"'),'v1: Engelle düğmesi yok');
  ok(v1html.includes('Ayşe Nakliyat')&&v1html.includes('id="pf"')&&v1html.includes('id="rp"'),'v1: sahip adı, Profili gör ve Şikayet et duruyor');
  ok(r(`return availableListing(loads[0])`)===true,'v1: engellenen hesap filtresi uygulanmaz (sahip bilinmiyor)');
  // v0 satırı (bugünkü durum): sahip kimliği var, Engelle düğmesi ve filtre aynen.
  r(`openLoad(2)`);const v0html=r(`return $("#sheetBody").innerHTML`);
  ok(v0html.includes('id="bk2"'),'v0: Engelle düğmesi sürer');
  ok(r(`return availableListing(loads[1])`)===false,'v0: engellenen hesabın ilanı gizlenir');
  return out;
 });
};

/* B10: v1 modunda tonaj formu en fazla 3 ondalık kabul eder; geçersizse form gönderilmeden uyarı gösterilir, yuvarlama
   yapılmaz. v0 modunda giriş davranışı değişmez. Sunucu doğrulaması ayrıca sürer (tests/db/api-v1-vehicle.test.cjs). */
module.exports=({test,boot})=>{
 const MSG='Tonaj en fazla 3 ondalık basamak içerebilir. Örnek: 18,250 ton.';
 test('Tonaj hassasiyeti: metin kuralı (ondalık, tam sayı, sıfır, boş, geçersiz karakter)',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);const r=boot();
  for(const v of ['18','18.5','18.25','18.250','18,250','0.001','1e-3','40','9007199254740991',' 7.5 '])ok(r(`return tonDecimalsOK(${JSON.stringify(v)})`)===true,'geçerli '+v);
  for(const v of ['18.2501','18.2500','18,2501','0.0001','1e-4','1e-7','40.12345'])ok(r(`return tonDecimalsOK(${JSON.stringify(v)})`)===false,'geçersiz '+v);
  // Sıfır, boş ve geçersiz karakter bu kuralın değil mevcut kontrolün işi (bugünkü mesaj aynen).
  for(const v of ['','0','abc','-','1..2'])ok(r(`return tonDecimalsOK(${JSON.stringify(v)})`)===true,'hassasiyet dışı durum mevcut kontrole kalır: '+JSON.stringify(v));
  ok(r(`return positiveAmount(+'')`)===false&&r(`return positiveAmount(+'0')`)===false&&r(`return positiveAmount(+'abc')`)===false,'boş/sıfır/geçersiz zaten reddediliyor');
  r(`nakgoAuth.apiMode=()=> 'v1'`);
  ok(r(`return v1TonError('18.2501')`)===MSG&&r(`return v1TonError('18.250')`)==='','v1: uyarı metni');
  r(`nakgoAuth.apiMode=()=> 'v0'`);
  ok(r(`return v1TonError('18.2501')`)==='','v0: kontrol yok');
  return out;
 });

 test('Tonaj hassasiyeti: ilan formu ve düzenleme v1/v0 modunda; geçiş sonrası doğru mod',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);const r=boot();
  r(`globalThis.__toasts=[];globalThis.__created=[];toast=t=>globalThis.__toasts.push(t);
     nakgoMarket.active=()=>true;nakgoMarket.guest=()=>false;nakgoMarket.create=async(v)=>{globalThis.__created.push(v);return {};};
     globalThis.__mode='v1';nakgoAuth.apiMode=()=>globalThis.__mode;`);
  const publish=async(raw,mode)=>{
   r(`globalThis.__toasts=[];globalThis.__created=[];globalThis.__mode=${JSON.stringify(mode)};postMode='truck';tab='post';$("#go").disabled=false;renderPost($("#main"));
      $("#f").value='İzmir';$("#t").value='Bursa';$("#v").value='Kamyon';$("#bd").value='Tenteli';$("#d").value=localDay();$("#n").value='';$("#post-phone").value='05321234567';$("#w").value=${JSON.stringify(raw)};`);
   try{await r(`return $("#go").onclick()`);}catch(e){}
   return {toasts:r(`return globalThis.__toasts.slice()`),created:r(`return globalThis.__created.map(x=>x.cap)`)};
  };
  let x=await publish('18.2501','v1');ok(x.toasts[0]===MSG&&!x.created.length,'v1: 18,2501 gönderilmedi, uyarı gösterildi');
  x=await publish('18.2500','v1');ok(x.toasts[0]===MSG&&!x.created.length,'v1: 4 basamaklı yazım da reddedilir (sessiz kısaltma yok)');
  x=await publish('18.250','v1');ok(x.created.length===1&&x.created[0]===18.25&&!x.toasts.includes(MSG),'v1: 18,250 gönderildi (değer aynı, yuvarlama yok)');
  x=await publish('18','v1');ok(x.created[0]===18,'v1: tam sayı');
  x=await publish('0','v1');ok(!x.created.length&&x.toasts[0]==='Geçerli, sıfırdan büyük bir tonaj gir','v1: sıfır mevcut mesaj');
  x=await publish('','v1');ok(!x.created.length&&x.toasts[0]==='Geçerli, sıfırdan büyük bir tonaj gir','v1: boş mevcut mesaj');
  x=await publish('abc','v1');ok(!x.created.length&&x.toasts[0]==='Geçerli, sıfırdan büyük bir tonaj gir','v1: geçersiz karakter mevcut mesaj');
  x=await publish('18.2501','v0');ok(x.created.length===1&&x.created[0]===18.2501&&!x.toasts.includes(MSG),'v0: davranış değişmedi, değer olduğu gibi');
  // Oturum ortasında v1 → v0 geçişi: aynı form, kontrol kalkar; geri v1: kontrol döner.
  x=await publish('7.12345','v1');ok(!x.created.length,'v1');x=await publish('7.12345','v0');ok(x.created[0]===7.12345,'geçiş sonrası v0');
  x=await publish('7.12345','v1');ok(!x.created.length&&x.toasts[0]===MSG,'yeniden v1');
  // Yük ilanı formu (ağırlık alanı).
  r(`globalThis.__toasts=[];globalThis.__created=[];globalThis.__mode='v1';postMode='load';tab='post';$("#go").disabled=false;renderPost($("#main"));
     $("#f").value='İstanbul';$("#t").value='Ankara';$("#v").value='Tır';$("#b").value='Tenteli';$("#d").value='Bugün';$("#n").value='';$("#c").value='Palet';$("#w").value='3.1415';
     $("#post-phone").value='05321234567';`);
  try{await r(`return $("#go").onclick()`);}catch(e){}
  ok(r(`return globalThis.__toasts[0]`)===MSG&&!r(`return globalThis.__created.length`),'v1 yük formu: uyarı, gönderim yok');
  // Düzenleme formu (boş kapasite).
  const day=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
  r(`const x=nakgoMarket.mapped({id:5,owner_id:'',kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,cargo:'',note:'',owner_label:'A',available_on:'${day}',available_until:null,available_time:'',loading_text:null,items:[],image_data:'',status:'active',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600e3).toISOString(),updated_at:'',revision:0});
     x.mine=true;trucks=[x];loads=[];globalThis.__upd=[];nakgoMarket.update=async(k,id,p)=>{globalThis.__upd.push(p);return true;};globalThis.__toasts=[];`);
  const edit=async(raw,mode)=>{r(`globalThis.__mode=${JSON.stringify(mode)};globalThis.__upd=[];globalThis.__toasts=[];openEdit('t','t5');$("#ep").value=${JSON.stringify(raw)};$("#ed").value='Bugün';`);
   try{await r(`return $("#es").onclick()`);}catch(e){}
   return {toasts:r(`return globalThis.__toasts.slice()`),upd:r(`return globalThis.__upd.map(p=>p.cap)`)};};
  let e=await edit('12.3456','v1');ok(e.toasts[0]===MSG&&!e.upd.length,'v1 düzenleme: uyarı, kayıt yok');
  e=await edit('12.345','v1');ok(!e.toasts.includes(MSG),'v1 düzenleme: 3 ondalık kabul');
  e=await edit('12.3456','v0');ok(!e.toasts.includes(MSG),'v0 düzenleme: davranış değişmedi');
  return out;
 });
};

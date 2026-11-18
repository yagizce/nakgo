/* B3-d: istemcinin API v1 geçişi. Sahte Supabase istemcisiyle: sürüm seçimi (tek yer), v1 çağrı adları ve argümanları,
   yanıtların v0 satır biçimine çevrilmesi, hata kodlarının bugünkü mesajlara eşlenmesi, v0'a güvenli dönüş, istek kimliği,
   eşzamanlı düzenleme. Mevcut v0 testlerine dokunmaz; onlar şema desteği olmayan sahte istemciyle v0'da çalışmaya devam eder. */
module.exports=({test,fs,path,ROOT})=>{
 const vm=require('node:vm');
 const v1spec=JSON.parse(fs.readFileSync(path.join(ROOT,'supabase/contract/v1.json'),'utf8'));
 const source=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
 const ME='00000000-0000-4000-8000-000000000001';
 const item=(id,o={})=>({id,kind:'load',from:{city:'İstanbul',district:'Tuzla'},to:{city:'Ankara',district:null},vehicle:'Tır',body:'Tenteli',amount:20,cargo:'Palet',items:[],
  date:{on:null,until:null,time:'',text:'bugün'},status:'active',created_at:'2026-11-18T08:00:00.000Z',has_photo:true,owner_label:'Ayşe',note:'Not',mine:false,
  expires_at:'2026-11-18T14:00:00.000Z',updated_at:'2026-11-18T08:00:00.123Z',contact_allowed:true,revision:o.mine?3:null,...o});
 // Sahte SDK: v1 çağrıları (schema('api').rpc) ve v0 çağrıları (rpc/from) ayrı kaydedilir.
 function harness({status={data:{data:{enabled:true}},error:null},v1={},config={},schema=true}={}){
  const calls={v1:[],v0:[]};let callback;const who={id:ME};
  const answer=(fn,args)=>{const a=v1[fn];const r=typeof a==='function'?a(args):a;return r||{data:{data:null},error:null};};
  const q=(table)=>{const req={table};calls.v0.push(req);const o={select(){return o;},order(){return o;},limit(){return o;},eq(){return o;},lt(){return o;},insert(v){req.insert=v;return o;},update(v){req.update=v;return o;},
   async maybeSingle(){return {data:table==='profiles'?{id:ME,display_name:'Ayşe'}:{id:1},error:null};},async single(){return {data:{id:1},error:null};},then(res,rej){return Promise.resolve({data:[],error:null}).then(res,rej);}};return o;};
  const sdk={auth:{onAuthStateChange(cb){callback=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:who.id,email:'a@test.invalid',user_metadata:{display_name:'Ayşe'}}},error:null};}},
   from:q,async rpc(fn,args){calls.v0.push({rpc:fn,args});return {data:fn==='nakgo_listing_contact'?'+905321234567':{},error:null};}};
  if(schema)sdk.schema=name=>({async rpc(fn,args){calls.v1.push({schema:name,fn,args});return fn==='status_v1'?(typeof status==='function'?status():status):answer(fn,args);}});
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,crypto:globalThis.crypto,Uint8Array,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},
   document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},
   window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst',...config})}),supabase:{createClient:()=>sdk}}};
  vm.createContext(ctx);vm.runInContext(source+';this.auth=nakgoAuth;',ctx);
  return {ctx,calls,who,auth:()=>ctx.auth,signIn:()=>callback('SIGNED_IN'),signOut:()=>callback('SIGNED_OUT')};
 }
 const fns=calls=>calls.v1.map(c=>c.fn);

 test('API v1 istemcisi: çağrı adları ve argümanları sözleşmedeki uçlarla aynı',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const found=[...source.matchAll(/\bv1\('([a-z_0-9]+)',\{([^}]*)\}/g)];
  ok(found.length>=18,'v1 çağrıları bulundu: '+found.length);
  const used=new Set();
  for(const [,fn,args] of found){
   used.add(fn);const spec=v1spec.functions[fn];ok(spec,fn+' sözleşmede var');if(!spec)continue;
   const given=[...args.matchAll(/\b(p_[a-z_]+)\s*:/g)].map(m=>m[1]),names=spec.args.map(a=>a[0]);
   for(const a of given)ok(names.includes(a),fn+': bilinmeyen argüman '+a);
   for(const [a,,opt] of spec.args)if(!opt)ok(given.includes(a),fn+': zorunlu argüman yok '+a);
  }
  // status_v1 yalnız sürüm sorgusunda; yönetici uçları yok (B8'e kadar v0).
  // listing_catalog_v1 (B10) diğer istemciler içindir; bu istemci listeleri config.js'te taşır ve test bunların katalogla
  // aynı olduğunu denetler (tests/db/api-v1-vehicle.test.cjs).
  const all=Object.keys(v1spec.functions).filter(f=>!['status_v1','listing_catalog_v1'].includes(f));
  for(const f of all)ok(used.has(f),'istemci '+f+' kullanıyor');
  ok(/callV1\('status_v1',\s*\{\}\)/.test(source),'sürüm sorgusu status_v1');
  ok(!/\.rpc\('[a-z_]+_v1'/.test(source),'v1 uçları v0 RPC listesine karışmıyor');
  ok((source.match(/const API_PREFERENCE = '(auto|v0)'/)||[])[1]==='auto','sürüm tercihi tek sabitte');
  return out;
 });

 test('API v1 istemcisi: sunucu açık derse bütün kullanıcı çağrıları v1; yanıtlar v0 biçiminde',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const h=harness({v1:{
   profile_v1:{data:{data:{display_name:'Ayşe',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listings_v1:{data:{data:[item(9),item(8,{mine:true})],page:{next:null}},error:null},
   my_listings_v1:{data:{data:[item(8,{mine:true})],page:{next:null}},error:null},
   listing_create_v1:a=>({data:{data:{listing:item(10,{mine:true,photo:'data:image/jpeg;base64,/9j/AA=='}),created:true}},error:null}),
   listing_update_v1:{data:{data:{listing:item(8,{mine:true,note:'Yeni'})}},error:null},
   listing_close_v1:{data:{data:{listing:item(8,{mine:true,status:'closed'}),changed:true}},error:null},
   listing_v1:{data:{data:item(9,{photo:'data:image/jpeg;base64,/9j/AA=='})},error:null},
   listing_contact_v1:a=>({data:{data:a.p_id===9?{phone:'+905321234567',limited:false}:{phone:null,limited:true}},error:null}),
   favorites_v1:{data:{data:[{listing_id:9,available:true,listing:item(9)},{listing_id:7,available:false,listing:null}],page:{next:null}},error:null},
   favorite_ids_v1:{data:{data:[9,7],page:{next:null}},error:null},
   favorite_add_v1:{data:{data:{listing_id:9,saved:true}},error:null},favorite_remove_v1:{data:{data:{listing_id:9,saved:false}},error:null},
   route_alerts_v1:{data:{data:[{id:3,kind:'load',from:'İzmir',to:null,vehicle:null,body:null,active:true,seen_at:'s',created_at:'c'}],page:{next:null}},error:null},
   route_alert_create_v1:{data:{data:{alert:{id:4,kind:'load',from:'Bursa',to:null,vehicle:null,body:null,active:true,seen_at:'s',created_at:'c'},created:true}},error:null},
   route_alert_update_v1:{data:{data:{alert:{id:3,kind:'load',from:'İzmir',to:null,vehicle:null,body:null,active:false,seen_at:'s',created_at:'c'}}},error:null},
   route_alert_delete_v1:{data:{data:{id:3,removed:true}},error:null},route_alerts_seen_v1:{data:{data:{updated:2}},error:null},
   profile_update_v1:{data:{data:{display_name:'Yeni',account_type:'owner',city:'Bursa',about:'',phone:''}},error:null},
   account_delete_v1:{data:{data:{deleted:true}},error:null}}});
  const a=h.auth();await a.init();
  ok(a.snapshot().profile.display_name==='Ayşe'&&a.snapshot().profile.id===ME,'profil v1 profile_v1 ile, kimlik oturumdan');
  const feed=await a.listListings();
  ok(feed[0].from_city==='İstanbul'&&feed[0].from_district==='Tuzla'&&feed[0].loading_text==='bugün'&&feed[0].contact_consent===true,'ilan alanları v0 adlarıyla');
  ok(feed[0].owner_id===null&&feed[1].owner_id===ME,'sahip yalnız kendi ilanında (v1 sahip kimliği vermez)');
  ok(feed[0].image_data===''&&feed[0].has_photo===true&&feed[0].updated_at==='2026-11-18T08:00:00.123Z','listede fotoğraf yok, has_photo ve revision var');
  await a.listListings({own:true,before:50});
  ok(JSON.stringify(h.calls.v1.at(-1))===JSON.stringify({schema:'api',fn:'my_listings_v1',args:{p_cursor:'50'}}),'kendi ilanlarım, imleç metin');
  const created=await a.createListing({kind:'load',from_city:'Ankara',to_city:'İzmir',amount:12,owner_id:'x',status:'closed',premium:true});
  const c=h.calls.v1.at(-1);
  ok(c.fn==='listing_create_v1'&&/^[0-9a-f-]{36}$/.test(c.args.p_request_id)&&JSON.stringify(c.args.p_listing)==='{"kind":"load","from_city":"Ankara","to_city":"İzmir","amount":12,"amount_unit":"ton"}','oluşturma: istek kimliği + beyaz liste + tonaj birimi (B10), sahip/ad/durum gönderilmez');
  await a.updateListing(8,{amount:14},3);ok(JSON.stringify(h.calls.v1.at(-1).args.p_changes)==='{"amount":14,"amount_unit":"ton"}','tonaj güncellemesinde birim');
  ok(created.id===10&&created.image_data.startsWith('data:image/jpeg'),'oluşturma yanıtı v0 satırı');
  ok(feed[1].revision===3&&feed[0].revision===null,'revision yalnız kendi ilanında (tamsayı)');
  await a.updateListing(8,{note:'Yeni',owner_id:'x'},3);
  ok(JSON.stringify(h.calls.v1.at(-1).args)==='{"p_id":8,"p_revision":3,"p_changes":{"note":"Yeni"}}','güncelleme tamsayı revision ile');
  const closed=await a.updateListing(8,{status:'closed'},3);
  ok(h.calls.v1.at(-1).fn==='listing_close_v1'&&closed.status==='closed','yalnız kapatma listing_close_v1');
  ok(await a.listingPhoto(9)==='data:image/jpeg;base64,/9j/AA==','fotoğraf ayrıntı ucundan');
  ok(await a.listingContact(9,'call')==='+905321234567'&&JSON.stringify(h.calls.v1.at(-1).args)==='{"p_id":9,"p_channel":"call"}','telefon + kanal');
  ok(await a.listingContact(11)===null&&h.calls.v1.at(-1).args.p_channel===null,'sınır aşımı v0 gibi null (ekran #135 uyarısını gösterir)');
  const favs=await a.listFavorites({details:true});
  ok(favs.length===2&&favs[0].listing.from_city==='İstanbul'&&favs[1].listing===null,'favoriler gömülü ilanla, görünmeyen null');
  ok(JSON.stringify(await a.listFavorites({before:10}))==='[{"listing_id":9},{"listing_id":7}]'&&h.calls.v1.at(-1).fn==='favorite_ids_v1'&&h.calls.v1.at(-1).args.p_cursor==='10','favori kimlikleri, imleç');
  ok(JSON.stringify(await a.setFavorite(9,true))==='{"listing_id":9,"saved":true}'&&h.calls.v1.at(-1).fn==='favorite_add_v1','favori ekleme');
  await a.setFavorite(9,false);ok(h.calls.v1.at(-1).fn==='favorite_remove_v1','favori kaldırma');
  const alerts=await a.listRouteAlerts();ok(alerts[0].from_city==='İzmir'&&alerts[0].to_city===null,'rota alarmları v0 adlarıyla');
  ok((await a.saveRouteAlert({kind:'load',from:' Bursa '})).from_city==='Bursa'&&h.calls.v1.at(-1).args.p_from==='Bursa','alarm kurma');
  ok((await a.setRouteAlert(3,false)).active===false,'alarm durdurma');
  ok((await a.removeRouteAlert(3)).removed===true,'alarm silme');
  ok(await a.routeAlertsSeen()===2,'görüldü');
  await a.saveProfileDetails({city:'Bursa'});ok(h.calls.v1.at(-1).fn==='profile_update_v1'&&a.snapshot().profile.city==='Bursa'&&a.snapshot().profile.id===ME,'profil güncelleme');
  ok(!h.calls.v0.some(x=>x.rpc!=='nakgo_delete_my_account'),'v1 açıkken v0 çağrısı yok');
  await a.deleteMyAccount();ok(h.calls.v1.some(x=>x.fn==='account_delete_v1')&&!h.calls.v0.length,'hesap silme v1');
  ok(fns(h.calls).filter(f=>f==='status_v1').length===1,'sürüm oturumda bir kez sorulur');
  return out;
 });

 test('API v1 istemcisi: hata eşlemesi, eşzamanlı düzenleme, v0 davranışının korunması',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const err=key=>({data:null,error:{code:'PT409',message:key,details:'x',hint:'nakgo.api'}});
  const h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listing_update_v1:err('conflict'),listing_v1:{data:{data:item(8,{mine:true,note:'Başka cihaz',revision:4})},error:null},
   listing_create_v1:{data:null,error:{code:'PT429',message:'limit_reached',hint:'nakgo.api'}},
   route_alert_create_v1:{data:{data:{alert:{id:3,kind:'load',from:'A'},created:false}},error:null},
   route_alert_delete_v1:{data:{data:{id:3,removed:false}},error:null},
   favorite_add_v1:{data:null,error:{code:'PT404',message:'not_found',hint:'nakgo.api'}},
   route_alert_update_v1:{data:null,error:{code:'42501',message:'account_suspended',hint:'nakgo.api'}}}});
  const a=h.auth();await a.init();
  let e=null;try{await a.updateListing(8,{note:'Benim'},2);}catch(x){e=x;}
  ok(e&&e.code==='conflict'&&a.message(e)==='İlan başka bir yerde değişti; güncel hâli yüklendi, yeniden dene.','çakışma mesajı (onaylı metin)');
  ok(e&&e.current&&e.current.note==='Başka cihaz'&&e.current.revision===4,'çakışmada güncel ilan ve yeni revision yüklenir');
  e=null;try{await a.createListing({kind:'truck'});}catch(x){e=x;}
  ok(e&&e.code==='54000'&&a.message(e).startsWith('Aynı anda en fazla 10'),'ilan sınırı bugünkü mesaj');
  e=null;try{await a.saveRouteAlert({kind:'load',from:'A'});}catch(x){e=x;}ok(e&&e.code==='23505','aynı alarm: bugünkü "zaten kurulu" davranışı');
  e=null;try{await a.removeRouteAlert(3);}catch(x){e=x;}ok(e&&e.code==='42501','olmayan alarm: bugünkü hata');
  e=null;try{await a.setFavorite(5,true);}catch(x){e=x;}ok(e&&e.code==='42501','görünmeyen ilan: bugünkü kod');
  e=null;try{await a.setRouteAlert(3,true);}catch(x){e=x;}ok(e&&e.code==='42501'&&e.apiKey==='account_suspended','askı: bugünkü kod, v1 anahtarı korunur');
  ok(!h.calls.v0.length,'iş hataları v0\'a devredilmez');
  return out;
 });

 test('API v1 istemcisi: v0\'a dönüş (kapalı, şema yok, fonksiyon yok) ve ağ hatasında çift yazma yok',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  // 1) Sunucu "kapalı" derse v0.
  let h=harness({status:{data:{data:{enabled:false}},error:null}});await h.auth().init();await h.auth().listListings();
  ok(fns(h.calls).join()==='status_v1'&&h.calls.v0.some(x=>x.table==='listings'),'kapalı: v0');
  // 2) Şema açık değil (son aşamaya kadar bugünkü durum): PGRST106 → v0.
  h=harness({status:{data:null,error:{code:'PGRST106',message:'Invalid schema: api'}}});await h.auth().init();await h.auth().listListings();
  ok(fns(h.calls).join()==='status_v1'&&h.calls.v0.some(x=>x.table==='profiles')&&h.calls.v0.some(x=>x.table==='listings'),'şema yok: v0');
  // 3) Sürüm sorgusu ağ hatası → v0.
  h=harness({status:()=>{throw new TypeError('fetch failed');}});await h.auth().init();await h.auth().listListings();
  ok(h.calls.v0.some(x=>x.table==='listings'),'ağ hatası: v0');
  // 4) Yapılandırma api:"v0" → hiç sorulmaz.
  h=harness({config:{api:'v0'}});await h.auth().init();await h.auth().listListings();
  ok(!h.calls.v1.length&&h.calls.v0.some(x=>x.table==='listings'),'yapılandırma v0: v1 çağrısı yok');
  // 5) Oturum ortasında v1 kapatılır (api_disabled): aynı istek bir kez v0 ile, sonrası hep v0.
  let disabled=false;
  h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listings_v1:()=>disabled?{data:null,error:{code:'PT503',message:'api_disabled',hint:'nakgo.api'}}:{data:{data:[item(1)],page:{next:null}},error:null}}});
  await h.auth().init();await h.auth().listListings();ok(fns(h.calls).at(-1)==='listings_v1','önce v1');
  disabled=true;const v0Before=h.calls.v0.length;const rows=await h.auth().listListings();
  ok(Array.isArray(rows)&&h.calls.v0.length===v0Before+1,'kapatılınca aynı istek v0 ile tekrarlandı');
  const v1Before=h.calls.v1.length;await h.auth().listListings();await h.auth().setFavorite(1,true);
  ok(h.calls.v1.length===v1Before,'oturumun kalanı v0');
  // 5b) Oturum ortasında şema kapatılır (PGRST106): aynı istek v0 ile.
  let gone=false;
  h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listings_v1:()=>gone?{data:null,error:{code:'PGRST106',message:'Invalid schema: api'}}:{data:{data:[],page:{next:null}},error:null}}});
  await h.auth().init();await h.auth().listListings();gone=true;const n0=h.calls.v0.length;await h.auth().listListings();
  ok(h.calls.v0.length===n0+1,'şema kalkınca aynı istek v0 ile');
  // 6) Fonksiyon yok (PGRST202) → v0.
  h=harness({v1:{profile_v1:{data:null,error:{code:'PGRST202',message:'Could not find the function'}}}});await h.auth().init();
  ok(h.calls.v0.some(x=>x.table==='profiles')&&h.auth().snapshot().profile,'fonksiyon yok: v0 ile profil');
  // 7) Yazmada ağ hatası: v0'a devredilmez; aynı içerik yeniden gönderilince aynı istek kimliği.
  let fail=true;const ids=[];
  h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listing_create_v1:a=>{ids.push(a.p_request_id);return fail?{data:null,error:{code:'',message:'TypeError: fetch failed'}}:{data:{data:{listing:item(5,{mine:true}),created:true}},error:null};}}});
  await h.auth().init();const input={kind:'load',from_city:'Ankara',to_city:'İzmir',amount:3};
  let e=null;try{await h.auth().createListing(input);}catch(x){e=x;}
  ok(e&&!h.calls.v0.some(x=>x.table==='listings'),'ağ hatası: v0 ile ikinci yazma yok');
  fail=false;await h.auth().createListing(input);
  ok(ids.length===2&&ids[0]===ids[1],'yeniden gönderim aynı istek kimliğiyle (sunucu ikinci ilanı açmaz)');
  await h.auth().createListing(input);ok(ids.length===3&&ids[2]!==ids[1],'başarıdan sonra yeni ilan yeni kimlik');
  await h.auth().createListing({...input,amount:4});ok(ids[3]!==ids[2],'farklı içerik farklı kimlik');
  // 7b) Belirsiz oluşturmadan sonra v1 kapatılırsa aynı içerik v0'a devredilmez (v0'da tekrar koruması yok).
  let mode='network';
  h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listing_create_v1:()=>mode==='network'?{data:null,error:{code:'',message:'TypeError: fetch failed'}}:mode==='limit'?{data:null,error:{code:'PT429',message:'limit_reached',hint:'nakgo.api'}}
    :{data:null,error:{code:'PT503',message:'api_disabled',hint:'nakgo.api'}}}});
  await h.auth().init();
  e=null;try{await h.auth().createListing(input);}catch(x){e=x;}ok(e&&e.code!=='create_uncertain','ilk deneme ağ hatası');
  mode='disabled';e=null;try{await h.auth().createListing(input);}catch(x){e=x;}
  ok(e&&e.code==='create_uncertain'&&!h.calls.v0.some(x=>x.table==='listings'),'belirsizken v0 ile ikinci yazma yok');
  ok(h.auth().message(e).includes('doğrulanamadı'),'kullanıcıya kontrol etmesi söylenir');
  await h.auth().createListing({...input,amount:9});ok(h.calls.v0.some(x=>x.table==='listings'&&x.insert),'farklı içerik v0 ile yazılır');
  // Sunucu yanıt verdiyse (iş hatası) belirsizlik yok: sonraki v0 denemesi serbest.
  h=harness({v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listing_create_v1:()=>mode==='limit'?{data:null,error:{code:'PT429',message:'limit_reached',hint:'nakgo.api'}}:{data:null,error:{code:'PT503',message:'api_disabled',hint:'nakgo.api'}}}});
  await h.auth().init();mode='limit';try{await h.auth().createListing(input);}catch(x){}
  mode='disabled';await h.auth().createListing(input);ok(h.calls.v0.some(x=>x.table==='listings'&&x.insert),'iş hatasından sonra v0 tekrarı serbest');
  // 8) Hesap değişince sürüm yeniden sorulur (ör. v1 bu arada kapatılmış).
  let enabled=true;
  h=harness({status:()=>({data:{data:{enabled}},error:null}),v1:{profile_v1:{data:{data:{display_name:'A',account_type:'owner',city:'',about:'',phone:''}},error:null},
   listings_v1:{data:{data:[],page:{next:null}},error:null}}});
  await h.auth().init();await h.auth().listListings();ok(fns(h.calls).at(-1)==='listings_v1','ilk hesap v1');
  enabled=false;h.who.id='00000000-0000-4000-8000-000000000002';h.signIn();await new Promise(r=>setTimeout(r,20));
  await h.auth().listListings();
  ok(fns(h.calls).filter(f=>f==='status_v1').length===2&&h.calls.v0.some(x=>x.table==='listings'),'yeni hesap: yeniden soruldu, v0');
  return out;
 });

 test('API v1 istemcisi: şema desteği olmayan istemcide v0 (bugünkü testler ve eski SDK)',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const h=harness({schema:false});await h.auth().init();await h.auth().listListings();await h.auth().listingContact(3);
  ok(!h.calls.v1.length&&h.calls.v0.some(x=>x.rpc==='nakgo_listing_contact'),'schema() yoksa v0');
  return out;
 });
};

/** B3-d: gerçek istemci kodu (src/js/cloud.js nakgoAuth) + gerçek supabase-js (2.117.3, uygulamanın sabitlediği sürüm) +
 * yerel PostgREST + migration'larla kurulmuş PostgreSQL. v1 açıkken uçtan uca akış, oturum ortasında v1 kapatılınca v0'a
 * dönüş ve api şeması açılmamışken (bugünkü Supabase durumu) baştan v0. Oturum (GoTrue) taklit edilir: kimlik JWT ile.
 * NAKGO_PG_HOST, NAKGO_POSTGREST_BIN ve @supabase/supabase-js (NODE_PATH) yoksa atlanır. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');
let sdk=null;try{sdk=require('@supabase/supabase-js');}catch{}
const SOURCE=fs.readFileSync(path.join(__dirname,'../../src/js/cloud.js'),'utf8');
const FAKE='https://abcdefghijklmnopqrst.supabase.co';

/** cloud.js'i ayrı bir bağlamda başlatır; istekler yerel PostgREST'e, kimlik verilen JWT ile. */
async function app(pg,{user,metadata={},config={},net=null}){
  const token=pg.jwt({sub:user});
  // net.drop: adı geçen uç bir kez sunucuda çalışır ama yanıtı istemciye ulaşmaz (bağlantı kopması benzetimi).
  const fetchLocal=async(url,init)=>{
    const res=await fetch(String(url).replace(FAKE+'/rest/v1',pg.base),init);
    if(net&&net.drop&&String(url).endsWith('/rpc/'+net.drop)){net.drop=null;throw new TypeError('fetch failed');}
    return res;
  };
  const ctx={URL,AbortSignal,setTimeout,clearTimeout,crypto:globalThis.crypto,Uint8Array,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},
    window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:FAKE,publishableKey:'sb_publishable_abcdefghijklmnopqrst',...config})}),
      supabase:{createClient:(url,key,opts)=>{
        const c=sdk.createClient(url,key,{...opts,auth:{...opts.auth,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchLocal,headers:{Authorization:'Bearer '+token}}});
        c.auth.getSession=async()=>({data:{session:{access_token:token}},error:null});
        c.auth.getUser=async()=>({data:{user:{id:user,email:'u@test.invalid',user_metadata:metadata}},error:null});
        c.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});
        c.auth.signOut=async()=>({error:null});
        return c;}}}};
  vm.createContext(ctx);vm.runInContext(SOURCE+';this.auth=nakgoAuth;',ctx);
  await ctx.auth.init();
  return ctx.auth;
}
const plain=x=>JSON.parse(JSON.stringify(x));
const usage=async db=>Object.fromEntries((await db.query(`select fn,sum(calls)::int n from private.api_usage group by fn`)).rows.map(r=>[r.fn,r.n]));
// Ekranların okuduğu alanlar (sahip kimliği, fotoğraf ve zaman biçimi hariç: v1 bunları bilerek farklı verir).
const view=r=>({id:Number(r.id),kind:r.kind,from:r.from_city,to:r.to_city,fromD:r.from_district,toD:r.to_district,veh:r.vehicle,body:r.body,amount:Number(r.amount),cargo:r.cargo,
  note:r.note,label:r.owner_label,on:r.available_on,until:r.available_until,time:r.available_time,text:r.loading_text,items:r.items,status:r.status,
  created:Date.parse(r.created_at),expires:Date.parse(r.expires_at),consent:r.contact_consent});

test('İstemci API v1 geçişi: gerçek supabase-js + yerel PostgREST',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN||!sdk){t.skip('NAKGO_PG_HOST, NAKGO_POSTGREST_BIN ve @supabase/supabase-js gerekli');return;}
  const db=await migratedDb();let pg=null,pg0=null,primary=null;
  try{
    const A='00000000-0000-4000-8000-0000000000d1',B='00000000-0000-4000-8000-0000000000d2';
    for(const id of [A,B])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
    pg=await startPostgrest(db);
    const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
    const JPEG='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    let a,b,mine,other;
    await t.test('v1 açık: ilk girişte profil v1 ile oluşur; ilan oluşturma, okuma, güncelleme, çakışma, kapatma',async()=>{
      a=await app(pg,{user:A,metadata:{display_name:'Ayşe',account_type:'owner'}});
      assert.deepEqual((await db.query(`select display_name,account_type from public.profiles where id=$1`,[A])).rows[0],{display_name:'Ayşe',account_type:'owner'});
      assert.equal(a.snapshot().profile.id,A);
      const input={kind:'load',from_city:'İstanbul',to_city:'Ankara',from_district:'Tuzla',to_district:null,vehicle:'Tır',body:'Tenteli',amount:20,cargo:'Palet',note:'Not',
        available_on:null,available_until:null,available_time:'',loading_text:'bugün',items:[],image_data:JPEG,contact_phone:'+905321234567',contact_consent:true};
      mine=await a.createListing(input);
      assert.equal((await db.query(`select owner_id,owner_label from public.listings where id=$1`,[mine.id])).rows[0].owner_label,'Ayşe');
      assert.equal(mine.owner_id,A);assert.equal(mine.image_data,JPEG);
      const own=await a.listListings({own:true});assert.deepEqual(own.map(r=>r.id),[mine.id]);
      assert.equal(own[0].image_data,'','listede fotoğraf yok');assert.equal(own[0].has_photo,true);
      assert.equal(await a.listingPhoto(mine.id),JPEG,'fotoğraf ayrıntıdan');
      assert.equal(own[0].revision,0);
      const updated=await a.updateListing(mine.id,{note:'Yeni not'},own[0].revision);assert.equal(updated.revision,1);
      assert.equal(updated.note,'Yeni not');
      await assert.rejects(a.updateListing(mine.id,{note:'Eski'},own[0].revision),e=>e.code==='conflict'&&e.current.note==='Yeni not'&&e.current.revision===1&&a.message(e).startsWith('İlan başka bir yerde değişti'));
      assert.equal((await db.query(`select note from public.listings where id=$1`,[mine.id])).rows[0].note,'Yeni not','çakışan güncelleme yazılmadı');
      const u=await usage(db);
      for(const fn of ['status_v1','profile_v1','profile_update_v1','listing_create_v1','my_listings_v1','listing_v1','listing_update_v1'])assert.ok(u[fn]>0,fn);
    });
    await t.test('v1 açık: akış, telefon, favori, rota alarmı; v0 hata davranışları korunur',async()=>{
      b=await app(pg,{user:B,metadata:{display_name:'Barış',account_type:'carrier'}});
      other=await b.createListing({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Kapalı kasa',amount:12,available_on:today,contact_phone:'+905339876543',contact_consent:true});
      const feed=await a.listListings();
      assert.deepEqual(feed.map(r=>r.id),[other.id,mine.id]);
      assert.equal(feed.find(r=>r.id===other.id).owner_id,null,'başkasının ilanında sahip kimliği yok');
      assert.equal(await a.listingContact(other.id,'call'),'+905339876543');
      assert.deepEqual(plain(await a.setFavorite(other.id,true)),{listing_id:other.id,saved:true});
      assert.deepEqual(plain(await a.listFavorites({})),[{listing_id:other.id}]);
      assert.equal((await a.listFavorites({details:true}))[0].listing.from_city,'İzmir');
      await a.setFavorite(other.id,false);assert.deepEqual(plain(await a.listFavorites({})),[]);
      const al=await a.saveRouteAlert({kind:'load',from:'Konya'});assert.equal(al.from_city,'Konya');
      await assert.rejects(a.saveRouteAlert({kind:'load',from:'Konya'}),e=>e.code==='23505','aynı alarm: v0 gibi "zaten kurulu"');
      assert.equal((await a.setRouteAlert(al.id,false)).active,false);
      assert.equal((await a.listRouteAlerts())[0].id,al.id);
      assert.equal(await a.routeAlertsSeen(),0);
      await a.removeRouteAlert(al.id);
      await assert.rejects(a.removeRouteAlert(al.id),e=>e.code==='42501','olmayan alarm: v0 gibi hata');
      for(let i=0;i<9;i++)await b.createListing({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:i+1,available_on:today});
      await assert.rejects(b.createListing({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:99,available_on:today}),
        e=>e.code==='54000'&&b.message(e).startsWith('Aynı anda en fazla 10'));
      await a.saveProfileDetails({city:'Bursa'});assert.equal(a.snapshot().profile.city,'Bursa');
    });
    await t.test('v1 ve v0 aynı kullanıcıya aynı ilanları aynı alanlarla gösterir',async()=>{
      const v1rows=await a.listListings(),own1=await a.listListings({own:true});
      const a0=await app(pg,{user:A,config:{api:'v0'}});
      const v0rows=await a0.listListings(),own0=await a0.listListings({own:true});
      assert.deepEqual(plain(v1rows.map(view)),plain(v0rows.map(view)));assert.deepEqual(plain(own1.map(view)),plain(own0.map(view)));
      assert.equal(own0[0].owner_id,A);assert.equal(own1[0].owner_id,A);
      assert.ok(Number.isInteger(own1[0].revision)&&own0[0].revision===undefined,'revision yalnız v1\'de (v0 sütunu göremez)');
    });
    await t.test('oturum ortasında v1 kapatılır: aynı çağrı v0 ile sürer, veri kaybı yok',async()=>{
      const before=await a.listListings();
      const u0=(await usage(db)).listings_v1;
      await db.query('update private.api_settings set v1_enabled=false');
      try{
        const after=await a.listListings();
        assert.deepEqual(after.map(r=>r.id),before.map(r=>r.id));
        assert.equal(after.find(r=>r.id===other.id).owner_id,B,'v0 satırı');
        const own=await a.listListings({own:true});
        const r=await a.updateListing(mine.id,{note:'v0 ile'},own[0].updated_at);assert.equal(r.note,'v0 ile');
      }finally{await db.query('update private.api_settings set v1_enabled=true');}
      await a.listListings();
      assert.equal((await usage(db)).listings_v1,u0,'v1 yeniden açılsa da bu oturum v0\'da kalır (yenileyince yeniden sorar)');
    });
    await t.test('bağlantı kopması: ilan sunucuda açıldı ama yanıt gelmedi; yeniden gönderim ikinci ilan açmaz, v1 kapatılsa da v0\'a devredilmez',async()=>{
      const net={drop:null};
      const c=await app(pg,{user:A,net});
      const input={kind:'truck',from_city:'Sivas',to_city:'Kayseri',vehicle:'Kamyon',body:'Tenteli',amount:7,available_on:today};
      const count=async()=>Number((await db.query(`select count(*) n from public.listings where owner_id=$1 and from_city='Sivas'`,[A])).rows[0].n);
      net.drop='listing_create_v1';
      await assert.rejects(c.createListing(input));
      assert.equal(await count(),1,'sunucu ilanı açtı, istemci bilmiyor');
      await db.query('update private.api_settings set v1_enabled=false');
      try{
        await assert.rejects(c.createListing(input),e=>e.code==='create_uncertain'&&c.message(e).includes('doğrulanamadı'));
        assert.equal(await count(),1,'v1 kapalıyken v0 ile ikinci ilan açılmadı');
      }finally{await db.query('update private.api_settings set v1_enabled=true');}
      const d=await app(pg,{user:A,net});net.drop='listing_create_v1';
      await assert.rejects(d.createListing({...input,to_city:'Tokat'}));
      const again=await d.createListing({...input,to_city:'Tokat'});
      assert.equal(Number((await db.query(`select count(*) n from public.listings where owner_id=$1 and to_city='Tokat'`,[A])).rows[0].n),1,'v1 açıkken yeniden gönderim aynı istek kimliğiyle: tek ilan');
      assert.ok(again.id>0);
    });
    await t.test('api şeması açılmamış (bugünkü Supabase): baştan v0, uygulama çalışır',async()=>{
      pg0=await startPostgrest(db,{schemas:'public'});
      const before=(await usage(db)).status_v1;
      const a0=await app(pg0,{user:A});
      assert.equal(a0.snapshot().profile.display_name,'Ayşe');
      assert.deepEqual((await a0.listListings()).map(r=>r.id),[...(await a.listListings())].map(r=>r.id));
      assert.equal(await a0.listingContact(other.id),'+905339876543');
      assert.equal((await usage(db)).status_v1,before,'v1 hiç çalışmadı');
    });
    await t.test('hesap silme v1 ile; yasal saklama v0 kuralıyla',async()=>{
      await b.deleteMyAccount();
      assert.equal((await db.query(`select display_name from public.profiles where id=$1`,[B])).rows[0].display_name,'Silinmiş hesap');
      assert.ok((await db.query(`select redacted_at from public.listings where id=$1`,[other.id])).rows[0].redacted_at);
      assert.equal(Number((await db.query(`select count(*) n from private.admin_audit where actor_id=$1 and action='self_delete'`,[B])).rows[0].n),1);
      assert.ok((await usage(db)).account_delete_v1>0);
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();if(pg0)pg0.stop();await finish(db,primary);}
});

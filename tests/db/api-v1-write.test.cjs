/** B3-c: API v1 yazma uçları. Her uç v0 yoluyla (authenticated rolü, RLS, sütun yetkisi, tetikleyiciler ya da nakgo_*
 * fonksiyonu) aynı işlemin sonucuyla karşılaştırılır. Kota, tetikleyici, revision, tekrar, yalıtım, telefon sınırı, hesap
 * silme ve yasal kayıt koruması sınanır. Sentetik veri; geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const rid=()=>crypto.randomUUID();
async function as(db,{user=null,role='authenticated',claims=null}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.query(`select set_config('request.jwt.claims',$1,true)`,[claims?JSON.stringify(claims):'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message,detail:e.detail,hint:e.hint}};}
}
// v1 çağrısı: {data} ya da {error:{code,key}}.
const call=async(db,user,fn,args=[],opts={})=>{
  const r=await as(db,{user,...opts},`select api.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a));
  return r.error?{error:r.error}:r.rows[0].r;
};
const key=r=>r.error&&r.error.key;
const istanbulToday=()=>new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const PHONE='+905321234567';
const JPEG='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const loadPayload=()=>({kind:'load',from_city:'İstanbul',to_city:'Ankara',from_district:'Tuzla',vehicle:'Tır',body:'Tenteli',amount:20,cargo:'Palet',note:'Not',
  loading_text:'bugün',items:[],image_data:JPEG,contact_phone:PHONE,contact_consent:true});
const truckPayload=()=>({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Kapalı kasa',amount:12,available_on:istanbulToday(),available_time:'09:30',contact_consent:false});
const COLS=['kind','from_city','to_city','from_district','to_district','vehicle','body','amount','cargo','note','available_on','available_until','available_time',
  'loading_text','items','image_data','contact_phone','contact_consent','status','owner_label','redacted_at'];
const row=async(db,id)=>(await db.query(`select * from public.listings where id=$1`,[id])).rows[0];
const pick=r=>JSON.parse(JSON.stringify(Object.fromEntries(COLS.map(c=>[c,r[c]]))));
const count=async(db,sql,args=[])=>Number((await db.query(sql,args)).rows[0].n);
// v0 yolu: authenticated rolü, RLS ve sütun yetkileriyle doğrudan tablo (cloud.js createListing/updateListing gibi).
const v0Insert=(db,user,label,p)=>{const k=Object.keys(p);return as(db,{user},`insert into public.listings(owner_label,${k.join(',')})
  select $1,${k.map(c=>'x.'+c).join(',')} from jsonb_populate_record(null::public.listings,$2) x returning id`,[label,JSON.stringify(p)]);};
const v0Update=(db,user,id,p)=>{const k=Object.keys(p);return as(db,{user},`update public.listings l set ${k.map(c=>c+'=x.'+c).join(',')}
  from jsonb_populate_record(null::public.listings,$1) x where l.id=$2 and l.owner_id=$3 returning l.id`,[JSON.stringify(p),id,user]);};

test('API v1 yazma uçları',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const A=uid(1),B=uid(2),C=uid(3),U=uid(4),D=uid(5),W=uid(6),N=uid(7),O=[uid(20),uid(21),uid(22),uid(23),uid(24)];
    for(const id of [A,B,C,U,D,W,N,...O])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)`,[id,id.slice(-4)+'@test.invalid',id===U?null:new Date().toISOString()]);
    await db.exec('set session_replication_role=replica');
    for(const [id,name] of [[A,'Ayşe'],[B,'Ayşe'],[C,'Cem'],[D,'Deniz'],[W,'Sahip'],...O.map((o,i)=>[o,'Sahip '+i])])
      await db.query(`insert into public.profiles(id,display_name,account_type) values($1,$2,'owner')`,[id,name]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[C]);
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[W]);
    await db.exec('reset session_replication_role');

    await t.test('ilan oluşturma: v0 ile aynı satır; sahip ve ad oturumdan/profilden; yanıt listing_v1 ayrıntısı',async()=>{
      for(const p of [loadPayload(),truckPayload()]){
        const a=await v0Insert(db,A,'Ayşe',p);assert.ok(!a.error,JSON.stringify(a.error));
        const b=await call(db,B,'listing_create_v1',[rid(),p]);assert.ok(b.data,JSON.stringify(b));
        assert.equal(b.data.created,true);
        const ra=await row(db,a.rows[0].id),rb=await row(db,b.data.listing.id);
        assert.deepEqual(pick(rb),pick(ra));
        assert.equal(rb.owner_id,B);assert.equal(rb.status,'active');
        assert.ok(Math.abs(new Date(rb.expires_at)-Date.now()-6*3600e3)<60e3,'süre 6 saat (varsayılan)');
        assert.deepEqual(b.data.listing,(await call(db,B,'listing_v1',[rb.id])).data,'yanıt = ayrıntı ucunun sahibine gösterdiği');
        assert.deepEqual(Object.keys(b.data).sort(),[...v1.functions.listing_create_v1.data].sort());
      }
      const n=await call(db,N,'listing_create_v1',[rid(),truckPayload()]);
      assert.equal((await row(db,n.data.listing.id)).owner_label,'NakGo kullanıcısı','profili olmayan hesap: v0 istemcisinin varsayılan adı');
      await db.query(`delete from public.listings where owner_id=$1`,[N]);
    });

    await t.test('ilan oluşturma: geçersiz girdi invalid_argument; v0 de reddeder; hiçbir satır yazılmaz; hata telefonu içermez',async()=>{
      const bad=[{from_city:'Ankara'},{body:'Uçan'},{amount:0},{contact_phone:'+90532123'},{note:null},{items:'x'},{image_data:'data:image/png;base64,AAAA'},
        {cargo:''},{amount:'abc'},{available_on:'dün'},{loading_text:'bugün',available_on:istanbulToday()}];
      const before=await count(db,`select count(*) n from public.listings`);
      for(const change of bad){
        const p={...loadPayload(),...change};
        assert.ok((await v0Insert(db,A,'Ayşe',p)).error,'v0 de reddeder: '+JSON.stringify(change));
        const r=await call(db,B,'listing_create_v1',[rid(),p]);
        assert.equal(key(r),'invalid_argument',JSON.stringify(change));
        assert.equal(r.error.hint,'nakgo.api');assert.equal(r.error.detail,'Geçersiz argüman');
        assert.ok(!JSON.stringify(r.error).includes('532'),'hata telefon içermez');
      }
      // v0'da da satır içeriği dönmez: authenticated bütün sütunları okuyamadığı için PostgreSQL DETAIL'i boş bırakır.
      assert.ok(!String((await v0Insert(db,A,'Ayşe',{...loadPayload(),from_city:'Ankara'})).error.detail||'').includes('532'));
      // İstemcinin yazamayacağı alanlar ve tür eksikliği.
      for(const p of [{...loadPayload(),owner_id:A},{...loadPayload(),status:'closed'},{...loadPayload(),owner_label:'Başkası'},{...loadPayload(),redacted_at:null},
        {...loadPayload(),expires_at:'2099-01-01'},(({kind,...x})=>x)(loadPayload()),{...loadPayload(),kind:'x'},{...loadPayload(),kind:1}])
        assert.equal(key(await call(db,B,'listing_create_v1',[rid(),p])),'invalid_argument',Object.keys(p).join());
      for(const args of [[null,loadPayload()],[rid(),null],[rid(),[1]],[rid(),'"x"']])
        assert.equal(key(await call(db,B,'listing_create_v1',args)),'invalid_argument');
      assert.equal(await count(db,`select count(*) n from public.listings`),before);
    });

    await t.test('tekrar: aynı istek kimliği aynı ilanı döner; farklı gövde conflict; başka hesap bağımsız; 24 saat sonra yeni istek',async()=>{
      const id=rid(),p=truckPayload();
      const a=await call(db,B,'listing_create_v1',[id,p]),b=await call(db,B,'listing_create_v1',[id,p]);
      assert.equal(a.data.created,true);assert.equal(b.data.created,false);assert.equal(b.data.listing.id,a.data.listing.id);
      assert.deepEqual(b.data.listing,a.data.listing);
      assert.equal(key(await call(db,B,'listing_create_v1',[id,{...p,amount:13}])),'conflict');
      const c=await call(db,A,'listing_create_v1',[id,p]);assert.equal(c.data.created,true);assert.notEqual(c.data.listing.id,a.data.listing.id);
      assert.equal(await count(db,`select count(*) n from private.api_requests where request_id=$1`,[id]),2);
      assert.deepEqual(Object.keys((await db.query(`select * from private.api_requests limit 1`)).rows[0]).sort(),['body_md5','created_at','fn','ref','request_id','user_id'],'gövde saklanmaz');
      await db.query(`update private.api_requests set created_at=now()-interval '25 hours' where user_id=$1 and request_id=$2`,[B,id]);
      const d=await call(db,B,'listing_create_v1',[id,p]);assert.equal(d.data.created,true);assert.notEqual(d.data.listing.id,a.data.listing.id);
      assert.equal(Number((await db.query(`select private.api_requests_retention() n`)).rows[0].n),0);
      await db.query(`update private.api_requests set created_at=now()-interval '25 hours'`);
      assert.ok(Number((await db.query(`select private.api_requests_retention() n`)).rows[0].n)>0);
      assert.equal(await count(db,`select count(*) n from private.api_requests`),0);
      await db.query(`delete from public.listings where owner_id in($1,$2)`,[A,B]);
    });

    await t.test('kota tetikleyicisi (10 etkin ilan) v1 içinden de çalışır: 11. ilan limit_reached; v0 ile aynı; tekrar kaydı geri alınır',async()=>{
      const ids=[];for(let i=0;i<9;i++)ids.push((await call(db,B,'listing_create_v1',[rid(),truckPayload()])).data.listing.id);
      ids.push((await v0Insert(db,B,'Ayşe',truckPayload())).rows[0].id);
      assert.equal((await v0Insert(db,B,'Ayşe',truckPayload())).error.code,'54000','v0: 11. ilan reddedilir');
      const req=rid(),over=await call(db,B,'listing_create_v1',[req,truckPayload()]);
      assert.deepEqual({code:over.error.code,key:over.error.key},{code:'PT429',key:'limit_reached'});
      assert.equal(await count(db,`select count(*) n from private.api_requests where request_id=$1`,[req]),0,'başarısız istek kaydı kalmaz');
      assert.equal((await call(db,B,'listing_close_v1',[ids[0]])).data.changed,true);
      assert.equal((await call(db,B,'listing_create_v1',[req,truckPayload()])).data.created,true,'aynı istek kimliği sınır açılınca çalışır');
      const r=await call(db,B,'listing_update_v1',[ids[0],(await call(db,B,'listing_v1',[ids[0]])).data.updated_at,{status:'active'}]);
      assert.equal(key(r),'limit_reached','yeniden açma da kotaya tabi');
      await db.query(`delete from public.listings where owner_id=$1`,[B]);
    });

    await t.test('güncelleme: revision ile; eski revision conflict ve satır değişmez; v0 ile aynı sonuç; sahip/karartma koşulu',async()=>{
      const a=(await v0Insert(db,A,'Ayşe',truckPayload())).rows[0],b=(await call(db,B,'listing_create_v1',[rid(),truckPayload()])).data.listing;
      const change={note:'Yeni not',amount:14,available_time:''};
      const va=await v0Update(db,A,a.id,change);assert.ok(!va.error);
      const vb=await call(db,B,'listing_update_v1',[b.id,b.updated_at,change]);assert.ok(vb.data,JSON.stringify(vb));
      assert.deepEqual(pick(await row(db,b.id)),pick(await row(db,a.id)));
      assert.notEqual(vb.data.listing.updated_at,b.updated_at,'updated_at tetikleyiciyle değişti');
      const before=await row(db,b.id);
      assert.equal(key(await call(db,B,'listing_update_v1',[b.id,b.updated_at,{note:'Eski'}])),'conflict');
      assert.deepEqual(await row(db,b.id),before);
      // Başka hesabın ilanı, olmayan ilan: aynı yanıt (var olup olmadığı belli edilmez).
      assert.equal(key(await call(db,A,'listing_update_v1',[b.id,vb.data.listing.updated_at,{note:'X'}])),'not_found');
      assert.equal(key(await call(db,A,'listing_update_v1',[999999999,'x',{note:'X'}])),'not_found');
      assert.deepEqual(await row(db,b.id),before);
      // Değişmez ve istemciye kapalı alanlar.
      for(const c of [{kind:'load'},{owner_id:A},{owner_label:'X'},{expires_at:'2099-01-01'},{redacted_at:null},{created_at:'2020-01-01'},{id:1},{}])
        assert.equal(key(await call(db,B,'listing_update_v1',[b.id,vb.data.listing.updated_at,c])),'invalid_argument',JSON.stringify(c));
      // Yazma koruması tetikleyicisi: etkin ilanın tarihi geçmiş olamaz.
      assert.equal(key(await call(db,B,'listing_update_v1',[b.id,vb.data.listing.updated_at,{available_on:'2020-01-01'}])),'invalid_argument');
      assert.deepEqual(await row(db,b.id),before);
      await db.exec('set session_replication_role=replica');await db.query(`update public.listings set redacted_at=now() where id=$1`,[a.id]);await db.exec('reset session_replication_role');
      assert.equal(key(await call(db,A,'listing_update_v1',[a.id,'x',{note:'X'}])),'not_found','karartılmış ilan');
      assert.equal((await v0Update(db,A,a.id,{note:'X'})).rows.length,0,'v0 RLS de güncellemez');
      await db.query(`delete from public.listings where owner_id in($1,$2)`,[A,B]);
    });

    await t.test('tetikleyiciler SECURITY DEFINER içinden çalışır: süre yenileme, moderasyon, erişim kaydı (hesap oturumdan)',async()=>{
      const l=(await call(db,B,'listing_create_v1',[rid(),truckPayload()])).data.listing;
      assert.deepEqual((await db.query(`select user_id,action,detail from private.access_log where listing_id=$1 order by id`,[l.id])).rows,[{user_id:B,action:'listing_create',detail:null}]);
      await db.exec('set session_replication_role=replica');await db.query(`update public.listings set expires_at=now()-interval '1 hour' where id=$1`,[l.id]);await db.exec('reset session_replication_role');
      const cur=(await call(db,B,'my_listings_v1')).data.find(x=>x.id===l.id);
      const r=await call(db,B,'listing_update_v1',[l.id,cur.updated_at,{status:'active'}]);
      assert.ok(new Date(r.data.listing.expires_at)>Date.now()+5*3600e3,'süresi dolmuş ilan etkinleşince 6 saat yenilenir');
      const closed=await call(db,B,'listing_close_v1',[l.id]);assert.equal(closed.data.listing.status,'closed');
      assert.equal((await call(db,B,'listing_close_v1',[l.id])).data.changed,false,'kapatma tekrar güvenli');
      assert.deepEqual((await db.query(`select user_id,action,detail from private.access_log where listing_id=$1 order by id`,[l.id])).rows.map(x=>x.detail),[null,'edit','status:active>closed']);
      assert.ok((await db.query(`select bool_and(user_id=$2) v from private.access_log where listing_id=$1`,[l.id,B])).rows[0].v);
      await db.query(`insert into private.listing_moderation(listing_id,removed) values($1,true)`,[l.id]);
      assert.equal(key(await call(db,B,'listing_update_v1',[l.id,closed.data.listing.updated_at,{status:'active'}])),'not_allowed','kaldırılmış ilan açılamaz');
      assert.equal((await v0Update(db,B,l.id,{status:'active'})).error.code,'42501','v0 de reddeder');
      await db.query(`delete from public.listings where owner_id=$1`,[B]);
    });

    await t.test('askıdaki hesap: yazma uçları account_suspended, kaldırma uçları çalışır; doğrulanmamış ve anonim reddedilir',async()=>{
      await db.exec('set session_replication_role=replica');
      const lid=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id) values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1) returning id`,[O[0],istanbulToday()])).rows[0].id);
      await db.query(`insert into public.listing_favorites(user_id,listing_id) values($1,$2)`,[C,lid]);
      const alert=Number((await db.query(`insert into public.route_alerts(user_id,kind,from_city) values($1,'load','Adana') returning id`,[C])).rows[0].id);
      await db.exec('reset session_replication_role');
      const writes=[['listing_create_v1',[rid(),truckPayload()]],['listing_update_v1',[lid,'x',{note:'a'}]],['listing_close_v1',[lid]],['profile_update_v1',[{city:'Bursa'}]],
        ['favorite_add_v1',[lid]],['route_alert_create_v1',['load','Adana','Mersin']],['route_alert_update_v1',[alert,false]],['listing_contact_v1',[lid]]];
      for(const [fn,args] of writes)assert.equal(key(await call(db,C,fn,args)),'account_suspended',fn);
      assert.equal((await call(db,C,'favorite_remove_v1',[lid])).data.saved,false);
      assert.equal((await call(db,C,'route_alert_delete_v1',[alert])).data.removed,true);
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1`,[C]),0);
      for(const fn of Object.keys(v1.functions).filter(f=>!v1.functions[f].roles.includes('anon'))){
        const spec=v1.functions[fn],sig=spec.args.map(a=>a[1]).join(',');
        assert.equal((await db.query(`select has_function_privilege('anon','api.${fn}(${sig})','execute') v`)).rows[0].v,false,fn);
      }
      for(const [fn,args] of [...writes,['account_delete_v1',[]],['favorite_remove_v1',[lid]],['route_alert_delete_v1',[1]],['route_alerts_seen_v1',[]]]){
        assert.equal(key(await call(db,U,fn,args)),'account_unverified',fn);
        assert.equal(key(await call(db,A,fn,args,{claims:{sub:A,is_anonymous:true}})),'auth_required',fn);
        assert.equal(key(await call(db,null,fn,args)),'auth_required',fn);
      }
      // Kullanıcı kimliği hiçbir uçta argüman değildir: kimlik yalnız oturumdan.
      for(const [fn,spec] of Object.entries(v1.functions))assert.ok(!spec.args.some(a=>/user|owner|actor|account/.test(a[0])),fn);
      await db.query(`delete from public.listings where id=$1`,[lid]);
    });

    await t.test('profil: v0 güncellemesiyle aynı; yoksa oluşturur; doğrulama; yalnız kendi profili',async()=>{
      const change={display_name:'  Yeni Ad ',city:'Bursa',about:'Merhaba',phone:'05321112233',account_type:'carrier'};
      const trimmed=Object.fromEntries(Object.entries(change).map(([k,v])=>[k,v.trim()]));
      assert.ok(!(await as(db,{user:A},`update public.profiles set display_name=$2,city=$3,about=$4,phone=$5,account_type=$6 where id=$1`,[A,...Object.values(trimmed)])).error);
      const r=await call(db,B,'profile_update_v1',[change]);
      const pa=(await db.query(`select display_name,account_type,city,about,phone from public.profiles where id=$1`,[A])).rows[0];
      assert.deepEqual(r,{data:pa});assert.deepEqual((await call(db,B,'profile_v1')).data,pa);
      assert.equal((await db.query(`select display_name from public.profiles where id=$1`,[D])).rows[0].display_name,'Deniz','başka profil değişmez');
      assert.deepEqual((await call(db,B,'profile_update_v1',[{phone:''}])).data.phone,'');
      assert.equal((await call(db,B,'profile_update_v1',[{city:'Bursa'}])).data.display_name,'Yeni Ad','verilmeyen alan değişmez');
      for(const c of [{phone:'5321112233'},{phone:'+905321112233'},{display_name:'x'.repeat(61)},{city:'x'.repeat(41)},{about:'x'.repeat(201)},{account_type:'admin'},
        {id:A},{display_name:5},{display_name:null},{},{created_at:'2020-01-01'}])
        assert.equal(key(await call(db,B,'profile_update_v1',[c])),'invalid_argument',JSON.stringify(c));
      const bad=await call(db,B,'profile_update_v1',[{phone:'05321112233x'}]);assert.ok(!JSON.stringify(bad.error).includes('0532'));
      assert.equal(await count(db,`select count(*) n from public.profiles where id=$1`,[N]),0);
      assert.deepEqual((await call(db,N,'profile_update_v1',[{display_name:'Yeni',account_type:'owner'}])).data,{display_name:'Yeni',account_type:'owner',city:'',about:'',phone:''});
      assert.equal((await call(db,N,'profile_update_v1',[{display_name:'Yeni 2'}])).data.display_name,'Yeni 2','ikinci çağrı günceller');
    });

    await t.test('favoriler: ekleme tekrar güvenli; görünmeyen ilan not_found; kaldırma tekrar güvenli; v0 ile aynı kayıt',async()=>{
      await db.exec('set session_replication_role=replica');
      const mk=(owner,extra='')=>db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id${extra?',status,expires_at':''})
        values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1${extra}) returning id`,[owner,istanbulToday()]).then(r=>Number(r.rows[0].id));
      const vis=await mk(O[1]),vis2=await mk(O[1]),expired=await mk(O[1],",'active',now()-interval '1 hour'"),closed=await mk(O[1],",'closed',now()+interval '1 hour'");
      const own=await mk(B,",'closed',now()+interval '1 hour'"),removed=await mk(O[1]),ofSuspended=await mk(C);
      await db.query(`insert into private.listing_moderation(listing_id,removed) values($1,true)`,[removed]);
      await db.exec('reset session_replication_role');
      assert.deepEqual(await call(db,B,'favorite_add_v1',[vis]),{data:{listing_id:vis,saved:true}});
      assert.deepEqual(await call(db,B,'favorite_add_v1',[vis]),{data:{listing_id:vis,saved:true}});
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1 and listing_id=$2`,[B,vis]),1,'mükerrer favori yok');
      assert.ok(!(await as(db,{user:A},`select public.nakgo_set_favorite($1,true)`,[vis2])).error);
      assert.ok(!(await call(db,B,'favorite_add_v1',[vis2])).error);
      assert.deepEqual((await db.query(`select user_id from public.listing_favorites where listing_id=$1 order by user_id`,[vis2])).rows.map(r=>r.user_id),[A,B]);
      // Okuma uçlarındaki sıkı kural: moderasyonla kaldırılmış ya da sahibi askıdaki ilan da eklenemez (v0 bunları durum
      // değişmezliğine bırakıyor; burada durum active kalsa bile reddedilir).
      for(const id of [expired,closed,removed,ofSuspended,999999999])assert.equal(key(await call(db,B,'favorite_add_v1',[id])),'not_found',String(id));
      for(const id of [expired,closed])assert.equal((await as(db,{user:A},`select public.nakgo_set_favorite($1,true)`,[id])).error.key,'Listing unavailable','v0 de reddeder');
      assert.equal(key(await call(db,B,'favorite_add_v1',[own])),'not_found','kendi kapalı ilanı: v0 kuralı (yalnız etkin ilan) da uygulanır');
      assert.deepEqual(await call(db,B,'favorite_remove_v1',[vis]),{data:{listing_id:vis,saved:false}});
      assert.deepEqual(await call(db,B,'favorite_remove_v1',[vis]),{data:{listing_id:vis,saved:false}});
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where listing_id=$1`,[vis]),0);
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1 and listing_id=$2`,[A,vis2]),1,'B kaldırınca A\'nınki kalır');
      await call(db,B,'favorite_remove_v1',[vis2]);
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1 and listing_id=$2`,[A,vis2]),1);
      for(const id of [0,-1,null])assert.equal(key(await call(db,B,'favorite_add_v1',[id])),'invalid_argument');
      await db.query(`delete from public.listings where owner_id in($1,$2,$3)`,[O[1],B,C]);
    });

    await t.test('rota uyarıları: tekrar güvenli oluşturma, 20 sınırı, açma/kapatma v0 ile aynı, silme tekrar güvenli, yalıtım',async()=>{
      const a=await call(db,B,'route_alert_create_v1',['load','İstanbul','Ankara','Tır',null]);
      assert.equal(a.data.created,true);
      const again=await call(db,B,'route_alert_create_v1',['load',' İstanbul ','Ankara ','Tır','']);
      assert.deepEqual(again.data,{alert:a.data.alert,created:false},'aynı uyarı (boşluklar kırpılır) ikinci kez oluşmaz');
      assert.deepEqual(a.data.alert,(await call(db,B,'route_alerts_v1')).data[0],'yanıt = okuma ucu öğesi');
      for(let i=0;i<19;i++)assert.equal((await call(db,B,'route_alert_create_v1',['truck','İzmir','Şehir '+i])).data.created,true);
      assert.deepEqual((({code,key})=>({code,key}))((await call(db,B,'route_alert_create_v1',['truck','İzmir','Yeni'])).error),{code:'PT429',key:'limit_reached'});
      assert.equal((await as(db,{user:B},`select public.nakgo_save_route_alert('truck','İzmir','Yeni',null,null)`)).error.code,'54000','v0 de reddeder');
      assert.equal((await call(db,B,'route_alert_create_v1',['load','İstanbul','Ankara','Tır'])).data.created,false,'sınırdayken aynı uyarı yine döner');
      assert.equal(await count(db,`select count(*) n from public.route_alerts where user_id=$1`,[B]),20);
      for(const args of [['x','A'],['load',null,null],['load',' ',''],[null,'A']])assert.equal(key(await call(db,B,'route_alert_create_v1',args)),'invalid_argument');
      // Açma/kapatma: v0 ile aynı (yeniden açınca seen_at şimdi olur).
      const id=a.data.alert.id;
      const off=await call(db,B,'route_alert_update_v1',[id,false]);assert.equal(off.data.alert.active,false);
      assert.deepEqual((await call(db,B,'route_alert_update_v1',[id,false])).data,off.data,'tekrar güvenli');
      const v0aR=(await as(db,{user:A},`select * from public.nakgo_save_route_alert('load','Hatay','Kilis',null,null)`));assert.ok(!v0aR.error,JSON.stringify(v0aR.error));
      const v0a=v0aR.rows[0];
      await as(db,{user:A},`select public.nakgo_set_route_alert($1,false)`,[v0a.id]);
      await db.query(`update public.route_alerts set seen_at=now()-interval '1 day' where id in($1,$2)`,[id,v0a.id]);
      const on=await call(db,B,'route_alert_update_v1',[id,true]);
      const v0on=(await as(db,{user:A},`select * from public.nakgo_set_route_alert($1,true)`,[v0a.id])).rows[0];
      assert.equal(on.data.alert.active,v0on.active);
      assert.ok(Math.abs(new Date(on.data.alert.seen_at)-new Date(v0on.seen_at))<60e3,'v0 gibi seen_at yenilenir');
      assert.equal(key(await call(db,A,'route_alert_update_v1',[id,false])),'not_found','başka hesabın uyarısı');
      assert.equal((await call(db,A,'route_alert_delete_v1',[id])).data.removed,false);
      assert.equal(await count(db,`select count(*) n from public.route_alerts where id=$1`,[id]),1,'başka hesap silemez');
      assert.equal((await call(db,A,'route_alerts_v1')).data.length,1,'A yalnız kendi uyarısını görür');
      // Görüldü: v0 ile aynı sayı.
      const v0seen=(await as(db,{user:A},`select public.nakgo_route_alerts_seen() n`)).rows[0].n;
      assert.deepEqual(await call(db,A,'route_alerts_seen_v1'),{data:{updated:v0seen}});
      assert.deepEqual(await call(db,B,'route_alert_delete_v1',[id]),{data:{id,removed:true}});
      assert.deepEqual(await call(db,B,'route_alert_delete_v1',[id]),{data:{id,removed:false}});
      await db.query(`delete from public.route_alerts where user_id in($1,$2)`,[A,B]);
    });

    await t.test('telefon: v0 sınırı aynen (30/saat, 100/gün); aşımda phone=null, limited=true ve güvenlik olayı kalıcı',async()=>{
      await db.exec('set session_replication_role=replica');
      const ids=[];
      for(let i=0;i<40;i++)ids.push(Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,contact_phone,contact_consent)
        values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1,$3,true) returning id`,[O[i%5],istanbulToday(),'+90532'+String(1000000+i)])).rows[0].id));
      const noConsent=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,contact_phone) values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1,$3) returning id`,[O[0],istanbulToday(),PHONE])).rows[0].id);
      await db.exec('reset session_replication_role');
      for(let i=0;i<30;i++)assert.deepEqual(await call(db,A,'listing_contact_v1',[ids[i]]),{data:{phone:'+90532'+String(1000000+i),limited:false}});
      assert.deepEqual(await call(db,A,'listing_contact_v1',[ids[30],'call']),{data:{phone:null,limited:true}});
      assert.deepEqual(await call(db,A,'listing_contact_v1',[ids[0]]),{data:{phone:'+90532'+String(1000000),limited:false}},'aynı ilan yeniden: sayılmaz, verilir');
      assert.deepEqual((await db.query(`select user_id,kind from private.security_events`)).rows,[{user_id:A,kind:'contact_limit_hour'}],'olay kalıcı (geri alınmadı)');
      assert.equal(await count(db,`select count(*) n from private.contact_views where user_id=$1`,[A]),30);
      assert.equal(await count(db,`select coalesce(sum(clicks),0) n from private.contact_clicks`),0,'sınırda tıklama sayılmaz');
      // v0 aynı hesap için aynı sonucu verir.
      assert.equal((await as(db,{user:A},`select public.nakgo_listing_contact($1) r`,[ids[31]])).rows[0].r,null);
      // Başka hesap bağımsız; tıklama sayımı v0 gibi.
      assert.deepEqual(await call(db,B,'listing_contact_v1',[ids[31],'whatsapp']),{data:{phone:'+90532'+String(1000031),limited:false}});
      assert.equal(await count(db,`select coalesce(sum(clicks),0) n from private.contact_clicks where channel='whatsapp'`),1);
      // 24 saatlik sınır: 100 farklı ilan (eski görüntülemeler saat penceresinin dışında).
      await db.query(`update private.contact_views set viewed_at=now()-interval '2 hours' where user_id=$1`,[B]);
      await db.query(`insert into private.contact_views(user_id,listing_id,viewed_at) select $1,1000000+g,now()-interval '3 hours' from generate_series(1,99) g`,[B]);
      assert.deepEqual(await call(db,B,'listing_contact_v1',[ids[32]]),{data:{phone:null,limited:true}});
      assert.equal(await count(db,`select count(*) n from private.security_events where user_id=$1 and kind='contact_limit_day'`,[B]),1);
      // Uygun olmayan ilan: not_found (telefon yok, sayılmaz); geçersiz kanal.
      assert.equal(key(await call(db,D,'listing_contact_v1',[noConsent])),'not_found');
      assert.equal(key(await call(db,D,'listing_contact_v1',[999999999])),'not_found');
      assert.equal(key(await call(db,D,'listing_contact_v1',[ids[1],'sms'])),'invalid_argument');
      assert.equal(await count(db,`select count(*) n from private.contact_views where user_id=$1`,[D]),0);
      // Kendi ilanı: sınırdan bağımsız, limited=false.
      assert.deepEqual(await call(db,O[0],'listing_contact_v1',[noConsent]),{data:{phone:PHONE,limited:false}});
      await db.query(`delete from public.listings where owner_id=any($1)`,[O]);
    });

    await t.test('hesap silme: v0 ile aynı silme; yasal saklama, denetim ve güvenlik kayıtları kalır; tekrar güvenli; sahip hesabı silinemez',async()=>{
      const l=(await call(db,D,'listing_create_v1',[rid(),{...loadPayload()}])).data.listing;
      await call(db,D,'route_alert_create_v1',['load','Adana','Mersin']);
      await db.exec('set session_replication_role=replica');
      const other=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id) values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1) returning id`,[O[2],istanbulToday()])).rows[0].id);
      await db.query(`insert into private.security_events(user_id,kind,hour) values($1,'contact_limit_hour',date_trunc('hour',now()))`,[D]);
      await db.exec('reset session_replication_role');
      await call(db,D,'favorite_add_v1',[other]);
      const accessBefore=await count(db,`select count(*) n from private.access_log where user_id=$1`,[D]);
      assert.ok(accessBefore>0);
      assert.deepEqual(await call(db,D,'account_delete_v1'),{data:{deleted:true}});
      const p=(await db.query(`select display_name,city,about,phone from public.profiles where id=$1`,[D])).rows[0];
      assert.deepEqual(p,{display_name:'Silinmiş hesap',city:'',about:'',phone:''});
      const lr=await row(db,l.id);
      assert.equal(lr.status,'closed');assert.equal(lr.contact_phone,null);assert.equal(lr.image_data,'');assert.equal(lr.note,'');assert.ok(lr.redacted_at);
      assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1`,[D]),0);
      assert.equal(await count(db,`select count(*) n from public.route_alerts where user_id=$1`,[D]),0);
      assert.equal(await count(db,`select count(*) n from private.api_requests where user_id=$1`,[D]),0);
      assert.equal(await count(db,`select count(*) n from private.admin_audit where actor_id=$1 and action='self_delete'`,[D]),1,'denetim kaydı');
      assert.ok(await count(db,`select count(*) n from private.access_log where user_id=$1`,[D])>=accessBefore,'erişim kaydı (yasal saklama) kalır');
      assert.equal(await count(db,`select count(*) n from private.security_events where user_id=$1`,[D]),1,'güvenlik olayı 1 yıl kalır');
      assert.equal(await count(db,`select count(*) n from public.listings where id=$1`,[l.id]),1,'ilan satırı silinmez, karartılır (yasal saklama)');
      const m=(await db.query(`select banned,suspended,deleted_at is not null d from private.account_moderation where user_id=$1`,[D])).rows[0];
      assert.deepEqual(m,{banned:true,suspended:true,d:true});
      assert.deepEqual(await call(db,D,'account_delete_v1'),{data:{deleted:true}},'tekrar güvenli');
      assert.equal(await count(db,`select count(*) n from private.admin_audit where actor_id=$1 and action='self_delete'`,[D]),1,'ikinci denetim kaydı yok');
      assert.equal(key(await call(db,D,'listing_create_v1',[rid(),truckPayload()])),'account_suspended','silinen hesap yazamaz');
      // Ana yönetici hesabı silinemez (v0 kuralı); hiçbir şey değişmez.
      const r=await call(db,W,'account_delete_v1');assert.equal(key(r),'not_allowed');
      assert.equal((await db.query(`select display_name from public.profiles where id=$1`,[W])).rows[0].display_name,'Sahip');
      assert.equal((await as(db,{user:W},`select public.nakgo_delete_my_account()`)).error.code,'42501','v0 de reddeder');
      await db.query(`delete from public.listings where id=$1`,[other]);
    });

    await t.test('v1 kapalıyken bütün yazma uçları api_disabled ve veri değişmez; v0 yazma yolları çalışır',async()=>{
      const before=await count(db,`select (select count(*) from public.listings)+(select count(*) from public.route_alerts)+(select count(*) from public.listing_favorites) n`);
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        const fns=Object.keys(v1.functions).filter(f=>!['status_v1'].includes(f));
        for(const fn of fns){const args=v1.functions[fn].args.filter(a=>a[2]!=='optional').map(a=>a[1]==='uuid'?rid():a[1]==='jsonb'?{}:a[1]==='boolean'?true:a[1]==='bigint'?1:'x');
          assert.deepEqual((({code,key})=>({code,key}))((await call(db,A,fn,args)).error),{code:'PT503',key:'api_disabled'},fn);}
        assert.equal(await count(db,`select (select count(*) from public.listings)+(select count(*) from public.route_alerts)+(select count(*) from public.listing_favorites) n`),before);
        const v=await v0Insert(db,A,'Ayşe',truckPayload());assert.ok(!v.error);
        assert.ok(!(await as(db,{user:A},`select public.nakgo_save_route_alert('load','Sivas',null,null,null)`)).error);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
      await db.query(`delete from public.listings where owner_id=$1`,[A]);await db.query(`delete from public.route_alerts where user_id=$1`,[A]);
    });

    await t.test('eşzamanlı yazma (gerçek PostgreSQL, ayrı bağlantılar)',async t2=>{
      if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
      const {Client}=require('pg');
      const conn=async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
        password:process.env.NAKGO_PG_PASSWORD,database:db.name,options:'-c TimeZone=UTC'});c.on('error',()=>{});await c.connect();return c;};
      const on=async(c,user,fn,args,hold=0)=>{
        await c.query('begin');
        try{await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);await c.query('set local role authenticated');
          const r=(await c.query(`select api.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a))).rows[0].r;
          if(hold)await c.query('select pg_sleep($1)',[hold]);await c.query('commit');return r;}
        catch(e){await c.query('rollback');return {error:{code:e.code,key:e.message}};}
      };
      const [x,y]=[await conn(),await conn()];
      try{
        await t2.test('aynı revision ile iki güncelleme: biri yazar, diğeri conflict; kayıp güncelleme yok',async()=>{
          const l=(await call(db,B,'listing_create_v1',[rid(),truckPayload()])).data.listing;
          const [a,b]=await Promise.all([on(x,B,'listing_update_v1',[l.id,l.updated_at,{note:'birinci'}],0.3),
            new Promise(r=>setTimeout(r,100)).then(()=>on(y,B,'listing_update_v1',[l.id,l.updated_at,{amount:30}]))]);
          assert.ok(a.data,JSON.stringify(a));assert.equal(b.error.key,'conflict');
          const r=await row(db,l.id);assert.equal(r.note,'birinci');assert.equal(Number(r.amount),12);
        });
        await t2.test('aynı istek kimliğiyle paralel oluşturma: tek ilan, ikisi aynı kimliği döner',async()=>{
          const id=rid(),p=truckPayload();const n=await count(db,`select count(*) n from public.listings where owner_id=$1`,[B]);
          const [a,b]=await Promise.all([on(x,B,'listing_create_v1',[id,p],0.3),new Promise(r=>setTimeout(r,100)).then(()=>on(y,B,'listing_create_v1',[id,p]))]);
          assert.equal(a.data.listing.id,b.data.listing.id);assert.deepEqual([a.data.created,b.data.created],[true,false]);
          assert.equal(await count(db,`select count(*) n from public.listings where owner_id=$1`,[B]),n+1);
        });
        await t2.test('kota: iki bağlantı aynı anda 10. ve 11. ilanı açar; biri limit_reached',async()=>{
          await db.query(`delete from public.listings where owner_id=$1`,[B]);
          for(let i=0;i<9;i++)await call(db,B,'listing_create_v1',[rid(),truckPayload()]);
          const [a,b]=await Promise.all([on(x,B,'listing_create_v1',[rid(),truckPayload()],0.3),new Promise(r=>setTimeout(r,100)).then(()=>on(y,B,'listing_create_v1',[rid(),truckPayload()]))]);
          assert.deepEqual([Boolean(a.data),b.error&&b.error.key],[true,'limit_reached']);
          assert.equal(await count(db,`select count(*) n from public.listings where owner_id=$1 and status='active'`,[B]),10);
        });
        await t2.test('aynı rota uyarısı paralel: tek kayıt, ikisi de başarılı',async()=>{
          const [a,b]=await Promise.all([on(x,A,'route_alert_create_v1',['load','Konya','Kayseri'],0.3),new Promise(r=>setTimeout(r,100)).then(()=>on(y,A,'route_alert_create_v1',['load','Konya','Kayseri']))]);
          assert.equal(a.data.alert.id,b.data.alert.id);assert.deepEqual([a.data.created,b.data.created],[true,false]);
          assert.equal(await count(db,`select count(*) n from public.route_alerts where user_id=$1 and from_city='Konya'`,[A]),1);
        });
        await t2.test('aynı favori paralel: tek kayıt',async()=>{
          await db.exec('set session_replication_role=replica');
          const lid=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id) values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1) returning id`,[O[3],istanbulToday()])).rows[0].id);
          await db.exec('reset session_replication_role');
          const [a,b]=await Promise.all([on(x,A,'favorite_add_v1',[lid],0.3),new Promise(r=>setTimeout(r,100)).then(()=>on(y,A,'favorite_add_v1',[lid]))]);
          assert.ok(a.data&&b.data);assert.equal(await count(db,`select count(*) n from public.listing_favorites where user_id=$1 and listing_id=$2`,[A,lid]),1);
        });
        await t2.test('telefon sınırı paralel: 29 görüntülemeden sonra iki farklı ilan aynı anda; yalnız biri verilir',async()=>{
          await db.exec('set session_replication_role=replica');
          const ids=[];for(let i=0;i<31;i++)ids.push(Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,contact_phone,contact_consent) values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1,$3,true) returning id`,[O[4],istanbulToday(),PHONE])).rows[0].id));
          await db.exec('reset session_replication_role');
          for(let i=0;i<29;i++)await call(db,N,'listing_contact_v1',[ids[i]]);
          const [a,b]=await Promise.all([on(x,N,'listing_contact_v1',[ids[29]],0.3),new Promise(r=>setTimeout(r,100)).then(()=>on(y,N,'listing_contact_v1',[ids[30]]))]);
          assert.deepEqual([a.data.limited,b.data.limited],[false,true]);
          assert.equal(await count(db,`select count(*) n from private.contact_views where user_id=$1`,[N]),30);
        });
      }finally{await x.end();await y.end();}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

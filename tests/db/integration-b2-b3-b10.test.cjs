/** Birleşik entegrasyon: B2 (#135 telefon sınırı, #136 gece temizliği), B3 (#137–#142) ve B10 (#143) birlikte. Mevcut testlere
 * dokunmaz; yalnız PR'lar arası etkileşimleri sınar: revision sayacının bütün sunucu yazmalarında artması, v0+v1 ortak
 * telefon sayacı, moderasyon/askı/silme/temizlik sonrası v1 davranışı, misafir yanıtlarında veri sızıntısı taraması,
 * SECURITY DEFINER ve yardımcı yetkileri. Sentetik veri; geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migratedDb,finish}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
async function as(db,{user=null,role='authenticated'}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const call=async(db,user,fn,args=[],role='authenticated')=>{
  const r=await as(db,{user,role},`select api.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a));
  return r.error?{error:r.error}:r.rows[0].r;
};
const key=r=>r.error&&r.error.key;
const today=()=>new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const truck=(o={})=>({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,amount_unit:'ton',available_on:today(),
  contact_phone:'+905321234567',contact_consent:true,...o});
const rev=async(db,id)=>Number((await db.query(`select revision from public.listings where id=$1`,[id])).rows[0].revision);

test('Birleşik entegrasyon B2 + B3 + B10',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const ADMIN=uid(1),A=uid(2),B=uid(3),C=uid(4),G=uid(5),O=[uid(20),uid(21),uid(22),uid(23)];
    for(const id of [ADMIN,A,B,C,G,...O])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-4)+'@test.invalid']);
    await db.exec('set session_replication_role=replica');
    for(const id of [ADMIN,A,B,C,G,...O])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,$2,'owner')`,[id,'K'+id.slice(-2)]);
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[ADMIN]);
    await db.exec('reset session_replication_role');
    const moderate=async(kind,target,action)=>{
      const v=Number((await db.query(`select coalesce((select revision from private.listing_moderation where listing_id::text=$1),(select revision from private.account_moderation where user_id::text=$1),0) v`,[String(target)])).rows[0].v);
      return as(db,{user:ADMIN},`select public.nakgo_admin_moderate($1,$2,$3,'Entegrasyon testi',$4) r`,[kind,String(target),action,v]);};
    const create=async(user,o)=>(await call(db,user,'listing_create_v1',[crypto.randomUUID(),truck(o)])).data.listing;

    await t.test('revision bütün sunucu yazmalarında artar: v0, v1, kapatma, yönetici kaldırma/geri alma, askı, hesap silme, gece temizliği',async()=>{
      const l=await create(A);assert.equal(await rev(db,l.id),0);
      assert.ok(!(await as(db,{user:A},`update public.listings set note='v0' where id=$1`,[l.id])).error);assert.equal(await rev(db,l.id),1,'v0');
      assert.ok((await call(db,A,'listing_update_v1',[l.id,1,{note:'v1'}])).data);assert.equal(await rev(db,l.id),2,'v1');
      const r1=await moderate('listing',l.id,'remove');assert.ok(!r1.error,JSON.stringify(r1.error));assert.equal(await rev(db,l.id),3,'yönetici kaldırma');
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,2,{note:'eski'}])),'conflict','yöneticiden sonra eski revision yazamaz');
      assert.ok(!(await moderate('listing',l.id,'restore')).error);assert.equal(await rev(db,l.id),4,'yönetici geri alma');
      const l2=await create(O[3]);
      const b=await moderate('user',O[3],'ban');assert.ok(!b.error,JSON.stringify(b.error));assert.equal(await rev(db,l2.id),1,'kalıcı engel ilanı kapattı');
      const l3=await create(C);
      assert.deepEqual(await call(db,C,'account_delete_v1'),{data:{deleted:true}});assert.equal(await rev(db,l3.id),1,'hesap silme karartması');
      // Gece temizliği (#136): süresi 10 gün önce dolmuş ilan karartılır; tetikleyiciler (koruma/moderasyon) bilerek kapalı,
      // revision tetikleyicisi açık.
      await db.exec('set session_replication_role=replica');
      const old=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,expires_at,contact_phone,contact_consent)
        values('truck','Konya','Sivas','Tır','Tenteli',5,'K',$2,$1,now()-interval '10 days','+905339999999',true) returning id`,[O[0],today()])).rows[0].id);
      await db.exec('reset session_replication_role');
      await db.query('call private.retention_batches(100,10)');
      const r=(await db.query(`select redacted_at,contact_phone,revision from public.listings where id=$1`,[old])).rows[0];
      assert.ok(r.redacted_at&&r.contact_phone===null,'temizlik karartma yaptı');assert.equal(Number(r.revision),1,'temizlik revision artırdı');
      assert.equal(key(await call(db,O[0],'listing_update_v1',[old,1,{note:'x'}])),'not_found','karartılmış ilan v1 ile güncellenemez');
      assert.ok(!(await call(db,O[0],'my_listings_v1')).data.some(x=>x.id===old),'karartılmış ilan kendi listesinde yok');
    });
    await t.test('telefon sınırı v0 ve v1\'de ortak sayaç: 15 + 15 sonra ikisi de sınırlı; tek güvenlik olayı',async()=>{
      await db.exec('set session_replication_role=replica');
      const ids=[];
      for(let i=0;i<32;i++)ids.push(Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,contact_phone,contact_consent)
        values('truck','İzmir','Bursa','Kamyon','Tenteli',5,'X',$2,$1,$3,true) returning id`,[[O[1],O[2],ADMIN][i%3],today(),'+90532'+String(2000000+i)])).rows[0].id));
      await db.exec('reset session_replication_role');
      for(let i=0;i<15;i++)assert.equal((await as(db,{user:G},`select public.nakgo_listing_contact($1) r`,[ids[i]])).rows[0].r,'+90532'+String(2000000+i));
      for(let i=15;i<30;i++)assert.equal((await call(db,G,'listing_contact_v1',[ids[i]])).data.limited,false);
      assert.deepEqual(await call(db,G,'listing_contact_v1',[ids[30]]),{data:{phone:null,limited:true}},'v1 31. ilan');
      assert.equal((await as(db,{user:G},`select public.nakgo_listing_contact($1) r`,[ids[31]])).rows[0].r,null,'v0 32. ilan');
      assert.equal((await call(db,G,'listing_contact_v1',[ids[3]])).data.phone,'+90532'+String(2000003),'v0 ile görülen ilan v1\'de yeniden verilir (sayılmaz)');
      assert.deepEqual((await db.query(`select kind from private.security_events where user_id=$1`,[G])).rows,[{kind:'contact_limit_hour'}]);
    });
    await t.test('moderasyon ve askı v1 yollarında: kaldırılan ilan görünmez, favorilenemez, telefonu verilmez, sahibi açamaz',async()=>{
      const l=await create(A,{from_city:'Hatay',to_city:'Adana'});
      await call(db,B,'favorite_add_v1',[l.id]);
      assert.ok(!(await moderate('listing',l.id,'remove')).error);
      assert.ok(!(await call(db,B,'listings_v1')).data.some(x=>x.id===l.id),'akışta yok');
      assert.equal(key(await call(db,B,'listing_v1',[l.id])),'not_found');
      assert.equal((await call(db,B,'favorites_v1')).data.find(x=>x.listing_id===l.id).available,false,'favoride görünmez');
      assert.equal(key(await call(db,B,'listing_contact_v1',[l.id])),'not_found');
      const cur=(await call(db,A,'my_listings_v1')).data.find(x=>x.id===l.id);
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,cur.revision,{status:'active'}])),'not_allowed');
      assert.ok(!(await moderate('user',A,'suspend')).error);
      assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck()])),'account_suspended');
      assert.ok((await call(db,A,'my_listings_v1')).data,'askıdaki hesap okumaya devam eder');
      assert.ok((await as(db,{user:A},`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on) values('truck','İzmir','Bursa','Kamyon','Tenteli',1,'A',$1)`,[today()])).error,'v0 de engeller');
      assert.ok(!(await moderate('user',A,'resume')).error);
    });
    await t.test('B10 + revision + v0: v0 ile 4 ondalık tonaj; v1 filtre bulur, eski revision yazamaz, okuma yuvarlamaz',async()=>{
      const l=await create(A,{from_city:'Rize',to_city:'Ordu',amount:18.25});
      assert.ok(!(await as(db,{user:A},`update public.listings set amount=18.2501 where id=$1`,[l.id])).error);
      const f=(await as(db,{user:B},`select api.listings_v1(p_min_amount=>18.25,p_max_amount=>18.251) r`)).rows[0].r.data;
      assert.ok(f.some(x=>x.id===l.id&&x.amount===18.2501));
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,0,{amount:20,amount_unit:'ton'}])),'conflict');
    });
    await t.test('misafir taraması: anon\'a açık bütün uçlarda telefon, kimlik, revision, not ve sahip adı yok',async()=>{
      const anonFns=Object.entries(v1.functions).filter(([,s])=>s.roles.includes('anon')).map(([f])=>f);
      assert.deepEqual(anonFns.sort(),['listing_catalog_v1','listing_v1','listings_v1','status_v1']);
      const id=(await call(db,null,'listings_v1',[],'anon')).data[0].id;
      const outs=[await call(db,null,'listings_v1',[],'anon'),await call(db,null,'listing_v1',[id],'anon'),await call(db,null,'status_v1',[],'anon'),await call(db,null,'listing_catalog_v1',[],'anon'),
        (await as(db,{role:'anon'},`select api.listings_v1(p_vehicle=>'Kamyon',p_min_amount=>1) r`)).rows[0].r];
      const text=JSON.stringify(outs);
      assert.ok(!/\+90\d{10}|05\d{9}/.test(text),'telefon yok');
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text),'hesap kimliği yok');
      assert.ok(!/"(revision|note|owner_label|owner_id|mine|contact_allowed|photo|expires_at|updated_at|redacted_at)"/.test(text),'üye alanları yok');
      for(const [f,s] of Object.entries(v1.functions).filter(([,s])=>!s.roles.includes('anon'))){
        const sig=s.args.map(a=>a[1]).join(',');
        assert.equal((await db.query(`select has_function_privilege('anon','api.${f}(${sig})','execute') v`)).rows[0].v,false,f);
      }
    });
    await t.test('SECURITY DEFINER denetimi: api uçları DEFINER ve boş search_path kullanır, istemci yetkileri izin listesiyle sınırlıdır',async()=>{
      const api=(await db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p where p.pronamespace='api'::regnamespace`)).rows;
      assert.ok(api.length>=Object.keys(v1.functions).length);
      for(const f of api){assert.equal(f.prosecdef,true,f.proname);assert.ok(f.proconfig.length===1&&/^search_path=("")?$/.test(f.proconfig[0]),f.proname+' '+f.proconfig);}
      const open=(await db.query(`select p.oid::regprocedure::text f,r from pg_proc p cross join (values('anon'),('authenticated')) v(r)
        where p.pronamespace='private'::regnamespace and has_function_privilege(v.r,p.oid,'execute')`)).rows;
      // Korumalı tablolardaki politikalar yalnız bu dört kimlik denetimini çağırır.
      assert.deepEqual(open.map(({f,r})=>`${f} ${r}`).sort(),[
        'private.document_account_verified() authenticated',
        'private.document_object_access(text,text) authenticated',
        'private.is_document_reviewer() authenticated',
        'private.viewer_blocks_listing_owner(uuid) authenticated',
      ]);
      const pub=(await db.query(`select p.oid::regprocedure::text f from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
        and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')`)).rows;
      assert.deepEqual(pub,[],'PUBLIC\'e açık SECURITY DEFINER yok');
      assert.equal((await db.query(`select has_table_privilege('anon','private.api_requests','select') a,has_table_privilege('authenticated','private.contact_views','select') b,
        has_table_privilege('authenticated','private.security_events','select') c,
        has_table_privilege('authenticated','private.listing_owner_blocks','select') d`)).rows.every(r=>!r.a&&!r.b&&!r.c&&!r.d),true,'özel tablolar kapalı');
    });
    await t.test('hesap silme (v1) sonrası gece temizliği: denetim ve güvenlik olayları kalır, tekrar kaydı yok',async()=>{
      const D=uid(30);await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[D]);
      await call(db,D,'profile_update_v1',[{display_name:'Deniz'}]);
      await create(D);
      await db.query(`insert into private.security_events(user_id,kind,hour) values($1,'contact_limit_day',date_trunc('hour',now()))`,[D]);
      assert.ok((await call(db,D,'account_delete_v1')).data.deleted);
      await db.query('call private.retention_batches(100,10)');
      assert.equal(Number((await db.query(`select count(*) n from private.admin_audit where actor_id=$1 and action='self_delete'`,[D])).rows[0].n),1);
      assert.equal(Number((await db.query(`select count(*) n from private.security_events where user_id=$1`,[D])).rows[0].n),1);
      assert.equal(Number((await db.query(`select count(*) n from private.api_requests where user_id=$1`,[D])).rows[0].n),0);
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

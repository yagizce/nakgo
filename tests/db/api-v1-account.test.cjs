/** B3-b2: API v1 hesap okuma uçları (profile_v1, favorites_v1, favorite_ids_v1, route_alerts_v1). Her uç v0'ın
 * authenticated rolü ve RLS altındaki sonucuyla karşılaştırılır; hesaplar arası yalıtım, sayfalama, oturum ve kapatma
 * anahtarı sınanır. Sentetik veri; geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {migratedDb,finish}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const LISTING_COLUMNS='id,owner_id,kind,from_city,to_city,from_district,to_district,expires_at,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,contact_consent';
async function as(db,{user=null,role='authenticated',claims=null}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.query(`select set_config('request.jwt.claims',$1,true)`,[claims?JSON.stringify(claims):'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const iso=t=>new Date(t).toISOString();
const pad=n=>String(n).padStart(2,'0');
const day=d=>d==null?null:(d instanceof Date?d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()):String(d).slice(0,10));
const memberItem=(r,actor)=>({id:Number(r.id),kind:r.kind,from:{city:r.from_city,district:r.from_district},to:{city:r.to_city,district:r.to_district},
  vehicle:r.vehicle,body:r.body,amount:Number(r.amount),cargo:r.cargo,items:r.items,
  date:{on:day(r.available_on),until:day(r.available_until),time:r.available_time,text:r.loading_text},status:r.status,created_at:iso(r.created_at),
  has_photo:r.image_data!=='',owner_label:r.owner_label,note:r.note,mine:r.owner_id===actor,expires_at:iso(r.expires_at),updated_at:iso(r.updated_at),contact_allowed:r.contact_consent,revision:r.owner_id===actor?Number(r.revision??0):null});
const norm=x=>JSON.parse(JSON.stringify(x));

async function pages(fn){const out=[],sizes=[];let c=null;for(let i=0;i<20;i++){const p=await fn(c);out.push(...p.items);sizes.push(p.items.length);if(p.next==null)break;c=p.next;}return {items:out,sizes};}

test('API v1 hesap okuma uçları',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const A=uid(1),B=uid(2),C=uid(3),U=uid(4),O=[uid(10),uid(11),uid(12),uid(13),uid(14),uid(15),uid(16)];
    for(const id of [A,B,C,U,...O])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,$2)`,[id,id===U?null:new Date().toISOString()]);
    const L={};
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into public.profiles(id,display_name,account_type,city,about,phone) values($1,'Ayşe','owner','İzmir','Merhaba','05321112233'),($2,'Barış','carrier','Bursa','','')`,[A,B]);
    const mk=async(owner,{status='active',expires="now()+interval '3 hours'",redacted=null,removed=false}={})=>{
      const id=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id,status,expires_at,redacted_at)
        values('load','İstanbul','Ankara','Tır','Tenteli',10,'Yük','Sahip','bugün','+905329998877',true,$1,$2,${expires},$3) returning id`,[owner,status,redacted])).rows[0].id);
      if(removed)await db.query(`insert into private.listing_moderation(listing_id,removed) values($1,true)`,[id]);
      return id;
    };
    const visible=[];for(let i=0;i<55;i++)visible.push(await mk(O[i%7]));
    L.othersClosed=await mk(O[0],{status:'closed'});
    L.ownClosed=await mk(A,{status:'closed'});
    L.ownRedacted=await mk(A,{status:'closed',redacted:new Date().toISOString()});
    L.othersExpired=await mk(O[1],{expires:"now()-interval '2 hours'"});
    L.removed=await mk(O[2],{status:'archived',removed:true});
    for(const id of [...visible,L.othersClosed,L.ownClosed,L.ownRedacted,L.othersExpired,L.removed])await db.query(`insert into public.listing_favorites(user_id,listing_id) values($1,$2)`,[A,id]);
    for(const id of visible.slice(0,3))await db.query(`insert into public.listing_favorites(user_id,listing_id) values($1,$2)`,[B,id]);
    for(let i=0;i<23;i++)await db.query(`insert into public.route_alerts(user_id,kind,from_city,to_city,vehicle,body,active) values($1,$2,$3,$4,$5,$6,$7)`,
      [A,i%2?'truck':'load','İstanbul','Ankara '+i,i%4?'Tır':null,null,i%5!==0]);
    await db.query(`insert into public.route_alerts(user_id,kind,from_city,to_city) values($1,'load','Adana','Mersin')`,[B]);
    await db.exec('reset session_replication_role');
    const v1page=(who,fn)=>async c=>{const r=await as(db,who,`select api.${fn}($1) r`,[c]);if(r.error)throw Error(JSON.stringify(r.error));return {items:r.rows[0].r.data,next:r.rows[0].r.page.next};};

    await t.test('profil v0 ile aynı; profili olmayan hesapta data=null; başka hesabın profili gelmez',async()=>{
      for(const user of [A,B]){
        const v0=(await as(db,{user},`select display_name,account_type,city,about,phone from public.profiles where id=$1`,[user])).rows[0];
        assert.deepEqual((await as(db,{user},`select api.profile_v1() r`)).rows[0].r,{data:v0});
      }
      assert.deepEqual((await as(db,{user:C},`select api.profile_v1() r`)).rows[0].r,{data:null});
      assert.ok(!JSON.stringify((await as(db,{user:B},`select api.profile_v1() r`)).rows).includes('Ayşe'));
      assert.deepEqual(Object.keys((await as(db,{user:A},`select api.profile_v1() r`)).rows[0].r.data).sort(),[...v1.functions.profile_v1.data].sort());
    });
    await t.test('favoriler v0 (favori + gömülü ilan, RLS) ile aynı: görünmeyen ilan available=false, listing=null; 50\'şer',async()=>{
      const a=await pages(v1page({user:A},'favorites_v1'));
      const v0=async c=>{const r=await as(db,{user:A},`select f.listing_id,l.* from public.listing_favorites f
          left join lateral (select ${LISTING_COLUMNS} from public.listings x where x.id=f.listing_id) l on true
          where ($1::bigint is null or f.listing_id<$1) order by f.listing_id desc limit 50`,[c==null?null:Number(c)]);
        return {items:r.rows,next:r.rows.length===50?String(r.rows.at(-1).listing_id):null};};
      const b=await pages(v0);
      assert.deepEqual(a.sizes,b.sizes);assert.deepEqual(a.sizes,[50,10]);
      assert.deepEqual(norm(a.items),norm(b.items.map(r=>({listing_id:Number(r.listing_id),available:r.id!=null,listing:r.id==null?null:memberItem(r,A)}))));
      const byId=Object.fromEntries(a.items.map(x=>[x.listing_id,x]));
      assert.equal(byId[L.othersClosed].available,false);assert.equal(byId[L.ownRedacted].available,false);assert.equal(byId[L.removed].available,false);
      assert.equal(byId[L.othersExpired].available,false);assert.equal(byId[L.ownClosed].available,true);assert.equal(byId[L.ownClosed].listing.mine,true);
      for(const x of a.items)assert.deepEqual(Object.keys(x).sort(),[...v1.functions.favorites_v1.item].sort());
      assert.ok(!JSON.stringify(a.items).match(/532999|owner_id|redacted|image_data|"photo"/),'telefon ve gizli alan yok');
    });
    await t.test('favori kimlikleri v0 gibi 200\'er, kimliğe göre azalan',async()=>{
      const a=(await as(db,{user:A},`select api.favorite_ids_v1() r`)).rows[0].r;
      const v0=(await as(db,{user:A},`select listing_id from public.listing_favorites order by listing_id desc limit 200`)).rows.map(r=>Number(r.listing_id));
      assert.deepEqual(a,{data:v0,page:{next:null}});
      assert.deepEqual((await as(db,{user:B},`select api.favorite_ids_v1() r`)).rows[0].r.data,visible.slice(0,3).sort((x,y)=>y-x));
    });
    await t.test('rota uyarıları v0 ile aynı (ilk 20), fazlası sonraki sayfada; başka hesabınki yok',async()=>{
      const a=await pages(v1page({user:A},'route_alerts_v1'));
      const v0=(await as(db,{user:A},`select id,kind,from_city,to_city,vehicle,body,active,seen_at,created_at from public.route_alerts order by id desc limit 20`)).rows;
      assert.deepEqual(a.sizes,[20,3]);
      assert.deepEqual(a.items.slice(0,20),v0.map(r=>({id:Number(r.id),kind:r.kind,from:r.from_city,to:r.to_city,vehicle:r.vehicle,body:r.body,active:r.active,seen_at:iso(r.seen_at),created_at:iso(r.created_at)})));
      for(const x of a.items)assert.deepEqual(Object.keys(x).sort(),[...v1.functions.route_alerts_v1.item].sort());
      const b=(await as(db,{user:B},`select api.route_alerts_v1() r`)).rows[0].r.data;
      assert.equal(b.length,1);assert.equal(b[0].from,'Adana');
    });
    await t.test('yalıtım: B, A\'nın favorilerini ve uyarılarını görmez; sayfa imleci başka hesabın verisini açmaz',async()=>{
      const bFav=(await pages(v1page({user:B},'favorites_v1'))).items.map(x=>x.listing_id);
      assert.deepEqual(bFav,visible.slice(0,3).sort((x,y)=>y-x));
      const aNext=(await as(db,{user:A},`select api.favorites_v1() r`)).rows[0].r.page.next;
      const cross=(await as(db,{user:B},`select api.favorites_v1($1) r`,[aNext])).rows[0].r.data.map(x=>x.listing_id);
      assert.ok(cross.every(id=>visible.slice(0,3).includes(id)),'A\'nın imleci B\'ye yalnız kendi verisini döndürür');
    });
    await t.test('oturum: misafire kapalı, anonim oturum auth_required, doğrulanmamış account_unverified',async()=>{
      for(const fn of ['profile_v1()','favorites_v1(text)','favorite_ids_v1(text)','route_alerts_v1(text)']){
        assert.equal((await db.query(`select has_function_privilege('anon','api.${fn}','execute') v`)).rows[0].v,false,fn);
        const call=`select api.${fn.replace('(text)','()')} r`;
        assert.equal((await as(db,{role:'anon'},call)).error.code,'42501');
        assert.equal((await as(db,{user:A,claims:{sub:A,is_anonymous:true}},call)).error.key,'auth_required');
        assert.equal((await as(db,{user:U},call)).error.key,'account_unverified');
      }
    });
    await t.test('v1 kapalıyken dört uç api_disabled; v0 tablo okumaları çalışır',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        for(const fn of ['profile_v1','favorites_v1','favorite_ids_v1','route_alerts_v1'])
          assert.deepEqual((await as(db,{user:A},`select api.${fn}() r`)).error,{code:'PT503',key:'api_disabled'},fn);
        for(const sql of [`select * from public.profiles`,`select * from public.listing_favorites`,`select * from public.route_alerts`])
          assert.ok((await as(db,{user:A},sql)).rows.length>0,sql);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
    await t.test('geçersiz imleç invalid_cursor',async()=>{
      for(const fn of ['favorites_v1','favorite_ids_v1','route_alerts_v1'])assert.equal((await as(db,{user:A},`select api.${fn}('x') r`)).error.key,'invalid_cursor',fn);
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

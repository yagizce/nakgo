/** B3-c: yazma uçlarının yerel PostgREST üzerinden HTTP entegrasyonu: durum kodları (400/401/403/404/409/429/503), yanıt
 * gövdesi, kimliğin JWT'den alınması, hata gövdesinde telefon olmaması. NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN yoksa atlanır.
 * Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');

test('API v1 yazma uçları HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
  const db=await migratedDb();let pg=null,primary=null;
  try{
    const A='00000000-0000-4000-8000-0000000000c1',B='00000000-0000-4000-8000-0000000000c2',S='00000000-0000-4000-8000-0000000000c3';
    for(const id of [A,B,S])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into public.profiles(id,display_name,account_type) values($1,'Ayşe','owner'),($2,'Barış','carrier')`,[A,B]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[S]);
    await db.exec('reset session_replication_role');
    pg=await startPostgrest(db);
    const TA=pg.jwt({sub:A}),TB=pg.jwt({sub:B}),TS=pg.jwt({sub:S});
    const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
    const truck={kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,available_on:today,contact_phone:'+905321234567',contact_consent:true};
    let listing;
    await t.test('oluşturma 200; tekrar aynı ilan; JWT dışı kimlik kabul edilmez; geçersiz girdi 400 (telefon yok)',async()=>{
      const req=crypto.randomUUID();
      const a=await pg.rpc('listing_create_v1',{token:TA,body:{p_request_id:req,p_listing:truck}});
      assert.equal(a.status,200);assert.equal(a.body.data.created,true);listing=a.body.data.listing;assert.equal(listing.mine,true);
      const b=await pg.rpc('listing_create_v1',{token:TA,body:{p_request_id:req,p_listing:truck}});
      assert.equal(b.body.data.listing.id,listing.id);assert.equal(b.body.data.created,false);
      assert.equal((await db.query(`select owner_id from public.listings where id=$1`,[listing.id])).rows[0].owner_id,A);
      const forged=await pg.rpc('listing_create_v1',{token:TA,body:{p_request_id:crypto.randomUUID(),p_listing:{...truck,owner_id:B}}});
      assert.equal(forged.status,400);assert.equal(forged.body.message,'invalid_argument');
      const bad=await pg.rpc('listing_create_v1',{token:TA,body:{p_request_id:crypto.randomUUID(),p_listing:{...truck,contact_phone:'+9053212'}}});
      assert.equal(bad.status,400);assert.deepEqual([bad.body.message,bad.body.hint],['invalid_argument','nakgo.api']);
      assert.ok(!bad.raw.includes('53212'),'hata gövdesi telefon içermez');
      assert.equal((await pg.rpc('listing_create_v1',{body:{p_request_id:req,p_listing:truck}})).status,401,'misafir');
      assert.equal((await pg.rpc('listing_create_v1',{token:TS,body:{p_request_id:crypto.randomUUID(),p_listing:truck}})).status,403,'askıdaki hesap');
    });
    await t.test('güncelleme: doğru revision 200, eski revision 409; başka hesap 404',async()=>{
      const ok=await pg.rpc('listing_update_v1',{token:TA,body:{p_id:listing.id,p_revision:listing.updated_at,p_changes:{note:'Yeni'}}});
      assert.equal(ok.status,200);assert.equal(ok.body.data.listing.note,'Yeni');
      const stale=await pg.rpc('listing_update_v1',{token:TA,body:{p_id:listing.id,p_revision:listing.updated_at,p_changes:{note:'Eski'}}});
      assert.equal(stale.status,409);assert.equal(stale.body.message,'conflict');
      assert.equal((await pg.rpc('listing_update_v1',{token:TB,body:{p_id:listing.id,p_revision:ok.body.data.listing.updated_at,p_changes:{note:'X'}}})).status,404);
      assert.equal((await pg.rpc('listing_close_v1',{token:TB,body:{p_id:listing.id}})).status,404);
      const c=await pg.rpc('listing_close_v1',{token:TA,body:{p_id:listing.id}});assert.equal(c.body.data.listing.status,'closed');
    });
    await t.test('kota 429 (limit_reached); rota uyarısı sınırı 429',async()=>{
      for(let i=0;i<10;i++)assert.equal((await pg.rpc('listing_create_v1',{token:TB,body:{p_request_id:crypto.randomUUID(),p_listing:truck}})).status,200);
      const over=await pg.rpc('listing_create_v1',{token:TB,body:{p_request_id:crypto.randomUUID(),p_listing:truck}});
      assert.equal(over.status,429);assert.equal(over.body.message,'limit_reached');
      for(let i=0;i<20;i++)await pg.rpc('route_alert_create_v1',{token:TB,body:{p_kind:'load',p_from:'Şehir '+i}});
      const r=await pg.rpc('route_alert_create_v1',{token:TB,body:{p_kind:'load',p_from:'Fazla'}});assert.equal(r.status,429);
      const again=await pg.rpc('route_alert_create_v1',{token:TB,body:{p_kind:'load',p_from:'Şehir 0'}});
      assert.equal(again.status,200);assert.equal(again.body.data.created,false);
    });
    await t.test('favori, telefon, profil ve rota uyarısı uçları; v0 ile aynı sunucuda',async()=>{
      const id=(await db.query(`select id from public.listings where owner_id=$1 limit 1`,[B])).rows[0].id;
      assert.deepEqual((await pg.rpc('favorite_add_v1',{token:TA,body:{p_listing_id:Number(id)}})).body,{data:{listing_id:Number(id),saved:true}});
      assert.deepEqual((await pg.rpc('favorite_ids_v1',{token:TA})).body.data,[Number(id)]);
      assert.equal((await pg.rpc('favorite_add_v1',{token:TA,body:{p_listing_id:999999999}})).status,404);
      const c=await pg.rpc('listing_contact_v1',{token:TA,body:{p_id:Number(id),p_channel:'call'}});
      assert.deepEqual(c.body,{data:{phone:'+905321234567',limited:false}});
      const v0=await pg.rpc('nakgo_listing_contact',{token:TA,schema:null,body:{p_id:Number(id)}});assert.equal(v0.body,'+905321234567','v0 aynı sunucuda');
      const p=await pg.rpc('profile_update_v1',{token:TA,body:{p_changes:{city:'Bursa',phone:'05321112233'}}});
      assert.equal(p.status,200);assert.equal(p.body.data.city,'Bursa');
      const pb=await pg.rpc('profile_update_v1',{token:TA,body:{p_changes:{phone:'0532'}}});assert.equal(pb.status,400);assert.ok(!pb.raw.includes('0532'));
      const al=await pg.rpc('route_alert_create_v1',{token:TA,body:{p_kind:'truck',p_to:'Ankara'}});
      assert.equal((await pg.rpc('route_alert_update_v1',{token:TA,body:{p_id:al.body.data.alert.id,p_active:false}})).body.data.alert.active,false);
      assert.deepEqual((await pg.rpc('route_alert_delete_v1',{token:TA,body:{p_id:al.body.data.alert.id}})).body.data.removed,true);
      assert.equal((await pg.rpc('route_alerts_seen_v1',{token:TA})).status,200);
      assert.equal((await pg.rpc('favorite_remove_v1',{token:TA,body:{p_listing_id:Number(id)}})).body.data.saved,false);
    });
    await t.test('v1 kapalıyken yazma uçları 503; v0 yazma yolu çalışır',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        assert.equal((await pg.rpc('route_alert_create_v1',{token:TA,body:{p_kind:'load',p_from:'Sivas'}})).status,503);
        const v0=await pg.rpc('nakgo_save_route_alert',{token:TA,schema:null,body:{p_kind:'load',p_from:'Sivas',p_to:null,p_vehicle:null,p_body:null}});
        assert.equal(v0.status,200);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
    await t.test('hesap silme 200; sahip hesabı 403; silinen hesap yazamaz',async()=>{
      assert.deepEqual((await pg.rpc('account_delete_v1',{token:TA})).body,{data:{deleted:true}});
      assert.equal((await pg.rpc('profile_update_v1',{token:TA,body:{p_changes:{city:'X'}}})).status,403);
      await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[B]);
      const r=await pg.rpc('account_delete_v1',{token:TB});assert.equal(r.status,403);assert.equal(r.body.message,'not_allowed');
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();await finish(db,primary);}
});

/** Şikâyet uçlarının yerel PostgREST üzerinden HTTP entegrasyonu: v1 (api) ve v0 (public) durum kodları, kimliğin JWT'den
 * alınması, tablonun HTTP'den okunamaması, yönetici uçlarının yalnız yöneticiye açık olması. NAKGO_PG_HOST ve
 * NAKGO_POSTGREST_BIN yoksa atlanır. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');

test('Şikâyet HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
  const db=await migratedDb();let pg=null,primary=null;
  try{
    const R='00000000-0000-4000-8000-0000000000d1',O='00000000-0000-4000-8000-0000000000d2',S='00000000-0000-4000-8000-0000000000d3',ADM='00000000-0000-4000-8000-0000000000d4';
    for(const id of [R,O,S,ADM])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
    await db.exec('set session_replication_role=replica');
    for(const id of [R,O,S,ADM])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,'K','owner')`,[id]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[S]);
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[ADM]);
    await db.exec('reset session_replication_role');
    pg=await startPostgrest(db);
    const TR=pg.jwt({sub:R}),TO=pg.jwt({sub:O}),TS=pg.jwt({sub:S}),TA=pg.jwt({sub:ADM});
    const load={kind:'load',from_city:'İstanbul',to_city:'Ankara',vehicle:'Tır',body:'Tenteli',amount:20,amount_unit:'ton',cargo:'Palet',loading_text:'bugün',items:[],contact_phone:'+905321234567',contact_consent:true};
    const c=await pg.rpc('listing_create_v1',{token:TO,body:{p_request_id:crypto.randomUUID(),p_listing:load}});assert.equal(c.status,200);
    const L=c.body.data.listing.id;
    const body=(o={})=>({p_listing_id:L,p_subject:'listing',p_reason:'fraud',p_note:'Kapora',...o});

    await t.test('v1: 200 oluşturma, tekrar aynı kayıt; kimlik JWT\'den; durum kodları',async()=>{
      const a=await pg.rpc('report_create_v1',{token:TR,body:body()});
      assert.equal(a.status,200);assert.equal(a.body.data.created,true);
      const b=await pg.rpc('report_create_v1',{token:TR,body:body({p_reason:'fake'})});
      assert.equal(b.status,200);assert.equal(b.body.data.created,false);assert.equal(b.body.data.report.id,a.body.data.report.id);
      assert.equal((await db.query(`select reporter_id from private.listing_reports where id=$1`,[a.body.data.report.id])).rows[0].reporter_id,R);
      const forged=await pg.rpc('report_create_v1',{token:TR,body:{...body(),p_reporter_id:O}});assert.equal(forged.status,404,'bilinmeyen argüman: uç bulunmaz');
      assert.equal((await pg.rpc('report_create_v1',{body:body()})).status,401,'misafir');
      assert.equal((await pg.rpc('report_create_v1',{token:TS,body:body()})).status,403,'askıdaki hesap');
      assert.equal((await pg.rpc('report_create_v1',{token:TO,body:body()})).status,403,'kendi ilanı (not_allowed)');
      const nf=await pg.rpc('report_create_v1',{token:TR,body:body({p_listing_id:999999})});assert.equal(nf.status,404);assert.equal(nf.body.message,'not_found');
      const bad=await pg.rpc('report_create_v1',{token:TR,body:body({p_reason:'Sahte ilan'})});assert.equal(bad.status,400);assert.equal(bad.body.message,'invalid_argument');
    });

    await t.test('v0 (public şeması): aynı kural ve aynı kayıt',async()=>{
      const a=await pg.rpc('nakgo_report_listing',{token:TR,schema:null,body:body({p_subject:'account'})});
      assert.equal(a.status,200);assert.equal(a.body.created,true);
      const b=await pg.rpc('nakgo_report_listing',{token:TR,schema:null,body:body({p_subject:'account'})});assert.equal(b.body.created,false);
      assert.equal((await pg.rpc('nakgo_report_listing',{schema:null,body:body()})).status,401,'misafir');
      assert.equal((await pg.rpc('nakgo_report_listing',{token:TO,schema:null,body:body()})).status,403,'kendi ilanı');
    });

    await t.test('gizlilik: tablo ve çekirdek fonksiyon HTTP\'den erişilemez; yönetici uçları yalnız yöneticiye',async()=>{
      for(const token of [null,TR,TO,TA]){
        const r=await pg.get('/listing_reports',token);await r.text();assert.ok(r.status>=400,'tablo kapalı '+r.status);
        assert.ok((await pg.rpc('report_create',{token,schema:null,body:{p_actor:O,p_listing_id:L,p_subject:'listing',p_reason:'fake',p_note:''}})).status>=400);
      }
      for(const token of [TR,TO]){
        assert.equal((await pg.rpc('nakgo_admin_reports',{token,schema:null,body:{}})).status,403);
        assert.equal((await pg.rpc('nakgo_admin_report_set',{token,schema:null,body:{p_id:1,p_status:'resolved',p_reason:'Kapat',p_revision:0}})).status,403);
      }
      const list=await pg.rpc('nakgo_admin_reports',{token:TA,schema:null,body:{p_status:'open'}});
      assert.equal(list.status,200);assert.ok(list.body.length===2&&list.body.every(x=>x.listing_id===L&&x.note==='Kapora'));
      const one=list.body[0];
      const set=await pg.rpc('nakgo_admin_report_set',{token:TA,schema:null,body:{p_id:one.id,p_status:'resolved',p_reason:'İncelendi',p_revision:one.revision}});
      assert.equal(set.status,200);assert.deepEqual(set.body,{revision:one.revision+1,changed:true});
      const stale=await pg.rpc('nakgo_admin_report_set',{token:TA,schema:null,body:{p_id:one.id,p_status:'rejected',p_reason:'İncelendi',p_revision:one.revision}});
      assert.equal(stale.status,409);assert.equal(stale.body.code,'PT409');
    });
  }finally{if(pg)pg.stop();await finish(db,primary);}
});

/** B10: araç verileri uçlarının yerel PostgREST üzerinden HTTP davranışı: katalog (misafir), akış filtreleri (yeni ve eski
 * çağrı biçimi), birimsiz tonaj 400. NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN yoksa atlanır. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');

test('API v1 araç verileri HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
  const db=await migratedDb();let pg=null,primary=null;
  try{
    const A='00000000-0000-4000-8000-0000000000e1';
    await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[A]);
    pg=await startPostgrest(db);const T=pg.jwt({sub:A});
    const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
    const truck=o=>({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,amount_unit:'ton',available_on:today,...o});
    await t.test('katalog misafire açık; birimsiz tonaj 400; geçerli ilan 200',async()=>{
      const c=await pg.rpc('listing_catalog_v1');assert.equal(c.status,200);assert.equal(c.body.data.amount.unit,'ton');assert.ok(c.body.data.vehicles.includes('Tır'));
      const {amount_unit,...noUnit}=truck();
      const r=await pg.rpc('listing_create_v1',{token:T,body:{p_request_id:crypto.randomUUID(),p_listing:noUnit}});
      assert.equal(r.status,400);assert.equal(r.body.message,'invalid_argument');
      for(const o of [{vehicle:'Tır',amount:30},{vehicle:'Kamyonet',amount:3}])
        assert.equal((await pg.rpc('listing_create_v1',{token:T,body:{p_request_id:crypto.randomUUID(),p_listing:truck(o)}})).status,200);
    });
    await t.test('akış filtreleri HTTP ile; eski çağrı biçimi (yalnız p_kind) çalışır; geçersiz filtre 400',async()=>{
      const f=await pg.rpc('listings_v1',{body:{p_vehicle:'Tır',p_min_amount:20}});
      assert.equal(f.status,200);assert.deepEqual(f.body.data.map(x=>x.vehicle),['Tır']);
      assert.equal((await pg.rpc('listings_v1',{body:{p_kind:'truck'}})).body.data.length,2);
      assert.equal((await pg.rpc('listings_v1',{body:{}})).body.data.length,2);
      assert.equal((await pg.rpc('listings_v1',{body:{p_max_amount:5}})).body.data[0].vehicle,'Kamyonet');
      assert.equal((await pg.rpc('listings_v1',{body:{p_vehicle:'TIR'}})).status,400);
      assert.equal((await pg.rpc('listings_v1',{body:{p_min_amount:10,p_max_amount:5}})).status,400);
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();await finish(db,primary);}
});

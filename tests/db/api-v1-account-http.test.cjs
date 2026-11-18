/** B3-b2: hesap okuma uçlarının yerel PostgREST üzerinden HTTP entegrasyonu. NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN yoksa
 * atlanır. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');

test('API v1 hesap uçları HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
  const db=await migratedDb();let pg=null,primary=null;
  try{
    const A='00000000-0000-4000-8000-0000000000b1',B='00000000-0000-4000-8000-0000000000b2';
    for(const id of [A,B])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into public.profiles(id,display_name,account_type,phone) values($1,'Ayşe','owner','05321112233')`,[A]);
    const id=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id) values('load','İstanbul','Ankara','Tır','Tenteli',1,'Yük','S','bugün',$1) returning id`,[B])).rows[0].id);
    await db.query(`insert into public.listing_favorites(user_id,listing_id) values($1,$2)`,[A,id]);
    await db.query(`insert into public.route_alerts(user_id,kind,from_city) values($1,'load','İzmir')`,[A]);
    await db.exec('reset session_replication_role');
    pg=await startPostgrest(db);
    const TA=pg.jwt({sub:A}),TB=pg.jwt({sub:B});
    await t.test('üye kendi verisini alır; başka hesap almaz; misafir 401',async()=>{
      assert.equal((await pg.rpc('profile_v1',{token:TA})).body.data.display_name,'Ayşe');
      assert.equal((await pg.rpc('profile_v1',{token:TB})).body.data,null);
      const f=await pg.rpc('favorites_v1',{token:TA});assert.equal(f.status,200);assert.equal(f.body.data[0].listing_id,id);assert.equal(f.body.data[0].available,true);
      assert.deepEqual((await pg.rpc('favorites_v1',{token:TB})).body.data,[]);
      assert.deepEqual((await pg.rpc('favorite_ids_v1',{token:TA})).body.data,[id]);
      assert.equal((await pg.rpc('route_alerts_v1',{token:TA})).body.data[0].from,'İzmir');
      assert.deepEqual((await pg.rpc('route_alerts_v1',{token:TB})).body.data,[]);
      for(const fn of ['profile_v1','favorites_v1','favorite_ids_v1','route_alerts_v1'])assert.equal((await pg.rpc(fn)).status,401,fn);
    });
    await t.test('v1 kapalıyken 503; v0 tablo okuması aynı sunucuda çalışır',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        assert.equal((await pg.rpc('favorites_v1',{token:TA})).status,503);
        const r=await pg.get('/listing_favorites?select=listing_id',TA);assert.equal(r.status,200);assert.deepEqual(await r.json(),[{listing_id:id}]);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();await finish(db,primary);}
});

/** B3-b1: ilan okuma uçlarının yerel PostgREST üzerinden HTTP entegrasyonu. NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN yoksa
 * atlanır. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');
const v1=require('../../supabase/contract/v1.json');

test('API v1 ilan uçları HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
  const db=await migratedDb();let pg=null,primary=null;
  try{
    const A='00000000-0000-4000-8000-0000000000a1',O='00000000-0000-4000-8000-0000000000a2';
    for(const id of [A,O])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
    await db.exec('set session_replication_role=replica');
    const ids=[];
    for(let i=0;i<55;i++)ids.push(Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id,image_data)
      values('load','İstanbul','Ankara','Tır','Tenteli',$1,'Yük','Sahip',$2,'+905321234567',true,$3,$4) returning id`,[10+i,'bugün',i%2?A:O,i===3?'data:image/jpeg;base64,/9j/4AAQ':''])).rows[0].id));
    const closed=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,status) values('load','İzmir','Bursa','Tır','Tenteli',1,'Yük','Sahip','bugün',$1,'closed') returning id`,[O])).rows[0].id);
    await db.exec('reset session_replication_role');
    pg=await startPostgrest(db);
    const T=pg.jwt({sub:A});
    await t.test('misafir akışı: 200, 50\'şer, misafir alanları; ikinci sayfa imleçle',async()=>{
      const p1=await pg.rpc('listings_v1');assert.equal(p1.status,200,p1.raw);
      assert.equal(p1.body.data.length,50);assert.deepEqual(Object.keys(p1.body.data[0]).sort(),[...v1.listing_item.guest].sort());
      const p2=await pg.rpc('listings_v1',{body:{p_cursor:p1.body.page.next}});
      assert.equal(p2.body.data.length,5);assert.equal(p2.body.page.next,null);
      assert.ok(!p1.raw.includes('5321234567')&&!p2.raw.includes('5321234567'));
    });
    await t.test('üye akışı ve ayrıntı: üye alanları, fotoğraf yalnız ayrıntıda; kapalı başkasının ilanı 404 not_found',async()=>{
      const m=await pg.rpc('listings_v1',{token:T});assert.deepEqual(Object.keys(m.body.data[0]).sort(),[...v1.listing_item.member].sort());
      assert.ok(!m.raw.includes('base64'));
      const d=await pg.rpc('listing_v1',{token:T,body:{p_id:ids[3]}});assert.equal(d.status,200);assert.match(d.body.data.photo,/^data:image\/jpeg/);
      const g=await pg.rpc('listing_v1',{body:{p_id:ids[3]}});assert.ok(!('photo' in g.body.data)&&!('owner_label' in g.body.data));
      const nf=await pg.rpc('listing_v1',{token:T,body:{p_id:closed}});assert.equal(nf.status,404);assert.equal(nf.body.message,'not_found');
    });
    await t.test('kendi ilanlarım: üye kendi ilanlarını görür; misafir 401',async()=>{
      const r=await pg.rpc('my_listings_v1',{token:T});assert.equal(r.status,200);assert.ok(r.body.data.length>0&&r.body.data.every(x=>x.mine));
      assert.equal((await pg.rpc('my_listings_v1')).status,401);
    });
    await t.test('v1 kapalıyken 503 api_disabled; v0 aynı sunucuda çalışır',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        const r=await pg.rpc('listings_v1');assert.equal(r.status,503);assert.equal(r.body.message,'api_disabled');
        assert.equal((await pg.rpc('nakgo_public_listings',{schema:null})).status,200);
        assert.equal((await pg.get('/listings?select=id&status=eq.active&order=id.desc&limit=50',T)).status,200);
        assert.equal((await pg.rpc('status_v1')).body.data.enabled,false);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();await finish(db,primary);}
});

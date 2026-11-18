/** B3-c2: ilan için tamsayı revision. Her güncellemede (v0 ve v1) tam 1 artar; v1 güncellemesi yalnız okunan revision ile
 * yazar; aynı milisaniyeye düşen iki sürüm birbirine karışmaz; v0 istemcisi sütunu göremez ve yazamaz; aynı revision'ı okuyan
 * birçok bağlantıdan yalnız biri yazar (gerçek PostgreSQL). Sentetik veri; geçici yerel veritabanı. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
async function as(db,{user=null,role='authenticated'}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const call=async(db,user,fn,args=[])=>{
  const r=await as(db,{user},`select api.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a));
  return r.error?{error:r.error}:r.rows[0].r;
};
const today=()=>new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const truck=()=>({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,amount_unit:'ton',available_on:today()});
const rev=async(db,id)=>Number((await db.query(`select revision from public.listings where id=$1`,[id])).rows[0].revision);

test('API v1 tamsayı revision',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const A=uid(1),B=uid(2);
    for(const id of [A,B])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into public.profiles(id,display_name) values($1,'Ayşe'),($2,'Barış')`,[A,B]);
    await db.exec('reset session_replication_role');
    const create=async user=>(await call(db,user,'listing_create_v1',[crypto.randomUUID(),truck()])).data.listing;

    await t.test('oluşturmada 0; her güncellemede tam 1 artar (v1, v0, kapatma); yanıt revision\'ı veritabanıyla aynı',async()=>{
      const l=await create(A);assert.equal(l.revision,0);
      const u=(await call(db,A,'listing_update_v1',[l.id,0,{note:'bir'}])).data.listing;assert.equal(u.revision,1);assert.equal(await rev(db,l.id),1);
      assert.ok(!(await as(db,{user:A},`update public.listings set note='v0' where id=$1`,[l.id])).error);
      assert.equal(await rev(db,l.id),2,'v0 güncellemesi de artırır');
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,1,{note:'eski'}])),'conflict','v0 değişikliğinden sonra eski revision yazamaz');
      assert.equal((await call(db,A,'listing_close_v1',[l.id])).data.listing.revision,3);
      assert.equal((await call(db,A,'my_listings_v1')).data.find(x=>x.id===l.id).revision,3);
    });
    await t.test('aynı milisaniyeye düşen iki sürüm: updated_at aynı olsa da eski sürüm yazamaz',async()=>{
      const l=await create(A);
      const first=(await call(db,A,'listing_update_v1',[l.id,0,{note:'X'}])).data.listing;
      // İkinci bir yazma; updated_at bilerek birinciyle aynı değere çekilir (aynı milisaniye / saat geri gitmesi).
      assert.ok(!(await as(db,{user:A},`update public.listings set note='Y' where id=$1`,[l.id])).error);
      await db.exec('set session_replication_role=replica');
      await db.query(`update public.listings set updated_at=$2 where id=$1`,[l.id,first.updated_at]);
      await db.exec('reset session_replication_role');
      assert.equal((await call(db,A,'listing_v1',[l.id])).data.updated_at,first.updated_at,'zaman damgaları aynı');
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,first.revision,{note:'Z'}])),'conflict');
      assert.equal((await db.query(`select note from public.listings where id=$1`,[l.id])).rows[0].note,'Y','ikinci yazma korunur');
    });
    await t.test('v0 istemcisi revision\'ı okuyamaz, yazamaz, ekleyemez; v1 de istemciden almaz',async()=>{
      const l=await create(A);
      assert.equal((await as(db,{user:A},`select revision from public.listings where id=$1`,[l.id])).error.code,'42501');
      assert.equal((await as(db,{user:A},`update public.listings set revision=99 where id=$1`,[l.id])).error.code,'42501');
      assert.equal((await as(db,{user:A},`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,revision) values('truck','İzmir','Bursa','Kamyon','Tenteli',1,'A',$1,9)`,[today()])).error.code,'42501');
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,0,{revision:99}])),'invalid_argument');
      assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),{...truck(),revision:9}])),'invalid_argument');
      // Yönetici/bakım yazması (tetikleyici açık) da artırır; değer elle verilse bile tetikleyici ezer.
      assert.ok(!(await as(db,{user:A,role:'postgres'},`update public.listings set revision=500 where id=$1`,[l.id])).error);
      assert.equal(await rev(db,l.id),1,'yetkili yazmada da elle verilen değer ezilir: tam 1 artar');
      for(const bad of [-1,null])assert.equal(key(await call(db,A,'listing_update_v1',[l.id,bad,{note:'x'}])),'invalid_argument',String(bad));
    });
    await t.test('revision yalnız sahibine: başkasının ilanında null, misafirde alan yok',async()=>{
      const l=await create(A);
      assert.equal((await call(db,A,'listing_v1',[l.id])).data.revision,0);
      assert.equal((await call(db,B,'listing_v1',[l.id])).data.revision,null);
      assert.ok(!('revision' in (await as(db,{role:'anon'},`select api.listing_v1($1) r`,[l.id])).rows[0].r.data));
      assert.ok((await call(db,B,'listings_v1')).data.every(x=>x.mine?Number.isInteger(x.revision):x.revision===null));
    });
    await t.test('aynı revision\'ı okuyan 5 bağlantı (gerçek PostgreSQL): yalnız biri yazar, diğerleri conflict',async t2=>{
      if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
      const {Client}=require('pg');
      const conns=[];
      try{
        for(let i=0;i<5;i++){const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
          password:process.env.NAKGO_PG_PASSWORD,database:db.name});c.on('error',()=>{});await c.connect();conns.push(c);}
        for(let round=0;round<3;round++){
          const l=await create(B);
          const results=await Promise.all(conns.map(async(c,i)=>{
            await c.query('begin');
            try{await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[B]);await c.query('set local role authenticated');
              const r=(await c.query(`select api.listing_update_v1($1,0,$2) r`,[l.id,JSON.stringify({note:'bağlantı '+i})])).rows[0].r;
              await c.query('select pg_sleep(0.05)');await c.query('commit');return {ok:r.data.listing.note};}
            catch(e){await c.query('rollback');return {err:e.message};}
          }));
          const wins=results.filter(r=>r.ok);
          assert.equal(wins.length,1,JSON.stringify(results));
          assert.ok(results.filter(r=>r.err).every(r=>r.err==='conflict'));
          assert.equal((await db.query(`select note from public.listings where id=$1`,[l.id])).rows[0].note,wins[0].ok);
          assert.equal(await rev(db,l.id),1);
        }
      }finally{for(const c of conns)await c.end();}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});
const key=r=>r.error&&r.error.key;

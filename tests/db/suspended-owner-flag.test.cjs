/** Askı işareti (listings.owner_suspended) eşzamanlılığı: askıya alma ile sahibin ilan yazması aynı anda olursa kilit
 * sırası (satır kilidi / danışmalı kilit) ters düşer. Deadlock (40P01) yönetici işleminde 'Moderation busy; refresh'
 * (PT409) olarak döner, işlemin hiçbir parçası kalmaz; tekrar deneme başarılı olur. Çekişmesiz işlemler değişmez; yazma
 * sürerken yapılan askı, yeni ilanı da işaretler. Davranış ve yetki testleri supabase/tests/suspended-owner-flag.sql'de.
 * Birden çok bağlantı gerektirir: yalnız gerçek PostgreSQL (CI: PostgreSQL 17). Sentetik veri; geçici veritabanı. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const ADMIN=uid(1),SELLER=uid(2);
const n=async(db,sql,args=[])=>Number((await db.query(sql,args)).rows[0].n);

test('askı işareti eşzamanlılığı (gerçek PostgreSQL)',async t=>{
  if(!realPg()){t.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
  const {Client}=require('pg');
  const D=await migratedDb();let primary=null;
  const conn=async(user,{deadlockTimeout='1s'}={})=>{
    const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
      password:process.env.NAKGO_PG_PASSWORD,database:D.name,options:'-c TimeZone=UTC'});
    c.on('error',()=>{});await c.connect();
    // deadlock_timeout süper kullanıcı ayarıdır: rol değişmeden önce verilir. Hangi tarafın kurban olacağını belirler.
    await c.query(`set deadlock_timeout='${deadlockTimeout}'`);
    await c.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user]);
    await c.query('set role authenticated');
    return c;
  };
  try{
    for(const id of [ADMIN,SELLER])await D.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
    await D.exec('set session_replication_role=replica');
    for(const id of [ADMIN,SELLER])await D.query(`insert into public.profiles(id,display_name,account_type) values($1,'K','owner')`,[id]);
    await D.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[ADMIN]);
    await D.exec('reset session_replication_role');
    const seller=await conn(SELLER);
    const L=Number((await seller.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
      values('load','İstanbul','Ankara','Tır','Tenteli',20,'Palet','K','bugün') returning id`)).rows[0].id);
    await seller.end();
    const moderate=(c,action,rev)=>c.query(`select public.nakgo_admin_moderate('user',$1,$2,'Deneme',$3) r`,[SELLER,action,rev]).then(r=>r.rows[0].r,e=>({error:{code:e.code,message:e.message}}));

    await t.test('deadlock: askıya alma PT409 döner, hiçbir parçası kalmaz; sahibin yazması tamamlanır; tekrar deneme başarılı',async()=>{
      const audit=await n(D,`select count(*) n from private.admin_audit`);
      const before=(await D.query(`select updated_at,revision from public.listings where id=$1`,[L])).rows[0];
      // Sahip satırı kilitler (danışmalı kilit henüz alınmadı). Yönetici satırı beklerken (deadlock_timeout 1 sn) sahip de
      // danışmalı kilidi beklemeye başlar; denetimi ilk yapan yönetici döngüyü bulur ve kurban olur (sahibinki 10 sn).
      // lock_timeout (5 sn) dolmadan dönmesi, yanıtın kilit zaman aşımından değil deadlock'tan geldiğini gösterir.
      const owner=await conn(SELLER,{deadlockTimeout:'10s'}),admin=await conn(ADMIN,{deadlockTimeout:'1s'});
      try{
        await owner.query('begin');
        await owner.query(`select id from public.listings where id=$1 for update`,[L]);
        const started=Date.now();
        const adminCall=moderate(admin,'suspend',0);// eşitleme satır kilidini bekler
        await new Promise(r=>setTimeout(r,300));
        const ownerWrite=owner.query(`update public.listings set note='Eşzamanlı' where id=$1`,[L]).then(()=>null,e=>e);// danışmalı kilidi bekler → deadlock
        const r=await adminCall;const waited=Date.now()-started;
        assert.ok(waited<4000,'deadlock olarak çözüldü, kilit zaman aşımı değil: '+waited+' ms');
        assert.deepEqual(r.error,{code:'PT409',message:'Moderation busy; refresh'},JSON.stringify(r));
        assert.equal(await ownerWrite,null,'sahibin yazması deadlock kurbanı değil');
        await owner.query('commit');
      }finally{await owner.end();await admin.end();}
      // Yarım kalan hiçbir şey yok: askı, işaret, denetim kaydı.
      assert.equal(await n(D,`select count(*) n from private.account_moderation where user_id=$1 and suspended`,[SELLER]),0);
      assert.equal(await n(D,`select count(*) n from public.listings where owner_id=$1 and owner_suspended`,[SELLER]),0);
      assert.equal(await n(D,`select count(*) n from private.admin_audit`),audit,'denetim kaydı yazılmadı');
      const after=(await D.query(`select note,updated_at,revision from public.listings where id=$1`,[L])).rows[0];
      assert.equal(after.note,'Eşzamanlı');assert.equal(Number(after.revision),Number(before.revision)+1,'sahibin yazması normal işlendi');
      // Tekrar deneme: başarılı, işaret açılır; sahibin yazmasından sonra satır başka değişmez.
      const admin2=await conn(ADMIN);
      try{assert.deepEqual(await moderate(admin2,'suspend',0),{revision:1,changed:true});}finally{await admin2.end();}
      const s=(await D.query(`select owner_suspended,updated_at,revision from public.listings where id=$1`,[L])).rows[0];
      assert.equal(s.owner_suspended,true);assert.equal(Number(s.revision),Number(after.revision));assert.equal(s.updated_at.getTime(),after.updated_at.getTime());
    });

    await t.test('çekişmesiz: askı kaldırma yanıtı ve sonucu değişmez',async()=>{
      const admin=await conn(ADMIN);
      try{assert.deepEqual(await moderate(admin,'resume',1),{revision:2,changed:true});}finally{await admin.end();}
      assert.equal(await n(D,`select count(*) n from public.listings where owner_id=$1 and owner_suspended`,[SELLER]),0);
    });

    await t.test('yazma sürerken askı: yönetici bekler, sonra yeni ilan da işaretlenir',async()=>{
      const owner=await conn(SELLER),admin=await conn(ADMIN);
      let fresh;
      try{
        await owner.query('begin');
        fresh=Number((await owner.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
          values('load','İstanbul','İzmir','Tır','Tenteli',5,'Palet','K','bugün') returning id`)).rows[0].id);
        const adminCall=moderate(admin,'suspend',2);
        await new Promise(r=>setTimeout(r,300));
        await owner.query('commit');
        assert.deepEqual(await adminCall,{revision:3,changed:true});
      }finally{await owner.end();await admin.end();}
      assert.equal((await D.query(`select owner_suspended from public.listings where id=$1`,[fresh])).rows[0].owner_suspended,true);
      assert.equal(await n(D,`select count(*) n from public.listings l where l.owner_suspended is distinct from
        exists(select 1 from private.account_moderation a where a.user_id=l.owner_id and a.suspended)`),0,'işaret her ilanda gerçek durumla aynı');
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(D,primary);}
});

test('askı işareti: migration öncesi askıdaki sahiplerin ilanları işaretlenir (geriye dönük doldurma)',async()=>{
  const {openDb,build,migrations}=require('../../tools/db-lib.cjs');
  const FILE='20261119050000_suspended_owner_flag.sql';
  const all=migrations().map(m=>m.name);assert.ok(all.includes(FILE));
  const after=all.slice(all.indexOf(FILE));
  const db=await openDb();let primary=null;
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db,{list:migrations().filter(m=>!after.includes(m.name))});
    for(const id of [ADMIN,SELLER])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
    await db.exec('set session_replication_role=replica');
    const mk=async owner=>Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,updated_at)
      values('load','İstanbul','Ankara','Tır','Tenteli',1,'Yük','K','bugün',$1,now()-interval '3 days') returning id`,[owner])).rows[0].id);
    const s1=await mk(SELLER),s2=await mk(SELLER),a1=await mk(ADMIN);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[SELLER]);
    await db.exec('reset session_replication_role');
    const before=(await db.query(`select id,updated_at,revision from public.listings order by id`)).rows;
    for(const m of migrations().filter(m=>after.includes(m.name)))await db.exec(m.sql);
    const r=(await db.query(`select id,owner_suspended,updated_at,revision from public.listings order by id`)).rows;
    assert.deepEqual(r.map(x=>[Number(x.id),x.owner_suspended]),[[s1,true],[s2,true],[a1,false]]);
    assert.deepEqual(r.map(x=>[Number(x.id),x.updated_at.getTime?.()??x.updated_at,String(x.revision)]),before.map(x=>[Number(x.id),x.updated_at.getTime?.()??x.updated_at,String(x.revision)]),'doldurma updated_at ve revision değiştirmez');
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

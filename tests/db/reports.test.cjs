/** Şikâyet: v0 (nakgo_report_listing) ve v1 (api.report_create_v1) aynı iş kuralıyla; kimlik, ilan/hesap bağı, tekrar,
 * sınır, eşzamanlılık, gizlilik, yönetici incelemesi (revision + admin_audit) ve kayıtların korunması. Sentetik veri;
 * geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
async function as(db,{user=null,role='authenticated',claims=null}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.query(`select set_config('request.jwt.claims',$1,true)`,[claims?JSON.stringify(claims):'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message,detail:e.detail,hint:e.hint}};}
}
const v1call=async(db,user,args,opts={})=>{
  const r=await as(db,{user,...opts},`select api.report_create_v1($1,$2,$3,$4) r`,args);
  return r.error?{error:r.error}:r.rows[0].r;
};
const v0call=async(db,user,args,opts={})=>{
  const r=await as(db,{user,...opts},`select public.nakgo_report_listing($1,$2,$3,$4) r`,args);
  return r.error?{error:r.error}:r.rows[0].r;
};
const adminList=async(db,user,status='',offset=0)=>{const r=await as(db,{user},`select public.nakgo_admin_reports($1,$2) r`,[status,offset]);return r.error?{error:r.error}:r.rows[0].r;};
const adminSet=async(db,user,args)=>{const r=await as(db,{user},`select public.nakgo_admin_report_set($1,$2,$3,$4) r`,args);return r.error?{error:r.error}:r.rows[0].r;};
const count=async(db,sql,args=[])=>Number((await db.query(sql,args)).rows[0].n);
const reports=(db,user)=>count(db,`select count(*) n from private.listing_reports where reporter_id=$1`,[user]);
const PHONE='+905321234567';
const load=(o={})=>({kind:'load',from_city:'İstanbul',to_city:'Ankara',vehicle:'Tır',body:'Tenteli',amount:20,amount_unit:'ton',cargo:'Palet',note:'Not',
  loading_text:'bugün',items:[],contact_phone:PHONE,contact_consent:true,...o});

test('Şikâyet API',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const R=uid(1),R2=uid(2),OWNER=uid(3),SUS=uid(4),UNV=uid(5),ADMIN=uid(6),OTHER=uid(7),MANY=uid(8),OWNER2=uid(9);
    for(const id of [R,R2,OWNER,SUS,UNV,ADMIN,OTHER,MANY,OWNER2])
      await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)`,[id,id.slice(-4)+'@test.invalid',id===UNV?null:new Date().toISOString()]);
    await db.exec('set session_replication_role=replica');
    for(const id of [R,R2,OWNER,SUS,ADMIN,OTHER,MANY,OWNER2])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,$2,'owner')`,[id,'K'+id.slice(-2)]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[SUS]);
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[ADMIN]);
    await db.exec('reset session_replication_role');
    const create=async(owner,o={})=>{const r=await as(db,{user:owner},`select api.listing_create_v1($1,$2) r`,[crypto.randomUUID(),JSON.stringify(load(o))]);assert.ok(!r.error,JSON.stringify(r.error));return r.rows[0].r.data.listing.id;};
    const L1=await create(OWNER),L2=await create(OWNER,{to_city:'İzmir'}),L3=await create(OWNER2),MINE=await create(R);
    const listings=[];for(let i=0;i<8;i++)listings.push(await create(OWNER2,{to_city:['Bursa','Konya','Adana','Mersin','Kayseri','Samsun','Van','Muş'][i]}));

    await t.test('oluşturma: v1 ve v0 aynı kayıt; şikâyet eden ve ilan sahibi sunucuda; yanıtta not ve hesap kimliği yok',async()=>{
      const a=await v1call(db,R,[L1,'listing','fraud','  Kapora\nistedi  ']);
      assert.ok(a.data,JSON.stringify(a));assert.equal(a.data.created,true);
      assert.deepEqual(Object.keys(a.data).sort(),[...v1.functions.report_create_v1.data].sort());
      assert.deepEqual(Object.keys(a.data.report).sort(),[...v1.functions.report_create_v1.report].sort());
      assert.equal(a.data.report.status,'open');assert.equal(a.data.report.listing_id,L1);
      const row=(await db.query(`select * from private.listing_reports where id=$1`,[a.data.report.id])).rows[0];
      assert.equal(row.reporter_id,R);assert.equal(row.account_id,OWNER);assert.equal(row.note,'Kapora istedi','kırpılır, kontrol karakteri boşluk olur');
      const b=await v0call(db,R2,[L1,'listing','fraud','Kapora istedi']);
      assert.ok(b.report&&b.created===true,JSON.stringify(b));
      const r2=(await db.query(`select * from private.listing_reports where id=$1`,[b.report.id])).rows[0];
      for(const c of ['subject','listing_id','account_id','reason','note','status'])assert.deepEqual(r2[c],row[c],c);
      assert.deepEqual(Object.keys(b).sort(),['created','report']);
      assert.ok(!JSON.stringify(a).includes(OWNER)&&!JSON.stringify(a).includes('Kapora'),'yanıt hesap kimliği ve not taşımaz');
    });

    await t.test('geçersiz girdi: invalid_argument / 22023; kayıt yazılmaz; hata girdiyi içermez',async()=>{
      const before=await reports(db,OTHER);
      for(const args of [[0,'listing','fraud',''],[null,'listing','fraud',''],[L1,'user','fraud',''],[L1,null,'fraud',''],[L1,'listing','Sahte ilan',''],
        [L1,'listing',null,''],[L1,'listing','fraud','ç'.repeat(201)],[9007199254740992,'listing','fraud','']]){
        const a=await v1call(db,OTHER,args);assert.equal(a.error&&a.error.key,'invalid_argument',JSON.stringify(args));
        assert.ok(!JSON.stringify(a.error).includes('ççç'));
        const b=await v0call(db,OTHER,args);assert.equal(b.error&&b.error.code,'22023',JSON.stringify(args));
      }
      const ok200=await v1call(db,OTHER,[L1,'listing','other','ç'.repeat(200)]);assert.equal(ok200.data.created,true,'200 karakter sınırda kabul');
      assert.equal(await reports(db,OTHER),before+1);
    });

    await t.test('bağ: olmayan, kapalı, süresi dolmuş, kaldırılmış, temizlenmiş ya da sahibi askıdaki ilan not_found; kendi ilanı not_allowed',async()=>{
      const gone=[];
      const closed=await create(OWNER,{to_city:'Rize'}),expired=await create(OWNER,{to_city:'Ordu'});
      await db.exec('set session_replication_role=replica');
      await db.query(`update public.listings set status='closed' where id=$1`,[closed]);gone.push(closed);
      await db.query(`update public.listings set expires_at=now()-interval '1 minute' where id=$1`,[expired]);gone.push(expired);
      const removed=(await db.query(`insert into public.listings(owner_id,owner_label,kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,expires_at) select owner_id,owner_label,kind,from_city,'Tokat',vehicle,body,amount,cargo,loading_text,expires_at from public.listings where id=$1 returning id`,[L1])).rows[0].id;await db.query(`insert into private.listing_moderation(listing_id,removed) values($1,true)`,[removed]);gone.push(removed);
      const redacted=(await db.query(`insert into public.listings(owner_id,owner_label,kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,expires_at) select owner_id,owner_label,kind,from_city,'Sinop',vehicle,body,amount,cargo,loading_text,expires_at from public.listings where id=$1 returning id`,[L1])).rows[0].id;await db.query(`update public.listings set redacted_at=now() where id=$1`,[redacted]);gone.push(redacted);
      await db.exec('reset session_replication_role');
      gone.push(999999);
      for(const id of gone)for(const subject of ['listing','account']){
        assert.equal(key(await v1call(db,OTHER,[id,subject,'fake',''])),'not_found',id+' '+subject);
        const b=await v0call(db,OTHER,[id,subject,'fake','']);assert.equal(b.error.code,'42501');assert.equal(b.error.key,'Listing unavailable');
      }
      // Sahibi askıya alınınca ilanı görünmez (v0 nakgo_public_listings kuralı) → şikâyet edilemez.
      const susListing=await create(OTHER,{to_city:'Kars'});
      await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true) on conflict(user_id) do update set suspended=true`,[OTHER]);
      assert.equal(key(await v1call(db,R,[susListing,'listing','fake',''])),'not_found');
      await db.query(`update private.account_moderation set suspended=false where user_id=$1`,[OTHER]);
      for(const subject of ['listing','account']){
        assert.equal(key(await v1call(db,R,[MINE,subject,'fake',''])),'not_allowed');
        const b=await v0call(db,R,[MINE,subject,'fake','']);assert.equal(b.error.key,'Own listing');
      }
      assert.equal(await count(db,`select count(*) n from private.listing_reports where listing_id=any($1)`,[[...gone,MINE,susListing]]),0);
    });

    await t.test('kimlik: misafir, anonim oturum, doğrulanmamış ve askıdaki hesap gönderemez',async()=>{
      const anon=await as(db,{role:'anon'},`select api.report_create_v1($1,'listing','fake','') r`,[L3]);assert.equal(anon.error.code,'42501');
      assert.match(anon.error.key,/permission denied/,'misafir uca hiç erişemez (yetki yok)');
      const anon0=await as(db,{role:'anon'},`select public.nakgo_report_listing($1,'listing','fake','') r`,[L3]);assert.equal(anon0.error.code,'42501');
      assert.equal(key(await v1call(db,R2,[L3,'listing','fake',''],{claims:{sub:R2,is_anonymous:true}})),'auth_required');
      assert.equal(key(await v1call(db,UNV,[L3,'listing','fake',''])),'account_unverified');
      assert.equal((await v0call(db,UNV,[L3,'listing','fake',''])).error.key,'Verified account required');
      assert.equal(key(await v1call(db,SUS,[L3,'listing','fake',''])),'account_suspended');
      assert.equal((await v0call(db,SUS,[L3,'listing','fake',''])).error.key,'Account suspended');
      assert.equal(await count(db,`select count(*) n from private.listing_reports where reporter_id=any($1)`,[[SUS,UNV]]),0);
    });

    await t.test('tekrar: aynı ilan ya da aynı hesap için açık şikâyet tekdir; karar sonrası yeniden şikâyet edilebilir',async()=>{
      const a=await v1call(db,R,[L1,'listing','fake','farklı sebep']);
      assert.equal(a.data.created,false);assert.equal(a.data.report.reason,'fraud','ilk kayıt döner, değişmez');
      const b=await v0call(db,R,[L1,'listing','fraud','']);assert.equal(b.created,false);assert.equal(b.report.id,a.data.report.id);
      const acc=await v1call(db,R,[L1,'account','fake','']);assert.equal(acc.data.created,true,'ilan ve hesap şikâyeti ayrı');
      const acc2=await v1call(db,R,[L2,'account','fraud','']);assert.equal(acc2.data.created,false,'aynı sahibin başka ilanı: aynı hesap şikâyeti');
      assert.equal(acc2.data.report.id,acc.data.report.id);
      const set=await adminSet(db,ADMIN,[a.data.report.id,'resolved','İncelendi ve kapatıldı',0]);assert.equal(set.changed,true);
      const again=await v1call(db,R,[L1,'listing','fake','']);assert.equal(again.data.created,true,'kapanan şikâyetten sonra yeni kayıt');
    });

    await t.test('sınır: kişi başına 10/saat ve 30/24 saat; tekrar ve başkasının kayıtları sayılmaz',async()=>{
      const all=[L1,L2,L3,...listings];
      for(let i=0;i<10;i++){const r=await v1call(db,MANY,[all[i],'listing','fake','']);assert.equal(r.data&&r.data.created,true,'kayıt '+i);}
      assert.equal(key(await v1call(db,MANY,[all[10],'listing','fake',''])),'limit_reached');
      assert.equal((await v0call(db,MANY,[all[10],'listing','fake',''])).error.code,'54000');
      assert.equal((await v1call(db,MANY,[all[0],'listing','fake',''])).data.created,false,'sınırda da tekrar aynı kaydı döner');
      assert.equal((await v1call(db,R2,[all[10],'listing','fake',''])).data.created,true,'başka kişi etkilenmez');
      // Saatlik pencere geçince günlük sınır: 1–24 saat önceki kayıtlar sayılır.
      await db.query(`update private.listing_reports set created_at=now()-interval '2 hours',status='rejected' where reporter_id=$1`,[MANY]);
      await db.exec('set session_replication_role=replica');
      for(let i=0;i<19;i++)await db.query(`insert into private.listing_reports(reporter_id,subject,listing_id,account_id,reason,status,created_at)
        values($1,'listing',$2,$3,'fake','rejected',now()-interval '3 hours')`,[MANY,L3,OWNER2]);
      await db.exec('reset session_replication_role');
      assert.equal((await v1call(db,MANY,[all[1],'listing','fake',''])).data.created,true,'29 → 30');
      assert.equal(key(await v1call(db,MANY,[all[2],'listing','fake',''])),'limit_reached','30/24 saat');
      await db.query(`update private.listing_reports set created_at=now()-interval '25 hours' where reporter_id=$1`,[MANY]);
      assert.equal((await v1call(db,MANY,[all[2],'listing','fake',''])).data.created,true,'24 saatten eskiler sayılmaz');
    });

    await t.test('gizlilik: tablo istemciye kapalı; sahip ve diğer kullanıcılar şikâyeti göremez; yönetici uçları yalnız yöneticiye',async()=>{
      for(const role of ['anon','authenticated']){
        const r=await as(db,{user:OWNER,role},`select count(*) from private.listing_reports`);assert.equal(r.error.code,'42501',role);
        const f=await as(db,{user:OWNER,role},`select private.report_create($1,$2,'listing','fake','')`,[OWNER,L3]);assert.equal(f.error.code,'42501',role+' çekirdek fonksiyon');
      }
      for(const u of [OWNER,R,UNV]){
        assert.equal((await adminList(db,u)).error.key,'Admin required');
        assert.equal((await adminSet(db,u,[1,'resolved','Kapatıldı',0])).error.key,'Admin required');
      }
      const anon=await as(db,{role:'anon'},`select public.nakgo_admin_reports('',0)`);assert.equal(anon.error.code,'42501');
      // İstemciye açık hiçbir v0/v1 uç şikâyet içeriği döndürmez.
      const p=await as(db,{user:OWNER},`select api.listing_v1($1) r`,[L1]);assert.ok(!JSON.stringify(p.rows).includes('Kapora'));
    });

    await t.test('yönetici: liste ve süzgeç; durum kararı revision ve gerekçeyle; admin_audit kaydı',async()=>{
      const list=await adminList(db,ADMIN,'open');
      assert.ok(Array.isArray(list)&&list.length>0&&list.every(x=>x.status==='open'));
      const one=list.find(x=>x.listing_id===L2&&x.subject==='account')||list.find(x=>x.subject==='account');
      assert.ok(one&&one.account_id===OWNER&&one.reporter_label&&one.account_label&&'note' in one&&'revision' in one);
      assert.ok((await adminList(db,ADMIN,'resolved')).every(x=>x.status==='resolved'));
      assert.equal((await adminList(db,ADMIN,'x')).error.code,'22023');
      assert.equal((await adminList(db,ADMIN,'',-1)).error.code,'22023');
      assert.ok((await adminList(db,ADMIN,'',0)).length<=21,'sayfa 20 + 1');
      assert.equal((await adminSet(db,ADMIN,[one.id,'reviewing','ab',one.revision])).error.code,'22023','gerekçe en az 3');
      assert.equal((await adminSet(db,ADMIN,[one.id,'done','İnceleniyor',one.revision])).error.code,'22023');
      assert.equal((await adminSet(db,ADMIN,[999999,'resolved','İnceleniyor',0])).error.code,'22023');
      const audit=await count(db,`select count(*) n from private.admin_audit`);
      const s=await adminSet(db,ADMIN,[one.id,'reviewing','İnceleniyor',one.revision]);assert.deepEqual(s,{revision:one.revision+1,changed:true});
      assert.equal((await adminSet(db,ADMIN,[one.id,'resolved','Eski sürüm',one.revision])).error.code,'PT409','eşzamanlı karar');
      assert.deepEqual(await adminSet(db,ADMIN,[one.id,'reviewing','Yine',one.revision+1]),{revision:one.revision+1,changed:false});
      const a=(await db.query(`select * from private.admin_audit order by id desc limit 1`)).rows[0];
      assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit+1);
      assert.deepEqual([a.actor_id,a.target,a.action,a.reason,Number(a.revision)],[ADMIN,'report:'+one.id,'report_reviewing','İnceleniyor',one.revision+1]);
      const r=(await db.query(`select * from private.listing_reports where id=$1`,[one.id])).rows[0];
      assert.equal(r.reviewed_by,ADMIN);assert.ok(r.reviewed_at);
      // İncelenen şikâyet hâlâ açık sayılır: aynı kişi yeniden gönderirse aynı kayıt döner.
      assert.equal((await v1call(db,R,[L2,'account','fake',''])).data.created,false);
    });

    await t.test('kayıt korunur: ilan silinince, şikâyet eden ya da ilan sahibi hesabı silinince şikâyet kalır',async()=>{
      const n=await count(db,`select count(*) n from private.listing_reports`);
      const tmp=await create(OWNER,{to_city:'Hatay'});const r=await v1call(db,R2,[tmp,'listing','fraud','Not']);
      await db.exec('set session_replication_role=replica');
      await db.query(`delete from public.listings where id=$1`,[tmp]);
      await db.exec('reset session_replication_role');
      const kept=(await db.query(`select * from private.listing_reports where id=$1`,[r.data.report.id])).rows[0];
      assert.ok(kept&&Number(kept.listing_id)===tmp&&kept.note==='Not','ilan silinse de kayıt ve ilan numarası kalır');
      const admin=(await adminList(db,ADMIN,'open')).find(x=>x.id===r.data.report.id);assert.equal(admin.kind,null,'yönetici listesi silinmiş ilanla da çalışır');
      await db.query(`delete from auth.users where id=$1`,[R2]);
      assert.equal(await count(db,`select count(*) n from private.listing_reports`),n+1,'hiçbir şikâyet silinmedi');
      assert.equal(await count(db,`select count(*) n from private.listing_reports where reporter_id is null and id=$1`,[r.data.report.id]),1,'silinen hesap kimliği boşaltılır');
    });

    await t.test('eşzamanlı aynı şikâyet tek kayıt (gerçek PostgreSQL)',async t2=>{
      if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
      const {Client}=require('pg');const env=process.env;
      const conns=await Promise.all(Array.from({length:6},async()=>{const c=new Client({host:env.NAKGO_PG_HOST,port:env.NAKGO_PG_PORT||5432,user:env.NAKGO_PG_USER||'postgres',password:env.NAKGO_PG_PASSWORD,database:db.name});await c.connect();return c;}));
      try{
        const res=await Promise.all(conns.map(async c=>{
          await c.query('begin');await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[OTHER]);await c.query('set local role authenticated');
          try{const r=(await c.query(`select api.report_create_v1($1,'listing','fake','') r`,[L3])).rows[0].r;await c.query('commit');return r.data.created;}
          catch(e){await c.query('rollback');return e.message;}
        }));
        assert.equal(res.filter(x=>x===true).length,1,JSON.stringify(res));assert.ok(res.every(x=>x===true||x===false),JSON.stringify(res));
        assert.equal(await count(db,`select count(*) n from private.listing_reports where reporter_id=$1 and listing_id=$2 and status='open'`,[OTHER,L3]),1);
      }finally{await Promise.all(conns.map(c=>c.end()));}
      // Sınır yarışı (belirlenimci): 9 kayıtlı kişi; A 10. kaydı açar ama işlemi bitirmez. B'nin 11. denemesi kişi
      // kilidinde bekler ve A bitince limit_reached alır. Kilit olmasa B beklemeden 11. kaydı açardı.
      const FRESH=uid(30);await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'f@test.invalid',now())`,[FRESH]);
      const targets=[L1,L2,L3,...listings];
      for(let i=0;i<9;i++)assert.equal((await v1call(db,FRESH,[targets[i],'listing','fake',''])).data.created,true);
      const [a,b]=await Promise.all([0,1].map(async()=>{const c=new Client({host:env.NAKGO_PG_HOST,port:env.NAKGO_PG_PORT||5432,user:env.NAKGO_PG_USER||'postgres',password:env.NAKGO_PG_PASSWORD,database:db.name});await c.connect();return c;}));
      try{
        for(const c of [a,b]){await c.query('begin');await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[FRESH]);await c.query('set local role authenticated');}
        assert.equal((await a.query(`select api.report_create_v1($1,'listing','fake','') r`,[targets[9]])).rows[0].r.data.created,true);
        let settled=false;
        const second=b.query(`select api.report_create_v1($1,'listing','fake','') r`,[targets[10]]).then(r=>r.rows[0].r.data.created,e=>e.message).finally(()=>{settled=true;});
        await new Promise(r=>setTimeout(r,400));
        assert.equal(settled,false,'ikinci istek kişi kilidinde bekler');
        await a.query('commit');
        assert.equal(await second,'limit_reached');await b.query('rollback');
      }finally{await Promise.all([a,b].map(c=>c.end()));}
    });
  }finally{await finish(db,primary);}
});
const key=r=>r.error&&r.error.key;

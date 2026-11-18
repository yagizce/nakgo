/** B2 telefon görüntüleme sınırı: geçici yerel veritabanında (PGlite ya da NAKGO_PG_HOST ile yerel PostgreSQL) migration'larla
 * kurulan şema üzerinde. Sentetik hesap ve ilanlar; hiçbir uzak sisteme bağlanmaz. Eşzamanlılık testleri birden çok
 * bağlantı ister ve yalnız gerçek PostgreSQL'de çalışır (CI'da PostgreSQL 17 sunucusu). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');

const PHONE='+905321234567';
const uid=()=>crypto.randomUUID();

async function setup(db){
  const owners=Array.from({length:14},uid);
  const readers={a:uid(),b:uid(),admin:uid(),unverified:uid()};
  for(const id of [...owners,...Object.values(readers)])
    await db.query(`insert into auth.users(id,email_confirmed_at) values($1,$2)`,[id,id===readers.unverified?null:new Date().toISOString()]);
  // Yükleme tetikleyicisiz yapılır (oturum denetimleri); ilanlar kotayı (10 aktif) aşmamak için 14 sahibe dağıtılır.
  await db.exec(`set session_replication_role=replica`);
  for(const id of [readers.admin,owners[0]])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,'Test','owner')`,[id]);
  await db.query(`insert into private.admin_members(user_id,active) values($1,true)`,[readers.admin]);
  const ids=(await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id)
    select 'load','İstanbul','Ankara','Tır','Tenteli',10,'Test','Test','bugün',$1,true,($2::uuid[])[1+(g%14)] from generate_series(1,140) g returning id`,[PHONE,owners])).rows.map(r=>Number(r.id)).sort((x,y)=>x-y);
  await db.exec(`reset session_replication_role`);
  return {owners,readers,ids};
}

/** Belirli hesap ve rol olarak tek sorgu; kimlik işlem sonunda temizlenir. */
async function as(db,user,sql,args=[],role='authenticated'){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.exec('set local role '+role);
    const r=await db.query(sql,args);
    await db.exec('commit');
    return r.rows;
  }catch(e){await db.exec('rollback');throw e;}
}
const contact=async(db,user,id,channel=null)=>(await as(db,user,`select public.nakgo_listing_contact($1,$2) n`,[id,channel]))[0].n;
const code=async p=>{try{await p;return 'ok';}catch(e){return e.code;}};
const views=async(db,user)=>Number((await db.query(`select count(*) n from private.contact_views where user_id=$1`,[user])).rows[0].n);
const events=async(db,user)=>(await db.query(`select kind from private.security_events where user_id=$1 order by id`,[user])).rows.map(r=>r.kind);

test('telefon görüntüleme sınırı (hesap başına, sunucu tarafında)',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const {owners,readers:R,ids}=await setup(db);
    const shift=(user,interval)=>db.query(`update private.contact_views set viewed_at=viewed_at-$2::interval where user_id=$1`,[user,interval]);

    await t.test('60 dakikada 30 farklı ilan; 31. ilan numara vermez ve güvenlik olayı yazılır',async()=>{
      for(let i=0;i<30;i++)assert.equal(await contact(db,R.a,ids[i]),PHONE,'görüntüleme '+(i+1));
      assert.equal(await views(db,R.a),30);
      assert.equal(await contact(db,R.a,ids[30]),null,'31. engellenir');
      assert.equal(await views(db,R.a),30,'engellenen sayılmaz');
      assert.deepEqual(await events(db,R.a),['contact_limit_hour']);
      assert.equal(await contact(db,R.a,ids[31],'call'),null);
      assert.deepEqual(await events(db,R.a),['contact_limit_hour'],'aynı saatte tek olay (tablo şişirilemez)');
      assert.equal(Number((await db.query(`select count(*) n from private.security_events where hour<>date_trunc('hour',at,'UTC')`)).rows[0].n),0,'olay saat dilimine bağlı');
      await shift(R.a,'59 minutes');
      assert.equal(await contact(db,R.a,ids[30]),null,'59 dakika önceki görüntülemeler hâlâ saat penceresinde');
      await shift(R.a,'-59 minutes');
    });
    await t.test('aynı ilanı yeniden görmek sayılmaz ve sınırda da numara verir',async()=>{
      assert.equal(await contact(db,R.a,ids[0],'whatsapp'),PHONE);
      assert.equal(await contact(db,R.a,ids[0]),PHONE);
      assert.equal(await views(db,R.a),30);
    });
    await t.test('hesaplar bağımsız: başka hesabın sayacı etkilenmez',async()=>{
      assert.equal(await contact(db,R.b,ids[0]),PHONE);
      assert.equal(await views(db,R.b),1);assert.deepEqual(await events(db,R.b),[]);
    });
    await t.test('60 dakika dolunca yeni 30; 24 saatte 100; 101. engellenir',async()=>{
      let next=30;
      for(let round=0;round<3;round++){
        await shift(R.a,'61 minutes');
        for(let i=0;i<(round<2?30:10);i++)assert.equal(await contact(db,R.a,ids[next++]),PHONE,'görüntüleme '+next);
      }
      assert.equal(await views(db,R.a),100);
      await shift(R.a,'61 minutes');
      assert.equal(await contact(db,R.a,ids[next]),null,'101. engellenir (saat penceresi boşken)');
      await shift(R.a,'12 hours');
      assert.equal(await contact(db,R.a,ids[next]),null,'13–17 saat önceki görüntülemeler hâlâ gün penceresinde');
      assert.ok((await events(db,R.a)).includes('contact_limit_day'));
      assert.equal(await contact(db,R.a,ids[5]),PHONE,'daha önce görülen ilan yine verilir');
    });
    await t.test('24 saat dolunca yeniden görüntülenebilir',async()=>{
      await shift(R.a,'11 hours');// hepsi artık 24 saatten eski
      assert.equal(await contact(db,R.a,ids[101]),PHONE);
    });
    await t.test('yalnız başarılı görüntüleme sayılır; kendi ilanı ve uygun olmayan ilan sayılmaz',async()=>{
      const own=(await db.query(`select id from public.listings where owner_id=$1 limit 1`,[owners[3]])).rows[0].id;
      assert.equal(await contact(db,owners[3],own),PHONE);assert.equal(await views(db,owners[3]),0,'kendi ilanı sayılmaz');
      await db.exec(`set session_replication_role=replica`);
      await db.query(`update public.listings set status='closed' where id=$1`,[ids[120]]);
      await db.exec(`reset session_replication_role`);
      assert.equal(await code(contact(db,R.b,ids[120])),'42501');
      assert.equal(await views(db,R.b),1,'hata veren istek kayıt bırakmaz');
    });
    await t.test('yetkisiz erişim: misafir, doğrulanmamış hesap; kayıtlar ve temizlik fonksiyonu istemciye kapalı',async()=>{
      assert.equal(await code(as(db,null,`select public.nakgo_listing_contact($1)`,[ids[0]],'anon')),'42501');
      assert.equal(await code(contact(db,R.unverified,ids[0])),'42501');
      for(const sql of [`select * from private.contact_views`,`select * from private.security_events`,`select private.contact_retention()`,
        `insert into private.security_events(user_id,kind,hour) values(gen_random_uuid(),'contact_limit_hour',now())`,`delete from private.contact_views`])
        for(const role of ['authenticated','anon'])assert.equal(await code(as(db,R.b,sql,[],role)),'42501',role+': '+sql);
    });
    await t.test('güvenlik olayı: telefon, ilan ve IP içermez; değiştirilemez, 1 yıl dolmadan silinemez',async()=>{
      const row=(await db.query(`select to_jsonb(e) j from private.security_events e where user_id=$1 limit 1`,[R.a])).rows[0].j;
      assert.deepEqual(Object.keys(row).sort(),['at','hour','id','kind','user_id']);
      assert.ok(!JSON.stringify(row).includes('5321234567'));
      assert.equal(await code(db.query(`update private.security_events set kind='contact_limit_day' where user_id=$1`,[R.a])),'42501');
      const ancient=uid();
      await db.query(`insert into private.security_events(at,user_id,kind,hour) values(now()-interval '2 years',$1,'contact_limit_hour',now()-interval '2 years')`,[ancient]);
      assert.equal(await code(db.query(`update private.security_events set kind='contact_limit_day' where user_id=$1`,[ancient])),'42501','süresi dolmuş kayıt da değiştirilemez');
      assert.equal(await code(db.query(`delete from private.security_events where user_id=$1`,[R.a])),'42501');
      assert.equal(await code(db.query(`truncate private.security_events`)),'42501');
      const cols=(await db.query(`select string_agg(column_name,',' order by column_name) c from information_schema.columns where table_schema='private' and table_name in('contact_views','security_events')`)).rows[0].c;
      assert.ok(!/ip|phone/.test(cols),cols);
    });
    await t.test('saklama: görüntüleme 25 saat, güvenlik olayı 1 yıl',async()=>{
      const old=uid(),fresh=uid();
      await db.query(`insert into private.security_events(at,user_id,kind,hour) values(now()-interval '1 year 1 day',$1,'contact_limit_hour',now()-interval '1 year 1 day'),
        (now()-interval '364 days',$2,'contact_limit_hour',now()-interval '364 days')`,[old,fresh]);
      await db.query(`insert into private.contact_views values($1,$2,now()-interval '26 hours'),($1,$3,now()-interval '24 hours')`,[R.b,ids[130],ids[131]]);
      const r=(await db.query(`select private.contact_retention() r`)).rows[0].r;
      assert.ok(r.contact_views_deleted>=1&&r.security_events_deleted>=1,JSON.stringify(r));
      assert.equal(Number((await db.query(`select count(*) n from private.security_events where at<now()-interval '1 year'`)).rows[0].n),0,'1 yıldan eski olay kalmaz');
      assert.deepEqual(await events(db,old),[]);assert.deepEqual(await events(db,fresh),['contact_limit_hour']);
      assert.equal(Number((await db.query(`select count(*) n from private.contact_views where viewed_at<now()-interval '25 hours'`)).rows[0].n),0);
      assert.equal(Number((await db.query(`select count(*) n from private.contact_views where user_id=$1 and listing_id=$2`,[R.b,ids[131]])).rows[0].n),1,'24 saatlik kayıt kalır');
    });
    await t.test('yönetici olayları görür; normal üye göremez; filtre doğrulanır',async()=>{
      const page=(user,f='')=>as(db,user,`select public.nakgo_admin_page('security',0,'',$1) d`,[f]);
      const d=(await page(R.admin))[0].d;
      assert.ok(d.length>=2&&d.every(e=>['id','at','kind','user_id','display_name'].every(k=>k in e)));
      assert.ok(!JSON.stringify(d).includes('5321234567'));
      assert.ok((await page(R.admin,'contact_limit_day'))[0].d.every(e=>e.kind==='contact_limit_day'));
      assert.equal(await code(page(R.admin,'x')),'22023');
      assert.equal(await code(page(R.b)),'42501');
      assert.equal(await code(as(db,null,`select public.nakgo_admin_page('security')`,[],'anon')),'42501');
    });
    await t.test('hesap silinince görüntüleme kayıtları silinir',async()=>{
      await db.query(`delete from auth.users where id=$1`,[R.b]);
      assert.equal(await views(db,R.b),0);
    });

    await t.test('eşzamanlılık: paralel isteklerle sınır aşılamaz; aynı ilan tek kayıt (gerçek PostgreSQL)',async t2=>{
      if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
      const {Client}=require('pg');
      const conn=async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
        password:process.env.NAKGO_PG_PASSWORD,database:db.name,options:'-c TimeZone=UTC'});await c.connect();return {query:(s,a)=>c.query(s,a),exec:s=>c.query(s),end:()=>c.end()};};
      const c=uid();await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[c]);
      for(let i=0;i<29;i++)assert.equal(await contact(db,c,ids[i]),PHONE);
      const clients=await Promise.all(Array.from({length:12},conn));
      try{
        const got=await Promise.all(clients.map((cl,i)=>contact(cl,c,ids[40+i])));
        assert.equal(got.filter(x=>x===PHONE).length,1,'29 + paralel 12 → yalnız 1 başarılı: '+JSON.stringify(got));
        assert.equal(await views(db,c),30);
        const same=await Promise.all(clients.map(cl=>contact(cl,c,ids[0])));
        assert.ok(same.every(x=>x===PHONE));assert.equal(await views(db,c),30,'aynı ilan paralel: kayıt sayısı değişmez');
        assert.deepEqual(await events(db,c),['contact_limit_hour'],'paralel aşımlar tek olay');
        const d=uid();await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[d]);
        const par=await Promise.all(clients.map(cl=>contact(cl,d,ids[60])));
        assert.ok(par.every(x=>x===PHONE));assert.equal(await views(db,d),1,'aynı ilan paralel ilk görüntüleme: tek kayıt');
      }finally{await Promise.all(clients.map(cl=>cl.end()));}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

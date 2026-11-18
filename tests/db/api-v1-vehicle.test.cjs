/** B10: araç verileri (araç tipi, kasa tipi, tonaj). Katalog = tablo kısıtları = istemci listeleri; v1 girdisinde birim ve tür
 * zorunluluğu; v0 ile aynı değer kuralları; yetkisiz değişiklik; revision; eski veri; akış filtreleri; veri sızıntısı.
 * Sentetik veri; geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
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
const call=async(db,user,fn,args=[],role='authenticated')=>{
  const r=await as(db,{user,role},`select api.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args.map(a=>a!==null&&typeof a==='object'?JSON.stringify(a):a));
  return r.error?{error:r.error}:r.rows[0].r;
};
const key=r=>r.error&&r.error.key;
const today=()=>new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const truck=(o={})=>({kind:'truck',from_city:'İzmir',to_city:'Bursa',vehicle:'Kamyon',body:'Tenteli',amount:12,amount_unit:'ton',available_on:today(),...o});
const clientList=name=>{const src=fs.readFileSync(path.join(__dirname,'../../src/js/config.js'),'utf8');
  return JSON.parse(new RegExp('const '+name+' = (\\[[^\\]]*\\]);').exec(src)[1]);};
const constraintList=async(db,name)=>{const def=(await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname=$1`,[name])).rows[0].d;
  return [...def.matchAll(/'([^']+)'::text/g)].map(m=>m[1]);};

test('API v1 araç verileri (B10)',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const A=uid(1),B=uid(2),S=uid(3);
    for(const id of [A,B,S])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
    await db.exec('set session_replication_role=replica');
    await db.query(`insert into public.profiles(id,display_name) values($1,'Ayşe'),($2,'Barış'),($3,'Selin')`,[A,B,S]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[S]);
    await db.exec('reset session_replication_role');
    const catalog=(await call(db,null,'listing_catalog_v1',[],'anon')).data;

    await t.test('katalog tek kaynak: tablo kısıtları, istemci listeleri ve tonaj sınırlarıyla birebir aynı',async()=>{
      assert.deepEqual(catalog.vehicles,await constraintList(db,'listings_vehicle_check'));
      assert.deepEqual(catalog.bodies,await constraintList(db,'listings_body_check'));
      assert.deepEqual(catalog.vehicles,clientList('vehicles'),'istemci araç listesi');
      assert.deepEqual(catalog.bodies,clientList('bodies'),'istemci kasa listesi');
      const amountDef=(await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='listings_amount_check'`)).rows[0].d;
      assert.match(amountDef,/amount > \(0\)::numeric/);assert.match(amountDef,new RegExp(String(catalog.amount.max)));
      assert.deepEqual(catalog.amount,{unit:'ton',min_exclusive:0,max:9007199254740991});
      assert.deepEqual(await call(db,A,'listing_catalog_v1'),{data:catalog},'üye de aynı kataloğu alır');
      assert.equal((await db.query(`select col_description('public.listings'::regclass,(select attnum from pg_attribute where attrelid='public.listings'::regclass and attname='amount')) d`)).rows[0].d.startsWith('Ton.'),true,'birim tabloda belgeli');
    });
    await t.test('bütün araç × kasa birleşimleri v1 ile kabul; v0 ile aynı kural',async()=>{
      // Kota (10 etkin ilan) nedeniyle her birleşim oluşturulup kapatılır.
      for(const vehicle of catalog.vehicles)for(const body of catalog.bodies){
        const r=await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({vehicle,body})]);
        assert.ok(r.data,vehicle+'/'+body+' '+JSON.stringify(r.error));
        assert.equal(r.data.listing.vehicle,vehicle);assert.equal(r.data.listing.body,body);
        await call(db,A,'listing_close_v1',[r.data.listing.id]);
      }
    });
    await t.test('geçersiz araç ve kasa: v1 invalid_argument, v0 de reddeder; hiçbir satır yazılmaz',async()=>{
      const before=Number((await db.query(`select count(*) n from public.listings`)).rows[0].n);
      for(const bad of ['TIR','tır',' Tır','Tır ','','Uçak','Kamyon;drop',null]){
        assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({vehicle:bad})])),'invalid_argument','araç '+bad);
        assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({body:bad})])),'invalid_argument','kasa '+bad);
        assert.ok((await as(db,{user:A},`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on) values('truck','İzmir','Bursa',$1,'Tenteli',1,'A',$2)`,[bad,today()])).error,'v0 araç '+bad);
      }
      for(const bad of [5,true,['Tır'],{v:'Tır'}]){
        assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({vehicle:bad})])),'invalid_argument','araç türü '+JSON.stringify(bad));
        assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({body:bad})])),'invalid_argument','kasa türü '+JSON.stringify(bad));
      }
      assert.equal(Number((await db.query(`select count(*) n from public.listings`)).rows[0].n),before);
    });
    await t.test('tonaj: sınırlar ve birim zorunlu; birimsiz, yanlış birimli ya da metin tonaj reddedilir',async()=>{
      for(const amount of [0.001,1,40,9007199254740991]){
        const r=await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck({amount})]);
        assert.ok(r.data,String(amount));assert.equal(Number(r.data.listing.amount),amount);
        await call(db,A,'listing_close_v1',[r.data.listing.id]);
      }
      const bad=[{amount:0},{amount:-1},{amount:9007199254740992},{amount:'12'},{amount:'12 ton'},{amount:null},{amount_unit:undefined},{amount_unit:'kg'},
        {amount_unit:'TON'},{amount_unit:'m³'},{amount_unit:1},{amount_unit:null},{amount_unit:['ton']}];
      for(const o of bad){const p=truck(o);for(const k of Object.keys(o))if(o[k]===undefined)delete p[k];
        assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),p])),'invalid_argument',JSON.stringify(o));}
      const {amount,...noAmount}=truck();
      assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),noAmount])),'invalid_argument','tonaj yokken birim tek başına');
      const {amount_unit,...noUnit}=truck();
      assert.equal(key(await call(db,A,'listing_create_v1',[crypto.randomUUID(),noUnit])),'invalid_argument','birimsiz tonaj');
      // Güncellemede de aynı.
      const l=(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck()])).data.listing;
      for(const ch of [{amount:5},{amount:5,amount_unit:'kg'},{note:'x',amount_unit:'ton'},{amount:'5',amount_unit:'ton'},{amount_unit:'ton'},{amount:0,amount_unit:'ton'},{vehicle:'TIR'},{body:3}])
        assert.equal(key(await call(db,A,'listing_update_v1',[l.id,0,ch])),'invalid_argument',JSON.stringify(ch));
      assert.equal(Number((await db.query(`select amount from public.listings where id=$1`,[l.id])).rows[0].amount),12,'değişmedi');
      const ok=await call(db,A,'listing_update_v1',[l.id,0,{amount:7.5,amount_unit:'ton',vehicle:'Tır',body:'Frigorifik'}]);
      assert.deepEqual([Number(ok.data.listing.amount),ok.data.listing.vehicle,ok.data.listing.body,ok.data.listing.revision],[7.5,'Tır','Frigorifik',1]);
      assert.ok((await call(db,A,'listing_update_v1',[l.id,1,{vehicle:'Kamyonet'}])).data,'tonaj olmadan araç değişikliği birim istemez');
      await db.query(`update private.api_requests set created_at=created_at`);
      await call(db,A,'listing_close_v1',[l.id]);
    });
    await t.test('yetkisiz değişiklik: başka hesap, askıdaki hesap, misafir; v0 RLS de engeller',async()=>{
      const l=(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck()])).data.listing;
      assert.equal(key(await call(db,B,'listing_update_v1',[l.id,0,{vehicle:'Tır'}])),'not_found');
      assert.equal(key(await call(db,S,'listing_update_v1',[l.id,0,{vehicle:'Tır'}])),'account_suspended');
      assert.equal((await as(db,{role:'anon'},`select api.listing_update_v1($1,0,'{"vehicle":"Tır"}')`,[l.id])).error.code,'42501');
      assert.equal((await as(db,{user:B},`update public.listings set vehicle='Tır' where id=$1 returning id`,[l.id])).rows.length,0,'v0 RLS');
      assert.equal((await db.query(`select vehicle,revision from public.listings where id=$1`,[l.id])).rows[0].vehicle,'Kamyon');
      await call(db,A,'listing_close_v1',[l.id]);
    });
    await t.test('revision: aynı sürümden araç ve tonaj değişikliği; ikincisi conflict, ilki korunur',async()=>{
      const l=(await call(db,A,'listing_create_v1',[crypto.randomUUID(),truck()])).data.listing;
      assert.ok((await call(db,A,'listing_update_v1',[l.id,0,{vehicle:'Tır'}])).data);
      assert.equal(key(await call(db,A,'listing_update_v1',[l.id,0,{amount:30,amount_unit:'ton'}])),'conflict');
      const row=(await db.query(`select vehicle,amount,revision from public.listings where id=$1`,[l.id])).rows[0];
      assert.deepEqual([row.vehicle,Number(row.amount),Number(row.revision)],['Tır',12,1]);
      if(realPg()){
        const {Client}=require('pg');const cs=[];
        try{
          for(let i=0;i<2;i++){const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:db.name});c.on('error',()=>{});await c.connect();cs.push(c);}
          const go=async(c,ch,hold)=>{await c.query('begin');try{await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[A]);await c.query('set local role authenticated');
            await c.query(`select api.listing_update_v1($1,1,$2)`,[l.id,JSON.stringify(ch)]);if(hold)await c.query('select pg_sleep(0.3)');await c.query('commit');return 'ok';}catch(e){await c.query('rollback');return e.message;}};
          const res=await Promise.all([go(cs[0],{body:'Frigorifik'},true),new Promise(r=>setTimeout(r,100)).then(()=>go(cs[1],{amount:40,amount_unit:'ton'},false))]);
          assert.deepEqual(res,['ok','conflict']);
          const r2=(await db.query(`select body,amount from public.listings where id=$1`,[l.id])).rows[0];
          assert.deepEqual([r2.body,Number(r2.amount)],['Frigorifik',12]);
        }finally{for(const c of cs)await c.end();}
      }
      await call(db,A,'listing_close_v1',[l.id]);
    });
    await t.test('eski veri: v0 ile açılmış ve bugüne kadar hiç güncellenmemiş ilan, serbest metinli eski rota alarmı',async()=>{
      await db.exec('set session_replication_role=replica');
      const old=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,created_at) values('truck','Konya','Sivas','Tır','Lowbed',25.75,'Ayşe',$2,$1,now()-interval '1 hour') returning id`,[A,today()])).rows[0].id);
      const oldAlert=Number((await db.query(`insert into public.route_alerts(user_id,kind,from_city,vehicle,body) values($1,'truck','Konya','TIR','lowbed') returning id`,[A])).rows[0].id);
      await db.exec('reset session_replication_role');
      const l=(await call(db,A,'listing_v1',[old])).data;
      assert.deepEqual([l.vehicle,l.body,Number(l.amount),l.revision],['Tır','Lowbed',25.75,0]);
      assert.ok((await call(db,A,'listing_update_v1',[old,0,{note:'güncel'}])).data,'araç alanına dokunmayan düzenleme birim istemez');
      assert.ok((await call(db,A,'listing_close_v1',[old])).data.changed);
      const alerts=(await call(db,A,'route_alerts_v1')).data;
      assert.ok(alerts.some(a=>a.id===oldAlert&&a.vehicle==='TIR'),'eski alarm okunur');
      assert.equal((await call(db,A,'route_alert_update_v1',[oldAlert,false])).data.alert.active,false,'eski alarm kapatılır');
      assert.equal((await call(db,A,'route_alert_delete_v1',[oldAlert])).data.removed,true,'eski alarm silinir');
      assert.ok(!(await as(db,{user:A},`select public.nakgo_save_route_alert('truck','Konya',null,'TIR',null)`)).error,'v0 serbest metni değişmedi');
      await db.query(`delete from public.route_alerts where user_id=$1`,[A]);
    });
    await t.test('rota alarmı v1: araç/kasa yalnız katalogdan',async()=>{
      assert.equal(key(await call(db,A,'route_alert_create_v1',['truck','Konya',null,'TIR',null])),'invalid_argument');
      assert.equal(key(await call(db,A,'route_alert_create_v1',['truck','Konya',null,null,'lowbed'])),'invalid_argument');
      assert.equal((await call(db,A,'route_alert_create_v1',['truck','Konya',null,' Tır ','Lowbed'])).data.alert.vehicle,'Tır');
      assert.ok((await call(db,A,'route_alert_create_v1',['load','Konya',null,null,null])).data,'araç/kasa isteğe bağlı');
      await db.query(`delete from public.route_alerts where user_id=$1`,[A]);
    });
    await t.test('akış filtreleri: araç, kasa, tonaj aralığı; sonuç SQL ile aynı; sayfalama; geçersiz değer; eski çağrı',async()=>{
      await db.query(`delete from public.listings`);
      await db.exec('set session_replication_role=replica');
      const owners=[uid(30),uid(31),uid(32),uid(33),uid(34),uid(35),uid(36),uid(37),uid(38),uid(39),uid(40),uid(41)];
      for(const o of owners)await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[o]);
      let n=0;
      for(const vehicle of ['Tır','Kamyon','Kamyonet'])for(const body of ['Tenteli','Frigorifik'])for(const amount of [1,10,24.5,40,90]){
        for(let k=0;k<4;k++)await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on,owner_id,contact_phone,contact_consent,cargo) values($1,'İzmir','Bursa',$2,$3,$4,'X',$5,$6,'+905321234567',true,case when $1='load' then 'Yük' else '' end)`,
          [k%2?'truck':'load',vehicle,body,amount,today(),owners[n++%owners.length]]);
      }
      await db.exec('reset session_replication_role');
      const all=async(args)=>{const out=[];let c=null;for(let i=0;i<20;i++){const r=await call(db,A,'listings_v1',[c,...args]);if(r.error)return r;out.push(...r.data);c=r.data.length?r.page.next:null;if(!c)break;}return out;};
      for(const [kind,vehicle,body,min,max] of [[null,'Tır',null,null,null],[null,null,'Frigorifik',null,null],[null,null,null,10,40],['truck','Kamyon','Tenteli',24.5,null],[null,'Kamyonet','Frigorifik',null,9.99],['load',null,null,90,90]]){
        const got=await all([kind,vehicle,body,min,max]);
        const want=(await db.query(`select id from public.listings where ($1::text is null or kind=$1) and ($2::text is null or vehicle=$2) and ($3::text is null or body=$3) and ($4::numeric is null or amount>=$4) and ($5::numeric is null or amount<=$5) order by id desc`,[kind,vehicle,body,min,max])).rows.map(r=>Number(r.id));
        assert.deepEqual(got.map(x=>x.id),want,JSON.stringify([kind,vehicle,body,min,max]));
        assert.ok(got.every(x=>(!vehicle||x.vehicle===vehicle)&&(!body||x.body===body)));
      }
      assert.equal((await all([null,null,null,null,null])).length,120,'filtresiz: hepsi (sayfalı)');
      for(const args of [[null,'TIR'],[null,null,'tenteli'],[null,null,null,0],[null,null,null,-1],[null,null,null,null,0],[null,null,null,50,10],[null,null,null,9007199254740992]])
        assert.equal(key(await call(db,A,'listings_v1',[null,...args])),'invalid_argument',JSON.stringify(args));
      // Eski çağrılar (yalnız imleç/tür) aynen çalışır; misafir de filtreler.
      assert.equal((await as(db,{user:A},`select api.listings_v1() r`)).rows[0].r.data.length,50);
      assert.equal((await as(db,{user:A},`select api.listings_v1(p_kind=>'truck') r`)).rows[0].r.data.length,50);
      const g=(await as(db,{role:'anon'},`select api.listings_v1(p_vehicle=>'Tır',p_min_amount=>40) r`)).rows[0].r.data;
      assert.ok(g.length>0&&g.every(x=>x.vehicle==='Tır'&&Number(x.amount)>=40));
      const text=JSON.stringify(g);
      assert.ok(!/5321234567|owner_id|owner_label|"note"|contact_allowed|revision/.test(text),'misafir yanıtında kişisel/üye alanı yok');
      assert.equal(Number((await db.query(`select count(*) n from pg_proc where proname='listings_v1' and pronamespace='api'::regnamespace`)).rows[0].n),1,'tek tanım');
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

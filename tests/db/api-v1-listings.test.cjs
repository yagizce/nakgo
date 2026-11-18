/** B3-b1: API v1 ilan okuma uçları (listings_v1, listing_v1, my_listings_v1). Her uç v0 ile karşılaştırılır:
 *  - misafir akışı ↔ nakgo_public_listings (birebir),
 *  - üye akışı ↔ v0 üye sorgusu (listings tablosu, authenticated rolü ve RLS altında),
 *  - kendi ilanlarım ↔ v0 sahip sorgusu, ayrıntı ↔ v0 RLS altında kimlikle okuma.
 * Sentetik, tohumlu rastgele veri; geçici yerel veritabanı (PGlite ya da yerel PostgreSQL). */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {migratedDb,finish}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const PHONE='+905321234567',PHOTO='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
// Belirlenimci sözde rastgele (mulberry32).
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const LISTING_COLUMNS='id,owner_id,kind,from_city,to_city,from_district,to_district,expires_at,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,contact_consent';

async function as(db,{user=null,role='authenticated',claims=null}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.query(`select set_config('request.jwt.claims',$1,true)`,[claims?JSON.stringify(claims):'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;
    await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const replica=async(db,fn)=>{await db.exec('set session_replication_role=replica');try{return await fn();}finally{await db.exec('reset session_replication_role');}};

/** Tutarlı durumlar (gerçek akışların ürettiği): kaldırılan ilan 'archived', askıdaki sahibin ilanları kapalı. */
async function seed(db,n=260){
  const R=rng(20261118);
  const owners=Array.from({length:30},(_,i)=>uid(i+1)),A=uid(101),B=uid(102),S=uid(103),U=uid(104);
  for(const id of [...owners,A,B,S,U])await db.query(`insert into auth.users(id,email_confirmed_at) values($1,$2)`,[id,id===U?null:new Date().toISOString()]);
  await replica(db,async()=>{
    for(const id of [...owners,A,B,S])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,$2,'owner')`,[id,'Kişi '+id.slice(-3)]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[S]);
    for(let i=0;i<n;i++){
      const r=R(),owner=r<0.08?A:r<0.12?B:r<0.15?S:owners[Math.floor(R()*owners.length)];
      let status=R()<0.7?'active':R()<0.8?'closed':'archived';if(owner===S&&status==='active')status='closed';
      const expiresIn=R()<0.7?1+Math.floor(R()*5)*60:-(1+Math.floor(R()*48))*60;// dakika
      const kind=R()<0.5?'load':'truck',text=kind==='load'&&R()<0.5?'bugün':null,daysAgo=text?null:(R()<0.2?2:0);
      const photo=kind==='load'&&R()<0.4?PHOTO:'',redact=status!=='active'&&R()<0.25;
      const id=Number((await db.query(`insert into public.listings(kind,from_city,to_city,from_district,vehicle,body,amount,cargo,note,owner_label,loading_text,available_on,available_time,items,contact_phone,contact_consent,owner_id,status,expires_at,image_data,redacted_at)
        values($1,'İstanbul','Ankara',$2,'Tır','Tenteli',$3,$4,$5,$6,$7,case when $8::int is null then null else (now() at time zone 'Europe/Istanbul')::date-$8::int end,'',$9::jsonb,$10,$11,$12,$13,now()+make_interval(mins=>$14),$15,$16) returning id`,
        [kind,R()<0.5?'Kadıköy':null,100+i,kind==='load'?'Yük '+i:'','Not '+i,'Sahip '+i,text,daysAgo,'[]',PHONE,R()<0.8,owner,status,expiresIn,photo,redact?new Date().toISOString():null])).rows[0].id);
      if(status==='archived'&&R()<0.7)await db.query(`insert into private.listing_moderation(listing_id,removed,updated_at) values($1,true,now())`,[id]);
    }
  });
  return {owners,A,B,S,U};
}

async function pages(fetchPage){
  const out=[],sizes=[];let cursor=null;
  for(let i=0;i<20;i++){const p=await fetchPage(cursor);out.push(...p.items);sizes.push(p.items.length);if(p.next==null)break;cursor=p.next;}
  return {items:out,sizes};
}
const v1Page=(db,who,fn,args={})=>async cursor=>{
  const r=await as(db,who,`select api.${fn}(${['p_cursor',...Object.keys(args)].map((k,i)=>`${k}=>$${i+1}`).join(',')}) r`,[cursor,...Object.values(args)]);
  if(r.error)throw Error(JSON.stringify(r.error));return {items:r.rows[0].r.data,next:r.rows[0].r.page.next};
};
const v0Guest=db=>async cursor=>{const r=await as(db,{role:'anon'},`select * from public.nakgo_public_listings($1)`,[cursor==null?null:Number(cursor)]);
  if(r.error)throw Error(JSON.stringify(r.error));return {items:r.rows,next:r.rows.length===50?String(r.rows.at(-1).id):null};};
const v0Member=(db,user,own=false)=>async cursor=>{const r=await as(db,{user},`select ${LISTING_COLUMNS} from public.listings where ${own?'owner_id=$2':"status='active'"} and ($1::bigint is null or id<$1) order by id desc limit 50`,own?[cursor,user]:[cursor]);
  if(r.error)throw Error(JSON.stringify(r.error));return {items:r.rows,next:r.rows.length===50?String(r.rows.at(-1).id):null};};

const iso=t=>new Date(t).toISOString();
const pad=n=>String(n).padStart(2,'0');
// pg sürücüsü date sütununu yerel gece yarısı Date'i olarak verir; takvim günü yerel bileşenlerden okunur.
const day=d=>d==null?null:(d instanceof Date?d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()):String(d).slice(0,10));
function expectedItem(row,{member=false,actor=null,photo=null,detail=false}){
  const o={id:Number(row.id),kind:row.kind,from:{city:row.from_city,district:row.from_district},to:{city:row.to_city,district:row.to_district},
    vehicle:row.vehicle,body:row.body,amount:Number(row.amount),cargo:row.cargo,items:row.items,
    date:{on:day(row.available_on),until:day(row.available_until),time:row.available_time,text:row.loading_text},
    status:row.status,created_at:iso(row.created_at),has_photo:(photo??row.image_data)!==''};
  if(member)Object.assign(o,{owner_label:row.owner_label,note:row.note,mine:row.owner_id===actor,expires_at:iso(row.expires_at),updated_at:iso(row.updated_at),contact_allowed:row.contact_consent,revision:row.owner_id===actor?Number(row.revision??0):null});
  if(member&&detail)o.photo=(row.image_data||'')===''?null:row.image_data;
  return o;
}
const norm=x=>JSON.parse(JSON.stringify(x,(k,v)=>k==='amount'?Number(v):v));

test('API v1 ilan okuma uçları',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const P=await seed(db);
    const photoOf=new Map((await db.query('select id,image_data from public.listings')).rows.map(r=>[Number(r.id),r.image_data]));
    const all=(await db.query(`select ${LISTING_COLUMNS},redacted_at from public.listings order by id desc`)).rows;
    const counts=all.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
    assert.ok(counts.active>100&&counts.closed>10&&counts.archived>5,'veri yeterince çeşitli: '+JSON.stringify(counts));

    await t.test('misafir akışı nakgo_public_listings ile birebir (sıra, sayfa, alanlar)',async()=>{
      const a=await pages(v1Page(db,{role:'anon'},'listings_v1')),b=await pages(v0Guest(db));
      assert.ok(a.items.length>50,'en az iki sayfa');
      assert.deepEqual(a.sizes,b.sizes,'sayfa boyutları');
      assert.deepEqual(norm(a.items),norm(b.items.map(r=>expectedItem(r,{photo:photoOf.get(Number(r.id))}))));
    });
    await t.test('üye akışı misafir akışıyla aynı ilanları gösterir (tek sıkı kural)',async()=>{
      const g=(await pages(v1Page(db,{role:'anon'},'listings_v1'))).items.map(x=>x.id);
      const m=(await pages(v1Page(db,{user:P.A},'listings_v1'))).items.map(x=>x.id);
      assert.deepEqual(m,g);
    });
    await t.test('üye akışı v0 üye sorgusuyla karşılaştırılır: tek fark, sahibin kendi süresi geçmiş aktif ilanları (v0 sahip kuralı)',async()=>{
      const a=(await pages(v1Page(db,{user:P.A},'listings_v1'))).items,b=(await pages(v0Member(db,P.A))).items;
      const ids=new Set(a.map(x=>x.id)),extra=b.filter(r=>!ids.has(Number(r.id)));
      assert.ok(a.every(x=>b.some(r=>Number(r.id)===x.id)),'v1 ⊆ v0');
      assert.ok(extra.length>0,'testte fark gerçekten oluşuyor');
      for(const r of extra){
        assert.equal(r.owner_id,P.A,'fark yalnız kendi ilanı: '+r.id);
        const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);// İstanbul (UTC+3)
        const strict=new Date(r.expires_at)>new Date()&&(r.loading_text!==null||day(r.available_on)>=today);
        assert.equal(strict,false,'fark yalnız sıkı kurala uymayan ilan: '+r.id);
      }
      const byId=new Map(b.map(r=>[Number(r.id),r]));
      assert.deepEqual(norm(a),norm(a.map(x=>expectedItem(byId.get(x.id),{member:true,actor:P.A}))),'alan değerleri v0 ile aynı');
    });
    await t.test('kendi ilanlarım v0 sahip sorgusuyla birebir; başka hesabın ilanı yok',async()=>{
      for(const user of [P.A,P.B,P.S]){
        const a=await pages(v1Page(db,{user},'my_listings_v1')),b=await pages(v0Member(db,user,true));
        assert.deepEqual(norm(a.items),norm(b.items.map(r=>expectedItem(r,{member:true,actor:user}))),user);
        assert.ok(a.items.every(x=>x.mine===true));
      }
      assert.equal((await db.query(`select has_function_privilege('anon','api.my_listings_v1(text)','execute') v`)).rows[0].v,false,'misafire hiç açık değil');
      assert.equal((await as(db,{role:'anon'},`select api.my_listings_v1() r`)).error.code,'42501');
      assert.equal((await as(db,{user:P.A,claims:{sub:P.A,is_anonymous:true}},`select api.my_listings_v1() r`)).error.key,'auth_required');
    });
    await t.test('ayrıntı: her ilan ve her izleyici için v0 RLS görünürlüğüyle aynı; görünmeyen not_found; fotoğraf yalnız üyeye',async()=>{
      let seenNotFound=0,seenOwnHidden=0;
      for(const row of all){
        const id=Number(row.id);
        for(const who of [{role:'anon'},{user:P.A},{user:P.B}]){
          const r=await as(db,who,`select api.listing_v1($1) r`,[id]);
          const v0=who.user?await as(db,who,`select ${LISTING_COLUMNS} from public.listings where id=$1`,[id]):await as(db,who,`select * from public.nakgo_public_listings(null) where id=$1`,[id]);
          const v0guestAll=who.user?null:(await as(db,who,`select id from public.listings l where l.id=$1 and exists(select 1 from private.api_visible_listings v where v.id=l.id)`,[id]));
          void v0guestAll;
          const visible0=who.user?v0.rows.length===1:(await pages(v0Guest(db))).items.some(x=>Number(x.id)===id);
          if(!visible0){assert.equal(r.error&&r.error.key,'not_found',id+' '+JSON.stringify(who));seenNotFound++;continue;}
          assert.ok(!r.error,id+' '+JSON.stringify(r.error));
          const member=!!who.user;
          assert.deepEqual(norm(r.rows[0].r.data),norm(expectedItem(member?v0.rows[0]:row,{member,actor:who.user,detail:member,photo:member?null:photoOf.get(id)})));
          if(member&&row.owner_id===who.user&&!(r.rows[0].r.data.status==='active'&&new Date(row.expires_at)>new Date()))seenOwnHidden++;
        }
      }
      assert.ok(seenNotFound>50&&seenOwnHidden>0,'kapsam: '+seenNotFound+'/'+seenOwnHidden);
    }).catch(e=>{throw e;});
    await t.test('veri yalıtımı: yanıtlarda telefon, sahip kimliği, karartma ve listede fotoğraf yok; mine yalnız sahibine',async()=>{
      for(const [who,fn] of [[{role:'anon'},'listings_v1'],[{user:P.A},'listings_v1'],[{user:P.A},'my_listings_v1'],[{user:P.B},'my_listings_v1']]){
        const items=(await pages(v1Page(db,who,fn))).items,txt=JSON.stringify(items);
        for(const bad of ['5321234567','owner_id','redacted','image_data','base64',P.A,P.B])assert.ok(!txt.includes(bad),fn+' '+bad);
        if(who.user)assert.ok(items.every(x=>x.mine===(all.find(r=>Number(r.id)===x.id).owner_id===who.user)));
      }
      const detail=JSON.stringify((await as(db,{role:'anon'},`select api.listing_v1($1) r`,[(await pages(v1Page(db,{role:'anon'},'listings_v1'))).items[0].id])).rows);
      assert.ok(!/5321234567|owner_label|"note"|"photo"|base64/.test(detail),'misafir ayrıntısında üye alanı yok');
    });
    await t.test('yanıt alanları sözleşmedeki gibi (eksik ya da fazla alan yok)',async()=>{
      const L=v1.listing_item;
      const g=(await as(db,{role:'anon'},`select api.listings_v1() r`)).rows[0].r,m=(await as(db,{user:P.A},`select api.listings_v1() r`)).rows[0].r;
      assert.deepEqual(Object.keys(g).sort(),['data','page']);assert.deepEqual(Object.keys(g.page),['next']);
      for(const x of g.data)assert.deepEqual(Object.keys(x).sort(),[...L.guest].sort());
      for(const x of m.data)assert.deepEqual(Object.keys(x).sort(),[...L.member].sort());
      const x=m.data[0];assert.deepEqual(Object.keys(x.from).sort(),[...L.place].sort());assert.deepEqual(Object.keys(x.date).sort(),[...L.date].sort());
      const d=(await as(db,{user:P.A},`select api.listing_v1($1) r`,[x.id])).rows[0].r;
      assert.deepEqual(Object.keys(d),['data']);assert.deepEqual(Object.keys(d.data).sort(),[...L.member,...L.detail_member_extra].sort());
      assert.equal(v1.functions.listings_v1.page_size,50);
    });
    await t.test('sayfalama ve filtre: 50\'şer, kimliğe göre azalan, sayfalar ayrık; yeni ilan sonraki sayfayı bozmaz; tür filtresi',async()=>{
      const p1=(await as(db,{role:'anon'},`select api.listings_v1() r`)).rows[0].r;
      assert.equal(p1.data.length,50);assert.equal(p1.page.next,String(p1.data.at(-1).id));
      assert.ok(p1.data.every((x,i)=>i===0||x.id<p1.data[i-1].id));
      const before=(await as(db,{role:'anon'},`select api.listings_v1($1) r`,[p1.page.next])).rows[0].r;
      await replica(db,()=>db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id) values('load','İzmir','Bursa','Tır','Açık kasa',1,'Yük','X','bugün',$1,true,$2)`,[PHONE,P.owners[0]]));
      const after=(await as(db,{role:'anon'},`select api.listings_v1($1) r`,[p1.page.next])).rows[0].r;
      assert.deepEqual(after,before,'imleçli sayfa yeni ilandan etkilenmez');
      const all1=(await pages(v1Page(db,{role:'anon'},'listings_v1'))).items;
      assert.equal(new Set(all1.map(x=>x.id)).size,all1.length,'tekrar yok');
      for(const kind of ['load','truck']){
        const f=(await pages(v1Page(db,{role:'anon'},'listings_v1',{p_kind:kind}))).items;
        assert.deepEqual(f.map(x=>x.id),all1.filter(x=>x.kind===kind).map(x=>x.id),kind);
      }
      assert.equal((await as(db,{role:'anon'},`select api.listings_v1(null,'boat') r`)).error.key,'invalid_argument');
      for(const bad of ['0','abc','-5'])assert.equal((await as(db,{role:'anon'},`select api.listings_v1($1) r`,[bad])).error.key,'invalid_cursor',bad);
      for(const bad of [0,-1])assert.equal((await as(db,{role:'anon'},`select api.listing_v1($1) r`,[bad])).error.key,'invalid_argument');
    });
    await t.test('oturum: anonim oturum misafir görünümü alır; doğrulanmamış hesap reddedilir',async()=>{
      const r=(await as(db,{user:P.A,claims:{sub:P.A,is_anonymous:true}},`select api.listings_v1() r`)).rows[0].r;
      assert.deepEqual(Object.keys(r.data[0]).sort(),[...v1.listing_item.guest].sort());
      assert.equal((await as(db,{user:P.U},`select api.listings_v1() r`)).error.key,'account_unverified');
    });
    await t.test('v1 kapatılınca uçlar api_disabled verir, v0 ilan okumaları çalışmaya devam eder',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        for(const [who,sql] of [[{role:'anon'},`select api.listings_v1() r`],[{user:P.A},`select api.listing_v1(1) r`],[{user:P.A},`select api.my_listings_v1() r`]])
          assert.deepEqual((await as(db,who,sql)).error,{code:'PT503',key:'api_disabled'},sql);
        assert.ok((await pages(v0Guest(db))).items.length>50);
        assert.ok((await pages(v0Member(db,P.A))).items.length>50);
        assert.ok((await pages(v0Member(db,P.A,true))).items.length>0);
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
    await t.test('tutarsız durumlar (gerçek akışlarda oluşmaz): v1 sıkı kural yine gizler, v0 üye sorgusu gösterir',async()=>{
      const ids=await replica(db,async()=>{
        const mk=async owner=>Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id) values('load','Adana','Mersin','Tır','Açık kasa',1,'Yük','X','bugün',$1,true,$2) returning id`,[PHONE,owner])).rows[0].id);
        const removed=await mk(P.owners[1]);await db.query(`insert into private.listing_moderation(listing_id,removed) values($1,true)`,[removed]);
        const suspended=await mk(P.S);
        return [removed,suspended];
      });
      const v1ids=(await pages(v1Page(db,{user:P.B},'listings_v1'))).items.map(x=>x.id);
      const v0ids=(await pages(v0Member(db,P.B))).items.map(x=>Number(x.id));
      for(const id of ids){
        assert.ok(!v1ids.includes(id),'v1 gizler '+id);assert.ok(v0ids.includes(id),'v0 üye gösterir '+id);
        assert.equal((await as(db,{user:P.B},`select api.listing_v1($1) r`,[id])).error.key,'not_found');
      }
      await replica(db,()=>db.query(`delete from public.listings where id=any($1)`,[ids]));
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

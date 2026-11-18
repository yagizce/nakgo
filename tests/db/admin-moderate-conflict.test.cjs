/** Yönetici işlemlerinde eşzamanlılık (nakgo_admin_moderate): eski revision ve uzun kilit beklemesi HTTP 409 (PT409) ile
 * hemen döner; PostgREST'in 40001'i sonsuz yeniden denemesi yok. Denetim kaydı yalnız başarılı işlemde yazılır.
 * #125 (yasal arşiv) kendi zaman damgasıyla kuruluyken de düzeltme uygulanır. Sentetik veri; geçici yerel veritabanı. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');
const {openDb,build,migrations,root}=require('../../tools/db-lib.cjs');

const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const ADMIN=uid(1),ADMIN2=uid(2),USER=uid(3);
async function as(db,user,sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);
    await db.exec('set local role authenticated');
    const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,key:e.message}};}
}
const moderate=async(db,user,args)=>{const r=await as(db,user,`select public.nakgo_admin_moderate($1,$2,$3,$4,$5) r`,args);return r.error?r:r.rows[0].r;};
const count=async(db,sql,args=[])=>Number((await db.query(sql,args)).rows[0].n);
async function seed(db){
  for(const id of [ADMIN,ADMIN2,USER])await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,id.slice(-2)+'@test.invalid']);
  await db.exec('set session_replication_role=replica');
  for(const id of [ADMIN,ADMIN2,USER])await db.query(`insert into public.profiles(id,display_name,account_type) values($1,'K','owner')`,[id]);
  await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true),($2,true,false)`,[ADMIN,ADMIN2]);
  const l=(await db.query(`insert into public.listings(owner_id,owner_label,kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,expires_at)
    values($1,'K','load','İstanbul','Ankara','Tır','Tenteli',20,'Palet','bugün',now()+interval '6 hours') returning id`,[USER])).rows[0].id;
  await db.exec('reset session_replication_role');
  return String(l);
}
// Stale revision: kod PT409, mesaj aynı; durum ve denetim kaydı değişmez.
async function staleChecks(db,listing,{hold=true}={}){
  const audit=await count(db,`select count(*) n from private.admin_audit`);
  for(const args of [['user',USER,'suspend','Deneme',7],['listing',listing,'remove','Deneme',7],...(hold?[['listing',listing,'hold','Deneme',7]]:[])]){
    const r=await moderate(db,ADMIN,args);
    assert.deepEqual(r.error,{code:'PT409',key:'Moderation changed; refresh'},JSON.stringify(args));
  }
  assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit,'çakışmada denetim kaydı yazılmaz');
  assert.equal(await count(db,`select count(*) n from private.account_moderation where user_id=$1 and suspended`,[USER]),0);
  const ok=await moderate(db,ADMIN,['user',USER,'suspend','Gerçek karar',0]);
  assert.deepEqual(ok,{revision:1,changed:true});
  const a=(await db.query(`select actor_id,target,action,reason,revision from private.admin_audit order by id desc limit 1`)).rows[0];
  assert.deepEqual([a.actor_id,a.target,a.action,a.reason,Number(a.revision)],[ADMIN,USER,'suspend','Gerçek karar',1]);
  assert.deepEqual((await moderate(db,ADMIN2,['user',USER,'resume','Eski sürüm',0])).error.code,'PT409','ikinci yönetici eski sürümle');
}
async function definitionChecks(db){
  const f=(await db.query(`select proconfig,prosrc from pg_proc where oid='public.nakgo_admin_moderate(text,text,text,text,bigint)'::regprocedure`)).rows[0];
  assert.ok(f.proconfig.includes('lock_timeout=5s')&&f.proconfig.includes('search_path=""'),JSON.stringify(f.proconfig));
  assert.ok(f.prosrc.includes("when lock_not_available then")&&f.prosrc.includes("'Moderation busy; refresh' using errcode='PT409'"));
  // PostgREST 40001'i yeniden dener: istemcinin çağırabildiği hiçbir fonksiyon 40001 yükseltmemeli. Sonradan bir migration
  // (ör. #125 zaman damgası değişip bu düzeltmeden sonra çalışırsa) 40001'i geri getirirse bu kontrol düşer.
  const bad=(await db.query(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','api') and p.prosrc ~ 'errcode\\s*=\\s*''40001''' and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))`)).rows.map(r=>r.f);
  assert.deepEqual(bad,[]);
}

test('Yönetici işlemi eşzamanlılığı',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    const listing=await seed(db);
    await t.test('tanım: PT409, lock_timeout 5s, istemciye açık fonksiyonlarda 40001 yok',()=>definitionChecks(db));
    await t.test('eski revision PT409; durum ve denetim kaydı değişmez; doğru revision işler',()=>staleChecks(db,listing));

    await t.test('iki yönetici aynı anda; kilit 5 saniyeden uzun (gerçek PostgreSQL)',async t2=>{
      if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
      const {Client}=require('pg'),env=process.env;
      const conn=async()=>{const c=new Client({host:env.NAKGO_PG_HOST,port:env.NAKGO_PG_PORT||5432,user:env.NAKGO_PG_USER||'postgres',password:env.NAKGO_PG_PASSWORD,database:db.name});await c.connect();return c;};
      const [a,b,lock]=await Promise.all([conn(),conn(),conn()]);
      const begin=async(c,user)=>{await c.query('begin');await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);await c.query('set local role authenticated');};
      const call=(c,args)=>c.query(`select public.nakgo_admin_moderate($1,$2,$3,$4,$5) r`,args).then(r=>r.rows[0].r,e=>({code:e.code,key:e.message}));
      try{
        const rev=Number((await db.query(`select revision from private.listing_moderation where listing_id=$1 union all select 0 limit 1`,[listing])).rows[0].revision);
        const audit=await count(db,`select count(*) n from private.admin_audit`);
        // A işlemi açık tutar; B aynı sürümle bekler, A bitince güncel olmadığı için PT409 alır (beklemez, tekrar denenmez).
        await begin(a,ADMIN);await begin(b,ADMIN2);
        assert.equal((await call(a,['listing',listing,'remove','A kararı',rev])).changed,true);
        let settled=false;const second=call(b,['listing',listing,'remove','B kararı',rev]).finally(()=>{settled=true;});
        await new Promise(r=>setTimeout(r,300));assert.equal(settled,false,'B, A bitene kadar bekler');
        await a.query('commit');
        assert.deepEqual(await second,{code:'PT409',key:'Moderation changed; refresh'});await b.query('rollback');
        assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit+1,'tek karar, tek denetim kaydı');
        // Kilit 5 saniyeden uzun tutulursa: belirsiz bekleme yok, PT409 'busy'; hiçbir şey yazılmaz.
        await lock.query('begin');await lock.query(`select pg_advisory_xact_lock(hashtextextended($1::text,7290))`,[USER]);
        await begin(b,ADMIN2);const t0=Date.now();
        const busy=await call(b,['user',USER,'ban','Engel',1]);await b.query('rollback');
        assert.deepEqual(busy,{code:'PT409',key:'Moderation busy; refresh'});
        assert.ok(Date.now()-t0>=4500&&Date.now()-t0<9000,'yaklaşık 5 sn: '+(Date.now()-t0));
        await lock.query('rollback');
        assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit+1);
        assert.equal(await count(db,`select count(*) n from private.account_moderation where user_id=$1 and banned`,[USER]),0);
      }finally{await Promise.all([a,b,lock].map(c=>c.end().catch(()=>{})));}
    });

    await t.test('HTTP (yerel PostgREST): 409 hemen döner, yeniden deneme yok',async t2=>{
      if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t2.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
      const {startPostgrest}=require('./postgrest.cjs');const {Client}=require('pg'),env=process.env;
      const pg=await startPostgrest(db,{schemas:'public'});
      const lock=new Client({host:env.NAKGO_PG_HOST,port:env.NAKGO_PG_PORT||5432,user:env.NAKGO_PG_USER||'postgres',password:env.NAKGO_PG_PASSWORD,database:db.name});await lock.connect();
      try{
        const T=pg.jwt({sub:ADMIN}),body=(o={})=>({p_kind:'user',p_target:USER,p_action:'resume',p_reason:'HTTP deneme',p_revision:0,...o});
        const audit=await count(db,`select count(*) n from private.admin_audit`);
        let t0=Date.now();const stale=await pg.rpc('nakgo_admin_moderate',{token:T,schema:null,body:body()});
        assert.equal(stale.status,409);assert.deepEqual([stale.body.code,stale.body.message],['PT409','Moderation changed; refresh']);
        assert.ok(Date.now()-t0<3000,'yanıt hemen gelir: '+(Date.now()-t0)+' ms');
        await lock.query('begin');await lock.query(`select pg_advisory_xact_lock(hashtextextended($1::text,7290))`,[USER]);
        t0=Date.now();const busy=await pg.rpc('nakgo_admin_moderate',{token:T,schema:null,body:body({p_revision:1})});
        assert.equal(busy.status,409);assert.deepEqual([busy.body.code,busy.body.message],['PT409','Moderation busy; refresh']);
        assert.ok(Date.now()-t0<9000,'yanıt 5 sn kilit süresinde gelir: '+(Date.now()-t0)+' ms');
        await lock.query('rollback');
        assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit,'çakışmalarda denetim kaydı yok');
        const ok=await pg.rpc('nakgo_admin_moderate',{token:T,schema:null,body:body({p_revision:1})});
        assert.equal(ok.status,200);assert.deepEqual(ok.body,{revision:2,changed:true});
        assert.equal(await count(db,`select count(*) n from private.admin_audit`),audit+1);
      }finally{await lock.end().catch(()=>{});pg.stop();}
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

test('#125 kendi zaman damgasıyla kuruluyken düzeltme yasal arşiv sürümüne uygulanır',async()=>{
  const db=await openDb();let primary=null;
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    const legal={name:'20261117000000_legal_archive.sql',sql:fs.readFileSync(path.join(root,'tests/backup/fixtures/legal_archive.b25013e.sql'),'utf8')};
    await build(db,{list:[...migrations(),legal].sort((a,b)=>a.name<b.name?-1:1)});
    const src=(await db.query(`select prosrc from pg_proc where oid='public.nakgo_admin_moderate(text,text,text,text,bigint)'::regprocedure`)).rows[0].prosrc;
    assert.ok(src.includes('rid bigint; h record'),'#125 sürümü korunur (yasal koruma adımları)');
    await definitionChecks(db);
    const listing=await seed(db);
    // #125'te yasal saklama ayrıca yasal erişim (MFA) ister; o kural #125'e aittir ve burada değişmez.
    assert.equal((await moderate(db,ADMIN,['listing',listing,'hold','Deneme',7])).error.key,'Legal access required');
    await staleChecks(db,listing,{hold:false});
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

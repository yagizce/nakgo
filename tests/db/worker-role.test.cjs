/** B4: yerel `worker` rolü (supabase/local/worker.sql). Kanıtlananlar: hiçbir tabloya erişemez; worker şeması dışında anon'dan
 * fazla hiçbir fonksiyonu çalıştıramaz; private/api şemalarına giremez; hiçbir role üye değil; kullanıcı ve yönetici rolleri
 * worker fonksiyonlarını çalıştıramaz. Yerel PostgREST varsa belirteçle uçtan uca; NAKGO_MINIFLARE varsa Worker (workerd)
 * içinden. Sentetik veri; geçici yerel veritabanı. Gerçek Supabase'i KANITLAMAZ. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {migratedDb,finish,realPg}=require('../backup/helpers.cjs');
const {startPostgrest}=require('./postgrest.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'../../supabase/local/worker.sql'),'utf8');
const ROOT=path.join(__dirname,'../..');

async function as(db,role,sql,args=[]){
  await db.exec('begin');
  try{await db.exec('set local role '+role);const r=(await db.query(sql,args)).rows;await db.exec('commit');return {rows:r};}
  catch(e){await db.exec('rollback');return {error:{code:e.code,message:e.message}};}
}

test('B4 worker rolü',async t=>{
  const db=await migratedDb();let pg=null,primary=null;
  try{
    // Yerel PostgREST için authenticator önce oluşur; worker.sql üyeliği verir.
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$;`);
    await db.exec(SQL);
    await db.exec(SQL);  // tekrar uygulanabilir

    await t.test('rol özellikleri: giriş yok, süper kullanıcı değil, RLS atlamaz, hiçbir role üye değil',async()=>{
      const r=(await db.query(`select rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication from pg_roles where rolname='worker'`)).rows[0];
      assert.deepEqual(r,{rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false,rolreplication:false});
      const member=(await db.query(`select b.rolname from pg_auth_members m join pg_roles a on a.oid=m.member join pg_roles b on b.oid=m.roleid where a.rolname='worker'`)).rows;
      assert.deepEqual(member,[],'worker hiçbir role üye değil');
      for(const role of ['anon','authenticated','service_role','postgres'])
        assert.equal((await db.query(`select pg_has_role('worker',$1,'MEMBER') v`,[role]).catch(()=>({rows:[{v:false}]}))).rows[0].v,false,role);
    });
    await t.test('hiçbir tabloya, görünüme ya da diziye yetkisi yok',async()=>{
      const tables=(await db.query(`select c.oid::regclass::text n,c.relkind k from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where c.relkind in('r','v','m','p','f','S') and s.nspname not in('pg_catalog','information_schema') and s.nspname not like 'pg_toast%'`)).rows;
      assert.ok(tables.length>20);
      for(const {n,k} of tables){
        const v=k==='S'?(await db.query(`select has_sequence_privilege('worker',$1,'USAGE,SELECT,UPDATE') v`,[n])).rows[0].v
          :(await db.query(`select has_table_privilege('worker',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') v`,[n])).rows[0].v;
        assert.equal(v,false,n);
      }
    });
    await t.test('şemalar: yalnız worker (ve herkese açık public); private, api, auth, cron yok',async()=>{
      for(const s of ['private','api','auth','cron','storage','extensions'])
        if((await db.query(`select 1 from pg_namespace where nspname=$1`,[s])).rows.length)
          assert.equal((await db.query(`select has_schema_privilege('worker',$1,'USAGE') v`,[s])).rows[0].v,false,s);
      assert.equal((await db.query(`select has_schema_privilege('worker','worker','USAGE') v, has_schema_privilege('worker','worker','CREATE') c`)).rows[0].c,false,'worker şemasında nesne oluşturamaz');
      for(const s of ['public','worker'])assert.equal((await db.query(`select has_schema_privilege('worker',$1,'CREATE') v`,[s])).rows[0].v,false,'CREATE '+s);
    });
    await t.test('fonksiyonlar: worker şeması dışında anon\'dan fazla yetki yok; kullanıcı ve yönetici worker fonksiyonlarını çalıştıramaz',async()=>{
      const fns=(await db.query(`select p.oid::regprocedure::text f,s.nspname n,p.prosecdef d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
        where s.nspname not in('pg_catalog','information_schema') and p.prokind in('f','p')`)).rows;
      let workerFns=0;
      for(const {f,n,d} of fns){
        const w=(await db.query(`select has_function_privilege('worker',$1,'EXECUTE') v`,[f])).rows[0].v;
        const usage=(await db.query(`select has_schema_privilege('worker',$1,'USAGE') v`,[n])).rows[0].v;
        if(n==='worker'){workerFns++;assert.equal(w&&usage,true,f);assert.equal(d,true,f+' SECURITY DEFINER');
          for(const role of ['anon','authenticated','service_role'])if((await db.query(`select 1 from pg_roles where rolname=$1`,[role])).rows.length)
            assert.equal((await db.query(`select has_function_privilege($1,$2,'EXECUTE') v`,[role,f])).rows[0].v,false,role+' '+f);
          continue;}
        if(!(w&&usage))continue;
        const anon=(await db.query(`select has_function_privilege('anon',$1,'EXECUTE') a,has_schema_privilege('anon',$2,'USAGE') u`,[f,n])).rows[0];
        assert.ok(anon.a&&anon.u,'worker anon\'dan fazlasını çalıştırabiliyor: '+f);
      }
      assert.equal(workerFns,2);
      const cfg=(await db.query(`select p.proname,p.proconfig from pg_proc p where p.pronamespace='worker'::regnamespace`)).rows;
      assert.ok(cfg.every(r=>Array.isArray(r.proconfig)&&r.proconfig.includes('search_path=""')),'boş search_path');
    });
    await t.test('davranış: worker fonksiyonları çalışır; tablo, api, v0 ve yönetici fonksiyonları reddedilir',async()=>{
      const h=(await as(db,'worker',`select worker.health() r`)).rows[0].r;
      assert.deepEqual(Object.keys(h).sort(),['db_time','v1_enabled']);
      await db.query(`insert into private.api_usage(hour,version,fn,shard,calls) values(date_trunc('hour',now()),'v1','listings_v1',0,5),(date_trunc('hour',now()),'v1','listings_v1',1,2),(date_trunc('hour',now())-interval '30 hours','v1','profile_v1',0,9)`);
      const u=(await as(db,'worker',`select worker.api_usage(24) r`)).rows[0].r;
      assert.equal(u.length,1);assert.deepEqual([u[0].fn,u[0].calls,u[0].version],['listings_v1',7,'v1']);
      assert.ok(!JSON.stringify(u).match(/user|account|[0-9a-f]{8}-[0-9a-f]{4}/),'hesap bilgisi yok');
      for(const bad of [0,169,null])assert.equal((await as(db,'worker',`select worker.api_usage($1) r`,[bad])).error.code,'22023');
      for(const sql of [`select * from public.listings limit 1`,`select * from public.profiles limit 1`,`select * from private.api_usage limit 1`,
        `insert into private.api_usage(hour,version,fn,shard,calls) values(now(),'v1','x',0,1)`,`select api.status_v1()`,`select api.listings_v1()`,
        `select public.nakgo_admin_role()`,`select public.nakgo_delete_my_account()`,`select public.nakgo_listing_contact(1)`,
        `create table public.x(id int)`,`create function worker.x() returns int language sql as 'select 1'`])
        assert.ok((await as(db,'worker',sql)).error,'reddedilmeli: '+sql);
      for(const role of ['anon','authenticated'])assert.equal((await as(db,role,`select worker.health()`)).error.code,'42501',role);
    });
    await t.test('yerel PostgREST: worker belirteci yalnız worker şemasına; diğer belirteçler worker şemasına giremez',async t2=>{
      if(!realPg()||!process.env.NAKGO_POSTGREST_BIN){t2.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli');return;}
      pg=await startPostgrest(db,{schemas:'public,api,worker'});
      const W=pg.jwt({role:'worker',aud:'worker',sub:undefined}),U=pg.jwt({sub:'00000000-0000-4000-8000-0000000000f1'});
      let r=await pg.rpc('health',{token:W,schema:'worker'});assert.equal(r.status,200);assert.ok('v1_enabled' in r.body);
      r=await pg.rpc('status_v1',{token:W});assert.ok([401,403].includes(r.status),'api: '+r.status);
      r=await pg.rpc('nakgo_admin_role',{token:W,schema:null});assert.ok([401,403].includes(r.status),'v0 yönetici: '+r.status);
      assert.ok([401,403].includes((await pg.get('/listings?select=id',W)).status),'tablo');
      assert.ok([401,403].includes((await pg.rpc('health',{token:U,schema:'worker'})).status),'üye belirteci worker şemasına giremez');
      assert.ok([401,403].includes((await pg.rpc('health',{schema:'worker'})).status),'misafir worker şemasına giremez');
      // Worker uygulaması (Node) gerçek PostgREST'e karşı.
      const {build}=await import(pathToFileURL(path.join(ROOT,'server/worker.mjs')).href);
      const logs=[];const app=build({WORKER_DB_URL:pg.base,WORKER_DB_TOKEN:W},{sink:l=>logs.push(l)});
      r=await app(new Request('http://w/health/db'));assert.equal(r.status,200);assert.equal((await r.json()).db.v1_enabled,true);
      r=await app(new Request('http://w/usage/v1?hours=24'));assert.equal(r.status,200);assert.equal((await r.json()).usage[0].calls,7);
      const bad=build({WORKER_DB_URL:pg.base,WORKER_DB_TOKEN:U},{sink:l=>logs.push(l)});
      r=await bad(new Request('http://w/health/db'));assert.equal(r.status,500,'yanlış rol belirteci reddedilir');
      assert.ok(logs.every(l=>!l.includes(W)&&!l.includes(U)),'belirteç günlüğe girmez');
      // Workers çalışma ortamı (workerd, Miniflare) içinden aynı akış.
      if(!process.env.NAKGO_MINIFLARE){t2.diagnostic('NAKGO_MINIFLARE yok: workerd adımı atlandı');return;}
      const {Miniflare}=await import(pathToFileURL(process.env.NAKGO_MINIFLARE).href);
      const mf=new Miniflare({modules:true,scriptPath:path.join(ROOT,'server/worker.mjs'),modulesRoot:ROOT,compatibilityDate:'2026-01-01',
        bindings:{WORKER_DB_URL:pg.base,WORKER_DB_TOKEN:W,LOG_LEVEL:'warn'}});
      try{
        r=await mf.dispatchFetch('http://w/health/db');assert.equal(r.status,200);assert.equal((await r.json()).db.v1_enabled,true);
        r=await mf.dispatchFetch('http://w/health');assert.equal(r.headers.get('cache-control'),'no-store');
        let last;for(let i=0;i<11;i++)last=await mf.dispatchFetch('http://w/health/db',{headers:{'cf-connecting-ip':'203.0.113.50'}});
        assert.equal(last.status,429,'workerd içinde istek sınırı');
        assert.equal((await mf.dispatchFetch('http://w/yok')).status,404);
      }finally{await mf.dispose();}
    });
  }catch(e){primary=e;throw e;}
  finally{if(pg)pg.stop();await finish(db,primary);}
});

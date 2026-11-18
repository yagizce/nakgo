/** B3-a: API v1 çerçevesi (api şeması, yardımcılar, hata anahtarları, yanıt biçimi, kullanım ölçümü, kapatma anahtarı).
 * Geçici yerel veritabanı (PGlite ya da NAKGO_PG_HOST ile yerel PostgreSQL); sentetik hesaplar. Uç fonksiyonlarının
 * kurallara uyumu (SECURITY DEFINER, search_path, yetkiler, ad) tools/api-contract.cjs ile ayrıca denetlenir. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {migratedDb,finish}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

/** Kimlik ve rolle tek sorgu; hata {code,message,detail,hint} olarak döner. */
async function as(db,{user=null,role='authenticated',claims=null}={},sql,args=[]){
  await db.exec('begin');
  try{
    await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user||'']);
    await db.query(`select set_config('request.jwt.claims',$1,true)`,[claims?JSON.stringify(claims):'']);
    await db.exec('set local role '+role);
    const r=(await db.query(sql,args)).rows;
    await db.exec('commit');return {rows:r};
  }catch(e){await db.exec('rollback');return {error:{code:e.code,message:e.message,detail:e.detail,hint:e.hint}};}
}

// Yalnız bu testte: yardımcıları uçlarda nasıl kullanılacaklarıyla sınamak için kurallara uygun deneme uçları.
const PROBES=`
create function api.zz_user_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin perform private.api_begin('zz_user_v1'); return private.api_ok(jsonb_build_object('id',private.api_actor(false))); end $$;
create function api.zz_write_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin perform private.api_begin('zz_write_v1'); return private.api_ok(jsonb_build_object('id',private.api_actor(true))); end $$;
create function api.zz_admin_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin perform private.api_begin('zz_admin_v1'); return private.api_ok(jsonb_build_object('id',private.api_admin())); end $$;
create function api.zz_page_v1(p_cursor text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare items jsonb; last int; more boolean;
begin perform private.api_begin('zz_page_v1');
 select jsonb_agg(x order by x desc),min(x) into items,last from (select x from generate_series(1,5) x where x<coalesce(private.api_cursor(p_cursor),6) order by x desc limit 3) s;
 more:=exists(select 1 from generate_series(1,5) x where x<last);
 return private.api_page(items,case when more then last end); end $$;
revoke all on function api.zz_user_v1(),api.zz_write_v1(),api.zz_admin_v1(),api.zz_page_v1(text) from public;
grant execute on function api.zz_user_v1(),api.zz_write_v1(),api.zz_admin_v1(),api.zz_page_v1(text) to anon,authenticated;`;

test('API v1 çerçevesi',async t=>{
  const db=await migratedDb();let primary=null;
  try{
    await db.exec(PROBES);
    const U={user:crypto.randomUUID(),admin:crypto.randomUUID(),unverified:crypto.randomUUID(),suspended:crypto.randomUUID()};
    for(const [k,id] of Object.entries(U))await db.query(`insert into auth.users(id,email_confirmed_at) values($1,$2)`,[id,k==='unverified'?null:new Date().toISOString()]);
    await db.query(`insert into private.admin_members(user_id,active) values($1,true)`,[U.admin]);
    await db.query(`insert into private.account_moderation(user_id,suspended) values($1,true)`,[U.suspended]);
    const call=(who,fn,args='')=>as(db,who,`select api.${fn}(${args}) r`);
    const err=r=>r.error&&{code:r.error.code,key:r.error.message};

    await t.test('status_v1: misafir ve üye çağırır; yanıt biçimi sözleşmedeki gibi',async()=>{
      for(const who of [{role:'anon'},{user:U.user}]){
        const r=(await call(who,'status_v1')).rows[0].r;
        assert.deepEqual(Object.keys(r),['data']);
        assert.deepEqual(Object.keys(r.data).sort(),[...v1.functions.status_v1.data].sort());
        assert.equal(r.data.api,'v1');assert.equal(r.data.enabled,true);assert.match(r.data.server_time,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      }
    });
    await t.test('oturum: misafir, anonim oturum, doğrulanmamış hesap reddedilir; anahtar ve SQLSTATE sabit',async()=>{
      assert.deepEqual(err(await call({role:'anon'},'zz_user_v1')),{code:'42501',key:'auth_required'});
      assert.deepEqual(err(await call({user:U.user,claims:{sub:U.user,is_anonymous:true}},'zz_user_v1')),{code:'42501',key:'auth_required'});
      assert.deepEqual(err(await call({user:U.unverified},'zz_user_v1')),{code:'42501',key:'account_unverified'});
      assert.equal((await call({user:U.user},'zz_user_v1')).rows[0].r.data.id,U.user);
    });
    await t.test('yazma: askıya alınmış hesap yazamaz, okuyabilir',async()=>{
      assert.equal((await call({user:U.suspended},'zz_user_v1')).rows[0].r.data.id,U.suspended);
      assert.deepEqual(err(await call({user:U.suspended},'zz_write_v1')),{code:'42501',key:'account_suspended'});
      assert.equal((await call({user:U.user},'zz_write_v1')).rows[0].r.data.id,U.user);
    });
    await t.test('yönetici ayrımı: üye admin_required alır, yönetici geçer',async()=>{
      assert.deepEqual(err(await call({user:U.user},'zz_admin_v1')),{code:'42501',key:'admin_required'});
      assert.deepEqual(err(await call({role:'anon'},'zz_admin_v1')),{code:'42501',key:'auth_required'});
      assert.equal((await call({user:U.admin},'zz_admin_v1')).rows[0].r.data.id,U.admin);
    });
    await t.test('hata anahtarları: kayıttaki her anahtar sözleşmedeki SQLSTATE ile, sabit açıklama ve işaretle yükselir',async()=>{
      for(const [key,spec] of Object.entries(v1.errors)){
        let e;try{await db.query('select private.api_raise($1)',[key]);}catch(x){e=x;}
        assert.equal(e.code,spec.sqlstate,key);assert.equal(e.message,key);assert.equal(e.hint,'nakgo.api');assert.ok(e.detail&&e.detail.length>=3,key);
      }
      let e;try{await db.query(`select private.api_raise('yok_boyle')`);}catch(x){e=x;}
      assert.equal(e.code,'XX000','kayıtsız anahtar programlama hatasıdır');
    });
    await t.test('sayfalama: imleç opak metin, sayfa boyutu sunucuda; geçersiz imleç invalid_cursor',async()=>{
      const p1=(await call({role:'anon'},'zz_page_v1')).rows[0].r;
      assert.deepEqual(p1,{data:[5,4,3],page:{next:'3'}});
      const p2=(await call({role:'anon'},'zz_page_v1',`'3'`)).rows[0].r;
      assert.deepEqual(p2,{data:[2,1],page:{next:null}});
      for(const bad of [`'0'`,`'-1'`,`'1;drop'`,`'99999999999999999'`])assert.deepEqual(err(await call({role:'anon'},'zz_page_v1',bad)),{code:'22023',key:'invalid_cursor'},bad);
    });
    await t.test('kapatma anahtarı: v1 kapalıyken uçlar api_disabled, status_v1 durumu bildirir; v0 etkilenmez',async()=>{
      await db.exec('update private.api_settings set v1_enabled=false');
      try{
        assert.deepEqual(err(await call({user:U.user},'zz_user_v1')),{code:'PT503',key:'api_disabled'});
        assert.equal((await call({role:'anon'},'status_v1')).rows[0].r.data.enabled,false);
        const v0=await as(db,{role:'anon'},`select count(*)::int n from public.nakgo_public_listings(null)`);
        assert.ok(!v0.error,'v0 RPC çalışır: '+JSON.stringify(v0.error));
      }finally{await db.exec('update private.api_settings set v1_enabled=true');}
    });
    await t.test('kullanım ölçümü: saatlik ve fonksiyon başına sayılır; kişisel veri yok',async()=>{
      await db.exec('delete from private.api_usage');
      for(let i=0;i<7;i++)await call({role:'anon'},'status_v1');
      await call({user:U.user},'zz_user_v1');
      await call({role:'anon'},'zz_user_v1');// hata: işlem geri alınır, sayılmaz
      const rows=(await db.query(`select version,fn,sum(calls)::int n,bool_and(hour=date_trunc('hour',hour)) h from private.api_usage group by 1,2 order by 2`)).rows;
      assert.deepEqual(rows.map(r=>[r.version,r.fn,r.n,r.h]),[['v1','status_v1',7,true],['v1','zz_user_v1',1,true]]);
      const all=JSON.stringify((await db.query('select * from private.api_usage')).rows);
      for(const id of Object.values(U))assert.ok(!all.includes(id),'hesap kimliği yok');
      assert.deepEqual((await db.query(`select column_name c from information_schema.columns where table_schema='private' and table_name='api_usage' order by ordinal_position`)).rows.map(r=>r.c),v1.usage_columns);
      const r=(await db.query(`select private.api_usage_retention() n`)).rows[0].n;assert.equal(Number(r),0);
      await db.query(`insert into private.api_usage values(now()-interval '401 days','v1','status_v1',0,3),(now()-interval '300 days','v1','status_v1',0,2)`);
      assert.equal(Number((await db.query(`select private.api_usage_retention() n`)).rows[0].n),1,'400 günden eski sayımlar silinir');
      assert.equal(Number((await db.query(`select count(*) n from private.api_usage where hour<now()-interval '200 days'`)).rows[0].n),1,'300 günlük sayım kalır');
    });
    await t.test('yetki: istemci api yardımcılarını, ayar/hata/kullanım tablolarını kullanamaz; api şemasında nesne oluşturamaz',async()=>{
      for(const role of ['anon','authenticated'])for(const sql of [
        `select private.api_raise('auth_required')`,`select private.api_begin('status_v1')`,`select private.api_actor()`,`select private.api_admin()`,
        `select private.api_cursor('1')`,`select private.api_usage_retention()`,`select * from private.api_usage`,`select * from private.api_errors`,
        `update private.api_settings set v1_enabled=false`,`insert into private.api_usage values(now(),'v1','status_v1',0,1)`,
        `create function api.x_v1() returns jsonb language sql as 'select null::jsonb'`,`create table api.t(id int)`]){
        const r=await as(db,{user:U.user,role},sql);
        assert.equal(r.error&&r.error.code,'42501',role+': '+sql+' → '+JSON.stringify(r.error||'açık'));
      }
    });
    await t.test('yetki: yardımcı fonksiyonlarda istemciye ve PUBLIC\'e çalıştırma izni yok (şema izninden bağımsız)',async()=>{
      const rows=(await db.query(`select p.oid::regprocedure::text f,r.r,has_function_privilege(r.r,p.oid,'execute') v
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values('anon'),('authenticated'),('public')) r(r)
        where n.nspname='private' and (p.proname like 'api\\_%')`)).rows;
      assert.ok(rows.length>=8);
      for(const x of rows)assert.equal(x.v,false,x.f+' → '+x.r);
    });
    await t.test('hata ayrıntısında kişisel ya da gizli veri yok',async()=>{
      const rows=(await db.query('select key,detail from private.api_errors')).rows;
      for(const r of rows)assert.ok(!/@|\+90|[0-9a-f]{8}-[0-9a-f]{4}|select |private\./i.test(r.detail),r.key+': '+r.detail);
      const e=(await call({user:U.unverified},'zz_user_v1')).error;
      assert.ok(!JSON.stringify(e).includes(U.unverified),'hata hesabı ele vermez');
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}
});

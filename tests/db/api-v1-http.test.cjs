/** B3-a: API v1'in yerel PostgREST üzerinden HTTP entegrasyonu. Supabase'in kullandığı API katmanı (PostgREST) yerelde
 * çalıştırılır; api ve public şemaları açılır, Supabase'in auth.uid() tanımı ve authenticator rol modeli taklit edilir.
 * Çalışması için: yerel gerçek PostgreSQL (NAKGO_PG_HOST) ve PostgREST ikilisi (NAKGO_POSTGREST_BIN). Yoksa atlanır.
 * Bu test gerçek Supabase'i KANITLAMAZ: Supabase'in PostgREST sürümü ve "Exposed schemas" ayarı canlıda ayrıca doğrulanır. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');
const v1=require('../../supabase/contract/v1.json');

const BIN=process.env.NAKGO_POSTGREST_BIN;
const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');

test('API v1 HTTP (yerel PostgREST)',async t=>{
  if(!realPg()||!BIN){t.skip('NAKGO_PG_HOST ve NAKGO_POSTGREST_BIN gerekli (yerel PostgREST); CI\'da henüz yok');return;}
  const db=await migratedDb();let proc=null,primary=null;
  const SECRET=crypto.randomBytes(32).toString('hex'),PW=crypto.randomBytes(16).toString('hex');
  const PORT=3900+Math.floor(Math.random()*90),ADMIN=PORT+100;
  const jwt=c=>{const h=b64({alg:'HS256',typ:'JWT'}),p=b64({aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+600,...c});return h+'.'+p+'.'+crypto.createHmac('sha256',SECRET).update(h+'.'+p).digest('base64url');};
  try{
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
      do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$;
      alter role authenticator password '${PW}'; grant anon,authenticated to authenticator;
      create function api.zz_raise_v1(p_key text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
       begin perform private.api_begin('zz_raise_v1'); if p_key='auth_required' then perform private.api_actor(); end if; perform private.api_raise(p_key); return null; end $f$;
      create function api.zz_user_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $f$
       begin perform private.api_begin('zz_user_v1'); return private.api_ok(jsonb_build_object('ok',private.api_actor() is not null)); end $f$;
      revoke all on function api.zz_raise_v1(text),api.zz_user_v1() from public;
      grant execute on function api.zz_raise_v1(text),api.zz_user_v1() to anon,authenticated;`);
    const user=crypto.randomUUID();
    await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[user]);
    const host=process.env.NAKGO_PG_HOST,port=process.env.NAKGO_PG_PORT||5432;
    const uri=host.startsWith('/')?`postgres://authenticator:${PW}@/${db.name}?host=${host}&port=${port}`:`postgres://authenticator:${PW}@${host}:${port}/${db.name}`;
    proc=spawn(BIN,[],{env:{PGRST_DB_URI:uri,PGRST_DB_SCHEMAS:'public,api',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:SECRET,
      PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(PORT),PGRST_ADMIN_SERVER_PORT:String(ADMIN),PGRST_LOG_LEVEL:'crit'},stdio:'ignore'});
    let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(`http://127.0.0.1:${ADMIN}/ready`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,150));}
    assert.ok(ready,'PostgREST hazır değil');
    const call=async(fn,{token=null,body={},schema='api',method='POST'}={})=>{
      const h={'content-type':'application/json',accept:'application/json'};
      if(schema){h['content-profile']=schema;h['accept-profile']=schema;}
      if(token)h.authorization='Bearer '+token;
      const r=await fetch(`http://127.0.0.1:${PORT}/rpc/${fn}`,{method,headers:h,body:method==='POST'?JSON.stringify(body):undefined});
      const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null,raw:text};
    };
    const T=jwt({sub:user,is_anonymous:false});

    await t.test('status_v1: misafir ve üye POST ile 200, yanıt biçimi sözleşmedeki gibi',async()=>{
      for(const token of [null,T]){
        const r=await call('status_v1',{token});
        assert.equal(r.status,200,r.raw);assert.deepEqual(Object.keys(r.body),['data']);assert.equal(r.body.data.api,'v1');
      }
    });
    await t.test('v1 uçları yalnız POST (GET, salt okunur işlemde sayım yazamaz)',async()=>{
      const r=await call('status_v1',{method:'GET'});
      assert.ok(r.status>=400,'GET reddedilmeli: '+r.status);
    });
    await t.test('hata anahtarları HTTP üzerinden: SQLSTATE, anahtar, işaret ve HTTP durumu sözleşmedeki gibi',async()=>{
      for(const [key,spec] of Object.entries(v1.errors)){
        const r=await call('zz_raise_v1',{token:key==='auth_required'?null:T,body:{p_key:key}});
        assert.equal(r.status,spec.http,key+': HTTP '+r.status+' '+r.raw);
        assert.equal(r.body.code,spec.sqlstate,key);assert.equal(r.body.message,key);assert.equal(r.body.hint,'nakgo.api');
        assert.ok(!r.raw.includes(user),key+': yanıtta hesap kimliği yok');
      }
    });
    await t.test('oturum: anonim oturum ve imzası geçersiz belirteç reddedilir; geçerli üye geçer',async()=>{
      assert.equal((await call('zz_user_v1',{token:jwt({sub:user,is_anonymous:true})})).body.message,'auth_required');
      const forged=T.slice(0,-4)+'AAAA';
      assert.equal((await call('zz_user_v1',{token:forged})).status,401);
      assert.equal((await call('zz_user_v1',{token:T})).body.data.ok,true);
    });
    await t.test('doğrudan tablo erişimi yok: api şemasında tablo yok, private şeması API\'de açık değil',async()=>{
      const h={'accept-profile':'api',authorization:'Bearer '+T};
      assert.equal((await fetch(`http://127.0.0.1:${PORT}/api_usage`,{headers:h})).status,404);
      assert.equal((await fetch(`http://127.0.0.1:${PORT}/api_usage`,{headers:{...h,'accept-profile':'private'}})).status,406);
      assert.equal((await call('api_begin',{token:T,schema:'private',body:{p_fn:'status_v1'}})).status,406);
    });
    await t.test('v0 aynı sunucuda değişmeden çalışır (varsayılan şema public)',async()=>{
      const r=await call('nakgo_public_listings',{schema:null,body:{}});
      assert.equal(r.status,200,r.raw);assert.ok(Array.isArray(r.body));
      const listings=await fetch(`http://127.0.0.1:${PORT}/listings?select=id&limit=1`,{headers:{authorization:'Bearer '+T}});
      assert.equal(listings.status,200,'v0 tablo okuması (RLS ile) sürer');
    });
    await t.test('kullanım sayımı HTTP çağrılarında da yazılır; kişisel veri yok',async()=>{
      const n=(await db.query(`select coalesce(sum(calls),0)::int n from private.api_usage where fn='status_v1'`)).rows[0].n;
      assert.ok(n>=2,'status_v1 sayıldı: '+n);
      assert.ok(!JSON.stringify((await db.query('select * from private.api_usage')).rows).includes(user));
    });
  }catch(e){primary=e;throw e;}
  finally{if(proc)proc.kill();await finish(db,primary);}
});

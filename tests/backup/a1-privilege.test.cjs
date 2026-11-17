/** B7-A1 testleri: yetki değişmezleri, yedek rolü profili, SECURITY DEFINER parmak izi ve K6 muafiyet doğrulaması.
 * Her "bozma" işlem içinde uygulanır ve geri alınır; beklenen sınıfa (nonwaivable / waivable) düşmesi şarttır. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {migratedDb,uniqueRole,dropRoles,withRollback,finish}=require('./helpers.cjs');
const PA=require('../../tools/backup/privilege-audit.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {validateWaiver,NAMESPACE}=require('../../tools/backup/waiver.cjs');
const C=require('../../tools/backup/crypto.cjs');
const root=path.resolve(__dirname,'../..');

test('backup-role.sql üreticiyle birebir aynı (elle düzenleme yok)',()=>{
  assert.equal(fs.readFileSync(path.join(root,'ops/backup/backup-role.sql'),'utf8'),BR.renderTemplate());
});

test('dışa aktarma sabitleri: dosya üreticiyle aynı; sayım listesi scope.json ile aynı',async()=>{
  const db=await migratedDb();let primary=null;
  try{
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'ops/backup/export-functions.json'),'utf8')),await PA.exportPins(db));
    const scope=BR.loadScope();
    const src=(await db.query(`select prosrc from pg_proc where oid='private.nakgo_backup_guard_counts()'::regprocedure`)).rows[0].prosrc;
    const inFn=[...new Set([...src.matchAll(/to_regclass\('([a-z_.]+)'\)/g)].map(m=>m[1]))].sort();
    const want=[...scope.excluded.guard_stop_if_rows,...scope.excluded.known_loss,...scope.guard_exact_zero,'pg_catalog.pg_largeobject_metadata'].sort();
    assert.deepEqual(inFn,want);
    // Her kapsam tablosunun dışa aktarma fonksiyonu var ve PUBLIC'e kapalı.
    for(const f of BR.exportFunctions(scope)){
      const pub=(await db.query(`select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=$1::regprocedure and a.grantee=0) v`,[f+'()'])).rows[0].v;
      assert.equal(pub,false,f+' PUBLIC\'e kapalı olmalı');
    }
  }catch(e){primary=e;throw e;}finally{await finish(db,primary);}
});

test('search_path kuralı: pg_temp açıkça en sonda olmalı',()=>{
  assert.equal(PA.searchPathStatus([]).ok,false);
  assert.equal(PA.searchPathStatus(['search_path=""']).ok,false);
  assert.equal(PA.searchPathStatus(['search_path=public']).ok,false);
  assert.equal(PA.searchPathStatus(['search_path=pg_temp, public']).ok,false);
  assert.equal(PA.searchPathStatus(['search_path=pg_catalog, pg_temp']).ok,true);
  assert.equal(PA.searchPathStatus(['search_path=public, pg_temp']).ok,true);
});

test('risk işaretleri',()=>{
  assert.deepEqual(PA.riskFlags("begin execute format('select 1'); end"),['dynamic_sql']);
  assert.deepEqual(PA.riskFlags('select net.http_post(1)'),['network']);
  assert.ok(PA.riskFlags('perform set_config($$a$$,1,true)').includes('setting_change'));
  assert.ok(PA.riskFlags('delete from public.x where 1=1').includes('data_write'));
  assert.deepEqual(PA.riskFlags('select 1 -- delete from x'),[]);
});

test('veritabanı denetimleri',async t=>{
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_t');const other=uniqueRole('nakgo_other_t');let primary=null;
  try{
    await t.test('migration şeması değişmezleri geçiyor',async()=>{
      const r=await PA.invariants(db);
      assert.equal(r.ok,true,JSON.stringify(r.failures));
      assert.deepEqual(r.public_definers,[]);
      assert.equal(r.service_role_checked,true);
    });
    await t.test('bozma: public SECURITY DEFINER fonksiyon PUBLIC\'e açık',async()=>{
      await withRollback(db,`create function public.zz_leak() returns int language sql security definer set search_path='' as 'select 1';`,async()=>{
        const r=await PA.invariants(db);
        assert.ok(r.failures.some(f=>f.code==='public_execute_definer'&&f.id==='public.zz_leak()'));
      });
    });
    await t.test('bozma: tetikleyici fonksiyon PUBLIC olsa da değişmez bozulmaz',async()=>{
      await withRollback(db,`create function public.zz_trg() returns trigger language plpgsql security definer set search_path='' as 'begin return new; end';`,async()=>{
        assert.equal((await PA.invariants(db)).ok,true);
      });
    });
    await t.test('bozma: service_role\'e beklenmeyen açık yetki',async()=>{
      await withRollback(db,`grant select on public.listings to service_role;`,async()=>{
        const r=await PA.invariants(db);
        assert.ok(r.failures.some(f=>f.code==='service_role_unexpected_grant'&&f.id==='table public.listings SELECT'));
      });
    });

    await db.exec(BR.renderLiteral({role,password:'test-only-'+role}));
    await db.exec(`create role ${other} nologin`);
    const evalNow=async(allowlist)=>PA.evaluate(await PA.audit(db,{role}),{allowlist});

    await t.test('yeni rol beklenen profilde: karar ok',async()=>{
      const a=await PA.audit(db,{role});
      const e=PA.evaluate(a);
      assert.equal(e.decision,'ok',JSON.stringify(e));
      assert.deepEqual(a.memberships,[]);
      assert.deepEqual(a.membership_grants,[]);
      assert.ok(a.tables_read.includes('public.listings'));
      assert.deepEqual(a.schemas.filter(x=>x.usage).map(x=>x.schema).filter(x=>!['public','private','pg_catalog','information_schema'].includes(x)),[],'auth/storage şemalarında USAGE yok');
      assert.deepEqual(a.tables_write,[]);
      assert.ok(a.export_functions.length===7&&a.export_functions.every(f=>f.execute_ok&&f.owner_is_schema_owner),JSON.stringify(a.export_functions));
      assert.equal(e.info.filter(x=>x.code==='export_function_pinned').length,7);
      // Süper kullanıcı olmadan kapatılamayan PUBLIC yan yolları bilgi olarak raporlanır (docs/backup/side-channels.md).
      const res=e.info.filter(x=>x.code==='accepted_residual').map(x=>x.id);
      for(const id of ['pg_catalog.lo_create(oid)','pg_catalog.lo_from_bytea(oid, bytea)','TEMP'])assert.ok(res.includes(id),id+' '+res.join(','));
      assert.ok(res.some(x=>x.startsWith('pg_catalog.pg_logical_emit_message(')));
      assert.deepEqual(await BR.verifyRole((s,p)=>db.query(s,p),{role}),[]);
    });
    await t.test('rol oturum tablolarını okuyamaz; Auth satırlarını yalnız dışa aktarma fonksiyonuyla alır',async()=>{
      await withRollback(db,'select 1',async()=>{
        await db.exec(`set role ${role}`);
        for(const t of ['auth.sessions','auth.refresh_tokens','auth.users']){
          await db.exec('savepoint d');
          await assert.rejects(db.query('select count(*) from '+t),e=>e.code==='42501',t);
          await db.exec('rollback to savepoint d');
        }
        const n=Number((await db.query('select count(*) n from private.nakgo_backup_auth_users()')).rows[0].n);
        await db.exec('reset role');
        assert.equal(n,Number((await db.query('select count(*) n from auth.users')).rows[0].n));
      });
    });
    await t.test('security_invoker görünümü Auth\'a dayansa da rol okuyamaz: bulgu yok',async()=>{
      await withRollback(db,`create view public.zz_inv with (security_invoker=true) as select id from auth.users; grant select on public.zz_inv to ${role}`,async()=>{
        assert.equal((await evalNow()).decision,'ok');
      });
    });
    await t.test('denetim deterministik',async()=>{
      const x=await evalNow(),y=await evalNow();
      assert.equal(x.audit_sha256,y.audit_sha256);
    });

    const nonwaivable=[
      ['tabloya INSERT',`grant insert on public.listings to ${role}`,'table_write'],
      ['kolon UPDATE',`grant update(note) on public.listings to ${role}`,'table_write'],
      ['TRUNCATE',`grant truncate on private.admin_audit to ${role}`,'table_write'],
      ['rol üyeliği',`grant authenticated to ${role}`,'membership'],
      ['pg_write_all_data üyeliği',`grant pg_write_all_data to ${role}`,'membership'],
      ['pg_read_all_data üyeliği (eski yöntem)',`grant pg_read_all_data to ${role}`,'membership'],
      ['auth şemasında doğrudan okuma',`grant usage on schema auth to ${role}; grant select on auth.sessions to ${role}`,'read_outside_scope'],
      ['dışa aktarma fonksiyonu PUBLIC\'e açıldı',`grant execute on function private.nakgo_backup_auth_users() to public`,'export_function_changed'],
      ['dışa aktarma fonksiyonu başka role açıldı',`grant execute on function private.nakgo_backup_auth_identities() to ${other}`,'export_function_changed'],
      ['dışa aktarma gövdesi değişti',`create or replace function private.nakgo_backup_storage_buckets() returns setof jsonb language plpgsql stable security definer
        set search_path = pg_catalog, pg_temp as $f$ begin return query select to_jsonb(t) from auth.sessions t; end $f$`,'export_function_changed'],
      ['dışa aktarma ayarı değişti',`alter function private.nakgo_backup_auth_users() set search_path = public, pg_temp`,'export_function_changed'],
      ['dışa aktarma sahibi değişti',`alter function private.nakgo_backup_auth_users() owner to ${other}`,'export_function_changed'],
      ['dışa aktarma fonksiyonu silindi',`drop function private.nakgo_backup_storage_objects()`,'export_function_changed'],
      ['ağ fonksiyonu çağrılabilir (pg_net benzeri)',`create schema net; create function net.http_post(u text) returns bigint language sql as 'select 1'; grant usage on schema net to ${role}`,'network_function'],
      ['dblink benzeri fonksiyon',`create function public.dblink_exec(t text) returns text language sql as 'select t'`,'network_function'],
      ['public görünümü üzerinden oturum okuma',`create view public.zz_sess as select * from auth.sessions; grant select on public.zz_sess to ${role}`,'view_reads_outside_scope'],
      ['materyalize görünüm üzerinden Auth okuma',`create materialized view private.zz_mv as select id,email from auth.users; grant select on private.zz_mv to ${role}`,'view_reads_outside_scope'],
      ['yedek rolünün üyesi olan rol (dışa aktarmayı çağırabilir)',`grant ${role} to ${other}`,'role_has_members'],
      ['dışa aktarma fonksiyonu yedek rolünün üyesine dolaylı açık',`grant ${role} to ${other}`,'export_function_changed'],
      ['dolaylı üyelik',`grant authenticated to ${other}; grant ${other} to ${role}`,'membership'],
      ['şemada CREATE',`grant create on schema public to ${role}`,'schema_create'],
      ['dizi USAGE',`grant usage on sequence public.listings_id_seq to ${role}`,'sequence_write'],
      ['BYPASSRLS kaldırıldı',`alter role ${role} nobypassrls`,'role_attribute'],
      ['bağlantı sınırı sınırsız',`alter role ${role} connection limit -1`,'role_attribute'],
      ['CREATEROLE',`alter role ${role} createrole`,'role_attribute'],
    ];
    for(const [name,sql,code] of nonwaivable){
      await t.test('bozma (muaf tutulamaz): '+name,async()=>{
        await withRollback(db,sql,async()=>{
          const e=await evalNow();
          assert.equal(e.decision,'stop_nonwaivable',name);
          assert.ok(e.nonwaivable.some(x=>x.code===code),JSON.stringify(e.nonwaivable));
        });
      });
    }
    await t.test('bozma: veritabanında CREATE',async t2=>{
      if(db.engine==='pglite'){t2.skip('PGlite: geri alınmış bir işlemden sonra pg_database güncellemesi "tuple concurrently deleted" veriyor (PGlite kusuru); PG16/PG17\'de çalışır');return;}
      const dbname=(await db.query('select current_database() d')).rows[0].d;
      // PGlite veritabanı düzeyindeki GRANT'ı işlem içinde geri alamıyor; bu yüzden açıkça geri alınır.
      await db.exec(`grant create on database "${dbname}" to ${role}`);
      try{assert.ok((await evalNow()).nonwaivable.some(x=>x.code==='database_create'));}
      finally{await db.exec(`revoke create on database "${dbname}" from ${role}`);}
      assert.equal((await evalNow()).decision,'ok');
    });

    const fnSafe=`create function private.zz_count() returns bigint language sql stable security definer set search_path = pg_catalog, pg_temp as 'select count(*) from public.listings';
      revoke execute on function private.zz_count() from public; grant execute on function private.zz_count() to ${role};`;
    await t.test('bozma: izin listesinde olmayan çağrılabilir SECURITY DEFINER → waivable',async()=>{
      await withRollback(db,fnSafe,async()=>{
        const e=await evalNow();
        assert.equal(e.decision,'stop_waivable');
        assert.equal(e.waivable[0].code,'definer_unreviewed');
        assert.equal(e.waivable[0].id,'private.zz_count()');
      });
    });
    await t.test('izin listesi: geçerli kayıt ok; gövde/ACL/sahip/bağımlı tablo değişince fark',async()=>{
      await withRollback(db,fnSafe,async()=>{
        const fp=(await PA.audit(db,{role})).definer_functions.find(f=>f.id==='private.zz_count()');
        assert.equal(fp.search_path.ok,true);
        assert.ok(fp.relations.some(r=>r.name==='public.listings'),'bağımlı tablo bulunmalı');
        const entry={id:fp.id,fingerprint_sha256:fp.fingerprint_sha256,reviewed_by:'test',reviewed_at:'2026-11-17',reason:'test',data_scope:['public.listings sayısı']};
        const allow={version:1,entries:[entry]};
        assert.equal((await evalNow(allow)).decision,'ok');
        assert.equal((await evalNow({version:1,entries:[{...entry,data_scope:[]}]})).waivable[0].code,'definer_allowlist_invalid');
        const changes=[
          ['gövde',`create or replace function private.zz_count() returns bigint language sql stable security definer set search_path = pg_catalog, pg_temp as 'select count(*)+0 from public.listings'`],
          ['bağımlı tablonun ACL\'si',`grant select on public.listings to anon`],
          ['bağımlı tablonun RLS\'si',`alter table public.listings no force row level security; alter table public.listings force row level security`],
          ['bağımlı tablonun politikası',`create policy zz_p on public.listings for select to anon using (true)`],
          ['sahip',`alter function private.zz_count() owner to ${other}`],
          ['EXECUTE yolu',`grant execute on function private.zz_count() to public`],
          ['ayar',`alter function private.zz_count() set work_mem = '1MB'`],
        ];
        for(const [what,sql] of changes){
          await db.exec('savepoint s');
          try{await db.exec(sql);const e=await evalNow(allow);assert.equal(e.decision,'stop_waivable',what);assert.equal(e.waivable[0].code,'definer_changed',what);}
          finally{await db.exec('rollback to savepoint s');}
        }
      });
    });
    await t.test('bozma: search_path=\'\' (pg_temp örtük olarak önde) gerekçesiz geçmez',async()=>{
      await withRollback(db,`create function private.zz_sp() returns int language sql security definer set search_path='' as 'select 1';
        grant execute on function private.zz_sp() to ${role};`,async()=>{
        const fp=(await PA.audit(db,{role})).definer_functions.find(f=>f.id==='private.zz_sp()');
        assert.equal(fp.search_path.ok,false);
        const entry={id:fp.id,fingerprint_sha256:fp.fingerprint_sha256,reviewed_by:'t',reviewed_at:'t',reason:'t',data_scope:['sabit 1']};
        const e=await evalNow({version:1,entries:[entry]});
        assert.ok(e.waivable[0].problems.some(p=>p.includes('search_path')));
        assert.equal((await evalNow({version:1,entries:[{...entry,search_path_exception:'yalnız sabit döndürür, tablo/tip adı yok'}]})).decision,'ok');
      });
    });
    await t.test('bozma: dinamik SQL ve yazma işareti gerekçe ister',async()=>{
      await withRollback(db,`create function private.zz_dyn(t text) returns void language plpgsql security definer set search_path = pg_catalog, pg_temp
          as $f$ begin execute format('delete from %s',t); end $f$; grant execute on function private.zz_dyn(text) to ${role};`,async()=>{
        const fp=(await PA.audit(db,{role})).definer_functions.find(f=>f.id==='private.zz_dyn(t text)');
        assert.ok(fp.risk_flags.includes('dynamic_sql')&&fp.risk_flags.includes('data_write'));
        const e=await evalNow({version:1,entries:[{id:fp.id,fingerprint_sha256:fp.fingerprint_sha256,reviewed_by:'t',reviewed_at:'t',reason:'t',data_scope:['yok']}]});
        assert.ok(e.waivable[0].problems.some(p=>p.includes('risk')));
      });
    });
    await t.test('çağrılabilirlik şema USAGE ister: auth/storage çağrılamaz; PUBLIC USAGE\'lı yeni şema denetlenir',async()=>{
      await withRollback(db,`create function storage.zz_s() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        create function auth.zz_a() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        create schema zz_hidden; create function zz_hidden.f() returns int language sql security definer as 'select 1';
        create schema zz_open; grant usage on schema zz_open to public; create function zz_open.f() returns int language sql security definer as 'select 1';`,async()=>{
        const ids=(await PA.audit(db,{role})).definer_functions.map(f=>f.id);
        assert.ok(!ids.includes('storage.zz_s()')&&!ids.includes('auth.zz_a()')&&!ids.includes('zz_hidden.f()'),'USAGE olmayan şemadaki fonksiyon çağrılamaz');
        assert.ok(ids.includes('zz_open.f()'),'PUBLIC USAGE verilen şemadaki fonksiyon denetlenir');
        assert.equal(PA.evaluate(await PA.audit(db,{role})).decision,'stop_waivable');
      });
    });
    await t.test('çağrılan SECURITY DEFINER fonksiyon değişirse çağıranın parmak izi değişir',async()=>{
      await withRollback(db,`create function private.zz_inner() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select 1';
        create function private.zz_outer() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select private.zz_inner()';
        revoke execute on function private.zz_inner() from public; grant execute on function private.zz_outer() to ${role};`,async()=>{
        const before=(await PA.audit(db,{role})).definer_functions.find(f=>f.id==='private.zz_outer()');
        assert.ok(before.calls.some(c=>c.id==='private.zz_inner()'));
        await db.exec(`create or replace function private.zz_inner() returns int language sql security definer set search_path = pg_catalog, pg_temp as 'select 2'`);
        const after=(await PA.audit(db,{role})).definer_functions.find(f=>f.id==='private.zz_outer()');
        assert.notEqual(before.fingerprint_sha256,after.fingerprint_sha256);
      });
    });

    await t.test('K6 muafiyeti',async t2=>{
      await withRollback(db,fnSafe,async()=>{
        const evaluation=await evalNow();
        const k2=C.testKeyPair(),k1=C.testKeyPair();
        const trusted={[k2.keyId]:k2.publicKey};
        const now=new Date('2026-11-17T10:00:00Z');
        const base={version:1,environment:'test',waiver_id:C.randomUUID(),event_id:C.randomUUID(),diff_sha256:evaluation.waivable_diff_sha256,
          covers:evaluation.waivable.map(w=>({id:w.id,fingerprint_sha256:w.fingerprint_sha256})),reason:'Supabase güncellemesi inceleniyor',
          issued_at:'2026-11-17T09:00:00Z',not_after:'2026-11-18T09:00:00Z'};
        const good=C.sign(NAMESPACE,base,k2.privateKey,k2.keyId);
        const opts={enabled:true,environment:'test',trustedKeys:trusted,now,evaluation};
        await t2.test('geçerli belge yalnız açıkça etkinleştirilince geçer',()=>{
          assert.equal(validateWaiver(good,opts).ok,true);
          assert.equal(validateWaiver(good,{...opts,enabled:false}).ok,false);
          assert.equal(validateWaiver(good,{...opts,environment:'production'}).ok,false);
        });
        const bad=[
          ['K1 (yanlış anahtar) imzası',C.sign(NAMESPACE,base,k1.privateKey,k1.keyId)],
          ['başka amaçlı imza (alan adı)',C.sign('nakgo-backup-release/v1',base,k2.privateKey,k2.keyId)],
          ['imzadan sonra alan değişti',{...good,reason:'değiştirilmiş gerekçe metni'}],
          ['farklı diff',C.sign(NAMESPACE,{...base,diff_sha256:'0'.repeat(64)},k2.privateKey,k2.keyId)],
          ['eksik kapsam',C.sign(NAMESPACE,{...base,covers:[]},k2.privateKey,k2.keyId)],
          ['48 saati aşan süre',C.sign(NAMESPACE,{...base,not_after:'2026-11-19T10:00:00Z'},k2.privateKey,k2.keyId)],
          ['süresi dolmuş',C.sign(NAMESPACE,{...base,issued_at:'2026-11-16T00:00:00Z',not_after:'2026-11-16T12:00:00Z'},k2.privateKey,k2.keyId)],
          ['UUID olmayan olay',C.sign(NAMESPACE,{...base,event_id:'olay-1'},k2.privateKey,k2.keyId)],
          ['gerekçe yok',C.sign(NAMESPACE,{...base,reason:''},k2.privateKey,k2.keyId)],
        ];
        for(const [name,doc] of bad)await t2.test('reddedilir: '+name,()=>assert.equal(validateWaiver(doc,opts).ok,false,name));
        await t2.test('muaf tutulamayan bulgu varken geçerli belge de reddedilir',async()=>{
          await db.exec('savepoint w');
          try{
            await db.exec(`grant insert on public.listings to ${role}`);
            const ev=await evalNow();
            assert.equal(ev.decision,'stop_nonwaivable');
            assert.equal(validateWaiver(good,{...opts,evaluation:ev}).ok,false);
          }finally{await db.exec('rollback to savepoint w');}
        });
      });
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);await dropRoles([role,other]);}
});

/* Dar rol uygulanabilirliği. Supabase'in sahiplik modeli YEREL olarak taklit edilir (gerçek Supabase'e bağlanılmaz):
 *  - "postgres" benzeri rol: süper kullanıcı DEĞİL, CREATEROLE + BYPASSRLS; public/private nesnelerinin ve dışa aktarma
 *    fonksiyonlarının sahibi;
 *  - auth/storage şeması ve tabloları başka rollerin; "postgres" benzeri rol onlarda USAGE/SELECT'i grant option OLMADAN tutar.
 * Bu, Supabase belgelerinde anlatılan durumdur; gerçek davranış B7-B'de geçici bir Supabase projesinde doğrulanır (V4–V8). */
test('dar rol: PG16+ BYPASSRLS kuralı ve Supabase sahiplik modelinde şablon, dışa aktarma ve RLS koruması',async t=>{
  const {realPg}=require('./helpers.cjs');
  if(!realPg()){t.skip('PGlite tek kullanıcılı; rol öznitelik kuralları gerçek PostgreSQL16/17 ile sınanır');return;}
  const db=await migratedDb();
  const sfx=uniqueRole('x').slice(2);
  const R={pg:'sim_pg'+sfx,nobypass:'sim_nobypass'+sfx,schemaOwner:'sim_admin'+sfx,authOwner:'sim_auth_admin'+sfx,backup:'nakgo_backup_sim'+sfx,b2:'nakgo_backup_nb'+sfx};
  const verify=()=>BR.verifyRole((q,p)=>db.query(q,p),{role:R.backup});
  let primary=null;
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    await db.exec(`create role ${R.pg} createrole bypassrls; create role ${R.nobypass} createrole; create role ${R.schemaOwner}; create role ${R.authOwner};`);
    // public/private'ın ve dışa aktarma fonksiyonlarının sahibi "postgres" benzeri rol (Supabase'te migration'lar postgres ile çalışır).
    await db.exec(`do $$ declare r record; begin
      for r in select n.nspname s,c.relname t,c.relkind k from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','private') and c.relkind in('r','p','v','m','S')
          and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in('a','i')) loop
        execute format('alter %s %I.%I owner to ${R.pg}',case when r.k='S' then 'sequence' when r.k in('v') then 'view' when r.k='m' then 'materialized view' else 'table' end,r.s,r.t);
      end loop;
      for r in select p.oid::regprocedure f from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'nakgo_backup_%' loop
        execute format('alter function %s owner to ${R.pg}',r.f);
      end loop;
      alter schema public owner to ${R.pg}; alter schema private owner to ${R.pg};
      alter schema auth owner to ${R.schemaOwner}; alter schema storage owner to ${R.schemaOwner};
      for r in select n.nspname s,c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('auth','storage') and c.relkind='r' loop
        execute format('alter table %I.%I owner to ${R.authOwner}',r.s,r.t);
        execute format('grant select on %I.%I to ${R.pg}',r.s,r.t);
      end loop;
      grant usage on schema auth, storage to ${R.pg};
    end $$;`);
    // 1) BYPASSRLS'i olmayan CREATEROLE rolü BYPASSRLS'li rol oluşturamaz; şablon tek işlemde durur, yarım rol kalmaz.
    await assert.rejects(db.exec(`set role ${R.nobypass}; ${BR.renderLiteral({role:R.b2,password:'test-only-'+R.b2})}`),e=>e.code==='42501','CREATEROLE tek başına yetmez');
    await db.exec('reset role');
    assert.equal((await db.query(`select count(*)::int n from pg_roles where rolname=$1`,[R.b2])).rows[0].n,0,'yarım rol yok');
    // 2) Tablo tablo Auth yetkisi bu sahiplik modelinde ETKİSİZ (grant option yok): dışa aktarma fonksiyonları bu yüzden var.
    await db.exec(`create role ${R.b2} nologin; set role ${R.pg}; grant select on auth.users to ${R.b2}; reset role;`);
    assert.equal((await db.query(`select has_table_privilege($1,'auth.users','SELECT') v`,[R.b2])).rows[0].v,false,'tablo tablo yetki etkisiz');
    // 3) Şablon, süper kullanıcı ve pg_read_all_data olmadan, "postgres" benzeri rolle hatasız çalışır.
    await db.exec(`set role ${R.pg}; ${BR.renderLiteral({role:R.backup,password:'test-only-'+R.backup})} reset role;`);
    const a=(await db.query(`select rolbypassrls,rolsuper from pg_roles where rolname=$1`,[R.backup])).rows[0];
    assert.equal(a.rolbypassrls,true,'PG'+major+': BYPASSRLS verilebildi');assert.equal(a.rolsuper,false);
    assert.deepEqual(await verify(),[]);
    const e=PA.evaluate(await PA.audit(db,{role:R.backup}));
    assert.equal(e.decision,'ok',JSON.stringify(e.nonwaivable));
    await db.exec(`insert into auth.users(id,email) values (gen_random_uuid(),'sim-${sfx}@example.test')`);
    // 4) Rol Auth satırlarını yalnız fonksiyonla alır (sahibi başka olan tablolardan); oturumlara hiçbir yoldan ulaşamaz.
    await db.exec(`set role ${R.backup}`);
    const n=Number((await db.query('select count(*) n from private.nakgo_backup_auth_users()')).rows[0].n);
    await assert.rejects(db.query('select 1 from auth.sessions limit 1'),e=>e.code==='42501');
    await db.exec('reset role');
    assert.equal(n,Number((await db.query('select count(*) n from auth.users')).rows[0].n));
    assert.ok(n>0,'test verisinde kullanıcı var');
    // 5) Fonksiyon sahibi RLS'ye tabi olursa sessizce eksik döndürmez, HATA verir.
    await db.exec(`alter table auth.users enable row level security; alter role ${R.pg} nobypassrls; set role ${R.backup}`);
    await assert.rejects(db.query('select count(*) from private.nakgo_backup_auth_users()'),/RLS etkin/);
    await db.exec(`reset role; alter role ${R.pg} bypassrls; alter table auth.users disable row level security`);
    // 6) Doğrulama sapmaları yakalar.
    await db.exec(`alter role ${R.backup} nobypassrls`);
    assert.ok((await verify()).some(p=>/BYPASSRLS/.test(p)));
    await db.exec(`alter role ${R.backup} bypassrls; grant pg_read_all_data to ${R.backup} with inherit true`);
    assert.ok((await verify()).some(p=>/beklenmeyen üyelik: pg_read_all_data/.test(p)));
    assert.ok((await verify()).some(p=>/doğrudan okunabilmemeli: auth\.sessions/.test(p)),'pg_read_all_data oturumları okutur');
    await db.exec(`revoke pg_read_all_data from ${R.backup}; set role ${R.pg}; revoke execute on function private.nakgo_backup_auth_users() from ${R.backup}; reset role`);
    assert.ok((await verify()).some(p=>/çağrılamıyor: private\.nakgo_backup_auth_users/.test(p)));
  }catch(e){primary=e;throw e;}
  finally{
    try{await db.exec('reset role');}catch{}
    await finish(db,primary);
    await dropRoles([R.backup,R.b2,R.pg,R.nobypass,R.schemaOwner,R.authOwner]);
  }
});

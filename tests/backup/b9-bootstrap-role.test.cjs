'use strict';
/* İlk yedek (bootstrap) için geçici salt okunur rol: ops/backup/bootstrap-role.sql ve bootstrap-role-drop.sql.
 * Gerçek PostgreSQL 17'de, Production biçiminde kaynakta (32 migration + Supabase taklidi + 38 yardımcı tablo).
 * Betikler Supabase'teki postgres'e benzeyen, süper kullanıcı OLMAYAN bir rolle (CREATEROLE, BYPASSRLS,
 * pg_read_all_data ADMIN, pg_signal_backend) çalıştırılır. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {realPg,uniqueRole,dropRoles}=require('./helpers.cjs');
const {prodShaped,PROD_AUX_TABLES}=require('./prod-fixture.cjs');
const {snapshotDump,binPath,toolMajor}=require('../../tools/backup/dump.cjs');
const {restoreAndVerify}=require('../../tools/backup/restore-verify.cjs');
const {loadScope}=require('../../tools/backup/backup-role.cjs');

const root=path.join(__dirname,'../..');
const ROLE='nakgo_bootstrap_reader';
const CREATE=path.join(root,'ops/backup/bootstrap-role.sql');
const DROP=path.join(root,'ops/backup/bootstrap-role-drop.sql');
const days=n=>new Date(Date.now()+n*86400000).toISOString();

test('bootstrap rolü betikleri: parola, bağlantı bilgisi ya da anahtar içermez',()=>{
  for(const f of [CREATE,DROP]){
    const code=fs.readFileSync(f,'utf8').split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
    assert.doesNotMatch(code,/\bpassword\b/i,f+': parola atanmaz');
    assert.doesNotMatch(code,/postgres(ql)?:\/\/|pooler\.supabase|BEGIN [A-Z ]*PRIVATE KEY|AGE-SECRET-KEY/i,f);
  }
});

test('bootstrap rolü (gerçek PostgreSQL, Production biçiminde kaynak)',async t=>{
  if(!realPg()){t.skip('PGlite: roller ve çoklu bağlantı yok');return;}
  const pgBin=process.env.NAKGO_PG_BIN;
  const tool=await toolMajor('psql',pgBin);
  if(!tool){if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error('psql gerekli');t.skip('psql yok');return;}
  const {Client}=require('pg');
  const base={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432)};
  const su={...base,user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD};
  await dropRoles([ROLE]);
  const P=await prodShaped();const db=P.db;
  const emul=uniqueRole('nakgo_pgemul');const pw='test-only-'+emul;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-brole-'));
  const clients=[];
  const closeAll=async()=>{while(clients.length)await clients.pop().end().catch(()=>{});};
  const connectAs=async()=>{const c=new Client({...base,user:ROLE,password:'test-only-reader',database:db.name});c.on('error',()=>{});await c.connect();clients.push(c);return c;};
  // Betikler sahibin çalıştıracağı biçimde (oluşturma: psql --single-transaction; kaldırma: tek işlem olmadan; ikisi de
  // ON_ERROR_STOP); Supabase postgres'ini taklit eden rolle. single/asSuperuser/pre yalnız negatif testler içindir.
  const psql=(file,vars={},{single=file===CREATE,asSuperuser=false,pre=[]}={})=>{
    const args=['-X','-q',...(single?['--single-transaction']:[]),'-v','ON_ERROR_STOP=1',...Object.entries(vars).flatMap(([k,v])=>['-v',k+'='+v]),
      ...pre.flatMap(s=>['-c',s]),...(asSuperuser?[]:['-c','set role '+emul]),'-f',file];
    const r=spawnSync(binPath('psql',pgBin),args,{encoding:'utf8',env:{...process.env,PGHOST:su.host,PGPORT:String(su.port),PGUSER:su.user,PGPASSWORD:su.password||'',PGDATABASE:db.name,PGOPTIONS:''}});
    return {code:r.status,err:(r.stderr||'')+(r.stdout||'')};
  };
  const roleRow=async()=>(await db.query(`select r.*,a.rolpassword is null nopw,(select array_agg(g.rolname::text order by 1) from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid) member_of
    from pg_roles r join pg_authid a on a.oid=r.oid where r.rolname=$1`,[ROLE])).rows[0];
  try{
    await db.exec(`create role ${emul} login password '${pw}' nosuperuser createrole bypassrls inherit;
      grant pg_read_all_data to ${emul} with admin option, inherit true;grant pg_signal_backend to ${emul};`);

    await t.test('ön koşul: geçersiz geçerlilik tarihi ya da B7 fonksiyonları varsa rol oluşmaz',async()=>{
      for(const v of [days(30),days(-1)]){
        const r=psql(CREATE,{valid_until:v});
        assert.notEqual(r.code,0);assert.match(r.err,/valid_until/);
        assert.equal(await roleRow(),undefined,'işlem geri alındı');
      }
      await db.exec(`create function private.nakgo_backup_guard_counts() returns int language sql as 'select 0'`);
      try{
        const r=psql(CREATE,{valid_until:days(7)});
        assert.notEqual(r.code,0);assert.match(r.err,/K6b/);assert.equal(await roleRow(),undefined);
      }finally{await db.exec('drop function private.nakgo_backup_guard_counts()');}
    });

    await t.test('ön koşul: role beklenmeyen üye varsa (oluşturucu ADMIN dışında) rol oluşmaz',async()=>{
      // createrole_self_grant: oluşturucu rolün yetkilerini de alır (INHERIT/SET) → reddedilir.
      const a=psql(CREATE,{valid_until:days(7)},{pre:["set createrole_self_grant = 'set, inherit'"]});
      assert.notEqual(a.code,0);assert.match(a.err,/beklenmeyen rol üyeleri/);assert.match(a.err,/inherit=true set=true/);
      assert.equal(await roleRow(),undefined,'işlem geri alındı');
      // Süper kullanıcıyla çalıştırma: oluşturucu üyeliği oluşmaz, beklenen tek satır yok → reddedilir.
      const b=psql(CREATE,{valid_until:days(7)},{asSuperuser:true});
      assert.notEqual(b.code,0);assert.match(b.err,/beklenmeyen rol üyeleri/);
      assert.equal(await roleRow(),undefined);
    });

    await t.test('oluşturma: yalnız beklenen öznitelikler ve tek üyelik; parola yok; ikinci çalıştırma reddedilir',async()=>{
      const r=psql(CREATE,{valid_until:days(7)});
      assert.equal(r.code,0,r.err);
      const x=await roleRow();
      assert.equal(x.rolcanlogin,true);assert.equal(x.rolsuper,false);assert.equal(x.rolinherit,false);assert.equal(x.rolbypassrls,true);
      assert.equal(x.rolcreatedb,false);assert.equal(x.rolcreaterole,false);assert.equal(x.rolreplication,false);assert.equal(x.rolconnlimit,3);
      assert.ok(x.rolvaliduntil>new Date()&&x.rolvaliduntil<new Date(Date.now()+8*86400000));
      assert.equal(x.nopw,true,'parola betikte verilmez');
      assert.deepEqual(x.member_of,['pg_read_all_data']);
      assert.ok(x.rolconfig.includes('default_transaction_read_only=on'));
      const m=(await db.query(`select admin_option,inherit_option,set_option from pg_auth_members where member=(select oid from pg_roles where rolname=$1)`,[ROLE])).rows;
      assert.deepEqual(m,[{admin_option:false,inherit_option:true,set_option:false}]);
      const own=(await db.query(`select count(*)::int n from pg_shdepend d join pg_roles r on r.oid=d.refobjid where r.rolname=$1 and d.deptype in ('o','a')`,[ROLE])).rows[0].n;
      assert.equal(own,0,'hiçbir nesnenin sahibi değil, hiçbir nesnede doğrudan yetkisi yok');
      const again=psql(CREATE,{valid_until:days(7)});
      assert.notEqual(again.code,0);assert.match(again.err,/zaten var/);
      // Parolasız rol giriş yapamaz; test parolası yalnız burada, süper kullanıcı tarafından verilir.
      await assert.rejects(connectAs());
      await db.exec(`alter role ${ROLE} password 'test-only-reader'`);
    });

    await t.test('salt okunurluk oturum ayarına dayanmaz: varsayılan kapatılsa da hiçbir yere yazamaz',async()=>{
      const c=await connectAs();
      assert.equal((await c.query(`select current_setting('default_transaction_read_only') v`)).rows[0].v,'on','rol düzeyinde varsayılan');
      await assert.rejects(c.query('create temp table t1(i int)'),e=>e.code==='25006','varsayılanla geçici tablo da yok');
      await c.query('set default_transaction_read_only = off');
      const tables=(await db.query(`select format('%I.%I',n.nspname,c.relname) t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and (n.nspname in ('public','private') or format('%I.%I',n.nspname,c.relname)=any($1::text[])) order by 1`,
        [[...PROD_AUX_TABLES.map(([t])=>t),'cron.job','supabase_migrations.schema_migrations']])).rows.map(r=>r.t);
      assert.ok(tables.length>=60,'tam şemalar + 38 yardımcı + meta: '+tables.length);
      for(const tb of tables){
        await assert.rejects(c.query(`delete from ${tb} where false`),e=>e.code==='42501',tb+' DELETE');
        await assert.rejects(c.query(`truncate ${tb}`),e=>e.code==='42501',tb+' TRUNCATE');
      }
      for(const s of ['public','private'])await assert.rejects(c.query(`create table ${s}.nakgo_x(i int)`),e=>e.code==='42501',s+' CREATE');
      await assert.rejects(c.query('create schema nakgo_x'),e=>e.code==='42501');
      await assert.rejects(c.query('create role nakgo_x'),e=>e.code==='42501');
      await assert.rejects(c.query('set role pg_read_all_data'),e=>e.code==='42501','SET FALSE');
      await assert.rejects(c.query(`set role ${emul}`),e=>e.code==='42501');
      const seq=(await db.query(`select format('%I.%I',n.nspname,c.relname) s from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname in ('public','private') limit 1`)).rows[0].s;
      await assert.rejects(c.query(`select nextval('${seq}')`),e=>e.code==='42501','dizi ilerletilemez');
      // Bilinen yan yol (belgelendi): varsayılan kapatılınca oturuma özel geçici tablo açılabilir (PUBLIC TEMP yetkisi).
      await c.query('create temp table t2(i int)');
      await closeAll();
    });

    await t.test('kapsam: tam şemalar, 38 yardımcı tablo ve meta eksiksiz okunur; RLS atlanır (sayılar süper kullanıcıyla aynı)',async()=>{
      await db.query(`insert into cron.job(jobname,schedule,command,username) values('baska-rol','* * * * *','select 1','service_role')`);
      const c=await connectAs();
      const rels=(await db.query(`select format('%I.%I',n.nspname,c.relname) t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p','S') and (n.nspname in ('public','private') or format('%I.%I',n.nspname,c.relname)=any($1::text[])) order by 1`,
        [[...PROD_AUX_TABLES.map(([t])=>t),'cron.job','supabase_migrations.schema_migrations']])).rows.map(r=>r.t);
      const rlsOn=(await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and n.nspname in ('public','private','auth','cron')`)).rows[0].n;
      assert.ok(rlsOn>=10,'taklitte RLS açık tablolar var: '+rlsOn);
      let rows=0;
      for(const tb of rels){
        const q=`select count(*)::int n from ${tb}`;
        const want=(await db.query(q)).rows[0].n,got=(await c.query(q)).rows[0].n;
        assert.equal(got,want,tb);rows+=want;
      }
      assert.ok(rows>0);
      await closeAll();
      // BYPASSRLS olmadan: cron.job yalnız kendi işlerini gösterir (sessiz eksik) ve pg_dump RLS yüzünden durur.
      await db.exec(`alter role ${ROLE} nobypassrls`);
      try{
        const c2=await connectAs();
        assert.equal((await c2.query('select count(*)::int n from cron.job')).rows[0].n,0,'BYPASSRLS yokken cron.job eksik okunur');
        await closeAll();
        const d=spawnSync(binPath('pg_dump',pgBin),['-Fc','-n','public','-f',path.join(dir,'x.dump')],{encoding:'utf8',
          env:{...process.env,PGHOST:base.host,PGPORT:String(base.port),PGUSER:ROLE,PGPASSWORD:'test-only-reader',PGDATABASE:db.name,PGOPTIONS:''}});
        assert.notEqual(d.status,0);assert.match(d.stderr,/row-level security/i);
      }finally{await db.exec(`alter role ${ROLE} bypassrls`);}
    });

    await t.test('bootstrap dökümü bu rolle alınır, geri yüklenir ve 7 kontrolün hepsinden geçer; sayı bozulursa doğrulama düşer',async()=>{
      const out=path.join(dir,'dump');fs.mkdirSync(out,{mode:0o700});
      const conn={...base,user:ROLE,password:'test-only-reader',database:db.name};
      const r=await snapshotDump({conn,scope:loadScope(),outDir:out,pgBin,allowLocal:true,mode:'bootstrap'});
      assert.equal(r.status,'ok',JSON.stringify(r.reasons||r.stage));
      assert.equal(r.source.dump_role,ROLE);assert.equal(r.source.used_snapshot,true);
      assert.equal(r.source.meta_files['cron.job'].rows,3,'başka role ait iş de dahil: '+JSON.stringify(r.source.meta_files['cron.job']));
      assert.ok(Object.keys(r.source.counts).length>=26,'kapsam tabloları sayıldı: '+Object.keys(r.source.counts).length);
      assert.ok(Object.keys(r.source.guard_counts).length>=22,'koruma sayımları');
      // Geri yükleme: geçici yerel veritabanına A (pg_dump) + B (COPY) yüklenir ve kaynakla karşılaştırılır.
      const v=await restoreAndVerify({bundleDir:out,pgBin});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      assert.deepEqual(v.checks.map(c=>c.code).sort(),['auth_version','b_content','counts','fingerprint','fk_orphans','meta','restore']);
      assert.ok(v.checks.every(c=>c.ok));
      // Kanıt: doğrulama gerçekten geri yüklenen veriye bakıyor. Kaynak kaydındaki bir sayı bozulunca 'counts' düşer.
      const sf=path.join(out,'source.json');const src=JSON.parse(fs.readFileSync(sf,'utf8'));
      const tb=Object.keys(src.counts).find(k=>k.startsWith('private.'));src.counts[tb]+=1;
      fs.writeFileSync(sf,JSON.stringify(src));
      const bad=await restoreAndVerify({bundleDir:out,pgBin});
      assert.equal(bad.status,'failed');
      assert.equal(bad.checks.find(c=>c.code==='counts').ok,false,tb);
      fs.rmSync(out,{recursive:true,force:true});
      // Bağlantı sınırı: S1 + pg_dump + bir yedek oturuma yer var, dördüncüsü reddedilir.
      for(let i=0;i<3;i++)await connectAs();
      await assert.rejects(connectAs(),e=>e.code==='53300');
      await closeAll();
    });

    const otherSession=async()=>{const c=new Client({...base,user:emul,password:pw,database:db.name});c.on('error',()=>{});await c.connect();clients.push(c);return c;};
    const canLogin=async()=>(await db.query('select rolcanlogin from pg_roles where rolname=$1',[ROLE])).rows[0]?.rolcanlogin;

    await t.test('kaldırma tek işlem içinde çalıştırılırsa (--single-transaction) hiçbir şey değişmez',async()=>{
      const c=await connectAs();
      const r=psql(DROP,{},{single:true});
      assert.notEqual(r.code,0);assert.match(r.err,/tek işlem içinde/);
      assert.equal(await canLogin(),true,'NOLOGIN de geri alındı');
      assert.equal((await c.query('select 1 v')).rows[0].v,1,'oturum açık');
      await closeAll();
    });

    await t.test('kaldırma 2. adımda durursa: rol NOLOGIN kalır (yeni giriş yok), açık oturumlara dokunulmaz; düzeltilince yeniden çalışır',async()=>{
      const c=await connectAs();
      // a) Role doğrudan yetki verilmiş (bağ var) → bağ denetimi durdurur.
      const tb=(await db.query(`select format('%I.%I',n.nspname,c.relname) t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1 limit 1`)).rows[0].t;
      await db.exec(`grant select on ${tb} to ${ROLE}`);
      const a=psql(DROP);
      assert.notEqual(a.code,0);assert.match(a.err,/elle incelenmeli/);
      assert.equal(await canLogin(),false,'1. adım ayrı commit edildi');
      await assert.rejects(connectAs(),e=>/not permitted to log in/.test(e.message),'yeni giriş reddedilir');
      assert.equal((await c.query('select 1 v')).rows[0].v,1,'bağ denetimi oturum sonlandırmadan önce: oturum açık');
      await db.exec(`revoke select on ${tb} from ${ROLE}`);
      // b) Oturum sonlandırma yetkisi yok (pg_signal_backend) → durur, rol NOLOGIN kalır, oturum açık kalır.
      await db.exec(`revoke pg_signal_backend from ${emul}`);
      try{
        const b=psql(DROP);
        assert.notEqual(b.code,0);assert.match(b.err,/permission denied to terminate/);
        assert.equal(await canLogin(),false);
        assert.equal((await c.query('select 1 v')).rows[0].v,1,'sonlandırılamadı: oturum açık');
      }finally{await db.exec(`grant pg_signal_backend to ${emul}`);}
      // Bu alt testten sonra rol NOLOGIN; sonraki test için yeniden LOGIN yapılır (süper kullanıcı, yalnız test).
      await closeAll();
      await db.exec(`alter role ${ROLE} login`);
    });

    await t.test('kaldırma: beklenmeyen üyelik varsa durur; NOLOGIN korunur, oturuma ve üyeliğe dokunulmaz; temizlenince yeniden çalışır',async()=>{
      const extra=uniqueRole('nakgo_extra');
      const members=async()=>(await db.query(`select u.rolname::text member,g.rolname::text role,a.admin_option,a.inherit_option,a.set_option
        from pg_auth_members a join pg_roles u on u.oid=a.member join pg_roles g on g.oid=a.roleid
        where g.rolname=$1 or u.rolname=$1 order by 1,2`,[ROLE])).rows;
      try{
        const c=await connectAs();
        // a) Role sonradan beklenmeyen bir üye eklenir (başka bir rol, rolün okuma yetkisini devralır).
        await db.exec(`create role ${extra} nologin; grant ${ROLE} to ${extra}`);
        const before=await members();
        assert.ok(before.some(x=>x.member===extra&&x.role===ROLE),'beklenmeyen üyelik kuruldu');
        const a=psql(DROP);
        assert.notEqual(a.code,0);assert.match(a.err,/beklenmeyen üyelik/);assert.match(a.err,new RegExp('üyesi: '+extra));
        assert.equal(await canLogin(),false,'1. adımın NOLOGIN durumu korundu');
        await assert.rejects(connectAs(),e=>/not permitted to log in/.test(e.message),'yeni giriş reddedilir');
        assert.equal((await c.query('select 1 v')).rows[0].v,1,'hedef rolün açık oturumu sonlandırılmadı');
        assert.deepEqual(await members(),before,'üyelikler silinmedi ya da değiştirilmedi');
        // b) Rolün kendisi beklenmeyen bir role üye yapılır (yön tersi) → yine durur, yine dokunulmaz.
        await db.exec(`revoke ${ROLE} from ${extra}; grant ${extra} to ${ROLE}`);
        const before2=await members();
        const b=psql(DROP);
        assert.notEqual(b.code,0);assert.match(b.err,new RegExp('üye: '+extra));
        assert.equal(await canLogin(),false);
        assert.equal((await c.query('select 1 v')).rows[0].v,1,'oturum açık');
        assert.deepEqual(await members(),before2);
        // Üyelik elle temizlenince kaldırma baştan sona çalışır: oturum sonlandırılır, rol silinir.
        await db.exec(`revoke ${extra} from ${ROLE}`);
        const ok=psql(DROP);assert.equal(ok.code,0,ok.err);assert.match(ok.err,/sonlandırılan oturum: 1/);
        await assert.rejects(c.query('select 1'),'oturum kapatıldı');
        assert.equal(await roleRow(),undefined,'rol silindi');
      }finally{await closeAll();await dropRoles([extra]);}
      // Sonraki alt test için rol betikle yeniden oluşturulur (test parolası yalnız süper kullanıcıyla, yalnız testte).
      const re=psql(CREATE,{valid_until:days(7)});assert.equal(re.code,0,re.err);
      await db.exec(`alter role ${ROLE} password 'test-only-reader'`);
    });

    await t.test('kaldırma: yalnız bu rolün oturumu sonlandırılır, başka rolün oturumu açık kalır; rol ve tüm bağları silinir; ikinci çalıştırma zararsız',async()=>{
      const c=await connectAs();
      const other=await otherSession();
      assert.equal((await c.query('select 1 v')).rows[0].v,1);
      const r=psql(DROP);assert.equal(r.code,0,r.err);
      assert.match(r.err,/sonlandırılan oturum: 1/);
      await assert.rejects(c.query('select 1'),'oturum kapatıldı');
      assert.equal((await other.query('select 1 v')).rows[0].v,1,'başka rolün oturumu açık');
      assert.equal(await roleRow(),undefined);
      assert.equal((await db.query(`select count(*)::int n from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole where s.setrole<>0 and r.oid is null`)).rows[0].n,0,'rol ayarı kalmadı');
      const again=psql(DROP);assert.equal(again.code,0,again.err);assert.match(again.err,/yapılacak bir şey yok/);
    });
  }finally{
    for(const c of clients)await c.end().catch(()=>{});
    await db.close();
    await dropRoles([ROLE,emul]);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

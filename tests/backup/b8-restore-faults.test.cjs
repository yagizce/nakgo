/** B8: kurtarma hata ve güvence senaryoları (B7 kipi, tam migration zinciri, yasal arşiv dahil).
 * Yalnız yerel, geçici PostgreSQL ve bellek içi depo. Uzak sisteme bağlanmaz.
 * Kapsam: yanlış/eksik anahtar, bozuk/eksik yedek, yarıda kesilen geri yükleme, yasal saklama korunumu,
 * geri yüklenen kopyada RLS ve yetkiler, manifest–nesne uyuşmazlığı, aynı yedeğin iki kez geri yüklenmesi,
 * geri yükleme sonrası uygulama akışları. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const {realPg,migratedDb,uniqueRole,dropRoles,finish}=require('./helpers.cjs');
const {seed}=require('./fixtures.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {toolMajor}=require('../../tools/backup/dump.cjs');
const {restoreAndVerify}=require('../../tools/backup/restore-verify.cjs');
const {MemoryStore}=require('../../tools/backup/store.cjs');
const E=require('../../tools/backup/encrypt.cjs');
const C=require('../../tools/backup/crypto.cjs');
const {runBackup}=require('../../tools/backup/pipeline.cjs');
const DR=require('../../tools/backup/dr-fetch.cjs');

const hasBin=b=>{try{execFileSync('which',[b],{stdio:'ignore'});return true;}catch{return false;}};
const pgBase=()=>({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD});
const bin=b=>process.env.NAKGO_PG_BIN?path.join(process.env.NAKGO_PG_BIN,b):b;

/** Kaynak ve geri yüklenen veritabanında aynı olması gereken güvenlik kataloğu. */
const SECURITY_CATALOG=`
select 'rel '||n.nspname||'.'||c.relname||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity||' acl='||coalesce(c.relacl::text,'-') l
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','p')
union all
select 'col '||n.nspname||'.'||c.relname||'.'||a.attname||' acl='||a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and a.attacl is not null and not a.attisdropped
union all
select 'pol '||n.nspname||'.'||c.relname||'.'||p.polname||' cmd='||p.polcmd::text||' roles='||array_to_string(array(select coalesce(r.rolname,'public') from unnest(p.polroles) x left join pg_roles r on r.oid=x order by 1),',')
  ||' using='||coalesce(pg_get_expr(p.polqual,p.polrelid),'-')||' check='||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'-')
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')
union all
select 'fn '||p.oid::regprocedure::text||' definer='||p.prosecdef||' acl='||coalesce(p.proacl::text,'-')||' cfg='||coalesce(array_to_string(p.proconfig,','),'-')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
union all
select 'trg '||c.oid::regclass::text||'.'||t.tgname||' enabled='||t.tgenabled::text||' def='||pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and not t.tgisinternal
order by 1`;

const LEGAL_STATE=`select
  (select count(*) from private.legal_records)::int records,
  (select count(*) from private.legal_holds where released_at is null)::int active_holds,
  (select count(*) from private.listing_moderation where hold)::int hold_flags,
  (select count(*) from public.listings where owner_suspended)::int suspended_listings,
  (select count(*) from private.account_moderation where suspended)::int suspended_accounts,
  (select count(*) from private.legal_access_log)::int legal_log,
  private.legal_chain_check() chain`;

async function expectSqlState(db,sql,state,label,params=[]){
  await db.exec('savepoint p');
  let code=null;
  try{await db.query(sql,params);}catch(e){code=e.code;}
  await db.exec('rollback to savepoint p');
  assert.equal(code,state,label);
}

test('geri yükleme provası hazırlığı: hata ve güvence senaryoları (gerçek PostgreSQL)',async t=>{
  if(!realPg()){t.skip('PGlite: pg_dump/pg_restore yok');return;}
  if(!hasBin('age')||!hasBin('age-keygen')){if(process.env.NAKGO_REQUIRE_AGE==='1')throw Error('age gerekli ama yok');t.skip('age yok');return;}
  const db=await migratedDb();const role=uniqueRole('nakgo_backup_rd');let primary=null;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-rd-'));
  const {Client}=require('pg');const admin=new Client({...pgBase(),database:'postgres'});await admin.connect();
  // Bu sürecin açtığı geçici veritabanları (kaynak hariç). Her senaryodan sonra 0 olmalı: yarım hedef kalmaz.
  const leftovers=async()=>(await admin.query(`select datname from pg_database where datname like $1 and datname<>$2`,['nakgo_check_'+process.pid+'_%',db.name])).rows.map(r=>r.datname);
  try{
    const major=Number(/postgresql (\d+)/.exec(db.engine)[1]);
    const tool=await toolMajor('pg_dump',process.env.NAKGO_PG_BIN);
    if(!tool||tool<major){const msg=`pg_dump ${tool} sunucudan (${major}) eski`;if(process.env.NAKGO_REQUIRE_DUMP==='1')throw Error(msg);t.skip(msg);return;}

    /* --- Kaynak: sentetik veri + gerçek yoldan yasal saklama ve askıya alma --- */
    const ids=await seed(db);
    const adminId=(await db.query(`select gen_random_uuid() id`)).rows[0].id;
    await db.query(`insert into auth.users(id,email_confirmed_at,email) values($1,now(),'rd-admin@example.invalid')`,[adminId]);
    await db.query(`insert into private.admin_members(user_id,active,owner) values($1,true,true)`,[adminId]);
    const held=(await db.query(`select id from public.listings where owner_id=$1 order by id limit 1`,[ids[2]])).rows[0].id;
    const suspendedOwner=ids[3];
    await db.exec('begin');
    try{
      await db.query(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims','{"aal":"aal2"}',true)`,[adminId]);
      await db.exec('set local role authenticated');
      await db.query(`select public.nakgo_admin_moderate('listing',$1,'hold','Prova saklama',0)`,[String(held)]);
      await db.query(`select public.nakgo_admin_moderate('user',$1,'suspend','Prova askı',0)`,[suspendedOwner]);
      await db.exec('commit');
    }catch(e){await db.exec('rollback');throw e;}
    const srcLegal=(await db.query(LEGAL_STATE)).rows[0];
    assert.ok(srcLegal.records>=1&&srcLegal.active_holds>=1&&srcLegal.hold_flags>=1,'kaynakta yasal saklama kuruldu: '+JSON.stringify(srcLegal));
    assert.ok(srcLegal.suspended_listings>=1,'kaynakta askıdaki sahibin ilanları işaretli');

    /* --- Yedek: gerçek boru hattı, geçici anahtarlar, bellek içi depo --- */
    const password='test-only-'+role;
    await db.exec(BR.renderLiteral({role,password}));
    const conn={host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:role,password,database:db.name};
    const idFiles=[0,1,2].map(i=>{const f=path.join(dir,'id'+i+'.txt');execFileSync('age-keygen',['-o',f],{stdio:'ignore'});return f;});
    const recipientsFile=path.join(dir,'recipients.txt');// yalnız 0 ve 1 alıcı; 2 "yanlış anahtar"
    fs.writeFileSync(recipientsFile,idFiles.slice(0,2).map(f=>/# public key: (age1\S+)/.exec(fs.readFileSync(f,'utf8'))[1]).join('\n')+'\n');
    const pinned=E.recipientsSha256(recipientsFile);
    const k1=C.testKeyPair();const trusted={[k1.keyId]:k1.publicKey};
    const work=path.join(dir,'work');fs.mkdirSync(work);
    const store=new MemoryStore();
    const base={conn,scope:BR.loadScope(),store,recipientsFile,pinnedRecipientsSha256:pinned,k1,allowLocal:true,pgBin:process.env.NAKGO_PG_BIN,workRoot:work,hooks:{preflight:async()=>({status:'ok'})}};
    // Yedek rolünün kendi yetkileri (geri yüklemede NOLOGIN olarak yeniden kurulur) karşılaştırmadan çıkarılır.
    const stripRole=l=>l.replace(new RegExp(','+role+'=[^,}]*','g'),'').replace(new RegExp(role+'=[^,}]*,?','g'),'');
    const srcCatalog=(await db.query(SECURITY_CATALOG)).rows.map(r=>stripRole(r.l));
    const r1=await runBackup({...base,runId:'rd1',now:new Date('2026-11-20T03:00:00Z')});
    assert.equal(r1.verified,true,JSON.stringify(r1.stages));
    const r2=await runBackup({...base,runId:'rd2',now:new Date('2026-11-20T09:00:00Z')});
    assert.equal(r2.verified,true,JSON.stringify(r2.stages));
    const ct=path.join(dir,'rd1.tar.age');
    const f1=await DR.fetchVerified({store,manifestKey:r1.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:ct});
    assert.equal(f1.ok,true,JSON.stringify(f1));

    const decrypt=(identity,input,outDir)=>{fs.mkdirSync(outDir,{recursive:true,mode:0o700});
      return spawnSync('bash',['-c','set -o pipefail; age -d '+(identity?'-i "$1" ':'')+'"$2" | tar -xf - -C "$3"','bash',identity||'',input,outDir],{encoding:'utf8'});};
    const bundle=path.join(dir,'bundle');

    await t.test('anahtar: yanlış kimlik ve kimliksiz çözme başarısız; hiçbir dosya çıkmaz',async()=>{
      for(const [label,id] of [['yanlış anahtar',idFiles[2]],['anahtar yok',null]]){
        const out=path.join(dir,'wrong-'+(id?'key':'none'));
        const r=spawnSync('age',['-d',...(id?['-i',id]:[]),'-o',path.join(dir,'x.tar'),ct],{encoding:'utf8'});
        assert.notEqual(r.status,0,label+' çözmemeli');
        assert.ok(!fs.existsSync(path.join(dir,'x.tar'))||fs.statSync(path.join(dir,'x.tar')).size===0,label+': düz metin üretilmedi');
        fs.rmSync(path.join(dir,'x.tar'),{force:true});
        assert.ok(!fs.existsSync(out));
      }
      // İki alıcı da tek başına yeter (A veya B).
      for(const id of idFiles.slice(0,2)){const r=spawnSync('age',['-d','-i',id,'-o',path.join(dir,'ok.tar'),ct]);assert.equal(r.status,0);fs.rmSync(path.join(dir,'ok.tar'));}
    });

    await t.test('bozuk şifreli yedek: tek bayt değişimi ve kesilmiş dosya çözülemez',async()=>{
      const buf=fs.readFileSync(ct);
      for(const [label,body] of [['bayt değişimi',(()=>{const b=Buffer.from(buf);b[Math.floor(b.length/2)]^=1;return b;})()],['kesilmiş',buf.subarray(0,Math.floor(buf.length*0.6))]]){
        const bad=path.join(dir,'bad.age');fs.writeFileSync(bad,body);
        const r=spawnSync('age',['-d','-i',idFiles[0],'-o',path.join(dir,'bad.tar'),bad]);
        assert.notEqual(r.status,0,label+' çözülmemeli');fs.rmSync(bad);fs.rmSync(path.join(dir,'bad.tar'),{force:true});
      }
    });

    await t.test('manifest–nesne uyuşmazlığı: başka bir GEÇERLİ yedeğin nesnesi yerine konursa indirme durur',async()=>{
      const swapped=new MemoryStore();
      for(const {key:k} of await store.list(''))await swapped.put(k,k===r1.keys.data?await store.get(r2.keys.data):await store.get(k));
      const r=await DR.fetchVerified({store:swapped,manifestKey:r1.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:path.join(dir,'swap.age')});
      assert.equal(r.ok,false);assert.match(r.code,/^(sha256|size|integrity)$/,JSON.stringify(r));
      assert.ok(!fs.existsSync(path.join(dir,'swap.age')),'dosya yazılmadı');
      const missing=new MemoryStore();
      for(const {key:k} of await store.list(''))if(k!==r1.keys.data)await missing.put(k,await store.get(k));
      const m=await DR.fetchVerified({store:missing,manifestKey:r1.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:path.join(dir,'miss.age')});
      assert.equal(m.ok,false,'nesnesi eksik yedek indirilemez: '+JSON.stringify(m));
    });

    const d=decrypt(idFiles[1],ct,bundle);
    assert.equal(d.status,0,d.stderr);

    await t.test('tam geri yükleme: yasal saklama, askı işareti, RLS/yetkiler ve uygulama akışları',async()=>{
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN,hooks:{
        legal_state:async(rdb)=>{
          const got=(await rdb.query(LEGAL_STATE)).rows[0];
          return {ok:JSON.stringify(got)===JSON.stringify(srcLegal),detail:{source:srcLegal,restored:got}};
        },
        security_catalog:async(rdb)=>{
          const got=(await rdb.query(SECURITY_CATALOG)).rows.map(r=>stripRole(r.l));
          const s=new Set(srcCatalog),g=new Set(got);
          const missing=srcCatalog.filter(l=>!g.has(l)),extra=got.filter(l=>!s.has(l));
          return {ok:!missing.length&&!extra.length,detail:{lines:got.length,missing:missing.slice(0,10),extra:extra.slice(0,10)}};
        },
        legal_enforced:async(rdb)=>{
          await rdb.exec('begin');
          try{
            await expectSqlState(rdb,`delete from public.listings where id=$1`,'55000','saklamadaki ilan silinemez',[held]);
            await expectSqlState(rdb,`update private.listing_moderation set hold=false where listing_id=$1`,'55000','aktif saklamada işaret kaldırılamaz',[held]);
            await expectSqlState(rdb,`delete from auth.users where id=$1`,'55000','saklamadaki ilanın sahibi Auth\'tan silinemez',[ids[2]]);
            await expectSqlState(rdb,`truncate private.legal_access_log`,'42501','yasal günlük kısaltılamaz (tetikleyici 42501)');
          }finally{await rdb.exec('rollback');}
          return {ok:true,detail:'korumalar geri yüklenen kopyada çalışıyor'};
        },
        rls_and_privileges:async(rdb)=>{
          const viewer=ids[1];
          await rdb.exec('begin');
          try{
            await rdb.query(`select set_config('request.jwt.claim.sub',$1,true)`,[viewer]);
            await rdb.exec('set local role authenticated');
            const seen=Number((await rdb.query(`select count(*) n from public.listings where owner_id=$1`,[suspendedOwner])).rows[0].n);
            assert.equal(seen,0,'askıdaki sahibin ilanı diğer üyeye görünmez');
            const own=Number((await rdb.query(`select count(*) n from public.listings where owner_id=$1`,[viewer])).rows[0].n);
            assert.ok(own>0,'kendi ilanı görünür');
            await expectSqlState(rdb,`select owner_suspended from public.listings limit 1`,'42501','owner_suspended istemciye kapalı');
            await expectSqlState(rdb,`select private.account_suspended($1)`,'42501','private fonksiyon istemciye kapalı',[suspendedOwner]);
            await expectSqlState(rdb,`select * from private.legal_records`,'42501','yasal arşiv istemciye kapalı');
            await expectSqlState(rdb,`select * from private.admin_members`,'42501','yönetici listesi istemciye kapalı');
            await expectSqlState(rdb,`select public.nakgo_admin_moderate('listing',$1,'release','x',0)`,'42501','yönetici olmayan moderasyon yapamaz',[String(held)]);
            const sl=(await rdb.query(`select id from public.listings where owner_id=$1 limit 1`,[ids[0]])).rows;
            await rdb.exec('reset role');
            const suspendedListing=(await rdb.query(`select id from public.listings where owner_id=$1 limit 1`,[suspendedOwner])).rows[0].id;
            await rdb.exec('set local role authenticated');
            let favErr=null;await rdb.exec('savepoint f');try{await rdb.query(`select public.nakgo_set_favorite($1,true)`,[suspendedListing]);}catch(e){favErr=e.code;}await rdb.exec('rollback to savepoint f');
            assert.ok(favErr,'askıdaki sahibin ilanı favorilenemez');
            /* Uygulama akışları: ilan ekleme, favori, rota alarmı, kendi ilanını okuma. */
            const lid=(await rdb.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent)
              values('load','Bursa','Konya','Tır','Tenteli',5,'Prova yük','Prova','yarın','+905000000001',true) returning id`)).rows[0].id;
            assert.ok(lid,'yeni ilan eklendi');
            await rdb.query(`select public.nakgo_set_favorite($1,true)`,[sl[0].id]);
            await rdb.query(`select public.nakgo_save_route_alert('load','Bursa',null,null,null)`);
            await rdb.exec('reset role');
            await rdb.query(`select set_config('request.jwt.claim.sub','',true)`);
            await rdb.exec('set local role anon');
            await expectSqlState(rdb,`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','A','B','Tır','Tenteli',1,'x','x','x')`,'42501','anon ilan ekleyemez');
          }finally{await rdb.exec('rollback');}
          return {ok:true,detail:'RLS, sütun ve fonksiyon yetkileri ile uygulama akışları geri yüklenen kopyada doğru'};
        },
        same_backup_twice_into_same_db:async(rdb)=>{
          const restoreInto=file=>spawnSync(bin('pg_restore'),['--exit-on-error','--no-owner','--no-password','-h',process.env.NAKGO_PG_HOST,'-p',String(process.env.NAKGO_PG_PORT||5432),'-U',process.env.NAKGO_PG_USER||'postgres','-d',rdb.name,file],{encoding:'utf8',env:{...process.env,PGPASSWORD:process.env.NAKGO_PG_PASSWORD||''}});
          // Çakışma ölçütü: pg_restore, geri yüklenmiş kopyada ZATEN VAR olan bir nesneyi yeniden oluşturmaya çalışıp durmalı
          // (SQLSTATE 42P06 şema / 42P07 ilişki / 42710 nesne → "already exists"); yalnız "başarısız oldu" yetmez.
          const CONFLICT=/pg_restore: error: could not execute query: ERROR:\s+(schema|relation|type|function|sequence|table|index|trigger|policy|constraint) "[^"]+"( for relation "[^"]+"| of relation "[^"]+")? already exists/;
          const r=restoreInto(path.join(bundle,'A.dump'));
          const err=r.stderr||'';const m=CONFLICT.exec(err);
          // Çakışan nesne gerçekten hedefte var olan bir nesne olmalı.
          let objectExists=false;
          if(m){const name=/"([^"]+)"/.exec(m[0])[1];
            objectExists=(await rdb.query(`select exists(select 1 from pg_namespace where nspname=$1) or exists(select 1 from pg_class where relname=$1) or exists(select 1 from pg_type where typname=$1) or exists(select 1 from pg_proc where proname=$1) e`,[name])).rows[0].e;}
          // Negatif kontrol: başka bir nedenle başarısız olan pg_restore (olmayan dosya) ölçütü KARŞILAMAMALI.
          const other=restoreInto(path.join(bundle,'olmayan.dump'));
          const otherMatches=CONFLICT.test(other.stderr||'');
          const n=Number((await rdb.query(`select count(*) n from public.listings`)).rows[0].n);
          return {ok:r.status!==0&&!!m&&objectExists&&other.status!==0&&!otherMatches&&n===srcCounts(),
            detail:{exit:r.status,conflict:m&&m[0].replace(/^pg_restore: error: could not execute query: /,''),object_exists:objectExists,other_exit:other.status,other_matches:otherMatches,listings:n}};
        },
      }});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok),null,1));
      const twice=v.checks.find(c=>c.code==='same_backup_twice_into_same_db');
      assert.ok(twice&&twice.ok,'ikinci geri yükleme denetimi çalıştı');
      assert.match(twice.detail.conflict,/^ERROR:\s+\w+ "[^"]+".* already exists$/,'çakışma mesajı');assert.equal(twice.detail.object_exists,true);
      assert.notEqual(twice.detail.other_exit,0);assert.equal(twice.detail.other_matches,false,'başka nedenli hata çakışma sayılmaz');
      assert.deepEqual(await leftovers(),[],'geçici hedef silindi');
    });
    function srcCounts(){return JSON.parse(fs.readFileSync(path.join(bundle,'source.json'),'utf8')).counts['public.listings'];}

    await t.test('aynı yedek ikinci kez (yeni hedefe) geri yüklenir: sonuç aynı, kalıntı yok',async()=>{
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(v.status,'ok',JSON.stringify(v.checks.filter(c=>!c.ok)));
      assert.deepEqual(await leftovers(),[]);
      // dr-fetch aynı dosyaya ikinci kez yazmaz.
      await assert.rejects(DR.fetchVerified({store,manifestKey:r1.keys.manifest,trustedK1:trusted,pinnedRecipientsSha256:pinned,outFile:ct}),/EEXIST/);
    });

    const variant=(name,mutate)=>{const p=path.join(dir,'v-'+name);fs.cpSync(bundle,p,{recursive:true});mutate(p);return p;};
    await t.test('eksik veya bozuk paket parçası: geri yükleme başarısız, hedef temizlenir',async()=>{
      const src=JSON.parse(fs.readFileSync(path.join(bundle,'source.json'),'utf8'));
      const bFile=Object.keys(src.b_files||{})[0];
      const cases=[
        ['A.dump eksik',p=>fs.rmSync(path.join(p,'A.dump')),/restore_a|exception/],
        ['A.dump kesilmiş',p=>{const f=path.join(p,'A.dump');const b=fs.readFileSync(f);fs.writeFileSync(f,b.subarray(0,Math.floor(b.length/2)));},/restore_a|exception/],
        ['B dosyası eksik',p=>fs.rmSync(path.join(p,'B',bFile+'.jsonl')),/restore_b|exception/],
        ['source.json sayısı oynanmış',p=>{const s=JSON.parse(fs.readFileSync(path.join(p,'source.json'),'utf8'));s.counts['public.listings']+=1;fs.writeFileSync(path.join(p,'source.json'),JSON.stringify(s));},/counts/],
        ['bootstrap.sql eksik',p=>fs.rmSync(path.join(p,'bootstrap.sql')),/exception/],
      ];
      for(const [label,mutate,code] of cases){
        const p=variant(label.replace(/\W+/g,'_'),mutate);
        let v;try{v=await restoreAndVerify({bundleDir:p,pgBin:process.env.NAKGO_PG_BIN});}catch(e){v={status:'failed',checks:[{code:'exception',ok:false,detail:e.message}]};}
        assert.equal(v.status,'failed',label);
        assert.match(v.checks.filter(c=>!c.ok).map(c=>c.code).join(','),code,label+': '+JSON.stringify(v.checks.filter(c=>!c.ok)).slice(0,300));
        assert.deepEqual(await leftovers(),[],label+': yarım hedef kalmadı');
        fs.rmSync(p,{recursive:true,force:true});
      }
    });

    await t.test('yarıda kesilen geri yükleme: pg_restore bağlantısı (PGAPPNAME=nakgo-backup) öldürülür → başarısız, hedef temizlenir, tekrar denenince geçer',async()=>{
      let killed=0;let stop=false;const seenApps=new Set();
      const killer=(async()=>{while(!stop&&!killed){
        const r=await admin.query(`select pg_terminate_backend(pid) k,application_name from pg_stat_activity where application_name='nakgo-backup' and datname like $1`,['nakgo_check_'+process.pid+'_%']);
        {for(const x of (await admin.query(`select distinct coalesce(application_name,'') a from pg_stat_activity where datname like $1`,['nakgo_check_'+process.pid+'_%'])).rows)seenApps.add(x.a);}
        killed+=r.rows.filter(x=>x.k).length;await new Promise(s=>setTimeout(s,5));}})();
      const v=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN});
      stop=true;await killer;
      assert.ok(killed>0,'pg_restore yakalanıp kesildi; görülen uygulamalar: '+[...seenApps].join('|'));
      assert.equal(v.status,'failed');
      assert.match(v.checks.filter(c=>!c.ok).map(c=>c.code).join(','),/restore_a/);
      assert.deepEqual(await leftovers(),[],'kesilen hedef silindi');
      const again=await restoreAndVerify({bundleDir:bundle,pgBin:process.env.NAKGO_PG_BIN});
      assert.equal(again.status,'ok',JSON.stringify(again.checks.filter(c=>!c.ok)));
    });

    await t.test('R2 dosyaları ile DB kayıtları: storage.objects doluysa yedek hiç başlamaz (dosya yedeği yok)',async()=>{
      await db.exec(`alter table storage.objects disable trigger user; insert into storage.objects(bucket_id,name) values('carrier-documents','rd-prova'); alter table storage.objects enable trigger user;`);
      try{
        const r=await runBackup({...base,runId:'rd3',now:new Date('2026-11-20T15:00:00Z')});
        assert.equal(r.verified,false);assert.equal(r.stages.dump.status,'failed');
        assert.match(JSON.stringify(r.stages.dump),/storage\.objects/);
        assert.equal(await store.get(r.keys.data),null,'veri nesnesi yazılmadı');
      }finally{await db.exec(`alter table storage.objects disable trigger user; delete from storage.objects where name='rd-prova'; alter table storage.objects enable trigger user;`);}
    });
  }catch(e){primary=e;throw e;}
  finally{await admin.end().catch(()=>{});await finish(db,primary);await dropRoles([role]);fs.rmSync(dir,{recursive:true,force:true});}
});

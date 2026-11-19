/** B2 parçalı gece temizliği (private.retention_batches): eşdeğerlik, kaldığı yerden devam, hata enjeksiyonu,
 * kesilme, eşzamanlı çalışma, mükerrer çalışma, yasal koruma ve yetki. Geçici yerel veritabanı (PGlite ya da yerel
 * PostgreSQL); sentetik veri. Birden çok bağlantı isteyen testler yalnız gerçek PostgreSQL'de çalışır. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {realPg,migratedDb,finish}=require('../backup/helpers.cjs');

const ROOT=path.join(__dirname,'..','..');
const replica=async(db,fn)=>{await db.exec('set session_replication_role=replica');try{return await fn();}finally{await db.exec('reset session_replication_role');}};

/** Her durumdan ilanlar ve erişim kayıtları. Kimlikler iki ayrı veritabanında aynı sırayla oluşur. */
async function seed(db,{bulk=57,bulkDeleted=23,bulkLogs=41}={}){
  const u=[...Array(6)].map((_,i)=>'00000000-0000-4000-8000-00000000000'+(i+1));
  for(const id of u)await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[id]);
  const L={};
  await replica(db,async()=>{
    await db.query(`insert into private.account_moderation(user_id,deleted_at) values($1,now()-interval '2 days')`,[u[5]]);
    const add=async(label,{owner=u[0],status='active',expires="now()+interval '3 hours'",updated='now()',redacted='null'}={})=>{
      L[label]=Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,owner_id,status,expires_at,updated_at,redacted_at,note)
        values('load','İstanbul','Ankara','Tır','Tenteli',10,'Yük','Ad','bugün','+905321234567',true,$1,$2,${expires},${updated},${redacted},'not') returning id`,[owner,status])).rows[0].id);
    };
    await add('expired10',{expires:"now()-interval '10 days'"});
    await add('expired7',{expires:"now()-interval '7 days'"});
    await add('closed9',{status:'closed',updated:"now()-interval '9 days'"});
    await add('deletedOwner',{owner:u[5]});
    await add('heldOld',{expires:"now()-interval '30 days'"});
    await add('removedRecent',{expires:"now()-interval '30 days'"});
    await add('removedOld',{expires:"now()-interval '500 days'"});
    await add('redactedOld',{expires:"now()-interval '500 days'",redacted:"now()-interval '400 days'"});
    await add('redactedOldHeld',{expires:"now()-interval '500 days'",redacted:"now()-interval '400 days'"});
    await add('redactedRecent',{expires:"now()-interval '100 days'",redacted:"now()-interval '90 days'"});
    await add('redacted330',{expires:"now()-interval '340 days'",redacted:"now()-interval '330 days'"});
    await add('fresh');
    for(let i=0;i<bulk;i++)await add('b'+i,{owner:u[1+(i%4)],expires:"now()-interval '12 days'"});
    for(let i=0;i<bulkDeleted;i++)await add('d'+i,{owner:u[1+(i%4)],expires:"now()-interval '600 days'",redacted:"now()-interval '500 days'"});
    await db.query(`insert into private.listing_moderation(listing_id,hold,updated_at) values($1,true,now()),($2,true,now())`,[L.heldOld,L.redactedOldHeld]);
    await db.query(`insert into private.listing_moderation(listing_id,removed,updated_at) values($1,true,now()-interval '10 days'),($2,true,now()-interval '400 days')`,[L.removedRecent,L.removedOld]);
    const log=(at,user,listing=null)=>db.query(`insert into private.access_log(at,user_id,action,listing_id) values(${at},$1,'login',$2)`,[user,listing]);
    for(let i=0;i<bulkLogs;i++)await log("now()-interval '400 days'",u[1+(i%3)]);
    await log("now()-interval '400 days'",u[4],L.heldOld);// korunan ilanın kaydı
    await log("now()-interval '400 days'",u[4]);// yasal korumalı kullanıcı (yalnız #125 senaryosunda korunur)
    await log("now()-interval '100 days'",u[1]);
    await log("now()-interval '330 days'",u[2]);
  });
  return {u,L};
}

async function state(db){
  const listings=(await db.query(`select id,redacted_at is not null red,note,contact_phone from public.listings order by id`)).rows
    .map(r=>`${r.id}:${r.red?'R':'-'}:${r.note}:${r.contact_phone||''}`);
  const logs=(await db.query(`select id from private.access_log order by id`)).rows.map(r=>Number(r.id));
  return {listings,logs};
}
const sumRuns=async(db,key)=>(await db.query(`select coalesce(sum((counts->>$1)::int),0)::int n from private.retention_runs`,[key])).rows[0].n;
const jobs=async db=>(await db.query(`select status,batches,counts,error from private.retention_jobs order by id`)).rows;
const code=async p=>{try{await p;return 'ok';}catch(e){return e.code||e.message;}};

test('parçalı gece temizliği',async t=>{
  await t.test('eşdeğerlik: parçalı + retention_run, tek başına retention_run ile aynı sonucu verir (küçük partilerle)',async()=>{
    const A=await migratedDb(),B=await migratedDb();
    try{
      await seed(A);await seed(B);
      await A.query('select private.retention_run()');
      await B.exec('call private.retention_batches(7)');
      const afterBatches=await jobs(B);
      await B.query('select private.retention_run()');
      assert.deepEqual(await state(B),await state(A));
      assert.equal(afterBatches.length,1);assert.equal(afterBatches[0].status,'done',JSON.stringify(afterBatches));
      assert.deepEqual(afterBatches[0].counts,{listings_redacted:61,listings_deleted:24,access_log_deleted:42});
      assert.equal(afterBatches[0].batches,9+4+6,'gerçekten küçük partilerle (7\'şer)');
      // retention_run'a kalan iş yok; toplam sayımlar aynı.
      const lastRun=(await B.query(`select counts from private.retention_runs order by id desc limit 1`)).rows[0].counts;
      assert.equal(lastRun.listings_redacted,0);assert.equal(lastRun.listings_deleted,0);assert.equal(lastRun.access_log_deleted,0);
      for(const k of ['listings_redacted','listings_deleted','access_log_deleted'])assert.equal(await sumRuns(B,k),await sumRuns(A,k),k);
    }finally{await finish(A);await finish(B);}
  });

  const db=await migratedDb();let primary=null;
  try{
    const {L}=await seed(db);
    const expected=async()=>{const S=await migratedDb();try{await seed(S);await S.query('select private.retention_run()');return await state(S);}finally{await finish(S);}};
    const want=await expected();
    // retention_run'ın da yapacağı ama parçalı temizliğin kapsamı dışındaki adımlar sonuçta fark yaratmaz.
    const final=async()=>{await db.query('select private.retention_run()');return state(db);};

    await t.test('yasal koruma ve saklama: süresi dolmamış ve korunan kayıtlar silinmez, karartılmaz',async()=>{
      await db.exec('call private.retention_batches(5,2)');// yarıda kalan iş
      const s=await state(db),has=id=>s.listings.find(x=>x.startsWith(id+':'));
      for(const k of ['expired7','heldOld','removedRecent','redactedOldHeld','redactedRecent','redacted330','fresh'])assert.ok(has(L[k]),k+' duruyor');
      for(const k of ['expired7','heldOld','removedRecent','fresh'])assert.match(has(L[k]),/:-:not:\+90/,k+' karartılmadı');
      assert.equal((await jobs(db)).at(-1).status,'stopped','parti sınırında durur ve kayda geçer');
    });
    await t.test('hata enjeksiyonu: bir parti hata verirse yalnız o parti geri alınır; iş kaydı hatayı tutar; sonraki çalışma kaldığı yerden sürer',async()=>{
      await db.exec(`create function public.zz_fail() returns trigger language plpgsql as $$begin if new.id=${L.b40} then raise exception 'enjekte hata'; end if; return new; end$$;
        create trigger zz_fail before update on public.listings for each row execute function public.zz_fail();`);
      const before=(await db.query(`select count(*)::int n from public.listings where redacted_at is not null`)).rows[0].n;
      // Yordam hatayla biter (pg_cron çalışmayı başarısız gösterir); hata kaydı ondan önce commit edilmiştir.
      const err=await db.exec('call private.retention_batches(5)').then(()=>null,e=>e);
      assert.ok(err,'başarısız parti yordamı hatayla bitirir');assert.match(err.message,/^retention_batches failed \(job \d+\)$/);
      assert.ok(!/enjekte/.test(err.message),'hata metni cron mesajına konmaz');
      const j=(await jobs(db)).at(-1);
      assert.equal(j.status,'failed');assert.match(j.error,/listings_redacted: enjekte hata/);
      const jid=Number((await db.query(`select max(id) n from private.retention_jobs where status='failed'`)).rows[0].n);
      assert.equal(err.message,'retention_batches failed (job '+jid+')','mesaj başarısız işin kimliğini taşır');
      assert.equal((await db.query(`select pg_try_advisory_lock(7301) a`)).rows[0].a,true,'oturum kilidi bırakıldı');
      await db.query(`select pg_advisory_unlock(7301)`);
      const after=(await db.query(`select count(*)::int n from public.listings where redacted_at is not null`)).rows[0].n;
      assert.equal(after-before,j.counts.listings_redacted||0,'iş kaydındaki sayım işlenen satırla aynı');
      assert.equal((await db.query(`select redacted_at is null n from public.listings where id=$1`,[L.b40])).rows[0].n,true,'hatalı parti geri alındı');
      assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgrelid='public.listings'::regclass and tgenabled='D'`)).rows[0].n,0,'tetikleyiciler kapalı kalmadı');
      await db.exec('drop trigger zz_fail on public.listings; drop function public.zz_fail();');
      await db.exec('call private.retention_batches(5)');
      assert.equal((await jobs(db)).at(-1).status,'done');
    });
    await t.test('mükerrer çalışma: ikinci çalışma hiçbir şey yapmaz, sayımlar ikiye katlanmaz',async()=>{
      const before=await state(db);
      await db.exec('call private.retention_batches(5)');
      const j=(await jobs(db)).at(-1);
      assert.equal(j.status,'done');assert.deepEqual(j.counts,{});assert.deepEqual(await state(db),before);
      assert.deepEqual(await final(),want,'retention_run sonrası sonuç tek seferlik temizlikle aynı');
      for(const k of ['listings_redacted','listings_deleted','access_log_deleted'])
        assert.equal(await sumRuns(db,k),{listings_redacted:61,listings_deleted:24,access_log_deleted:42}[k],k+': kayıtlı toplam = gerçek iş');
    });
    await t.test('denetim: her iş retention_runs\'a özet bırakır; yasal anahtar yok',async()=>{
      const rows=(await db.query(`select counts from private.retention_runs where counts ? 'batched_job' order by id`)).rows.map(r=>r.counts);
      assert.deepEqual(rows.map(r=>r.status),['stopped','failed','done','done']);
      assert.ok(rows.every(r=>!Object.keys(r).some(k=>/^legal_|^destructions_/.test(k))));
    });
    await t.test('yetki: istemciler yordamı, parti fonksiyonunu ve iş kayıtlarını kullanamaz; geçersiz giriş reddedilir',async()=>{
      for(const role of ['anon','authenticated'])for(const sql of [`call private.retention_batches()`,`select private.retention_batch('listings_redacted',5)`,
        `select * from private.retention_jobs`,`select private.retention_job_close(1,'done')`]){
        await db.exec('begin');
        try{await db.exec('set local role '+role);assert.equal(await code(db.query(sql)),'42501',role+': '+sql);}finally{await db.exec('rollback');}
      }
      for(const r of ['public','anon','authenticated'])for(const f of ['private.retention_batches(integer,integer)','private.retention_batch(text,integer)','private.retention_job_close(bigint,text,text)'])
        assert.equal((await db.query(`select has_function_privilege($1,$2,'execute') x`,[r,f])).rows[0].x,false,r+' '+f);
      assert.equal(await code(db.query(`select private.retention_batch('x',5)`)),'22023');
      assert.equal(await code(db.query(`select private.retention_batch('listings_redacted',0)`)),'22023');
      assert.equal(await code(db.query(`select private.retention_batch('listings_redacted',10001)`)),'22023');
    });
  }catch(e){primary=e;throw e;}
  finally{await finish(db,primary);}

  await t.test('yasal arşiv (#125) kuruluyken: aktif yasal koruması olan kullanıcının erişim kayıtları silinmez',async()=>{
    const D=await migratedDb();
    try{
      // #125 migration'ı depodaysa migratedDb onu zaten kurmuştur; yoksa sabitlenmiş kopya uygulanır.
      if(!(await D.query(`select to_regclass('private.legal_records') is not null x`)).rows[0].x)
        await D.exec(fs.readFileSync(path.join(ROOT,'tests/backup/fixtures/legal_archive.b25013e.sql'),'utf8'));
      const {u}=await seed(D);
      await replica(D,async()=>{
        const rec=(await D.query(`insert into private.legal_records(policy,user_id,reason,opened_by,snapshot,snapshot_sha256) values('access_log',$1,'Test koruması',$1,'{}',repeat('0',64)) returning id`,[u[4]])).rows[0];
        await D.query(`insert into private.legal_holds(record_id,scope,user_id,reason,opened_by) values($1,'user',$2,'Test koruması',$2)`,[rec.id,u[4]]);
      });
      await D.exec('call private.retention_batches(4)');
      assert.equal((await jobs(D)).at(-1).status,'done');
      const left=(await D.query(`select count(*)::int n from private.access_log where user_id=$1 and at<now()-interval '1 year'`,[u[4]])).rows[0].n;
      assert.equal(left,2,'korunan kullanıcının iki eski kaydı duruyor');
      assert.equal((await D.query(`select count(*)::int n from private.access_log where user_id<>$1 and at<now()-interval '1 year'`,[u[4]])).rows[0].n,0);
      const r=(await D.query('select private.retention_run() r')).rows[0].r;
      assert.equal(r.access_log_deleted,0,'#125 retention_run da aynı kuralla siliyor; kalan iş yok');
    }finally{await finish(D);}
  });

  await t.test('eşzamanlılık ve kesilme (gerçek PostgreSQL)',async t2=>{
    if(!realPg()){t2.skip('PGlite tek bağlantılıdır; CI PostgreSQL 17 sunucusunda çalışır');return;}
    const {Client}=require('pg');
    const D=await migratedDb();
    const conn=async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
      password:process.env.NAKGO_PG_PASSWORD,database:D.name,options:'-c TimeZone=UTC'});c.on('error',()=>{});await c.connect();return c;};
    try{
      const {L}=await seed(D);
      const want=await (async()=>{const S=await migratedDb();try{await seed(S);await S.query('select private.retention_run()');return await state(S);}finally{await finish(S);}})();
      await t2.test('iki yordam aynı anda: biri çalışır, diğeri skipped; satırlar iki kez işlenmez',async()=>{
        await D.exec(`create function public.zz_slow() returns trigger language plpgsql as $$begin perform pg_sleep(0.05); return new; end$$;
          create trigger zz_slow before update on public.listings for each row execute function public.zz_slow();`);
        const [a,b]=[await conn(),await conn()];
        try{await Promise.all([a.query('call private.retention_batches(5)'),new Promise(r=>setTimeout(r,100)).then(()=>b.query('call private.retention_batches(5)'))]);}
        finally{await a.end();await b.end();await D.exec('drop trigger zz_slow on public.listings; drop function public.zz_slow();');}
        const js=await jobs(D);
        assert.deepEqual(js.map(j=>j.status).sort(),['done','skipped']);
        assert.equal(js.find(j=>j.status==='done').counts.listings_redacted,61,'her satır bir kez');
      });
      await t2.test('retention_run çalışırken parti başlamaz; yordam "stopped" ile durur',async()=>{
        const h=await conn();
        try{
          await h.query('begin');await h.query('select pg_advisory_xact_lock(7300)');
          assert.equal((await D.query(`select private.retention_batch('listings_redacted',5) n`)).rows[0].n,-1);
          await D.exec('call private.retention_batches(5)');
          const j=(await jobs(D)).at(-1);assert.equal(j.status,'stopped');assert.match(j.error,/retention_run/);
          // Aynı anda başka temizlik sürerken retention_run atlanır ve bunu kayda geçirir (yönetim panelinde "Atlandı").
          const before=Number((await D.query(`select count(*) n from private.retention_runs where counts='{"skipped":true}'`)).rows[0].n);
          assert.deepEqual((await D.query(`select private.retention_run() r`)).rows[0].r,{skipped:true});
          assert.equal(Number((await D.query(`select count(*) n from private.retention_runs where counts='{"skipped":true}'`)).rows[0].n),before+1,'atlama kaydı yazıldı');
        }finally{await h.query('rollback');await h.end();}
      });
      await t2.test('kesilen çalışma: oturum öldürülür; sonraki çalışma işi "interrupted" kapatır ve kalanı bitirir',async()=>{
        const E=await migratedDb();
        const conn=async()=>{const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',
          password:process.env.NAKGO_PG_PASSWORD,database:E.name,options:'-c TimeZone=UTC'});c.on('error',()=>{});await c.connect();return c;};
        try{
        const {L}=await seed(E);
        // Silme adımını yavaşlat ve ortasında oturumu sonlandır.
        await E.exec(`create function public.zz_slow() returns trigger language plpgsql as $$begin perform pg_sleep(0.2); return old; end$$;
          create trigger zz_slow before delete on public.listings for each row execute function public.zz_slow();`);
        const a=await conn();
        const pid=(await a.query('select pg_backend_pid() p')).rows[0].p;
        const run=a.query('call private.retention_batches(3)').catch(e=>e);
        await new Promise(r=>setTimeout(r,1500));
        await E.query('select pg_terminate_backend($1)',[pid]);
        assert.ok((await run) instanceof Error);
        await a.end().catch(()=>{});
        await E.exec('drop trigger zz_slow on public.listings; drop function public.zz_slow();');
        const mid=(await jobs(E)).at(-1);
        assert.equal(mid.status,'running','kesilen iş açık kaldı');
        assert.ok(mid.counts.listings_deleted>0&&mid.counts.listings_deleted<24,'iş ortasında kesildi: '+JSON.stringify(mid.counts));
        const deletedSoFar=24-(await E.query(`select count(*)::int n from public.listings where redacted_at<now()-interval '1 year' and id<>$1`,[L.redactedOldHeld])).rows[0].n;
        assert.equal(deletedSoFar,mid.counts.listings_deleted,'işlenen satır = kayıtlı sayım (atomik)');
        await E.exec('call private.retention_batches(3)');
        const js=await jobs(E);
        assert.equal(js.at(-2).status,'interrupted');assert.equal(js.at(-1).status,'done');
        await E.query('select private.retention_run()');
        assert.deepEqual(await state(E),want);
        }finally{await finish(E);}
      });
      await t2.test('kullanıcı yazması parti boyunca beklemez (SKIP LOCKED); kilitli satır sonraki çalışmaya kalır',async()=>{
        const S=await migratedDb();
        try{
          const {L:L2}=await seed(S);
          const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:S.name});
          await c.connect();
          try{
            await c.query('begin');await c.query(`select 1 from public.listings where id=$1 for update`,[L2.b3]);
            const t0=Date.now();
            // Satır kilidi tutan işlem varken ALTER TABLE (tetikleyici kapatma) kilit bekler: lock_timeout 5 sn. Bu yüzden
            // kilidi tutan işlem satır kilidiyle sınırlı tutulur; ALTER TABLE'ın beklediği tablo kilidi ROW SHARE ile çakışmaz.
            await S.exec('call private.retention_batches(10)');
            assert.ok(Date.now()-t0<4000,'yordam kilitli satırı beklemedi');
            assert.equal((await S.query(`select redacted_at is null n from public.listings where id=$1`,[L2.b3])).rows[0].n,true,'kilitli satır atlandı');
          }finally{await c.query('rollback');await c.end();}
          await S.exec('call private.retention_batches(10)');
          assert.equal((await S.query(`select redacted_at is null n from public.listings where id=$1`,[L2.b3])).rows[0].n,false,'sonraki çalışmada işlendi');
        }finally{await finish(S);}
      });
    }finally{await finish(D);}
  });
});

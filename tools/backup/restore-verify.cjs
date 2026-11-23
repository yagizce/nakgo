/** B7-A2: S1 başarı ölçütü — dökümün düz PostgreSQL'e geri yüklenebilirliği ve bütünlüğü.
 *
 * Yalnız YEREL ve geçici bir veritabanına geri yükler (db-lib openDb: NAKGO_PG_HOST yerel olmalı; uzak host reddedilir).
 * Production'a, DEV'e ya da herhangi bir Supabase projesine geri yükleme yolu bu kodda yoktur.
 *
 * Sıra: roller (NOLOGIN) → bootstrap (şemalar, tipler, başvurulan fonksiyonlar) → B.pre.sql + B/*.jsonl (sha256 denetimli)
 *       → A (tamamı) → B.post.sql (yabancı anahtar, RLS, politika, kendi tetikleyicilerimiz, ACL).
 * Kontroller (hepsi geçmeli):
 *   counts        tablo başına satır sayısı = S1 (aynı anlık görüntü kanıtı)
 *   fk_orphans    her yabancı anahtar (NOT VALID olanlar dahil) için yetim satır = 0
 *   fingerprint   şema parmak izi = S1; yalnız kapsam dışı tablolara ait satırlar beklenen fark
 *   contract      API sözleşmesi v0 (veritabanı tarafı)
 *   auth_version  Auth sürümü = S1
 *   meta          yönetim verisi dosyalarının (cron, migration geçmişi) hash'i ve satır sayısı
 *   hooks         isteğe bağlı ek kontroller (A3: yasal zincir)
 * Ayrıca "notes" (doğrulamayı düşürmez, kurtarmada insan kararı ister): migration geçmişinin ve zamanlanmış işlerin
 * repodaki migration'larla tutarlılığı (tools/backup/restore-meta.cjs). Kurtarma runbook'unda DURDURMA koşuludur.
 * requireMeta (bootstrap): migration geçmişi ve zamanlanmış işler yedekte bulunmalı, okunabilmeli ve repo ile tutarlı olmalı;
 * değilse "migration_history" / "cron_jobs" kontrolü başarısız olur (not da yazılır) ve yedek doğrulanmış sayılmaz.
 * Bu ölçüt "Auth kurtarması başarılı" anlamına GELMEZ; o yalnız gerçek Supabase projesinde S2b ile kanıtlanır. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {openDb,finish}=require('../db-lib.cjs');
const {run,binPath,pgEnv,catalogFingerprint}=require('./dump.cjs');
const {loadScope,compareScope,readMeta}=require('./scope-export.cjs');

const SUPABASE_ROLE_ATTRS={service_role:'nologin bypassrls'};

async function fkOrphans(db){
  const fks=(await db.query(`select c.oid,c.conname,c.conrelid::regclass::text child,c.confrelid::regclass::text parent,c.convalidated,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by k.i) ccols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n order by k.i) pcols
    from pg_constraint c where c.contype='f' order by 2`)).rows;
  const q=s=>'"'+s.replace(/"/g,'""')+'"';
  const out=[];
  for(const f of fks){
    const notNull=f.ccols.map(c=>`x.${q(c)} is not null`).join(' and ');
    const join=f.ccols.map((c,i)=>`p.${q(f.pcols[i])}=x.${q(c)}`).join(' and ');
    const n=Number((await db.query(`select count(*) n from ${f.child} x where ${notNull} and not exists(select 1 from ${f.parent} p where ${join})`)).rows[0].n);
    out.push({constraint:f.conname,child:f.child,parent:f.parent,validated:f.convalidated,orphans:n});
  }
  return out;
}

function tocFilter(listText,{include}){
  return listText.split('\n').filter(l=>{
    if(!l.trim()||l.startsWith(';'))return false;
    return include(l);
  }).join('\n')+'\n';
}

/** Açık hedef (çevrim dışı doğrulama: pg-cluster.cjs kümesi, süper kullanıcı OLMAYAN rol). Yalnız Unix soketi ya da yerel
 * adres. Geçici veritabanını bu rol açar ve siler (CREATEDB). */
async function openTarget(target){
  const {Client}=require('pg');
  if(!target||typeof target.host!=='string'||!(target.host.startsWith('/')||['localhost','127.0.0.1','::1'].includes(target.host)))throw Error('hedef yalnız yerel olabilir');
  const base={host:target.host,port:Number(target.port||5432),user:target.user,...(target.password?{password:target.password}:{})};
  const name='nakgo_check_'+process.pid+'_'+Date.now();
  const admin=new Client({...base,database:'postgres'});admin.on('error',()=>{});await admin.connect();
  let c=null,closed=false;
  const close=async()=>{
    if(closed)return;closed=true;const errors=[];
    if(c)try{await c.end();}catch(e){errors.push(e);}
    try{await admin.query('drop database if exists '+name+' with (force)');}catch(e){errors.push(e);}
    try{await admin.end();}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,'Geçici veritabanı temizliği başarısız ('+name+')');
  };
  try{
    await admin.query('create database '+name);
    await admin.query('alter database '+name+" set timezone to 'UTC'");
    c=new Client({...base,database:name,options:'-c TimeZone=UTC'});c.on('error',()=>{});await c.connect();
    return {engine:'postgresql',name,query:(s,a=[])=>c.query(s,a),exec:s=>c.query(s),close};
  }catch(e){await close().catch(()=>{});throw e;}
}

/** target: {host,port,user[,password]} verilirse ortam (NAKGO_PG_*) yerine bu yerel hedef kullanılır.
 * expected: {cron, triggers, snapshot} — referans derlemesi (reference-build.cjs; uygulanmış migration'ların GERÇEK sonucu).
 *   Verilirse zamanlanmış işler bununla (requireMeta), yedekteki dış tetikleyiciler bununla ("external_triggers" kontrolü)
 *   ve geri yüklenen şema özeti bununla ("schema_reference" kontrolü, R4) karşılaştırılır. */
async function restoreAndVerify({bundleDir,pgBin,contractCheck=true,requireMeta=false,hooks={},target=null,expected=null}){
  const source=JSON.parse(fs.readFileSync(path.join(bundleDir,'source.json'),'utf8'));
  const checks=[],notes=[];const fail=(code,detail)=>checks.push({code,ok:false,detail});const pass=(code,detail)=>checks.push({code,ok:true,detail});
  if(!target&&!process.env.NAKGO_PG_HOST)return {status:'failed',checks:[{code:'target',ok:false,detail:'geri yükleme hedefi yalnız yerel PostgreSQL (NAKGO_PG_HOST)'}]};
  // Sinyal alındıysa (abort.cjs) geçici veritabanı açılmaz; açılırken geldiyse hemen kapatılır (kayıtlı görev de kapatır).
  const ABORT=require('./abort.cjs');
  const aborted=()=>({status:'failed',checks:[{code:'aborted',ok:false,detail:'sinyal alındı ('+ABORT.abortSignal()+')'}],notes:[]});
  if(ABORT.isAborting())return aborted();
  const db=target?await openTarget(target):await openDb();let primary=null;
  const unregDb=ABORT.register('geçici doğrulama veritabanı',()=>db.close());
  if(ABORT.isAborting()){try{await finish(db,null);}finally{unregDb();}return aborted();}
  try{await steps();}
  catch(e){primary=e;fail('exception',e.message);}
  finally{await finish(db,primary).catch(e=>fail('cleanup',e.message));unregDb();}
  return done();
  function done(){return {status:checks.length&&checks.every(c=>c.ok)?'ok':'failed',checks,notes};}
  async function steps(){
    // Açık hedefte (çevrim dışı doğrulama) geri yüklemeyi yapan rolün gerçek yetkisi kayda girer (kanıt; etiket değil).
    if(target){const u=(await db.query(`select rolsuper from pg_roles where rolname=current_user`)).rows[0];pass('target_role',{superuser:u.rolsuper===true});}
    const env=target?pgEnv({host:target.host,port:target.port||5432,user:target.user,password:target.password,database:db.name})
      :pgEnv({host:process.env.NAKGO_PG_HOST,port:process.env.NAKGO_PG_PORT||5432,user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:db.name});
    for(const r of source.restore.roles){
      // Rol adı paketten (güvenilmez): yalnız sade tanımlayıcı; değilse geri yükleme durur.
      if(typeof r!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(r))throw Error('paketteki rol adı geçersiz');
      const attrs=Object.hasOwn(SUPABASE_ROLE_ATTRS,r)?SUPABASE_ROLE_ATTRS[r]:'nologin';
      await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='${r.replace(/'/g,"''")}') then create role "${r.replace(/"/g,'""')}" ${attrs}; end if; end $$;`);
    }
    await db.exec(fs.readFileSync(path.join(bundleDir,'bootstrap.sql'),'utf8'));
    const pgr=binPath('pg_restore',pgBin);
    const restore=async(file,listFile)=>{
      const args=['--exit-on-error','--no-owner','--no-password','-d',db.name,...(listFile?['-L',listFile]:[]),path.join(bundleDir,file)];
      return run(pgr,args,{env});
    };
    const hasB=fs.existsSync(path.join(bundleDir,'B.pre.sql'));
    if(hasB){
      try{
        await db.exec(fs.readFileSync(path.join(bundleDir,'B.pre.sql'),'utf8'));
        await loadScope(db,{bundleDir,files:source.b_files||{}});
      }catch(e){fail('restore_b',e.message);return;}
    }
    // Döküm public şemasını açıkça oluşturur; hedefte zaten var. Yalnız "SCHEMA - public" kaydı atlanır, ACL ve
    // yorum kayıtları uygulanır; böylece şemanın varsayılan yetkileri kaynakla aynı kalır.
    const aList=(await run(pgr,['-l',path.join(bundleDir,'A.dump')],{env})).out;
    fs.writeFileSync(path.join(bundleDir,'A.list'),tocFilter(aList,{include:l=>!/ SCHEMA - public /.test(l)}));
    const ra=await restore('A.dump',path.join(bundleDir,'A.list'));
    if(ra.code!==0){fail('restore_a',ra.err.trim().split('\n').slice(-3).join(' | '));return;}
    if(hasB){
      try{await db.exec(fs.readFileSync(path.join(bundleDir,'B.post.sql'),'utf8'));}
      catch(e){fail('restore_b_post',e.message);return;}
    }
    pass('restore','A ve B geri yüklendi');
    // Sayılar
    const mism=[];
    for(const [t,n] of Object.entries(source.counts)){
      const got=Number((await db.query(`select count(*) n from ${t.split('.').map(s=>'"'+s.replace(/"/g,'""')+'"').join('.')}`)).rows[0].n);
      if(got!==n)mism.push(`${t}: kaynak ${n}, geri yüklenen ${got}`);
    }
    mism.length?fail('counts',mism):pass('counts',Object.keys(source.counts).length+' tablo');
    // B içeriği: geri yüklenen satırlar dosyadakiyle birebir aynı mı (yalnız sayı değil).
    if(hasB){
      const d=await compareScope(db,{bundleDir,files:source.b_files||{}});
      d.length?fail('b_content',d):pass('b_content',Object.keys(source.b_files||{}).length+' tablo');
    }
    // Yabancı anahtarlar
    const fks=await fkOrphans(db);
    const orphans=fks.filter(f=>f.orphans>0);
    orphans.length?fail('fk_orphans',orphans):pass('fk_orphans',fks.length+' yabancı anahtar');
    // Şema parmak izi
    const restored=await catalogFingerprint((q,a)=>db.query(q,a),{fullSchemas:source.full_schemas,includedTables:source.included_tables,excludeRoles:[source.dump_role,'postgres',(await db.query('select current_user u')).rows[0].u]});
    const excludedNames=[...source.excluded.transient,...source.excluded.known_loss,...source.excluded.guard_stop_if_rows,...(source.excluded.managed||[])];
    const expectedMissing=l=>excludedNames.some(t=>l.includes(' ON '+t+' ')||l.includes(' '+t+'.'));
    const srcSet=new Set(source.fingerprint_lines),dstSet=new Set(restored);
    const missing=source.fingerprint_lines.filter(l=>!dstSet.has(l)&&!expectedMissing(l));
    const extra=restored.filter(l=>!srcSet.has(l));
    (missing.length||extra.length)?fail('fingerprint',{missing:missing.slice(0,20),extra:extra.slice(0,20),missing_count:missing.length,extra_count:extra.length})
      :pass('fingerprint',restored.length+' satır');
    // Auth sürümü
    if(source.auth_version!==null){
      const v=(await db.query(`select max(version)::text v from auth.schema_migrations`)).rows[0].v;
      v===source.auth_version?pass('auth_version',v):fail('auth_version',{source:source.auth_version,restored:v});
    }
    // Yönetim verisi: dosya bütünlüğü (doğrulamayı düşürür) ve repo ile tutarlılık (not; requireMeta'da kontrol).
    // Sözleşmeden ÖNCE: sözleşme denetimi istisna fırlatırsa (ör. geçmiş yok, şema geride) yönetim verisi sonucu kaybolmaz.
    let meta=null;
    if(source.meta_files){
      try{meta=readMeta(bundleDir,source.meta_files);pass('meta',Object.entries(source.meta_files).map(([t,f])=>t+'='+(f.present?f.rows:'yok')).join(', '));}
      catch(e){fail('meta',e.message);}
      if(meta){
        const RM=require('./restore-meta.cjs');
        const h=meta['supabase_migrations.schema_migrations'],j=meta['cron.job'];
        if(h)notes.push({code:'migration_history',...RM.historyStatus(h)});
        if(j)notes.push({code:'cron_jobs',...RM.cronStatus(j,{history:h,expected:expected&&expected.cron})});
      }
      if((source.external_triggers||[]).length){
        // Kapsam dışı tablolardaki tetikleyicilerimiz düz PostgreSQL'de kurulamaz (tablo yok); hedefte kurtarma SQL'i kurar.
        notes.push({code:'external_triggers',ok:true,triggers:source.external_triggers.map(x=>x.table+'.'+x.name)});
      }
    }
    if(requireMeta){
      // Runbook DURDURMA koşulları kodda: eksik, okunamayan ya da repo ile tutarsız yönetim verisi kabul edilmez.
      const RM=require('./restore-meta.cjs');
      const need=(code,table,status)=>{
        const f=source.meta_files&&source.meta_files[table];
        if(!f||!f.present)return fail(code,{ok:false,reason:'yedekte yok: '+table});
        if(!meta||!Array.isArray(meta[table]))return fail(code,{ok:false,reason:'okunamadı: '+table});
        const st=status(meta[table]);
        return st.ok===true?pass(code,st):fail(code,st);
      };
      need('migration_history','supabase_migrations.schema_migrations',h=>RM.historyStatus(h));
      need('cron_jobs','cron.job',j=>RM.cronStatus(j,{history:meta&&meta['supabase_migrations.schema_migrations']||null,expected:expected&&expected.cron}));
    }
    if(expected){
      // O5: yedekteki dış tetikleyici listesi güvenilir referansla aynı olmalı (tanım çalıştırılmaz, yalnız karşılaştırılır).
      const RM=require('./restore-meta.cjs');
      const ts=RM.triggerStatus(source.external_triggers||[],expected.triggers||[]);
      ts.ok?pass('external_triggers',{count:(expected.triggers||[]).length}):fail('external_triggers',ts);
      // R4: geri yüklenen şema (Production'ın gerçek hâli) = uygulanmış migration'ların referans sonucu.
      const {SNAPSHOT_SQL}=require('../db-lib.cjs');
      const got=(await db.query('select line from ('+SNAPSHOT_SQL+') s order by 1')).rows.map(r=>r.line);
      // Dış tetikleyiciler (kapsam dışı tablolarda) düz geri yüklemede kurulamaz; yukarıda ayrıca karşılaştırıldı.
      const ext=new Set((expected.triggers||[]).map(x=>('trigger '+x.def).replace(/\s+/g,' ')));
      const exp=new Set(expected.snapshot||[]),have=new Set(got);
      const missing=(expected.snapshot||[]).filter(l=>!have.has(l)&&!ext.has(l)),extra=got.filter(l=>!exp.has(l));
      (missing.length||extra.length||!(expected.snapshot||[]).length)?fail('schema_reference',{missing_count:missing.length,extra_count:extra.length,missing:missing.slice(0,10),extra:extra.slice(0,10)})
        :pass('schema_reference',got.length+' satır');
    }
    // Sözleşme: repodaki v0 sözleşmesi repodaki şemayı anlatır. Kaynakta bekleyen migration varsa (migration geçmişi
    // repodan geride; ilk yedekte Production böyledir) sözleşme bu kopyada denetlenmez: provada migration'lardan sonra
    // denetlenir (migration-rehearsal.cjs). Bu bir not olarak kaydedilir; geçmiş yoksa ya da güncelse her zaman denetlenir.
    let behind=null;
    try{
      const h=source.meta_files&&source.meta_files['supabase_migrations.schema_migrations'];
      if(h&&h.present){const rows=readMeta(bundleDir,{x:h}).x;behind=require('./restore-meta.cjs').historyStatus(rows).pending;}
    }catch{behind=null;}
    if(contractCheck&&behind&&behind.length)notes.push({code:'contract',skipped:true,pending:behind.length,reason:`kaynak repodan ${behind.length} migration geride; sözleşme provada denetlenir`});
    else if(contractCheck){
      const {check}=require('../api-contract.cjs');
      // Yedek kapsamı public/private: api şeması (v1, yalnız kod) dökümde yok; v1 sözleşmesi burada denetlenmez.
      const r=await check({client:false,db,checkV1:false});
      r.fails.length?fail('contract',r.fails.slice(0,10)):pass('contract',r.checks+' kontrol');
    }
    for(const [name,fn] of Object.entries(hooks)){
      try{const r=await fn(db,source,{bundleDir});r.ok?pass(name,r.detail):fail(name,r.detail);}catch(e){fail(name,e.message);}
    }
  }
}

module.exports={restoreAndVerify,fkOrphans,openTarget};

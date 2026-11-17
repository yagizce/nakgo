/** B7-A2: S1 başarı ölçütü — dökümün düz PostgreSQL'e geri yüklenebilirliği ve bütünlüğü.
 *
 * Yalnız YEREL ve geçici bir veritabanına geri yükler (db-lib openDb: NAKGO_PG_HOST yerel olmalı; uzak host reddedilir).
 * Production'a, DEV'e ya da herhangi bir Supabase projesine geri yükleme yolu bu kodda yoktur.
 *
 * Sıra: roller (NOLOGIN) → bootstrap (şemalar, tipler, başvurulan fonksiyonlar) → B ön-veri+veri → A (tamamı) →
 *       B son-veri (politika, kendi tetikleyicilerimiz, yabancı anahtarlar).
 * Kontroller (hepsi geçmeli):
 *   counts        tablo başına satır sayısı = S1 (aynı anlık görüntü kanıtı)
 *   fk_orphans    her yabancı anahtar (NOT VALID olanlar dahil) için yetim satır = 0
 *   fingerprint   şema parmak izi = S1; yalnız kapsam dışı tablolara ait satırlar beklenen fark
 *   contract      API sözleşmesi v0 (veritabanı tarafı)
 *   auth_version  Auth sürümü = S1
 *   hooks         isteğe bağlı ek kontroller (A3: yasal zincir)
 * Bu ölçüt "Auth kurtarması başarılı" anlamına GELMEZ; o yalnız gerçek Supabase projesinde S2b ile kanıtlanır. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {openDb,finish}=require('../db-lib.cjs');
const {run,binPath,pgEnv,catalogFingerprint}=require('./dump.cjs');

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

async function restoreAndVerify({bundleDir,pgBin,contractCheck=true,hooks={}}){
  const source=JSON.parse(fs.readFileSync(path.join(bundleDir,'source.json'),'utf8'));
  const checks=[];const fail=(code,detail)=>checks.push({code,ok:false,detail});const pass=(code,detail)=>checks.push({code,ok:true,detail});
  if(!process.env.NAKGO_PG_HOST)return {status:'failed',checks:[{code:'target',ok:false,detail:'geri yükleme hedefi yalnız yerel PostgreSQL (NAKGO_PG_HOST)'}]};
  const db=await openDb();let primary=null;
  try{await steps();}
  catch(e){primary=e;fail('exception',e.message);}
  finally{await finish(db,primary).catch(e=>fail('cleanup',e.message));}
  return done();
  function done(){return {status:checks.length&&checks.every(c=>c.ok)?'ok':'failed',checks};}
  async function steps(){
    const env=pgEnv({host:process.env.NAKGO_PG_HOST,port:process.env.NAKGO_PG_PORT||5432,user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:db.name});
    for(const r of source.restore.roles){
      const attrs=SUPABASE_ROLE_ATTRS[r]||'nologin';
      await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='${r.replace(/'/g,"''")}') then create role "${r.replace(/"/g,'""')}" ${attrs}; end if; end $$;`);
    }
    await db.exec(fs.readFileSync(path.join(bundleDir,'bootstrap.sql'),'utf8'));
    const pgr=binPath('pg_restore',pgBin);
    const restore=async(file,listFile)=>{
      const args=['--exit-on-error','--no-owner','--no-password','-d',db.name,...(listFile?['-L',listFile]:[]),path.join(bundleDir,file)];
      return run(pgr,args,{env});
    };
    const hasB=fs.existsSync(path.join(bundleDir,'B.dump'));
    let post='';
    if(hasB){
      const list=(await run(pgr,['-l',path.join(bundleDir,'B.dump')],{env})).out;
      const allowedTriggers=new Set(source.restore.triggers);
      const isPost=l=>/ (POLICY|FK CONSTRAINT|TRIGGER) /.test(l);
      fs.writeFileSync(path.join(bundleDir,'B.pre.list'),tocFilter(list,{include:l=>!isPost(l)}));
      post=tocFilter(list,{include:l=>{
        if(/ TRIGGER /.test(l)){const m=/ TRIGGER (\S+) (\S+) (\S+) /.exec(l);return m&&allowedTriggers.has(m[1]+' '+m[2]+' '+m[3]);}
        return isPost(l);
      }});
      fs.writeFileSync(path.join(bundleDir,'B.post.list'),post);
      const r=await restore('B.dump',path.join(bundleDir,'B.pre.list'));
      if(r.code!==0){fail('restore_b',r.err.trim().split('\n').slice(-3).join(' | '));return;}
    }
    // Döküm public şemasını açıkça oluşturur; hedefte zaten var. Yalnız "SCHEMA - public" kaydı atlanır, ACL ve
    // yorum kayıtları uygulanır; böylece şemanın varsayılan yetkileri kaynakla aynı kalır.
    const aList=(await run(pgr,['-l',path.join(bundleDir,'A.dump')],{env})).out;
    fs.writeFileSync(path.join(bundleDir,'A.list'),tocFilter(aList,{include:l=>!/ SCHEMA - public /.test(l)}));
    const ra=await restore('A.dump',path.join(bundleDir,'A.list'));
    if(ra.code!==0){fail('restore_a',ra.err.trim().split('\n').slice(-3).join(' | '));return;}
    if(hasB&&post.trim()){
      const r=await restore('B.dump',path.join(bundleDir,'B.post.list'));
      if(r.code!==0){fail('restore_b_post',r.err.trim().split('\n').slice(-3).join(' | '));return;}
    }
    pass('restore','A ve B geri yüklendi');
    // Sayılar
    const mism=[];
    for(const [t,n] of Object.entries(source.counts)){
      const got=Number((await db.query(`select count(*) n from ${t.split('.').map(s=>'"'+s+'"').join('.')}`)).rows[0].n);
      if(got!==n)mism.push(`${t}: kaynak ${n}, geri yüklenen ${got}`);
    }
    mism.length?fail('counts',mism):pass('counts',Object.keys(source.counts).length+' tablo');
    // Yabancı anahtarlar
    const fks=await fkOrphans(db);
    const orphans=fks.filter(f=>f.orphans>0);
    orphans.length?fail('fk_orphans',orphans):pass('fk_orphans',fks.length+' yabancı anahtar');
    // Şema parmak izi
    const restored=await catalogFingerprint((q,a)=>db.query(q,a),{fullSchemas:source.full_schemas,includedTables:source.included_tables,excludeRoles:[source.dump_role,'postgres']});
    const excludedNames=[...source.excluded.transient,...source.excluded.known_loss,...source.excluded.guard_stop_if_rows];
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
    // Sözleşme
    if(contractCheck){
      const {check}=require('../api-contract.cjs');
      const r=await check({client:false,db});
      r.fails.length?fail('contract',r.fails.slice(0,10)):pass('contract',r.checks+' kontrol');
    }
    for(const [name,fn] of Object.entries(hooks)){
      try{const r=await fn(db,source);r.ok?pass(name,r.detail):fail(name,r.detail);}catch(e){fail(name,e.message);}
    }
  }
}

module.exports={restoreAndVerify,fkOrphans};

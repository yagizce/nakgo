/** API sözleşme kontrolü (v0). İki yönü denetler:
 *  1. İstemci ↔ sözleşme: src/js/cloud.js'in çağırdığı RPC'ler, argümanlar, tablolar ve kolonlar
 *     supabase/contract/v0.json'daki listeyle aynı mı?
 *  2. Sözleşme ↔ veritabanı: migration'lardan kurulan şemada her RPC aynı imza, dönüş tipi ve rol yetkisiyle var mı;
 *     migration'a bağlı yetkiler (migration_execute) dosya depodaysa zorunlu, değilse varsa doğrulanır;
 *     tablo/kolon yetkileri istemcinin ihtiyacını karşılıyor mu, yasak kolonlar kapalı mı; sözleşme dışında
 *     anon/authenticated'a açılmış fonksiyon ya da tablo var mı?
 * Motor db-lib.cjs ile seçilir (PGlite veya NAKGO_PG_HOST ile yerel PostgreSQL). Uzak veritabanına bağlanmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {root,openDb,finish,build}=require('./db-lib.cjs');
const contract=JSON.parse(fs.readFileSync(path.join(root,'supabase/contract/v0.json'),'utf8'));
const v1=JSON.parse(fs.readFileSync(path.join(root,'supabase/contract/v1.json'),'utf8'));
let source='',fails=[],checks=0;
const ok=(cond,msg)=>{checks++;if(!cond)fails.push(msg);};
const sameSet=(a,b,msg)=>{const x=[...new Set(a)].sort(),y=[...new Set(b)].sort();ok(JSON.stringify(x)===JSON.stringify(y),msg+': istemci ['+x+'] ↔ sözleşme ['+y+']');};
const constant=name=>{const m=source.match(new RegExp('const '+name+"\\s*=\\s*'([^']*)'"));if(!m)throw Error('cloud.js içinde '+name+' bulunamadı');return m[1].split(',');};
const arrayConst=name=>{const m=source.match(new RegExp('const '+name+'\\s*=\\s*\\[([^\\]]*)\\]'));if(!m)throw Error('cloud.js içinde '+name+' bulunamadı');return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]);};

function clientSide(){
  // RPC adları ve her çağrı satırında geçen p_* argümanları.
  const used={};
  for(const line of source.split('\n'))for(const m of line.matchAll(/\.rpc\('([a-z_]+)'/g)){
    (used[m[1]]??=new Set());for(const a of line.matchAll(/\b(p_[a-z_]+)\b/g))used[m[1]].add(a[1]);
  }
  sameSet(Object.keys(used),Object.keys(contract.rpc),'RPC listesi');
  for(const [name,args] of Object.entries(used)){
    const spec=contract.rpc[name];if(!spec)continue;
    const names=spec.args.map(a=>a[0]);
    for(const a of args)ok(names.includes(a),name+': istemci sözleşmede olmayan argüman gönderiyor: '+a);
    for(const [a,,opt] of spec.args)if(!opt)ok(args.has(a),name+': zorunlu argüman istemcide yok: '+a);
  }
  sameSet([...source.matchAll(/\.from\('([a-z_]+)'\)/g)].map(m=>m[1]),Object.keys(contract.tables),'Tablo listesi');
  const listingColumns=constant('listingColumns'),listingFields=arrayConst('listingFields');
  sameSet(listingColumns,contract.tables.listings.select,'listings okuma kolonları');
  sameSet([...listingFields,'kind','owner_label'],contract.tables.listings.insert,'listings ekleme kolonları');
  sameSet([...listingFields,'status'],contract.tables.listings.update,'listings güncelleme kolonları');
  sameSet(constant('alertColumns'),contract.tables.route_alerts.select,'route_alerts okuma kolonları');
  const profileSelects=[...source.matchAll(/\.from\('profiles'\)[^\n]*?\.select\('([^']*)'\)/g)].map(m=>m[1]);
  ok(profileSelects.length>0,'profiles okuma çağrısı bulunamadı');
  for(const s of profileSelects)sameSet(s.split(','),contract.tables.profiles.select,'profiles okuma kolonları');
  for(const c of [...contract.tables.profiles.insert,...contract.tables.profiles.update])ok(new RegExp("\\b"+c+"\\b").test(source),'profiles kolonu istemcide geçmiyor: '+c);
  ok(source.includes("listing:listings('+listingColumns+')"),'listing_favorites → listings gömülü okuması bulunamadı');
}

async function databaseSide(db){
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const roles=['anon','authenticated'];
  for(const [name,spec] of Object.entries(contract.rpc)){
    const fns=await q(`select p.oid,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result,
      p.proargnames names,p.pronargs n,p.pronargdefaults d,array(select format_type(t,null) from unnest(p.proargtypes) t) types
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=$1`,[name]);
    ok(fns.length===1,name+': tek tanım beklenir, bulunan '+fns.length+' (aşırı yükleme PostgREST çağrısını bozar)');
    if(fns.length!==1)continue;
    const f=fns[0],names=f.names||[],types=f.types;
    const actual=Array.from({length:f.n},(_,i)=>[names[i],types[i],i>=f.n-f.d?'optional':'']);
    const expected=spec.args.map(([a,t,o])=>[a,t,o||'']);
    ok(JSON.stringify(actual)===JSON.stringify(expected),name+': imza değişti: '+JSON.stringify(actual)+' ≠ '+JSON.stringify(expected));
    ok(f.result===spec.returns,name+': dönüş tipi değişti: '+f.result+' ≠ '+spec.returns);
    for(const r of roles){
      const can=(await q('select has_function_privilege($1,$2::oid,\'execute\') v',[r,f.oid]))[0].v;
      ok(can===spec.roles.includes(r),name+': '+r+' çalıştırma yetkisi '+(can?'açık':'kapalı')+', sözleşme '+(spec.roles.includes(r)?'açık':'kapalı')+' diyor');
    }
  }
  // Sözleşme dışında anon/authenticated'a açık fonksiyon olmamalı.
  const allowed=new Set();
  for(const n of Object.keys(contract.rpc))for(const r of contract.rpc[n].roles)allowed.add('public.'+n+' '+r);
  for(const [sig,v] of Object.entries(contract.internal_execute))for(const r of v.roles)allowed.add((sig.includes('.')?sig.replace(/\(.*$/,''):'public.'+sig.replace(/\(.*$/,''))+' '+r);
  // Migration'a bağlı yetkiler: migration dosyası depoda varsa ZORUNLU; yoksa isteğe bağlı (veritabanında varsa imza ve
  // roller birebir doğrulanır, yoksa beklenmez). Böylece ayrı bir PR'daki migration (ör. #125) birleşmeden önce de
  // geri yüklenen production verisi doğrulanabilir; birleştiği anda kural kendiliğinden zorunlu olur.
  for(const [file,spec] of Object.entries(contract.migration_execute||{})){
    const required=presentMigrations?presentMigrations.has(file):fs.existsSync(path.join(root,'supabase/migrations',file));
    for(const [sig,v] of Object.entries(spec.functions)){
      const qualified=sig.replace(/\(.*$/,''),args=sig.slice(sig.indexOf('(')+1,-1);
      const [schema,name]=qualified.includes('.')?qualified.split('.'):['public',qualified];
      const fns=await q(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p where p.pronamespace=$1::regnamespace and p.proname=$2`,[schema,name]);
      if(!fns.length){ok(!required,name+': '+file+' depoda var ama fonksiyon veritabanında yok');continue;}
      ok(fns.length===1&&fns[0].a===args,name+': imza sözleşmeyle uyuşmuyor: '+fns.map(f=>f.a).join(' | '));
      for(const r of v.roles)allowed.add(schema+'.'+name+' '+r);
    }
  }
  const exposed=await q(`select n.nspname||'.'||p.proname||' '||r.rolname k from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join (values('anon'),('authenticated')) r(rolname) where n.nspname in('public','private') and p.prokind='f'
    and has_function_privilege(r.rolname,p.oid,'execute') order by 1`);
  for(const {k} of exposed)ok(allowed.has(k),'sözleşme dışı çalıştırma yetkisi: '+k);
  for(const k of allowed)ok(exposed.some(e=>e.k===k),'sözleşmedeki yetki veritabanında yok: '+k);
  // Tablolar.
  for(const [table,spec] of Object.entries(contract.tables)){
    const rel='public.'+table;
    ok((await q('select relrowsecurity v from pg_class where oid=$1::regclass',[rel]))[0]?.v===true,table+': RLS kapalı');
    for(const op of ['select','insert','update'])for(const c of spec[op]||[])
      ok((await q('select has_column_privilege(\'authenticated\',$1,$2,$3) v',[rel,c,op]))[0].v,table+'.'+c+': authenticated için '+op+' yetkisi yok');
    for(const [op,cols] of Object.entries(spec.forbidden||{}))for(const c of cols){
      const v=c==='*'?(op==='delete'?(await q('select has_table_privilege(\'authenticated\',$1,\'delete\') v',[rel]))[0].v
        :(await q('select has_any_column_privilege(\'authenticated\',$1,$2) v',[rel,op]))[0].v)
        :(await q('select has_column_privilege(\'authenticated\',$1,$2,$3) v',[rel,c,op]))[0].v;
      ok(!v,table+'.'+c+': authenticated için '+op+' yasak olmalı');
    }
    for(const [,target] of Object.entries(spec.embeds||{}))
      ok((await q("select count(*)::int n from pg_constraint where contype='f' and conrelid=$1::regclass and confrelid=$2::regclass",[rel,'public.'+target]))[0].n===1,table+' → '+target+' gömülü okuma için tek yabancı anahtar gerekir');
  }
  // anon hiçbir tabloyu doğrudan göremez; authenticated yalnız sözleşmedeki tablolara erişir.
  const tables=await q(`select c.oid::regclass::text t,r.rolname,
    has_any_column_privilege(r.rolname,c.oid,'select') or has_any_column_privilege(r.rolname,c.oid,'insert')
    or has_any_column_privilege(r.rolname,c.oid,'update') or has_table_privilege(r.rolname,c.oid,'delete') v
    from pg_class c cross join (values('anon'),('authenticated')) r(rolname)
    where c.relnamespace in('public'::regnamespace,'private'::regnamespace) and c.relkind in('r','v','m')`);
  for(const x of tables)if(x.v)ok(x.rolname==='authenticated'&&Object.keys(contract.tables).some(t=>x.t===t||x.t==='public.'+t),'sözleşme dışı tablo erişimi: '+x.rolname+' → '+x.t);
}

/** v1 (api şeması): yalnız sözleşmedeki fonksiyonlar, kurallarına uygun; tablo yok; hata kayıtları sözleşmeyle aynı;
 * kullanım tablosunda kişisel veri sütunu yok. */
async function v1Side(db){
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const S=v1.schema,re=new RegExp(v1.naming);
  ok((await q('select count(*)::int n from pg_namespace where nspname=$1',[S]))[0].n===1,S+' şeması yok');
  const rels=await q(`select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1`,[S]);
  ok(!rels.length,S+' şemasında tablo/görünüm/dizi olmamalı: '+rels.map(r=>r.relname).join(','));
  const types=await q(`select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname=$1 and t.typtype<>'c'`,[S]);
  ok(!types.length,S+' şemasında tip olmamalı: '+types.map(t=>t.typname).join(','));
  for(const r of ['anon','authenticated'])ok((await q('select has_schema_privilege($1,$2,\'usage\') v',[r,S]))[0].v,S+': '+r+' kullanım yetkisi yok');
  for(const r of ['public','anon','authenticated'])ok(!(await q('select has_schema_privilege($1,$2,\'create\') v',[r,S]))[0].v,S+': '+r+' nesne oluşturabiliyor');
  const fns=await q(`select p.oid,p.proname,p.prokind,p.prosecdef,p.provolatile,coalesce(p.proconfig,'{}') cfg,pg_get_function_result(p.oid) result,
      p.proargnames names,p.pronargs n,p.pronargdefaults d,array(select format_type(t,null) from unnest(p.proargtypes) t) types,p.prosrc src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 order by 1`,[S]);
  const R=v1.function_rules;
  sameSet(fns.map(f=>f.proname),Object.keys(v1.functions),S+' fonksiyon listesi: veritabanı');
  ok(new Set(fns.map(f=>f.proname)).size===fns.length,S+': aşırı yüklenmiş fonksiyon var');
  for(const f of fns){
    const name=f.proname,spec=v1.functions[name];
    ok(re.test(name),name+': ad kuralına uymuyor ('+v1.naming+')');
    ok(f.prokind==='f',name+': fonksiyon değil');
    ok(f.result===R.returns,name+': dönüş '+f.result+' (jsonb olmalı)');
    ok(f.prosecdef===R.security_definer,name+': SECURITY DEFINER değil');
    ok(f.cfg.length===1&&/^search_path=("")?$/.test(f.cfg[0]),name+': search_path boş değil: '+f.cfg.join(';'));
    ok(f.provolatile===R.volatility,name+': VOLATILE değil');
    ok(f.src.includes(R.begin.replace('<name>',name)),name+': ilk adım private.api_begin(\''+name+'\') değil');
    const m=/^\s*(?:declare\b([\s\S]*?))?\bbegin\b\s*([\s\S]*)$/i.exec(f.src)||[];
    ok(/^perform private\.api_begin\(/.test(m[2]||''),name+': private.api_begin gövdenin ilk satırı değil');
    ok(!/[a-z_]+\s*\(/i.test((m[1]||'').replace(/\b(?:numeric|varchar|char|timestamptz|timestamp)\s*\(/gi,'')),name+': declare bölümünde fonksiyon çağrısı (api_begin\'den önce çalışır)');
    for(const r of ['public','anon','authenticated']){
      const can=(await q(r==='public'?`select exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=$1),acldefault('f',(select proowner from pg_proc where oid=$1)))) a where a.grantee=0 and a.privilege_type='EXECUTE') v`
        :`select has_function_privilege($2,$1::oid,'execute') v`,r==='public'?[f.oid]:[f.oid,r]))[0].v;
      ok(can===Boolean(spec&&spec.roles.includes(r)),name+': '+r+' çalıştırma yetkisi '+(can?'açık':'kapalı'));
    }
    if(spec){
      const names=f.names||[],actual=Array.from({length:f.n},(_,i)=>[names[i],f.types[i],i>=f.n-f.d?'optional':'']);
      ok(JSON.stringify(actual)===JSON.stringify(spec.args.map(([a,t,o])=>[a,t,o||''])),name+': imza sözleşmeden farklı');
    }
  }
  const errs=await q('select key,sqlstate from private.api_errors order by key');
  sameSet(errs.map(e=>e.key),Object.keys(v1.errors),'v1 hata anahtarları');
  for(const e of errs)if(v1.errors[e.key])ok(v1.errors[e.key].sqlstate===e.sqlstate,'v1 hata '+e.key+': SQLSTATE '+e.sqlstate+' ≠ sözleşme '+v1.errors[e.key].sqlstate);
  const cols=(await q(`select column_name c from information_schema.columns where table_schema='private' and table_name='api_usage' order by ordinal_position`)).map(r=>r.c);
  ok(JSON.stringify(cols)===JSON.stringify(v1.usage_columns),'api_usage sütunları sözleşmeden farklı (kişisel veri sütunu eklenmemeli): '+cols.join(','));
  // Yardımcılar istemciye kapalı.
  const helpers=await q(`select p.oid::regprocedure::text f,r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values('anon'),('authenticated')) r(rolname)
    where n.nspname='private' and p.proname like 'api\\_%' and has_function_privilege(r.rolname,p.oid,'execute')`);
  ok(!helpers.length,'api yardımcısı istemciye açık: '+helpers.map(h=>h.f+' '+h.rolname).join(','));
}

/** İstemci kaynağını (verilmezse src/js/cloud.js) ve/veya hazır bir veritabanını denetler; {checks,fails} döner. */
let presentMigrations=null;
let v1Enabled=true;
async function check({client=true,db=null,clientSource=null,migrationsPresent=null,checkV1=true}={}){
  fails=[];checks=0;v1Enabled=checkV1;presentMigrations=migrationsPresent?new Set(migrationsPresent):null;
  if(client){source=clientSource??fs.readFileSync(path.join(root,'src/js/cloud.js'),'utf8');clientSide();}
  if(db){await databaseSide(db);if(v1Enabled)await v1Side(db);}
  return {checks,fails};
}
module.exports={check,contract,v1};

if(require.main===module)(async()=>{
  const db=await openDb();let r,primary=null;
  try{await build(db);r=await check({db});}catch(e){primary=e;throw e;}finally{await finish(db,primary);}
  for(const f of r.fails)console.log('  ✗ '+f);
  console.log('API sözleşmesi '+contract.version+' + '+v1.version+' ('+db.engine+'): '+(r.checks-r.fails.length)+'/'+r.checks+' kontrol geçti');
  if(r.fails.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});

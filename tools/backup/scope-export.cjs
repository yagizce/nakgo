/** B7-A5: Auth/Storage kapsam tabloları (B kısmı) — pg_dump yerine dışa aktarma fonksiyonları.
 *
 * Yedek rolü auth ve storage şemalarında USAGE'a sahip değildir; pg_dump bu tabloları kilitleyemez ve okuyamaz. Bu yüzden:
 *   - Yapı (DDL) katalogdan üretilir. Katalog fonksiyonları (format_type, pg_get_constraintdef, pg_get_expr,
 *     pg_get_triggerdef) şema yetkisi istemez; veri okunmaz.
 *   - Veri yalnız ops/backup/scope.json'daki "export" fonksiyonlarından, S1 işlemi içinde (aynı anlık görüntü), imleçle
 *     satır satır alınır ve B/<tablo>.jsonl dosyalarına yazılır (satır başına bir JSON nesnesi).
 *
 * Bu DDL yalnız düz PostgreSQL'e DOĞRULAMA geri yüklemesi içindir: tablo, sütun, birincil/tekil/denetim kısıtları, kapsam
 * içi yabancı anahtarlar, RLS bayrağı, politikalar, izinli tetikleyiciler ve ACL. Tekil olmayan dizinler alınmaz. Gerçek
 * felaket kurtarmada Auth/Storage şemasını Supabase kurar; yalnız veri yüklenir (docs/backup/runbooks/restore-dr.md).
 *
 * İki okuma kipi:
 *   functions  (B7, yedek rolü): satırlar yalnız dışa aktarma fonksiyonlarından.
 *   direct     (ilk yedek, "bootstrap"; yedek rolü ve fonksiyonlar henüz yokken): AYNI sorgular doğrudan, fonksiyonların
 *              sahibi olacak rolle (Supabase: postgres). DIRECT_SQL fonksiyon gövdeleriyle aynıdır; test (b8) aynı
 *              veritabanında iki kipin çıktısının birebir aynı olduğunu denetler. Tek kullanımlık belirteçler iki kipte de
 *              boş yazılır.
 * Yönetim verisi (scope.meta: cron.job, migration geçmişi) meta/<ad>.jsonl dosyalarına alınır; yalnız direct kipte (B7 için
 * dışa aktarma fonksiyonları ayrı iştir). */
'use strict';
/** source.json'daki dosya adı güvenilmez: yalnız <klasör>/<şema>.<tablo>.jsonl (yol kaçışı yok). */
const bundleRel=(f,dir)=>{if(typeof f!=='string'||!new RegExp('^'+dir+'/[a-z_][a-z0-9_]*\\.[a-z_][a-z0-9_]*\\.jsonl$').test(f))throw Error('paket dosya adı geçersiz');return f;};
const fs=require('node:fs'),path=require('node:path');
const {sha256}=require('./crypto.cjs');

const qi=s=>'"'+String(s).replace(/"/g,'""')+'"';
const qn=t=>t.split('.').map(qi).join('.');
const fileOf=t=>'B/'+t+'.jsonl';
const metaFileOf=t=>'meta/'+t+'.jsonl';

/** Tablo sorguları dışa aktarma fonksiyonlarının "return query" gövdeleriyle birebir aynıdır (tek sütun; kaynak:
 * supabase/migrations/20261118000000_backup_export.sql; test denetler). cron.job ve migration geçmişi yalnız bootstrap
 * kipinde okunur: yalnız ad/zaman/komut/veritabanı/kullanıcı/etkinlik ve sürüm/ad (SQL metni alınmaz). */
const TOKEN_COLUMNS=['confirmation_token','recovery_token','email_change_token_new','email_change_token_current','reauthentication_token','phone_change_token'];
const DIRECT_SQL={
  'auth.users':`select x.j || coalesce((select jsonb_object_agg(k,'') from unnest(array[${TOKEN_COLUMNS.map(c=>"'"+c+"'").join(',')}]) k where x.j ? k),'{}'::jsonb)
  from (select to_jsonb(u) j from auth.users u) x`,
  'auth.identities':'select to_jsonb(t) from auth.identities t',
  'auth.mfa_factors':'select to_jsonb(t) from auth.mfa_factors t',
  'auth.schema_migrations':'select to_jsonb(t) from auth.schema_migrations t',
  'storage.buckets':'select to_jsonb(t) from storage.buckets t',
  'storage.objects':'select to_jsonb(t) from storage.objects t',
  'cron.job':`select jsonb_build_object('jobname',j.jobname,'schedule',j.schedule,'command',j.command,'database',j.database,
   'username',j.username,'active',j.active) from cron.job j order by j.jobname,j.jobid`,
  'supabase_migrations.schema_migrations':`select jsonb_build_object('version',m.version,'name',m.name) from supabase_migrations.schema_migrations m order by m.version`
};
const directFrom=name=>`(${DIRECT_SQL[name]}) d(j)`;
const sourceSql=(t,mode)=>{
  if(mode==='direct'){if(!DIRECT_SQL[t.name])throw Error('doğrudan sorgu tanımlı değil: '+t.name);return `select j::text j from ${directFrom(t.name)}`;}
  return `select j::text j from ${qn(t.export)}() j`;
};
async function relExists(c,t){
  const [ns,rel]=t.split('.');
  return (await c.query(`select exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2) e`,[ns,rel])).rows[0].e;
}

/** Kapsam denetimi (yalnız katalog): coverage_schemas içindeki her tablo bir listede olmalı. Dönüş: sınıflandırılmamışlar. */
function classified(scope){
  return new Set([...scope.tables.map(t=>t.name),...scope.excluded.transient,...scope.excluded.known_loss,...scope.excluded.guard_stop_if_rows,
    ...(scope.excluded.guard_stop_if_rows_pending||[]),...(scope.excluded.managed||[]),...scope.guard_exact_zero,...(scope.meta||[]).map(m=>m.name)]);
}
async function unclassifiedTables(c,scope){
  const known=classified(scope);
  const rows=(await c.query(`select n.nspname||'.'||c.relname q from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname = any($1::text[]) order by 1`,[scope.coverage_schemas||[]])).rows.map(r=>r.q);
  return {total:rows.length,unclassified:rows.filter(q=>!known.has(q)),present:rows};
}
/** Envanter denetimi (bootstrap): coverage_schemas içindeki gerçek tablo kümesi scope.coverage_inventory.tables ile
 * birebir aynı olmalı. Dönüş: neden listesi (boşsa geçer). Liste yoksa, biçimi bozuksa, yineleme ya da sınıflandırılmamış
 * satır içeriyorsa da durur; eksik ve fazla tablo ayrı ayrı adlandırılır. Hiçbir tablo otomatik yok sayılmaz. */
function inventoryProblems(scope,present){
  const inv=scope.coverage_inventory,schemas=scope.coverage_schemas||[];
  if(!inv||!Array.isArray(inv.tables)||!inv.tables.length)return ['kapsam envanteri tanımlı değil (ops/backup/scope.json coverage_inventory)'];
  const reasons=[],seen=new Set(),known=classified(scope);
  for(const t of inv.tables){
    if(typeof t!=='string'||!/^[a-z_]+\.[a-z0-9_]+$/.test(t)||!schemas.includes(t.split('.')[0])){reasons.push('envanter satırı geçersiz: '+String(t));continue;}
    if(seen.has(t)){reasons.push('envanterde yinelenen tablo: '+t);continue;}
    seen.add(t);
    if(!known.has(t))reasons.push('envanterde sınıflandırılmamış tablo: '+t);
  }
  const have=new Set(present);
  for(const t of seen)if(!have.has(t))reasons.push('envanterdeki tablo veritabanında yok: '+t);
  for(const t of have)if(!seen.has(t))reasons.push('envanterde olmayan tablo: '+t);
  return reasons;
}
/** Sayım fonksiyonunun saydığı liste (a1 testi fonksiyonla eşitliğini denetler) ve sayılması gereken bütün liste. */
const coreGuardList=scope=>[...scope.excluded.guard_stop_if_rows,...scope.excluded.known_loss,...scope.guard_exact_zero,'pg_catalog.pg_largeobject_metadata'];
const guardList=scope=>[...coreGuardList(scope),...(scope.excluded.guard_stop_if_rows_pending||[])];
/** Sayım sonucundaki anahtar: sayım fonksiyonuyla aynı (pg_catalog tabloları şemasız). */
const guardKey=t=>t.startsWith('pg_catalog.')?t.slice('pg_catalog.'.length):t;
/** Kapsam dışı tabloların kesin sayıları, doğrudan (bootstrap): bütün liste; tablo yoksa anahtar yok. */
async function directGuardCounts(c,scope){
  const r={};
  for(const t of guardList(scope)){
    if(!await relExists(c,t))continue;
    if((await c.query('select row_security_active($1::regclass) a',[t])).rows[0].a)throw Error('RLS etkin: '+t);
    r[guardKey(t)]=Number((await c.query(`select count(*) n from ${qn(t)}`)).rows[0].n);
  }
  return r;
}
/** to_jsonb'nin metin çıktısını etkileyen oturum ayarları. Dışa aktarma (S1) ve geri yükleme içerik denetimi aynı
 * ayarlarla çalışır; böylece geri yüklenen satırların yeniden dışa aktarımı dosyayla bayt bayt karşılaştırılabilir. */
const EXPORT_SETTINGS=`set local timezone='UTC'; set local datestyle='ISO, YMD'; set local intervalstyle='postgres'; set local extra_float_digits=1;`;

async function tableOid(c,t){
  const [ns,rel]=t.split('.');
  const r=(await c.query(`select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2`,[ns,rel])).rows;
  if(!r.length)throw Error('tablo yok: '+t);
  return r[0].oid;
}

/** Kapsam tablolarının DDL'i. pre: tablolar ve tablo içi kısıtlar (veri yüklemeden önce); post: yabancı anahtarlar, RLS,
 * politikalar, izinli tetikleyiciler, ACL (A geri yüklendikten sonra). */
async function scopeDDL(c,{included,allowedTriggers=[],excludeAclRoles=[]}){
  const pre=[],post=[],skipped=[];
  const set=new Set(included);
  for(const t of included){
    const oid=await tableOid(c,t);
    const cols=(await c.query(`select a.attname,format_type(a.atttypid,a.atttypmod) typ,a.attnotnull nn,a.attidentity::text ident,a.attgenerated::text gen,
        pg_get_expr(d.adbin,d.adrelid) expr
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`,[oid])).rows;
    // Varsayılanlarda başvurulan diziler (nextval) önceden oluşturulur; değerleri doğrulama için önemsizdir.
    for(const s of (await c.query(`select distinct s.oid::regclass::text q from pg_catalog.pg_depend d join pg_catalog.pg_attrdef ad on d.classid='pg_attrdef'::regclass and d.objid=ad.oid
        join pg_catalog.pg_class s on d.refclassid='pg_class'::regclass and d.refobjid=s.oid and s.relkind='S' where ad.adrelid=$1 order by 1`,[oid])).rows)
      pre.push(`create sequence if not exists ${s.q};`);
    const defs=cols.map(x=>{
      let s=`  ${qi(x.attname)} ${x.typ}`;
      if(x.gen==='s')s+=` generated always as (${x.expr}) stored`;
      else if(x.ident==='a')s+=' generated always as identity';
      else if(x.ident==='d')s+=' generated by default as identity';
      else if(x.expr!==null)s+=` default ${x.expr}`;
      if(x.nn)s+=' not null';
      return s;
    });
    for(const k of (await c.query(`select conname,pg_get_constraintdef(oid) def from pg_catalog.pg_constraint where conrelid=$1 and contype in ('p','u','c','x') order by contype,conname`,[oid])).rows)
      defs.push(`  constraint ${qi(k.conname)} ${k.def}`);
    pre.push(`create table ${qn(t)} (\n${defs.join(',\n')}\n);`);
    for(const k of (await c.query(`select k.conname,pg_get_constraintdef(k.oid) def,f.oid::regclass::text ref,
        (select n.nspname||'.'||f.relname from pg_catalog.pg_namespace n where n.oid=f.relnamespace) refq
        from pg_catalog.pg_constraint k join pg_catalog.pg_class f on f.oid=k.confrelid where k.conrelid=$1 and k.contype='f' order by 1`,[oid])).rows){
      if(set.has(k.refq))post.push(`alter table ${qn(t)} add constraint ${qi(k.conname)} ${k.def};`);
      else skipped.push(`yabancı anahtar ${t}.${k.conname} → ${k.refq} (kapsam dışı)`);
    }
    const rls=(await c.query(`select relrowsecurity r,relforcerowsecurity f from pg_catalog.pg_class where oid=$1`,[oid])).rows[0];
    if(rls.r)post.push(`alter table ${qn(t)} enable row level security;`);
    if(rls.f)post.push(`alter table ${qn(t)} force row level security;`);
    for(const p of (await c.query(`select p.polname,p.polpermissive perm,p.polcmd::text cmd,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk,
        array(select case when r=0 then 'public' else quote_ident(pg_get_userbyid(r)) end from unnest(p.polroles) r order by 1) roles
        from pg_catalog.pg_policy p where p.polrelid=$1 order by 1`,[oid])).rows){
      const cmd={r:'select',a:'insert',w:'update',d:'delete','*':'all'}[p.cmd];
      post.push(`create policy ${qi(p.polname)} on ${qn(t)} as ${p.perm?'permissive':'restrictive'} for ${cmd} to ${p.roles.join(', ')}`+
        (p.qual!==null?` using (${p.qual})`:'')+(p.chk!==null?` with check (${p.chk})`:'')+';');
    }
    const [ns,rel]=t.split('.');
    for(const g of (await c.query(`select tgname,pg_get_triggerdef(oid) def from pg_catalog.pg_trigger where tgrelid=$1 and not tgisinternal order by 1`,[oid])).rows){
      if(allowedTriggers.includes(ns+' '+rel+' '+g.tgname))post.push(g.def+';');
      else skipped.push(`tetikleyici ${t}.${g.tgname} (kapsam dışı fonksiyon)`);
    }
    // ACL: tablo ve sütun. Sahip ve dökümü alan rol hariç (geri yükleme sahibi farklıdır; fingerprint de bunları dışlar).
    for(const a of (await c.query(`select pg_get_userbyid(a.grantee) g,a.grantee=0 pub,a.privilege_type p,a.is_grantable gr
        from pg_catalog.pg_class c cross join lateral aclexplode(c.relacl) a where c.oid=$1 and a.grantee<>c.relowner order by 1,3`,[oid])).rows){
      if(!a.pub&&excludeAclRoles.includes(a.g))continue;
      post.push(`grant ${a.p.toLowerCase()} on ${qn(t)} to ${a.pub?'public':qi(a.g)}${a.gr?' with grant option':''};`);
    }
    for(const a of (await c.query(`select at.attname col,pg_get_userbyid(a.grantee) g,a.grantee=0 pub,a.privilege_type p
        from pg_catalog.pg_attribute at cross join lateral aclexplode(at.attacl) a where at.attrelid=$1 and at.attnum>0 and not at.attisdropped order by 1,2,4`,[oid])).rows){
      if(!a.pub&&excludeAclRoles.includes(a.g))continue;
      post.push(`grant ${a.p.toLowerCase()} (${qi(a.col)}) on ${qn(t)} to ${a.pub?'public':qi(a.g)};`);
    }
  }
  return {pre:pre.join('\n')+'\n',post:post.join('\n')+'\n',skipped};
}

/** Kapsam tablolarının verisi, AÇIK S1 işlemi içinde (c) imleçle. Dönüş: tablo başına satır sayısı, dosya ve sha256. */
async function exportScope(c,{tables,outDir,batch=1000,mode='functions',fileFor=fileOf}){
  fs.mkdirSync(path.join(outDir,'B'),{recursive:true,mode:0o700});
  const files={};
  for(const t of tables){
    const rel=fileFor(t.name),file=path.join(outDir,rel);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const fd=fs.openSync(file,'w',0o600);
    let rows=0;
    try{
      await c.query(`declare nakgo_b no scroll cursor for ${sourceSql(t,mode)}`);
      for(;;){
        const r=(await c.query(`fetch ${batch} from nakgo_b`)).rows;
        if(!r.length)break;
        fs.writeSync(fd,r.map(x=>x.j).join('\n')+'\n');rows+=r.length;
      }
      await c.query('close nakgo_b');
    }finally{fs.closeSync(fd);}
    files[t.name]={file:rel,rows,sha256:sha256(fs.readFileSync(file))};
  }
  return files;
}

/** Yönetim verisi (scope.meta). Tablo yoksa {present:false}; varsa satırlar meta/<ad>.jsonl. */
async function exportMeta(c,{meta,outDir,mode='functions'}){
  const out={};
  for(const m of meta){
    if(!await relExists(c,m.name)){out[m.name]={present:false};continue;}
    const f=await exportScope(c,{tables:[m],outDir,mode,fileFor:metaFileOf});
    out[m.name]={present:true,...f[m.name]};
  }
  return out;
}
/** Meta dosyalarının bütünlüğü: hash ve satır sayısı. Dönüş: satırlar (JSON) ya da hata. */
function readMeta(bundleDir,files){
  const out={};
  for(const [t,f] of Object.entries(files||{})){
    if(!f.present){out[t]=null;continue;}
    const buf=fs.readFileSync(path.join(bundleDir,bundleRel(f.file,'meta')));
    if(sha256(buf)!==f.sha256)throw Error('meta dosyası bozuk: '+f.file);
    const rows=buf.toString('utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
    if(rows.length!==f.rows)throw Error(`meta satır sayısı uyuşmuyor: ${t} ${rows.length}≠${f.rows}`);
    out[t]=rows;
  }
  return out;
}

/** Doğrulama geri yüklemesi: dosya sha256'sı source.json ile aynı olmalı; satırlar jsonb_populate_recordset ile yüklenir.
 * Üretilen sütunlar atlanır; kimlik sütunları kaynaktaki değerleri korur. */
async function loadScope(db,{bundleDir,files,batch=500}){
  for(const [t,f] of Object.entries(files)){
    const buf=fs.readFileSync(path.join(bundleDir,bundleRel(f.file,'B')));
    if(sha256(buf)!==f.sha256)throw Error('B veri dosyası bozuk: '+f.file);
    const lines=buf.toString('utf8').split('\n').filter(Boolean);
    if(lines.length!==f.rows)throw Error(`B satır sayısı uyuşmuyor: ${t} ${lines.length}≠${f.rows}`);
    const cols=(await db.query(`select string_agg(quote_ident(attname),',' order by attnum) c from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped and attgenerated=''`,[qn(t)])).rows[0].c;
    for(let i=0;i<lines.length;i+=batch){
      const chunk='['+lines.slice(i,i+batch).join(',')+']';
      await db.query(`insert into ${qn(t)} (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::${qn(t)},$1::jsonb)`,[chunk]);
    }
  }
}

/** Kayıpsızlık denetimi: geri yüklenen tablonun aynı ayarlarla yeniden dışa aktarımı, dosyadaki satırlarla (çoklu küme
 * olarak) birebir aynı olmalı. Yalnız satır sayısı değil içerik de karşılaştırılır; tür dönüşümünde kayıp yakalanır. */
async function compareScope(db,{bundleDir,files}){
  const diffs=[];
  await db.exec('begin');
  try{
    await db.exec(EXPORT_SETTINGS);
    for(const [t,f] of Object.entries(files)){
      const want=fs.readFileSync(path.join(bundleDir,bundleRel(f.file,'B')),'utf8').split('\n').filter(Boolean).sort();
      const got=(await db.query(`select to_jsonb(x)::text j from ${qn(t)} x`)).rows.map(r=>r.j).sort();
      if(sha256(want.join('\n'))!==sha256(got.join('\n'))){
        const g=new Set(got),w=new Set(want);
        diffs.push({table:t,missing:want.filter(l=>!g.has(l)).length,extra:got.filter(l=>!w.has(l)).length});
      }
    }
  }finally{await db.exec('rollback');}
  return diffs;
}

module.exports={scopeDDL,exportScope,exportMeta,readMeta,loadScope,compareScope,fileOf,metaFileOf,EXPORT_SETTINGS,DIRECT_SQL,directFrom,TOKEN_COLUMNS,
  unclassifiedTables,inventoryProblems,classified,guardList,coreGuardList,guardKey,directGuardCounts,relExists};

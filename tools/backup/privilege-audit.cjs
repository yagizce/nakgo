/** B7-A1: yedek rolünün yetki denetimi ve SECURITY DEFINER katalog parmak izi.
 *
 * Yalnız katalog okur; hiçbir şey yazmaz. db: {query(sql,args)} (db-lib.openDb veya pg Client).
 *
 * audit(db,{role})     → rolün özellikleri, üyelikleri, veritabanı/şema/tablo/dizi yetkileri ve çağırabildiği
 *                        tetikleyici olmayan her SECURITY DEFINER fonksiyonun ayrıntılı parmak izi.
 * evaluate(audit,opts) → bulguları üç sınıfa ayırır:
 *     nonwaivable: rolün kendisi beklenen profilden saptı (yazma, herhangi bir üyelik, CREATE, rol özelliği), dışa aktarma
 *                  fonksiyonu sabitlenen (ops/backup/export-functions.json) halinden saptı ya da rol bir ağ fonksiyonunu
 *                  (net.*, http*, dblink*) çağırabiliyor. Hiçbir muafiyet geçmez.
 *     waivable:    izin listesinde olmayan ya da parmak izi değişmiş çağrılabilir SECURITY DEFINER fonksiyon.
 *                  Döküm başlamaz; yalnız geçerli, imzalı ve tek kullanımlık bir K6 muafiyeti (varsayılan kapalı) geçer.
 *     info:        izin listesinde olup artık bulunmayan kayıtlar; sabitlenmiş halde bulunan dışa aktarma fonksiyonları;
 *                  süper kullanıcı olmadan kapatılamayan, kabul edilmiş PUBLIC yan yolları (büyük nesne, WAL mesajı, TEMP).
 * invariants(db)       → migration'lardan kurulan şemada değişmezler: public/private'ta PUBLIC'e açık tetikleyici olmayan
 *                        SECURITY DEFINER fonksiyon yok; service_role'e verilen açık yetkiler sözleşmedeki listeyle aynı.
 *
 * Bilinen sınır: PL/pgSQL ve metin gövdeli SQL fonksiyonlarında bağımlılıkları PostgreSQL kataloğu izlemez. Okunan/yazılan
 * tablolar gövdedeki şema-nitelikli adlardan statik olarak çıkarılır; şemasız adlar ve dinamik SQL bu yolla bulunamaz.
 * Bu yüzden dinamik SQL ve şema belirtmeyen search_path, izin listesinde ayrıca gerekçe ister (bkz. allowlistEntryValid). */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {canonical,sha256,sha256Json}=require('./crypto.cjs');
const root=path.resolve(__dirname,'../..');

// Yedek rolünün beklenen profili. Değişiklik ancak bu dosyada, incelemeli PR ile.
// B7-A5 dar rol: HİÇBİR üyelik yok (pg_read_all_data dahil). Auth/Storage yalnız sabitlenmiş dışa aktarma fonksiyonlarıyla.
const ROLE_PROFILE={super:false,createrole:false,createdb:false,replication:false,login:true,bypassrls:true,connlimitMax:2};
const WRITE_TABLE_PRIVS=['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];

async function rows(db,sql,args=[]){return (await db.query(sql,args)).rows;}

function normalizeBody(def){return String(def).replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\r/g,'').replace(/\s+/g,'');}

/** search_path kuralı: ayar sabitlenmiş olmalı ve pg_temp açıkça EN SONDA yazılmalı. PostgreSQL, pg_temp listede yoksa onu tablo ve
 * tip adlarında ilk sırada arar; bu yüzden search_path='' bile geçici şema gölgelemesine karşı koruma sağlamaz. */
function searchPathStatus(config){
  const entry=(config||[]).find(c=>c.startsWith('search_path='));
  if(!entry)return {value:null,ok:false,reason:'search_path sabitlenmemiş'};
  const value=entry.slice('search_path='.length);
  const parts=value.split(',').map(s=>s.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean);
  if(!parts.length)return {value,ok:false,reason:'search_path boş: pg_temp örtük olarak ilk sırada aranır'};
  if(parts[parts.length-1]!=='pg_temp')return {value,ok:false,reason:'pg_temp açıkça en sonda değil'};
  return {value,ok:true,reason:null};
}

const RISK_PATTERNS={
  dynamic_sql:/\bexecute\s+(?!function\b|procedure\b)/i,
  network:/\bnet\.\w+|\bhttp_(get|post|put|delete|request)\b|\bhttp\s*\(/i,
  dblink:/\bdblink/i,
  notify:/\bpg_notify\b|\bnotify\s+\w/i,
  setting_change:/\bset_config\s*\(|\bset\s+(local\s+)?(role|session\s+authorization|search_path|session_replication_role)\b|\breset\s+role\b/i,
  advisory_lock:/\bpg_advisory/i,
  sleep:/\bpg_sleep/i,
  copy:/\bcopy\s/i,
  large_object:/\blo_(import|export|create|unlink)\b/i,
  data_write:/\binsert\s+into\b|\bupdate\s+[a-z_"][\w."]*\s+set\b|\bdelete\s+from\b|\btruncate\b/i,
  ddl:/\b(create|alter|drop|grant|revoke)\s+(table|function|role|schema|policy|trigger|index|view|extension|sequence|on|all|usage|select|insert|update|delete|execute)\b/i
};
function riskFlags(src){const s=String(src).replace(/--[^\n]*/g,'');return Object.keys(RISK_PATTERNS).filter(k=>RISK_PATTERNS[k].test(s));}

/** Gövdedeki şema-nitelikli adlar: tablolar (to_regclass ile çözülür) ve fonksiyon çağrıları. */
function qualifiedRefs(src){
  const s=String(src).replace(/--[^\n]*/g,'').replace(/'(?:[^']|'')*'/g,"''");
  const rels=new Set(),funcs=new Set();
  for(const m of s.matchAll(/\b("?[a-z_][a-z0-9_$]*"?)\s*\.\s*("?[a-z_][a-z0-9_$]*"?)(\s*\()?/gi)){
    const a=m[1].replace(/"/g,'').toLowerCase(),b=m[2].replace(/"/g,'').toLowerCase();
    (m[3]?funcs:rels).add(a+'.'+b);
  }
  return {rels:[...rels].sort(),funcs:[...funcs].sort()};
}

/** Katalogdan ad ile bulunur: to_regclass, rolün USAGE'ı olmayan şemada (ör. auth) "permission denied" verir. */
async function relationState(db,qname){
  const r=await rows(db,`select c.oid,c.relkind::text kind,pg_get_userbyid(c.relowner) owner,coalesce(c.relacl::text,'') acl,
    c.relrowsecurity rls,c.relforcerowsecurity force_rls,
    coalesce((select string_agg(p.polname||':'||p.polcmd::text||':'||p.polpermissive::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||':'||array_to_string(p.polroles::regrole[]::text[],','),'|' order by p.polname)
      from pg_policy p where p.polrelid=c.oid),'') policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2`,qname.split('.'));
  if(!r.length)return null;
  const x=r[0];return {name:qname,kind:x.kind,owner:x.owner,acl:x.acl,rls:x.rls,force_rls:x.force_rls,policies_sha256:sha256(x.policies)};
}

async function functionFacts(db,oid,role){
  const f=(await rows(db,`select p.oid,n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,
      pg_get_function_result(p.oid) result,l.lanname lang,p.prosecdef secdef,p.provolatile::text volatility,p.proleakproof leakproof,
      p.proparallel::text parallel,p.prokind::text kind,p.prorettype::regtype::text rettype,coalesce(p.proconfig,'{}'::text[]) config,
      coalesce(p.proacl::text,'') acl,pg_get_userbyid(p.proowner) owner,o.rolsuper owner_super,o.rolbypassrls owner_bypassrls,
      p.prosrc src,case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else '' end def,
      has_schema_privilege($2,n.oid,'USAGE') schema_usage,has_function_privilege($2,p.oid,'EXECUTE') can_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang join pg_roles o on o.oid=p.proowner
    where p.oid=$1`,[oid,role]))[0];
  const sources=(await rows(db,`select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,
      case when a.grantee=0 then 'PUBLIC' when a.grantee=(select oid from pg_roles where rolname=$2) then 'direct' else 'membership' end via
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=$1 and a.privilege_type='EXECUTE'
      and (a.grantee=0 or a.grantee=(select oid from pg_roles where rolname=$2) or pg_has_role($2,a.grantee,'MEMBER'))
    order by 1`,[oid,role]));
  return {f,sources};
}

/** Tek bir fonksiyonun parmak izi; çağırdığı fonksiyonlar en fazla `depth` seviye özyinelemeli izlenir. */
async function fingerprintFunction(db,oid,role,{depth=3,seen=new Set()}={}){
  const {f,sources}=await functionFacts(db,oid,role);
  const id=f.schema+'.'+f.name+'('+f.args+')';
  const sp=searchPathStatus(f.config);
  const refs=f.lang==='c'||f.lang==='internal'?{rels:[],funcs:[]}:qualifiedRefs(f.src);
  const relations=[];
  for(const r of refs.rels){const st=await relationState(db,r);if(st)relations.push(st);}
  const calls=[];let deep=false;
  seen.add(oid);
  for(const q of refs.funcs){
    const [s,n]=q.split('.');
    // Yerleşik pg_catalog fonksiyonları sahibi değiştirilemez ve SECURITY DEFINER değildir; yalnız adları kaydedilir.
    if(s==='pg_catalog'){calls.push({id:q,builtin:true});continue;}
    for(const c of await rows(db,`select p.oid from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname=$1 and p.proname=$2 order by p.oid`,[s,n])){
      if(seen.has(c.oid))continue;
      if(depth<=0){deep=true;continue;}
      const sub=await fingerprintFunction(db,c.oid,role,{depth:depth-1,seen});
      calls.push({id:sub.id,fingerprint_sha256:sub.fingerprint_sha256,secdef:sub.secdef});
      if(sub.deep_call_graph)deep=true;
    }
  }
  const record={
    id,result:f.result,lang:f.lang,kind:f.kind,secdef:f.secdef,volatility:f.volatility,leakproof:f.leakproof,parallel:f.parallel,
    owner:f.owner,owner_super:f.owner_super,owner_bypassrls:f.owner_bypassrls,
    acl:f.acl,execute_sources:sources,schema_usage:f.schema_usage,
    config:[...f.config].sort(),search_path:sp,
    body_sha256:sha256(normalizeBody(f.def||f.src)),
    risk_flags:riskFlags(f.src),
    relations,calls,deep_call_graph:deep
  };
  record.fingerprint_sha256=sha256Json(record);
  return record;
}

async function audit(db,{role,fullSchemas=require('./backup-role.cjs').loadScope().full_schemas}={}){
  const r=await rows(db,`select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,
      rolvaliduntil::text valid_until from pg_roles where rolname=$1`,[role]);
  if(!r.length)return {role,exists:false};
  const a=r[0];
  const memberships=(await rows(db,`with recursive m(oid) as (
      select roleid from pg_auth_members where member=(select oid from pg_roles where rolname=$1)
      union select am.roleid from pg_auth_members am join m on am.member=m.oid)
    select distinct r.rolname from m join pg_roles r on r.oid=m.oid order by 1`,[role])).map(x=>x.rolname);
  // Doğrudan üyelik seçenekleri (PG16+: inherit_option, set_option).
  const membershipGrants=(await rows(db,`select r.rolname role,m.admin_option,m.inherit_option,m.set_option
      from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname=$1)
      order by 1,2,3,4`,[role]));
  // Rolün ÜYELERİ (dolaylı dahil): INHERIT ya da SET seçenekli üye, yedek rolünün okuma ve dışa aktarma yetkisini kullanır.
  // Hariç: yalnız ADMIN seçenekli üyelik (PG16+: CREATEROLE ile rolü oluşturan rol buna otomatik sahip olur; yetki
  // vermez), süper kullanıcılar ve şemaların sahibinin yetkilerini zaten taşıyan roller (Supabase: postgres).
  const members=(await rows(db,`with recursive m(oid) as (
      select member from pg_auth_members where roleid=(select oid from pg_roles where rolname=$1) and (inherit_option or set_option)
      union select am.member from pg_auth_members am join m on am.roleid=m.oid where am.inherit_option or am.set_option)
    select distinct r.rolname from m join pg_roles r on r.oid=m.oid
    where not r.rolsuper and not pg_has_role(r.oid,(select nspowner from pg_namespace where nspname='private'),'USAGE') order by 1`,[role])).map(x=>x.rolname);
  const database=(await rows(db,`select has_database_privilege($1,current_database(),'CREATE') "create",
      has_database_privilege($1,current_database(),'TEMP') temp,has_database_privilege($1,current_database(),'CONNECT') connect`,[role]))[0];
  const schemas=await rows(db,`select nspname schema,has_schema_privilege($1,oid,'USAGE') usage,has_schema_privilege($1,oid,'CREATE') "create"
    from pg_namespace where nspname !~ '^pg_(toast|temp)' and (has_schema_privilege($1,oid,'USAGE') or has_schema_privilege($1,oid,'CREATE')) order by 1`,[role]);
  const relPrivs=await rows(db,`select n.nspname||'.'||c.relname rel,c.relkind::text kind,
      array_remove(array[${WRITE_TABLE_PRIVS.map(p=>`case when has_table_privilege($1,c.oid,'${p}') then '${p}' end`).join(',')},
        case when has_any_column_privilege($1,c.oid,'INSERT') and not has_table_privilege($1,c.oid,'INSERT') then 'INSERT(column)' end,
        case when has_any_column_privilege($1,c.oid,'UPDATE') and not has_table_privilege($1,c.oid,'UPDATE') then 'UPDATE(column)' end],null) write_privs,
      has_any_column_privilege($1,c.oid,'SELECT') can_select
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p','v','m','f') and n.nspname !~ '^pg_(toast|temp)' and n.nspname not in ('pg_catalog','information_schema') order by 1`,[role]);
  const tablesWrite=relPrivs.filter(x=>x.write_privs.length).map(x=>({rel:x.rel,privs:x.write_privs}));
  const tablesRead=relPrivs.filter(x=>x.can_select).map(x=>x.rel);
  const sequences=await rows(db,`select n.nspname||'.'||c.relname seq,has_sequence_privilege($1,c.oid,'USAGE') usage,has_sequence_privilege($1,c.oid,'UPDATE') update
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname !~ '^pg_(toast|temp)'
      and (has_sequence_privilege($1,c.oid,'USAGE') or has_sequence_privilege($1,c.oid,'UPDATE')) order by 1`,[role]);
  const callable=await rows(db,`select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef and p.prokind in ('f','p') and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
      and has_schema_privilege($1,n.oid,'USAGE') and has_function_privilege($1,p.oid,'EXECUTE') order by n.nspname,p.proname,p.oid`,[role]);
  const functions=[];
  for(const c of callable)functions.push(await fingerprintFunction(db,c.oid,role));
  const exportFunctions=await exportFunctionFacts(db,role);
  // Tam şemalardaki, rolün okuyabildiği ve sahibinin yetkisiyle çalışan görünümler (security_invoker değil) ile
  // materyalize görünümler, tam şemalar dışındaki bir tabloya dayanıyorsa (ör. public.v → auth.sessions) rol o veriyi
  // görünüm üzerinden okur: dar rolün sınırı delinir.
  const outsideViews=(await rows(db,`select n.nspname||'.'||c.relname v from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname = any($2::text[]) and c.relkind in ('v','m') and has_table_privilege($1,c.oid,'SELECT')
      and not (c.relkind='v' and exists(select 1 from unnest(coalesce(c.reloptions,'{}'::text[])) o where o ~* '^security_invoker=(true|on|1|yes)$'))
      and exists(select 1 from pg_rewrite rw join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=rw.oid and d.refclassid='pg_class'::regclass
        join pg_class rc on rc.oid=d.refobjid join pg_namespace rn on rn.oid=rc.relnamespace
        where rw.ev_class=c.oid and rc.oid<>c.oid and rn.nspname <> all($2::text[]) and rn.nspname not in ('pg_catalog','information_schema'))
    order by 1`,[role,fullSchemas])).map(x=>x.v);
  // Rolün çağırabildiği yazma/dış bağlantı yan yolları. Ağ: net şeması (pg_net), http uzantısı, dblink. Kalıcı yazma:
  // büyük nesne fonksiyonları ve WAL mesajı (pg_catalog, PUBLIC; süper kullanıcı olmadan geri alınamaz).
  const sideChannels=await rows(db,`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' id,
      case when n.nspname='net' or (n.nspname<>'pg_catalog' and p.proname ~ '^(http|dblink)') then 'network'
        else 'pg_catalog_write' end kind
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='net' or (n.nspname<>'pg_catalog' and p.proname ~ '^(http|dblink)')
        or (n.nspname='pg_catalog' and p.proname in ('lo_create','lo_creat','lo_from_bytea','lo_put','lowrite','lo_import','lo_truncate','lo_truncate64','lo_unlink','pg_logical_emit_message')))
      and has_schema_privilege($1,n.oid,'USAGE') and has_function_privilege($1,p.oid,'EXECUTE')
    order by 1`,[role]);
  return {
    role,exists:true,
    attributes:{super:a.rolsuper,inherit:a.rolinherit,createrole:a.rolcreaterole,createdb:a.rolcreatedb,login:a.rolcanlogin,
      replication:a.rolreplication,bypassrls:a.rolbypassrls,connlimit:a.rolconnlimit,valid_until:a.valid_until},
    memberships,membership_grants:membershipGrants,members,database,schemas,tables_write:tablesWrite,tables_read:tablesRead,sequences,definer_functions:functions,
    export_functions:exportFunctions,side_channels:sideChannels,outside_views:outsideViews
  };
}

function loadExportPins(file=path.join(root,'ops/backup/export-functions.json')){
  const j=JSON.parse(fs.readFileSync(file,'utf8'));
  if(j.version!==1||!Array.isArray(j.functions))throw Error('Dışa aktarma sabitleri biçimi geçersiz: '+file);
  return j;
}

/** Ortamdan bağımsız sabit: gövde (prosrc, boşluk/yorum normalize), dil, oynaklık, sonuç tipi, ayarlar, SECURITY DEFINER.
 * Ortama bağlı olanlar sabite girmez, kural olarak denetlenir: sahip = fonksiyonun şemasının sahibi; EXECUTE yalnız yedek
 * rolüne doğrudan (PUBLIC, API rolleri ya da üyelik yolu yok). */
async function exportFunctionFacts(db,role,{pins=loadExportPins()}={}){
  const out=[];
  for(const pin of pins.functions){
    const m=/^([a-z_]+)\.([a-z_][a-z0-9_]*)\(\)$/.exec(pin.id);
    if(!m)throw Error('Geçersiz sabit kimliği: '+pin.id);
    const f=(await rows(db,`select p.prosrc src,l.lanname lang,p.prosecdef secdef,p.provolatile::text volatility,pg_get_function_result(p.oid) result,
        coalesce(p.proconfig,'{}'::text[]) config,p.proowner=n.nspowner owner_is_schema_owner,
        array(select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.privilege_type='EXECUTE' and a.grantee<>p.proowner order by 1)::text[] execute_grantees,
        -- Fonksiyonu fiilen çağırabilen roller (PUBLIC, doğrudan, üyelik; yedek rolünün üyeleri dahil). Hariç: süper
        -- kullanıcılar, yedek rolünün kendisi ve sahibin yetkilerini zaten taşıyan roller (onlar Auth'u doğrudan okuyabilir).
        array(select r.rolname::text from pg_roles r where not r.rolsuper and r.rolname<>$3
          and not pg_has_role(r.oid,p.proowner,'USAGE') and has_function_privilege(r.oid,p.oid,'EXECUTE')
          and has_schema_privilege(r.oid,n.oid,'USAGE') order by 1)::text[] other_callers
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where n.nspname=$1 and p.proname=$2 and p.pronargs=0`,[m[1],m[2],role]))[0];
    if(!f){out.push({id:pin.id,present:false});continue;}
    out.push({id:pin.id,present:true,src_sha256:sha256(normalizeBody(f.src)),lang:f.lang,secdef:f.secdef,volatility:f.volatility,
      result:f.result,config:[...f.config].sort(),owner_is_schema_owner:f.owner_is_schema_owner,execute_grantees:f.execute_grantees,
      execute_ok:f.execute_grantees.length===1&&f.execute_grantees[0]===role,other_callers:f.other_callers});
  }
  return out;
}
const PIN_FIELDS=['src_sha256','lang','secdef','volatility','result','config'];
function exportPinDiff(fact,pin){
  const d=[];
  if(!fact||!fact.present)return ['yok'];
  for(const k of PIN_FIELDS)if(canonical(fact[k])!==canonical(pin[k]))d.push(k);
  if(!fact.owner_is_schema_owner)d.push('sahip şema sahibi değil');
  if(!fact.execute_ok)d.push('EXECUTE yalnız yedek rolünde olmalı: '+fact.execute_grantees.join(','));
  if(fact.other_callers&&fact.other_callers.length)d.push('başka roller çağırabiliyor: '+fact.other_callers.join(','));
  return d;
}

function loadAllowlist(file=path.join(root,'ops/backup/definer-allowlist.json')){
  const j=JSON.parse(fs.readFileSync(file,'utf8'));
  if(j.version!==1||!Array.isArray(j.entries))throw Error('İzin listesi biçimi geçersiz: '+file);
  return j;
}

/** Bir izin listesi kaydı ancak inceleme bilgisi ve gereken gerekçeler eksiksizse geçerlidir. */
function allowlistEntryValid(entry,fn){
  const problems=[];
  if(!entry.reviewed_by||!entry.reviewed_at||!entry.reason)problems.push('inceleme bilgisi eksik');
  if(!/^[0-9a-f]{64}$/.test(entry.fingerprint_sha256||''))problems.push('parmak izi geçersiz');
  if(!Array.isArray(entry.data_scope)||!entry.data_scope.length)problems.push('döndürdüğü veri kapsamı yazılmamış');
  if(fn){
    if(!fn.search_path.ok&&!entry.search_path_exception)problems.push('search_path kuralı için gerekçe yok: '+fn.search_path.reason);
    const risky=fn.risk_flags.filter(f=>f!=='advisory_lock');
    if(risky.length&&!entry.risk_exception)problems.push('risk işaretleri için gerekçe yok: '+risky.join(','));
    if(fn.deep_call_graph)problems.push('çağrı grafiği derinlik sınırını aşıyor');
    if(['c','internal'].includes(fn.lang))problems.push('C/internal gövde incelenemez');
  }
  return problems;
}

function evaluate(a,{allowlist={version:1,entries:[]},exportPins=loadExportPins(),fullSchemas=require('./backup-role.cjs').loadScope().full_schemas}={}){
  const nonwaivable=[],waivable=[],info=[];
  const nw=(code,detail)=>nonwaivable.push({code,detail});
  if(!a.exists){nw('role_missing',a.role);return finalize();}
  const at=a.attributes;
  for(const k of ['super','createrole','createdb','replication','login','bypassrls'])if(at[k]!==ROLE_PROFILE[k])nw('role_attribute',k+'='+at[k]);
  if(!(at.connlimit>0&&at.connlimit<=ROLE_PROFILE.connlimitMax))nw('role_attribute','connlimit='+at.connlimit);
  // Her üyelik (doğrudan ya da dolaylı, pg_read_all_data dahil) muaf tutulamaz: rol yalnız doğrudan yetkilerle okur.
  for(const m of a.memberships)nw('membership',m);
  // Yedek rolüne üye olan her rol (dolaylı dahil) onun yetkileriyle Auth verisini dışa aktarabilir: muaf tutulamaz.
  for(const m of a.members||[])nw('role_has_members',m);
  if(a.database.create)nw('database_create','CREATE');
  for(const s of a.schemas)if(s.create)nw('schema_create',s.schema);
  for(const t of a.tables_write)nw('table_write',t.rel+':'+t.privs.join(','));
  // Tam şemalar dışında GERÇEKTEN okunabilen tablo (şema USAGE + SELECT): ör. auth.sessions. Auth/Storage yalnız dışa
  // aktarma fonksiyonlarıyla alınır; doğrudan okuma muaf tutulamaz.
  const usable=new Set(a.schemas.filter(s=>s.usage).map(s=>s.schema));
  for(const t of a.tables_read){const ns=t.split('.')[0];if(!fullSchemas.includes(ns)&&usable.has(ns))nw('read_outside_scope',t);}
  for(const v of a.outside_views||[])nw('view_reads_outside_scope',v);
  for(const s of a.sequences)nw('sequence_write',s.seq);
  for(const s of a.side_channels||[]){
    if(s.kind==='network')nw('network_function',s.id);
    else info.push({code:'accepted_residual',id:s.id});
  }
  if(a.database.temp)info.push({code:'accepted_residual',id:'TEMP'});
  const pinById=new Map(exportPins.functions.map(p=>[p.id,p]));
  for(const pin of exportPins.functions){
    const fact=(a.export_functions||[]).find(f=>f.id===pin.id);
    const d=exportPinDiff(fact,pin);
    if(d.length)nw('export_function_changed',pin.id+': '+d.join('; '));
    else info.push({code:'export_function_pinned',id:pin.id});
  }
  const byId=new Map(allowlist.entries.map(e=>[e.id,e]));
  for(const fn of a.definer_functions){
    if(pinById.has(fn.id))continue;
    const e=byId.get(fn.id);
    if(!e){waivable.push({code:'definer_unreviewed',id:fn.id,fingerprint_sha256:fn.fingerprint_sha256});continue;}
    if(e.fingerprint_sha256!==fn.fingerprint_sha256){waivable.push({code:'definer_changed',id:fn.id,fingerprint_sha256:fn.fingerprint_sha256,expected:e.fingerprint_sha256});continue;}
    const problems=allowlistEntryValid(e,fn);
    if(problems.length)waivable.push({code:'definer_allowlist_invalid',id:fn.id,fingerprint_sha256:fn.fingerprint_sha256,problems});
  }
  const present=new Set(a.definer_functions.map(f=>f.id));
  for(const e of allowlist.entries)if(!present.has(e.id))info.push({code:'allowlist_stale',id:e.id});
  return finalize();
  function finalize(){
    const sortBy=x=>canonical(x);
    nonwaivable.sort((x,y)=>sortBy(x)<sortBy(y)?-1:1);waivable.sort((x,y)=>sortBy(x)<sortBy(y)?-1:1);info.sort((x,y)=>sortBy(x)<sortBy(y)?-1:1);
    const decision=nonwaivable.length?'stop_nonwaivable':waivable.length?'stop_waivable':'ok';
    return {decision,nonwaivable,waivable,info,waivable_diff_sha256:sha256Json(waivable),audit_sha256:sha256Json(a)};
  }
}

/** Migration'lardan kurulan şemadaki değişmezler (yedek rolünden bağımsız). */
async function invariants(db,{serviceRoleContract=path.join(root,'supabase/contract/service-role.json')}={}){
  const failures=[];
  const publicDefiners=(await rows(db,`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' id
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef and p.prokind in ('f','p')
      and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
      and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    order by 1`)).map(x=>x.id);
  for(const id of publicDefiners)failures.push({code:'public_execute_definer',id});
  const expected=JSON.parse(fs.readFileSync(serviceRoleContract,'utf8'));
  const hasServiceRole=(await rows(db,`select 1 from pg_roles where rolname='service_role'`)).length>0;
  let serviceRole=null;
  if(hasServiceRole){
    const grants=(await rows(db,`
      select 'function '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||a.privilege_type g
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a
        where n.nspname in ('public','private') and a.grantee=(select oid from pg_roles where rolname='service_role')
      union all
      select 'table '||n.nspname||'.'||c.relname||' '||a.privilege_type
        from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a
        where n.nspname in ('public','private') and a.grantee=(select oid from pg_roles where rolname='service_role')
      union all
      select 'schema '||n.nspname||' '||a.privilege_type
        from pg_namespace n cross join lateral aclexplode(n.nspacl) a
        where n.nspname in ('public','private') and a.grantee=(select oid from pg_roles where rolname='service_role')
      order by 1`)).map(x=>x.g);
    serviceRole=grants;
    const want=new Set(expected.explicit_grants),got=new Set(grants);
    for(const g of grants)if(!want.has(g))failures.push({code:'service_role_unexpected_grant',id:g});
    for(const g of expected.explicit_grants)if(!got.has(g))failures.push({code:'service_role_missing_grant',id:g});
  }
  return {ok:failures.length===0,failures,public_definers:publicDefiners,service_role_checked:hasServiceRole,service_role_grants:serviceRole};
}

/** Migration'lardan kurulan şemadan dışa aktarma sabitlerini üretir (ops/backup/export-functions.json). */
async function exportPins(db,{scope=require('./backup-role.cjs').loadScope()}={}){
  const ids=require('./backup-role.cjs').exportFunctions(scope).map(f=>f+'()');
  const facts=await exportFunctionFacts(db,'-',{pins:{version:1,functions:ids.map(id=>({id}))}});
  return {version:1,
    description:'Yedek rolünün çağırdığı dışa aktarma fonksiyonlarının ortamdan bağımsız sabitleri. Üretici: node tools/backup/privilege-audit.cjs --export-pins. Elle düzenlenmez; değişiklik incelemeli PR ister. Sahip ve EXECUTE kuralları sabite girmez, privilege-audit tarafından ayrıca denetlenir.',
    functions:facts.map(f=>{if(!f.present)throw Error('Dışa aktarma fonksiyonu yok: '+f.id);return {id:f.id,...Object.fromEntries(PIN_FIELDS.map(k=>[k,f[k]]))};})};
}

module.exports={ROLE_PROFILE,audit,evaluate,invariants,loadAllowlist,loadExportPins,exportPins,exportPinDiff,allowlistEntryValid,searchPathStatus,riskFlags,qualifiedRefs,fingerprintFunction};

if(require.main===module)(async()=>{
  const {openDb,build,finish}=require('../db-lib.cjs');
  const args=process.argv.slice(2);
  const db=await openDb();let primary=null;
  try{
    // Yerel ortamda service_role yoksa Supabase'deki gibi oluşturulur; böylece migration'ın verdiği yetkiler de denetlenir.
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db);
    if(args.includes('--invariants')){
      const r=await invariants(db);
      for(const f of r.failures)console.log('  ✗ '+f.code+': '+f.id);
      console.log('Yetki değişmezleri ('+db.engine+'): '+(r.ok?'geçti':'BAŞARISIZ')+'; PUBLIC SECURITY DEFINER='+r.public_definers.length+', service_role açık yetki='+(r.service_role_grants||[]).length);
      if(!r.ok)process.exitCode=1;
    }else if(args.includes('--export-pins')){
      const j=await exportPins(db);
      const file=path.join(root,'ops/backup/export-functions.json');
      const text=JSON.stringify(j,null,1)+'\n';
      if(args.includes('--check')){
        const same=fs.existsSync(file)&&fs.readFileSync(file,'utf8')===text;
        console.log('Dışa aktarma sabitleri ('+db.engine+'): '+(same?'güncel':'FARKLI — node tools/backup/privilege-audit.cjs --export-pins'));
        if(!same)process.exitCode=1;
      }else{fs.writeFileSync(file,text);console.log('Yazıldı: ops/backup/export-functions.json ('+j.functions.length+' fonksiyon)');}
    }else{console.log('Kullanım: node tools/backup/privilege-audit.cjs --invariants | --export-pins [--check]');process.exitCode=2;}
  }catch(e){primary=e;throw e;}finally{await finish(db,primary);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

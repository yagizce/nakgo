/** B7-A1: yedek rolü betiği üreticisi. Tek kaynak ops/backup/scope.json.
 *
 *   node tools/backup/backup-role.cjs              → psql değişkenli şablonu yazar (ops/backup/backup-role.sql ile aynı olmalı)
 *   renderLiteral({role,password,validUntil})      → yalnız yerel testler için değerleri gömülü SQL
 *
 * Bu araç hiçbir uzak veritabanına bağlanmaz. Production'da rolün oluşturulması B7-D'de ayrı onayla, proje sahibinin
 * gözetiminde yapılır (bkz. docs/backup/privilege-audit.md).
 *
 * Yöntem (B7-A5, dar rol): üyelik YOK (pg_read_all_data dahil). Rol yalnız public/private tablo ve dizilerini, bu
 * şemaların sahibi olan rolden (Supabase'te postgres) aldığı doğrudan SELECT ile okur. auth ve storage şemalarında
 * USAGE'ı yoktur; oturum ve yenileme belirteci tablolarına hiçbir yoldan ulaşamaz. Kapsamdaki Auth/Storage satırlarını
 * yalnız scope.json'daki dışa aktarma fonksiyonlarıyla alır.
 *
 * Güvenlik notu: default_transaction_read_only bir güvenlik sınırı değildir; oturum onu kapatabilir. Gerçek sınırlar
 * yazma yetkisi olmaması, üyelik olmaması ve privilege-audit denetimidir. PUBLIC'e açık pg_catalog fonksiyonları
 * (büyük nesne, WAL mesajı, geçici tablo) süper kullanıcı olmadan kapatılamaz; bkz. docs/backup/side-channels.md. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const loadScope=(file=path.join(root,'ops/backup/scope.json'))=>JSON.parse(fs.readFileSync(file,'utf8'));
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Geçersiz tanımlayıcı: '+s);return s;};
const qname=n=>n.split('.').map(ident).join('.');
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'";
/** Rolün EXECUTE alacağı fonksiyonlar: tablo başına dışa aktarma ve sayım fonksiyonu. */
const exportFunctions=scope=>[...scope.tables.map(t=>t.export),scope.guard_counts_function].map(qname);

function body(scope,role,{password,validUntil}){
  const r=ident(role);
  const schemas=scope.full_schemas.map(ident).join(', ');
  return [
    `-- NakGo yedek rolü. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.`,
    `-- Şemaların ve dışa aktarma fonksiyonlarının SAHİBİ olan rolle çalıştırılır (Supabase: postgres). Süper kullanıcı gerekmez;`,
    `-- BYPASSRLS verebilmek için çalıştıran rolün de BYPASSRLS'i olmalıdır (PG16+). Tek işlem olarak çalıştırılır (psql --single-transaction): biri başarısızsa rol oluşmaz.`,
    `create role ${r} login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2`,
    `  password ${password} valid until ${validUntil};`,
    `-- Üyelik verilmez (pg_read_all_data dahil). Okuma yalnız aşağıdaki doğrudan yetkilerle.`,
    `grant usage on schema ${schemas} to ${r};`,
    `grant select on all tables in schema ${schemas} to ${r};`,
    `grant select on all sequences in schema ${schemas} to ${r};`,
    `-- Bu betiği çalıştıran rolün ileride oluşturacağı tablolar da okunur. Başka bir rolün oluşturduğu tablo okunamaz ve`,
    `-- döküm "yetki" aşamasında açıkça durur (sessiz eksik yok).`,
    `alter default privileges in schema ${schemas} grant select on tables to ${r};`,
    `alter default privileges in schema ${schemas} grant select on sequences to ${r};`,
    `-- Auth/Storage: tablo yetkisi YOK; yalnız sabit kapsamlı dışa aktarma ve sayım fonksiyonları.`,
    ...exportFunctions(scope).map(f=>`grant execute on function ${f}() to ${r};`),
    `-- default_transaction_read_only GÜVENLİK SINIRI DEĞİLDİR: oturum "set default_transaction_read_only = off" diyebilir.`,
    `-- Açık kaldığı sürece lo_create ve geçici tablo gibi PUBLIC yan yollarını da engeller (ek katman).`,
    `alter role ${r} set default_transaction_read_only = on;`,
    `alter role ${r} set statement_timeout = '15min';`,
    `alter role ${r} set lock_timeout = '30s';`,
    `alter role ${r} set idle_in_transaction_session_timeout = '20min';`,
    ''
  ].join('\n');
}
const renderTemplate=(scope=loadScope(),role='nakgo_backup')=>body(scope,role,{password:":'backup_password'",validUntil:":'valid_until'"});
const renderLiteral=({scope=loadScope(),role,password,validUntil='infinity'})=>body(scope,role,{password:lit(password),validUntil:lit(validUntil)});
/** Rol oluşturulduktan HEMEN SONRA çalıştırılır: verilen yetkilerin gerçekten ETKİLİ olduğunu ve fazlasının OLMADIĞINI doğrular.
 * Neden: GRANT veren rol yetkiyi "grant option" ile tutmuyorsa PostgreSQL hata vermez, yalnız uyarı verir ve hiçbir şey
 * vermez. Bu denetim kurulumun gerçekten çalıştığını, "başarılı" sanılmadan, sınar. Boş liste = beklenen durum. */
async function verifyRole(query,{role,scope=loadScope()}){
  const problems=[];
  const q=async(sql,args)=>(await query(sql,args)).rows;
  const attr=(await q(`select rolbypassrls,rolsuper,rolcanlogin from pg_roles where rolname=$1`,[role]))[0];
  if(!attr)return ['rol yok: '+role];
  if(!attr.rolbypassrls)problems.push('BYPASSRLS yok: pg_dump RLS\'li tablolarda durur');
  if(attr.rolsuper)problems.push('rol süper kullanıcı olmamalı');
  const ms=await q(`select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname=$1) order by 1`,[role]);
  for(const m of ms)problems.push('beklenmeyen üyelik: '+m.rolname);
  for(const s of scope.full_schemas){
    if(!(await q(`select has_schema_privilege($1,$2,'USAGE') ok`,[role,s]))[0].ok)problems.push('şema kullanımı yok: '+s);
    for(const r of await q(`select c.oid::regclass::text n,c.relkind::text k,
        case when c.relkind='S' then has_sequence_privilege($1,c.oid,'SELECT') else has_table_privilege($1,c.oid,'SELECT') end ok
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$2 and c.relkind in('r','p','S') order by 1`,[role,s]))
      if(!r.ok)problems.push((r.k==='S'?'dizi':'tablo')+' okunamıyor: '+r.n);
  }
  for(const f of exportFunctions(scope)){
    const [ns,fn]=f.split('.');
    const r=(await q(`select has_function_privilege($1,p.oid,'EXECUTE') ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=$2 and p.proname=$3 and p.pronargs=0`,[role,ns,fn]))[0];
    if(!r)problems.push('dışa aktarma fonksiyonu yok: '+f);else if(!r.ok)problems.push('dışa aktarma fonksiyonu çağrılamıyor: '+f);
  }
  // Negatif denetim: kapsam dışı Auth/Storage tabloları ve bu şemaların kendisi okunamamalı.
  const forbidden=[...scope.excluded.transient,...scope.excluded.known_loss,...scope.excluded.guard_stop_if_rows,...scope.tables.map(t=>t.name)];
  for(const t of forbidden){
    const [ns,rel]=t.split('.');
    const r=(await q(`select has_table_privilege($1,c.oid,'SELECT') or has_any_column_privilege($1,c.oid,'SELECT') sel,has_schema_privilege($1,n.oid,'USAGE') u
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$2 and c.relname=$3`,[role,ns,rel]))[0];
    if(r&&r.sel&&r.u)problems.push('doğrudan okunabilmemeli: '+t);
  }
  for(const s of [...new Set(forbidden.map(t=>t.split('.')[0]))].filter(s=>!scope.full_schemas.includes(s)))
    if((await q(`select has_schema_privilege($1,oid,'USAGE') u from pg_namespace where nspname=$2`,[role,s]))[0]?.u)problems.push('şema kullanımı olmamalı: '+s);
  return problems;
}
const dropLiteral=role=>`drop owned by ${ident(role)}; drop role if exists ${ident(role)};`;

module.exports={loadScope,renderTemplate,renderLiteral,dropLiteral,verifyRole,exportFunctions};
if(require.main===module)process.stdout.write(renderTemplate());

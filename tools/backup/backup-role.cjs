/** B7-A1: yedek rolü betiği üreticisi. Tek kaynak ops/backup/scope.json.
 *
 *   node tools/backup/backup-role.cjs              → psql değişkenli şablonu yazar (ops/backup/backup-role.sql ile aynı olmalı)
 *   renderLiteral({role,password,validUntil})      → yalnız yerel testler için değerleri gömülü SQL
 *
 * Bu araç hiçbir uzak veritabanına bağlanmaz. Production'da rolün oluşturulması B7-D'de ayrı onayla, proje sahibinin
 * gözetiminde yapılır (bkz. docs/backup/privilege-audit.md, "BYPASSRLS ve Supabase uygulanabilirliği").
 *
 * Güvenlik notu: default_transaction_read_only bir güvenlik sınırı değildir; oturum onu kapatabilir. Gerçek sınırlar
 * yalnız okuma veren pg_read_all_data üyeliği (başka üyelik yok), yazma yetkisi olmaması ve privilege-audit'in
 * çağrılabilir SECURITY DEFINER denetimidir. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const loadScope=(file=path.join(root,'ops/backup/scope.json'))=>JSON.parse(fs.readFileSync(file,'utf8'));
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Geçersiz tanımlayıcı: '+s);return s;};
const qname=n=>n.split('.').map(ident).join('.');
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'";

function body(scope,role,{password,validUntil}){
  const r=ident(role);
  return [
    `-- NakGo yedek rolü. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.`,
    `-- Yöntem: Supabase'in resmi yedek rolü (BYPASSRLS + pg_read_all_data). pg_dump RLS'yi kapatır; BYPASSRLS olmadan durur.`,
    `-- pg_read_all_data: auth ve storage DAHİL her şemadaki tablo, görünüm ve dizileri OKUR (oturumlar ve yenileme`,
    `-- belirteçleri dahil). Döküm kapsamı ayrıca ops/backup/scope.json ile sınırlanır; okuma yetkisi bundan geniştir.`,
    `-- Büyük nesneler (large objects) pg_read_all_data kapsamında DEĞİLDİR.`,
    `create role ${r} login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2`,
    `  password ${password} valid until ${validUntil};`,
    `-- Yalnız bu üyelik için INHERIT açık; ADMIN ve SET kapalı (PG16+ sözdizimi).`,
    `grant pg_read_all_data to ${r} with inherit true, set false;`,
    `-- default_transaction_read_only GÜVENLİK SINIRI DEĞİLDİR: oturum "set default_transaction_read_only = off" diyebilir.`,
    `-- Gerçek sınırlar: yalnız okuma veren üyelik, yazma yetkisi olmaması ve privilege-audit denetimidir.`,
    `alter role ${r} set default_transaction_read_only = on;`,
    `alter role ${r} set statement_timeout = '15min';`,
    `alter role ${r} set lock_timeout = '30s';`,
    `alter role ${r} set idle_in_transaction_session_timeout = '20min';`,
    ''
  ].join('\n');
}
const renderTemplate=(scope=loadScope(),role='nakgo_backup')=>body(scope,role,{password:":'backup_password'",validUntil:":'valid_until'"});
const renderLiteral=({scope=loadScope(),role,password,validUntil='infinity'})=>body(scope,role,{password:lit(password),validUntil:lit(validUntil)});
/** Rol oluşturulduktan HEMEN SONRA çalıştırılır: verilen yetkilerin gerçekten ETKİLİ olduğunu doğrular.
 * Neden: GRANT veren rol yetkiyi "grant option" ile tutmuyorsa PostgreSQL hata vermez, yalnız uyarı verir ve hiçbir şey
 * vermez (Supabase'te postgres, auth şemasında USAGE'ı grant option olmadan tutar; tablo tablo yetki bu yüzden orada
 * etkisizdir ve şablon pg_read_all_data kullanır). Bu denetim kurulumun gerçekten çalıştığını, "başarılı" sanılmadan,
 * sınar. Boş liste = rol beklenen her şeyi okuyabiliyor ve üyelik seçenekleri doğru. */
async function verifyRole(query,{role,scope=loadScope()}){
  const problems=[];
  const q=async(sql,args)=>(await query(sql,args)).rows;
  const attr=(await q(`select rolbypassrls,rolsuper,rolcanlogin from pg_roles where rolname=$1`,[role]))[0];
  if(!attr)return ['rol yok: '+role];
  if(!attr.rolbypassrls)problems.push('BYPASSRLS yok: pg_dump RLS\'li tablolarda durur');
  if(attr.rolsuper)problems.push('rol süper kullanıcı olmamalı');
  // PG16+: aynı üyelik farklı verenlerce birden çok satır olabilir; hepsi değerlendirilir.
  const ms=await q(`select m.admin_option,m.inherit_option,m.set_option from pg_auth_members m
    where m.member=(select oid from pg_roles where rolname=$1) and m.roleid=(select oid from pg_roles where rolname='pg_read_all_data')`,[role]);
  if(!ms.length)problems.push('pg_read_all_data üyeliği yok');
  else if(ms.some(m=>m.admin_option||m.set_option)||!ms.some(m=>m.inherit_option))problems.push('pg_read_all_data üyelik seçenekleri beklenen gibi değil (INHERIT açık, ADMIN/SET kapalı)');
  for(const s of scope.full_schemas){
    if(!(await q(`select has_schema_privilege($1,$2,'USAGE') ok`,[role,s]))[0].ok)problems.push('şema kullanımı yok: '+s);
    for(const r of await q(`select c.oid::regclass::text n,c.relkind::text k,
        case when c.relkind='S' then has_sequence_privilege($1,c.oid,'SELECT') else has_table_privilege($1,c.oid,'SELECT') end ok
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$2 and c.relkind in('r','p','S') order by 1`,[role,s]))
      if(!r.ok)problems.push((r.k==='S'?'dizi':'tablo')+' okunamıyor: '+r.n);
  }
  for(const t of scope.tables){
    const [schema]=t.name.split('.');
    const reg=(await q(`select to_regclass($1)::text r`,[t.name]))[0].r;
    if(!reg){if(t.required)problems.push('zorunlu tablo yok: '+t.name);continue;}
    const ok=(await q(`select has_schema_privilege($1,$2,'USAGE') u,has_table_privilege($1,$3::regclass,'SELECT') s`,[role,schema,t.name]))[0];
    if(!ok.u||!ok.s)problems.push('kapsam tablosu okunamıyor: '+t.name+(ok.u?'':' (şema kullanımı yok)'));
  }
  return problems;
}
const dropLiteral=role=>`drop owned by ${ident(role)}; drop role if exists ${ident(role)};`;

module.exports={loadScope,renderTemplate,renderLiteral,dropLiteral,verifyRole};
if(require.main===module)process.stdout.write(renderTemplate());

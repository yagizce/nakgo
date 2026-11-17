/** B7-A1: yedek rolü betiği üreticisi. Tek kaynak ops/backup/scope.json.
 *
 *   node tools/backup/backup-role.cjs              → psql değişkenli şablonu yazar (ops/backup/backup-role.sql ile aynı olmalı)
 *   renderLiteral({role,password,validUntil})      → yalnız yerel testler için değerleri gömülü SQL
 *
 * Bu araç hiçbir uzak veritabanına bağlanmaz. Production'da rolün oluşturulması B7-D'de ayrı onayla, proje sahibinin
 * gözetiminde yapılır (bkz. docs/backup/runbook-role.md).
 *
 * Güvenlik notu: default_transaction_read_only bir güvenlik sınırı değildir; oturum onu kapatabilir. Gerçek sınırlar
 * yalnız SELECT yetkisi, hiçbir role üyelik olmaması ve privilege-audit'in çağrılabilir SECURITY DEFINER denetimidir. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const loadScope=(file=path.join(root,'ops/backup/scope.json'))=>JSON.parse(fs.readFileSync(file,'utf8'));
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Geçersiz tanımlayıcı: '+s);return s;};
const qname=n=>n.split('.').map(ident).join('.');
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'";

function body(scope,role,{password,validUntil}){
  const r=ident(role);
  const schemas=scope.full_schemas.map(ident);
  const extraSchemas=[...new Set(scope.tables.map(t=>t.name.split('.')[0]))].filter(s=>!schemas.includes(s)).map(ident);
  const required=scope.tables.filter(t=>t.required).map(t=>qname(t.name));
  const optional=scope.tables.filter(t=>!t.required).map(t=>qname(t.name));
  return [
    `-- NakGo yedek rolü. Kaynak: ops/backup/scope.json. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.`,
    `-- BYPASSRLS: pg_dump RLS'li tablolarda satır kaçırmamak için gerekir; rol bu yüzden kapsamdaki her satırı OKUYABİLİR.`,
    `create role ${r} login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2`,
    `  password ${password} valid until ${validUntil};`,
    `alter role ${r} set default_transaction_read_only = on;`,
    `alter role ${r} set statement_timeout = '15min';`,
    `alter role ${r} set lock_timeout = '30s';`,
    `alter role ${r} set idle_in_transaction_session_timeout = '20min';`,
    `grant usage on schema ${schemas.join(', ')} to ${r};`,
    `grant select on all tables in schema ${schemas.join(', ')} to ${r};`,
    `grant select on all sequences in schema ${schemas.join(', ')} to ${r};`,
    ...(extraSchemas.length?[`grant usage on schema ${extraSchemas.join(', ')} to ${r};`]:[]),
    ...(required.length?[`grant select on ${required.join(', ')} to ${r};`]:[]),
    ...optional.map(t=>`do $$ begin if to_regclass(${lit(t)}) is not null then execute 'grant select on ${t} to ${r}'; end if; end $$;`),
    `-- Yeni tablolar için varsayılan yetki VERİLMEZ: yeni tablo eklendiğinde yedek "yetki yok" diye durur (bilinçli kırılma).`,
    ''
  ].join('\n');
}
const renderTemplate=(scope=loadScope(),role='nakgo_backup')=>body(scope,role,{password:":'backup_password'",validUntil:":'valid_until'"});
const renderLiteral=({scope=loadScope(),role,password,validUntil='infinity'})=>body(scope,role,{password:lit(password),validUntil:lit(validUntil)});
const dropLiteral=role=>`drop owned by ${ident(role)}; drop role if exists ${ident(role)};`;

module.exports={loadScope,renderTemplate,renderLiteral,dropLiteral};
if(require.main===module)process.stdout.write(renderTemplate());

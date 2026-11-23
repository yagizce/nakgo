/** T8 — referans ölçümü: elle yedeğin (bootstrap) döküm anlık görüntüsünün, aynı kaynakta dökümden HEMEN ÖNCE ve HEMEN
 * SONRA alınan iki salt okunur ölçümle tutarlılığı.
 *
 * Ne kanıtlar, ne kanıtlamaz (docs/backup/runbooks/reference-measurement.md):
 *   - Paket bütünlüğü (K9 imzası, SHA-256) paketin İMZALANAN paket olduğunu gösterir; paketin Production'dan geldiğini
 *     GÖSTERMEZ. Ölçümler de çevrim içi makinede alınır; çevrim dışı makine onları yalnız paketle TUTARLILIK için karşılaştırır.
 *   - "match": her tabloda önce = sonra = döküm. "bounds": bazı tablolar ölçümler arasında değişti ve döküm sayısı ikisinin
 *     arasında. Bu, dökümün o aralıkta alındığıyla TUTARLIDIR; sıralamanın ya da içeriğin kanıtı DEĞİLDİR.
 *   - Anlık görüntü sırası: txid sayaçları (pg_current_snapshot xmax) önce ≤ döküm ≤ sonra olmalı. Aynı kümede tutarlılık
 *     denetimidir; başka bir kümenin (ör. sahte kaynak) sayaçlarıyla da sağlanabilir.
 * Ölçüm yalnız katalog ve sayım okur (salt okunur oturum); içerik, satır ya da kişisel veri okumaz ve dosyaya yazmaz. */
'use strict';
const SJ=require('./strict-json.cjs');
const H_MEASURE='nakgo-reference/v1';
const RE_TABLE=/^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/;
const RE_TXID=/^\d{1,20}:\d{1,20}:(\d{1,20}(,\d{1,20})*)?$/;

const qn=t=>t.split('.').map(s=>'"'+s+'"').join('.');

/** c: salt okunur yapılmış istemci. scope: ops/backup/scope.json. Dönüş: ölçüm nesnesi (katı JSON'a uygun). */
async function measure(c,scope){
  const ro=(await c.query(`select current_setting('transaction_read_only') ro`)).rows[0].ro;
  if(ro!=='on')throw Object.assign(Error('ölçüm oturumu salt okunur değil'),{code:'reference_read_only'});
  const base=(await c.query(`select pg_current_snapshot()::text snap,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') at`)).rows[0];
  const tables=(await c.query(`select n.nspname||'.'||c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and (n.nspname = any($1::text[]) or n.nspname||'.'||c.relname = any($2::text[])) order by 1`,
    [scope.full_schemas,(scope.tables||[]).map(x=>x.name)])).rows.map(r=>r.t);
  if(tables.some(t=>!RE_TABLE.test(t)))throw Object.assign(Error('ölçülemeyen tablo adı'),{code:'reference_tables'});
  const counts={};
  for(const t of tables)counts[t]=Number((await c.query(`select count(*)::bigint n from ${qn(t)}`)).rows[0].n);
  let migrations=null;
  if((await c.query(`select to_regclass('supabase_migrations.schema_migrations') r`)).rows[0].r){
    const rows=(await c.query(`select version::text v,name::text n from supabase_migrations.schema_migrations order by version`)).rows;
    migrations=SJ.domainHash('nakgo-migrations/v1',rows.map(r=>[r.v,r.n===null?null:r.n]));
  }
  return validateMeasurement({snap:base.snap,at:base.at,migrations_sha256:migrations,counts});
}

function validateMeasurement(m){
  const ok=m&&typeof m==='object'&&Object.keys(m).sort().join()==='at,counts,migrations_sha256,snap'&&RE_TXID.test(m.snap)
    &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.at)&&(m.migrations_sha256===null||/^[0-9a-f]{64}$/.test(m.migrations_sha256))
    &&m.counts&&typeof m.counts==='object'&&Object.entries(m.counts).every(([t,n])=>RE_TABLE.test(t)&&Number.isSafeInteger(n)&&n>=0);
  if(!ok)throw Object.assign(Error('referans ölçümü biçimi geçersiz'),{code:'reference_schema'});
  return m;
}
function validateReference(r){
  if(!r||typeof r!=='object'||Object.keys(r).sort().join()!=='after,before,version'||r.version!==1)throw Object.assign(Error('referans dosyası biçimi geçersiz'),{code:'reference_schema'});
  validateMeasurement(r.before);validateMeasurement(r.after);
  if(r.before.at>r.after.at)throw Object.assign(Error('referans ölçümleri sırasız'),{code:'reference_order'});
  return r;
}
const referenceSha256=r=>SJ.domainHash(H_MEASURE,validateReference(r));

const xmaxOf=s=>BigInt(s.split(':')[1]);
/** Çevrim dışı karşılaştırma. dump: {txid_snapshot, counts, migrations_sha256}. Dönüş: {result:'match'|'bounds'} ya da hata. */
function compare(ref,dump){
  validateReference(ref);
  const bad=code=>{throw Object.assign(Error('referans ölçümü dökümle tutarsız: '+code),{code});};
  if(!RE_TXID.test(dump.txid_snapshot||''))bad('reference_snapshot');
  const b=xmaxOf(ref.before.snap),d=xmaxOf(dump.txid_snapshot),a=xmaxOf(ref.after.snap);
  if(!(b<=d&&d<=a))bad('reference_order');
  if(ref.before.migrations_sha256!==ref.after.migrations_sha256||ref.before.migrations_sha256!==dump.migrations_sha256)bad('reference_migrations');
  // Tablo kümeleri aynı olmalı: paketin sayımı ölçülen bir tabloyu atlayamaz, ölçülmemiş tablo da ekleyemez.
  const keys=o=>Object.keys(o).sort().join('\n');
  if(keys(dump.counts)!==keys(ref.before.counts)||keys(dump.counts)!==keys(ref.after.counts))bad('reference_tables');
  let changed=false;
  for(const [t,n] of Object.entries(dump.counts)){
    if(!(t in ref.before.counts)||!(t in ref.after.counts))bad('reference_tables');
    const lo=Math.min(ref.before.counts[t],ref.after.counts[t]),hi=Math.max(ref.before.counts[t],ref.after.counts[t]);
    if(n<lo||n>hi)bad('reference_counts');
    if(lo!==hi)changed=true;
  }
  return {result:changed?'bounds':'match'};
}
/** Paketteki migration geçmişinden aynı hash (ölçümle karşılaştırma için). */
const historySha256=rows=>SJ.domainHash('nakgo-migrations/v1',[...rows].sort((x,y)=>String(x.version)<String(y.version)?-1:1).map(r=>[String(r.version),r.name===undefined||r.name===null?null:String(r.name)]));

module.exports={measure,validateMeasurement,validateReference,referenceSha256,compare,historySha256,H_MEASURE};

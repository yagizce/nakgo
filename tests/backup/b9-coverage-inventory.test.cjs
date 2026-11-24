/** Kapsam envanteri (bootstrap): Production'da 24.11.2026'da salt okunur gözlenen Auth/Storage/Vault tabloları
 * (tests/backup/prod-fixture.cjs PROD_AUX_TABLES) ile ops/backup/scope.json coverage_inventory birebir aynı olmalı ve
 * denetim eksik, fazla, yinelenen, sınıflandırılmamış ya da geçersiz satırda durmalı. Veritabanı gerekmez; gerçek
 * PostgreSQL'deki uçtan uca durdurma senaryoları b8-bootstrap.test.cjs'tedir. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const SE=require('../../tools/backup/scope-export.cjs');
const BR=require('../../tools/backup/backup-role.cjs');
const {PROD_AUX_TABLES,LIFECYCLE_DDL}=require('./prod-fixture.cjs');

const LS='storage.bucket_lifecycle_states',LA='storage.lifecycle_abandoned_artifacts';
const scope=BR.loadScope();
const PROD=()=>PROD_AUX_TABLES.map(([t])=>t);
const clone=o=>JSON.parse(JSON.stringify(o));

test('kapsam envanteri = Production envanteri (38); her tablo sınıflandırılmış; iki yaşam döngüsü tablosu pending korumada',()=>{
  assert.equal(PROD_AUX_TABLES.length,38);
  const bySchema=PROD().reduce((m,t)=>{const k=t.split('.')[0];m[k]=(m[k]||0)+1;return m;},{});
  assert.deepEqual(bySchema,{auth:27,storage:10,vault:1},'şema bazında: auth 27, storage 10, vault 1');
  // İki yaşam döngüsü tablosu taklitte Supabase Storage kaynağındaki birincil anahtar ve sütunlarla kurulur.
  assert.deepEqual(Object.keys(LIFECYCLE_DDL).sort(),[LS,LA].sort());
  assert.match(LIFECYCLE_DDL[LS],/bucket_id text primary key references storage\.buckets\(id\) on delete cascade/);
  assert.match(LIFECYCLE_DDL[LA],/primary key\(bucket_id,key\)/);
  assert.deepEqual([...scope.coverage_inventory.tables].sort(),PROD().sort());
  assert.equal(new Set(scope.coverage_inventory.tables).size,38,'yineleme yok');
  const known=SE.classified(scope);
  for(const t of scope.coverage_inventory.tables)assert.ok(known.has(t),t);
  for(const t of [LS,LA]){
    assert.ok(scope.excluded.guard_stop_if_rows_pending.includes(t),t);
    assert.ok(SE.guardList(scope).includes(t),t+' bootstrap sayımında');
    assert.ok(!SE.coreGuardList(scope).includes(t),t+' B7 sayım fonksiyonu listesinde değil (sayım fonksiyonu değişmedi)');
    // Başka hiçbir sınıfta değil (tek sınıf).
    const classes=[scope.tables.map(x=>x.name),scope.excluded.transient,scope.excluded.known_loss,scope.excluded.guard_stop_if_rows,
      scope.excluded.managed||[],scope.guard_exact_zero,(scope.meta||[]).map(m=>m.name)];
    assert.equal(classes.filter(c=>c.includes(t)).length,0,t+' tek sınıfta');
  }
  // Sınıflandırma denetimi Production listesinde temiz.
  assert.deepEqual(PROD().filter(t=>!known.has(t)),[]);
});

test('envanter denetimi: Production kümesi geçer; sıra önemsiz',()=>{
  assert.deepEqual(SE.inventoryProblems(scope,PROD()),[]);
  assert.deepEqual(SE.inventoryProblems(scope,[...PROD()].reverse()),[]);
});

test('eksik tablo: her biri ayrı ayrı adlandırılır, sessiz geçilmez',()=>{
  for(const t of [LS,LA,'auth.users','auth.saml_providers','vault.secrets','storage.objects']){
    const r=SE.inventoryProblems(scope,PROD().filter(x=>x!==t));
    assert.deepEqual(r,['envanterdeki tablo veritabanında yok: '+t],t);
  }
  const r=SE.inventoryProblems(scope,PROD().filter(x=>x!==LS&&x!==LA));
  assert.deepEqual(r.sort(),['envanterdeki tablo veritabanında yok: '+LA,'envanterdeki tablo veritabanında yok: '+LS].sort());
  assert.equal(SE.inventoryProblems(scope,[]).length,38,'boş veritabanı: 38 eksik');
});

test('fazla tablo: sınıflandırılmış olsa bile Production envanterinde yoksa durur (Supabase yeni tablo eklediğinde)',()=>{
  for(const t of ['storage.prefixes','storage.iceberg_tables','auth.yeni_ozellik','storage.yeni_ozellik','vault.baska']){
    assert.deepEqual(SE.inventoryProblems(scope,[...PROD(),t]),['envanterde olmayan tablo: '+t],t);
  }
  // Eksik ve fazla birlikte: ikisi de adlandırılır (yer değiştirme sayı aynı kalsa da yakalanır).
  const r=SE.inventoryProblems(scope,[...PROD().filter(x=>x!==LA),'storage.yeni_ozellik']);
  assert.deepEqual(r.sort(),['envanterde olmayan tablo: storage.yeni_ozellik','envanterdeki tablo veritabanında yok: '+LA].sort());
});

test('yapılandırma hatası: envanter yok, boş, yinelenen, sınıflandırılmamış ya da geçersiz satır → dur',()=>{
  const w=f=>{const s=clone(scope);f(s);return SE.inventoryProblems(s,PROD());};
  for(const [label,f] of [['alan yok',s=>{delete s.coverage_inventory;}],['tables yok',s=>{delete s.coverage_inventory.tables;}],
    ['boş liste',s=>{s.coverage_inventory.tables=[];}],['liste değil',s=>{s.coverage_inventory.tables='auth.users';}]])
    assert.deepEqual(w(f),['kapsam envanteri tanımlı değil (ops/backup/scope.json coverage_inventory)'],label);
  assert.ok(w(s=>{s.coverage_inventory.tables.push(LS);}).includes('envanterde yinelenen tablo: '+LS));
  // Sınıflandırılmamış satır: kapsam sınıfından çıkarılırsa envanter de reddeder (iki liste birlikte değişmeli).
  assert.ok(w(s=>{s.excluded.guard_stop_if_rows_pending=s.excluded.guard_stop_if_rows_pending.filter(t=>t!==LA);})
    .includes('envanterde sınıflandırılmamış tablo: '+LA));
  for(const bad of ['public.listings','storage','Storage.objects','storage.objects;drop','',42,null])
    assert.ok(w(s=>{s.coverage_inventory.tables=[...s.coverage_inventory.tables,bad];}).includes('envanter satırı geçersiz: '+String(bad)),String(bad));
});

test('sınıflandırma denetimi (her iki kip) gevşemedi: bilinmeyen tablo yine sınıflandırılmamış',async()=>{
  const fake=list=>({query:async(sql,params)=>({rows:list.filter(q=>params[0].includes(q.split('.')[0])).map(q=>({q}))})});
  let r=await SE.unclassifiedTables(fake(PROD()),scope);
  assert.deepEqual({total:r.total,unclassified:r.unclassified},{total:38,unclassified:[]});
  assert.deepEqual([...r.present].sort(),PROD().sort());
  r=await SE.unclassifiedTables(fake([...PROD(),'storage.yeni_ozellik','auth.yeni_ozellik']),scope);
  assert.deepEqual(r.unclassified.sort(),['auth.yeni_ozellik','storage.yeni_ozellik']);
  // İki yaşam döngüsü tablosu sınıflandırılmadan önceki kapsam: Production'da 2 sınıflandırılmamış tablo (ölçülen engel).
  const old=clone(scope);old.excluded.guard_stop_if_rows_pending=old.excluded.guard_stop_if_rows_pending.filter(t=>t!==LS&&t!==LA);
  r=await SE.unclassifiedTables(fake(PROD()),old);
  assert.deepEqual(r.unclassified.sort(),[LS,LA].sort());
});

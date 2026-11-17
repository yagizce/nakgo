/** B7-A3 testleri: Merkle, kontrol noktası zinciri, yasal geçiş doğrulayıcısı, K2 serbest bırakma ve K6 muafiyet durum
 * makinesi. Veritabanı senaryoları #125'in sentetik kopyasıyla (legal-fixture.sql) PGlite, PG16 ve PG17'de koşar.
 * Depo bellek içi taklittir: R2'nin koşullu yazma ve tutarlı okuma davranışını KANITLAMAZ (B7-B, K3). */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDb,finish}=require('../../tools/db-lib.cjs');
const M=require('../../tools/backup/merkle.cjs');
const C=require('../../tools/backup/checkpoint.cjs');
const LE=require('../../tools/backup/legal-evidence.cjs');
const SM=require('../../tools/backup/state-machine.cjs');
const {advance}=require('../../tools/backup/legal-run.cjs');
const {MemoryStore}=require('../../tools/backup/store.cjs');
const {testKeyPair,sign,randomUUID,canonical}=require('../../tools/backup/crypto.cjs');

const FIX=fs.readFileSync(path.join(__dirname,'legal-fixture.sql'),'utf8');
const DAY=86400000;
const T0=Date.parse('2026-06-01T00:00:00Z');
const at=days=>new Date(T0+days*DAY);
const iso=days=>at(days).toISOString();

// ---------- ortam ----------
function memAnchor(name){const recs=[];return {name,recs,async put(seq,sha){recs.push({seq,sha});},async list(){return recs.slice();}};}
function env({conditionalPut=true,verified=true,anchors}={}){
  const k1=testKeyPair(),k2=testKeyPair();
  const store=new MemoryStore({conditionalPut,capabilities:verified?{verified:true,conditionalPut:'verified',consistentRead:'verified'}:{verified:false}});
  return {store,k1,k2,k7:crypto.randomBytes(32),anchors:anchors||[memAnchor('a1')],trustedK1:{[k1.keyId]:k1.publicKey},trustedK2:{[k2.keyId]:k2.publicKey},n:0};
}
async function legalDb(){const db=await openDb();try{await db.exec(FIX);}catch(e){await finish(db,e);throw e;}return db;}
const state=db=>LE.extractState((s,a)=>db.query(s,a));
async function step(E,db,days,extra={}){
  return advance({store:E.store,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,trustedK2:E.trustedK2,anchors:E.anchors,environment:'test',
    now:at(days),runId:'run-'+(++E.n),state:await state(db),...extra});
}
function releaseFor(E,ev,o={}){
  const doc={version:1,release_id:randomUUID(),event_id:ev.event_id,event_binding:ev.binding,scope:{type:ev.type,findings_sha256:ev.findings_sha256},
    reason:'İnceleme tamamlandı; kabul edildi.',environment:'test',not_before:ev.opened_at,not_after:new Date(Date.parse(ev.opened_at)+48*3600000).toISOString(),...o};
  return sign(SM.RELEASE_NS,doc,(o.key||E.k2).privateKey,(o.key||E.k2).keyId);
}
const open=r=>r.events.filter(e=>e.status==='open');
const codes=r=>r.blocking.map(f=>f.code).sort();
/** Başlangıç: ilk kontrol noktası insan onayıyla (K2) kabul edilir. */
async function baseline(E,db,days){
  const r1=await step(E,db,days);
  assert.equal(r1.ok,true,r1.reason);
  assert.deepEqual(codes(r1),['genesis_baseline']);
  const r2=await step(E,db,days,{releaseDocs:[releaseFor(E,open(r1)[0])]});
  assert.equal(r2.ok,true,r2.reason);assert.equal(r2.openEvents,0);
  return r2;
}
async function exec(db,sql){await db.exec(sql);}
const purge=sql=>`begin; select set_config('nakgo.legal_purge','on',true); ${sql}; commit;`;
async function logs(db,days){for(const d of days)await db.query(`select private.legal_log('view_record',null,$1)`,[iso(d)]);}

// ---------- birim ----------
test('Merkle: RFC 6962 test vektörleri ve kapsama kanıtı',()=>{
  const L=['','\x00','\x10','\x20\x21','\x30\x31','\x40\x41\x42\x43','\x50\x51\x52\x53\x54\x55\x56\x57','\x60\x61\x62\x63\x64\x65\x66\x67\x68\x69\x6a\x6b\x6c\x6d\x6e\x6f'].map(s=>Buffer.from(s,'latin1'));
  assert.equal(M.root([]),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(M.root(L.slice(0,1)),'6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  assert.equal(M.root(L.slice(0,2)),'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125');
  assert.equal(M.root(L),'5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328');
  for(let n=1;n<=33;n++){
    const a=[...Array(n)].map((_,i)=>'yaprak'+i),r=M.root(a);
    for(let i=0;i<n;i++){
      const p=M.proof(a,i);
      assert.ok(M.verifyProof(a[i],p,r));
      assert.ok(!M.verifyProof('sahte',p,r));
      if(p.path.length){
        const bad=[...p.path];bad[0]=(bad[0][0]==='0'?'1':'0')+bad[0].slice(1);
        assert.ok(!M.verifyProof(a[i],{...p,path:bad},r),'yol öğesi değişirse kanıt geçmez');
        assert.ok(!M.verifyProof(a[i],{...p,index:(i+1)%n},r)||n===1,'yanlış sıra');
      }
    }
  }
  // Alan ayrımı: iç düğüm değeri yaprak olarak sunulamaz.
  const a=['x','y'],r=M.root(a);
  const inner=M.nodeHash(M.leafHash('x'),M.leafHash('y'));
  assert.ok(!M.verifyProof(inner,{index:0,size:1,path:[]},r));
});

test('kontrol noktası gövdesi: K7 ile şifreli, sıraya bağlı, kurcalamaya dayanıklı',()=>{
  const k7=crypto.randomBytes(32),body={leaves:{a:[1]},sır:'kişisel olmayan test'};
  const bytes=C.sealBody(body,{k7,seq:3,prevSha:'ab'});
  assert.ok(!String(bytes).includes('kişisel olmayan'),'açık metin görünmez');
  assert.deepEqual(C.openBody(bytes,{k7,seq:3,prevSha:'ab'}),body);
  assert.throws(()=>C.openBody(bytes,{k7:crypto.randomBytes(32),seq:3,prevSha:'ab'}),/K7/);
  assert.throws(()=>C.openBody(bytes,{k7,seq:4,prevSha:'ab'}),'başka sıraya taşınamaz');
  assert.throws(()=>C.openBody(bytes,{k7,seq:3,prevSha:'ac'}),'başka zincire taşınamaz');
  const o=JSON.parse(String(bytes));o.ct=Buffer.from(Buffer.from(o.ct,'base64').map((b,i)=>i===0?b^1:b)).toString('base64');
  assert.throws(()=>C.openBody(Buffer.from(canonical(o)),{k7,seq:3,prevSha:'ab'}),'GCM etiketi kurcalamayı yakalar');
  assert.throws(()=>C.sealBody(body,{k7:Buffer.alloc(16),seq:1}),/32/);
});

test('silme kapsaması: son doğrulanmış yedek ve kalan yedek sayısı',()=>{
  const D=require('../../tools/backup/deletion.cjs');
  const now=new Date('2026-12-01T00:00:00Z');
  const gate={enabled:true,capabilityVerified:true,openEvents:0,anchorsOk:true};
  const objs=[{key:'db/a',last_modified:'2026-11-01T00:00:00Z'},...[1,2,3,4].map(i=>({key:'db/r'+i,last_modified:`2026-11-30T0${i}:00:00Z`}))];
  const all=objs.map(o=>o.key);
  assert.deepEqual(D.plan({objects:objs,now,gate,coverage:{verified:all}}).delete,['db/a']);
  assert.equal(D.plan({objects:objs,now,gate,coverage:{verified:['db/a','db/r1','db/r2','db/r3']}}).allowed,false,'3 doğrulanmış kalır');
  assert.equal(D.plan({objects:objs,now:new Date('2026-12-02T12:00:00Z'),gate,coverage:{verified:all}}).allowed,false,'en yeni yedek 24 saatten eski');
  assert.equal(D.plan({objects:objs,now,gate,coverage:{verified:[]}}).allowed,false,'doğrulanmış yedek yok');
  assert.equal(D.plan({objects:objs,now,gate,coverage:{}}).allowed,false,'kapsama bilinmiyor');
});

// ---------- veritabanı senaryoları ----------
test('başlangıç: ilk kontrol noktası K2 onayı olmadan kabul edilmez; meşru saklama silmesi bulgu üretmez',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0,1,2,3,40,41]);
    const r1=await step(E,db,45);
    assert.equal(r1.openEvents,1);assert.equal(r1.anchorsOk,true);
    const h=r1.header;
    assert.equal(h.counts.log,6);assert.equal(h.single_use_guaranteed,true);
    assert.ok(!JSON.stringify(h).includes('view_record'),'açık başlıkta içerik yok');
    // Olay kapanana kadar her çalışma açık olay bildirir.
    const r1b=await step(E,db,45);
    assert.equal(r1b.openEvents,1);assert.deepEqual(r1b.blocking,[],'aynı durum yeni bulgu üretmez');
    const r2=await step(E,db,45,{releaseDocs:[releaseFor(E,open(r1)[0])]});
    assert.equal(r2.openEvents,0);assert.deepEqual(r2.consumed.length,1);assert.equal(r2.seq,4,'N bekleyen, N+1 tüketilmiş');
    // Saklama (30 gün): 0..3. günler silinir; 40, 41 kalır.
    await db.query('select private.t_retention($1)',[iso(42)]);
    await logs(db,[46]);
    const r3=await step(E,db,46);
    assert.equal(r3.ok,true);assert.deepEqual(r3.blocking,[]);assert.equal(r3.openEvents,0);
    assert.equal(r3.header.counts.log,3);
    // Zincir bütünüyle doğrulanır ve her gövde başlığıyla birebir eşleşir.
    const chain=await C.readChain(E.store,{trustedK1:E.trustedK1});
    assert.equal(chain.ok,true);assert.equal(chain.headers.length,5);
    for(const [i,hh] of chain.headers.entries())await C.loadBody(E.store,hh,{k7:E.k7,prevHeader:chain.headers[i-1]||null});
  }finally{await finish(db);}
});

test('kanıtlanamayan log silmeleri: saklama dışı, sayım dışı, görülmemiş satır, kuyruk, değiştirme, geriye ekleme',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0,10,20,30]);
    await baseline(E,db,31);
    // 1) Saklama süresi dolmamış satır, retention_run olmadan doğrudan silinir.
    await exec(db,purge(`delete from private.legal_access_log where id=2`));
    let r=await step(E,db,32);
    assert.deepEqual(codes(r),['deleted_before_retention','deletion_not_counted']);
    assert.equal(r.events.filter(e=>e.status==='open'&&e.type==='legal_regression').length,1);
    // 2) İki kontrol noktası arasında eklenip silinen satır: sonraki satır ona bağlıdır → açıklanamayan boşluk.
    await logs(db,[33,33]);
    await exec(db,purge(`delete from private.legal_access_log where id=(select max(id)-1 from private.legal_access_log)`));
    r=await step(E,db,34);
    assert.deepEqual(codes(r),['chain_gap_unexplained']);
    // 2b) Kuyrukta görülmeden ekle-sil, ardından yeni ekleme: tetikleyici yeni satırı mevcut son satıra bağladığından
    // zincir bunu göremez (bilinen sınır). Yalnız kimlik boşluğu bilgi olarak kalır; tek başına olay açmaz.
    await logs(db,[34]);
    await exec(db,purge(`delete from private.legal_access_log where id=(select max(id) from private.legal_access_log)`));
    await logs(db,[34]);
    r=await step(E,db,34.5);
    assert.deepEqual(codes(r),[]);
    assert.ok(r.findings.some(f=>f.code==='id_gap'&&f.severity==='info'));
    // 3) Kuyruktan (görülmüş en yeni satır) silme.
    await exec(db,purge(`delete from private.legal_access_log where id=(select max(id) from private.legal_access_log)`));
    r=await step(E,db,35);
    assert.deepEqual(codes(r),['deleted_before_retention','deletion_not_counted']);
    // 4) Satır değiştirme (tetikleyici kapatılarak).
    await exec(db,`alter table private.legal_access_log disable trigger legal_access_log_append; update private.legal_access_log set action='export' where id=1; alter table private.legal_access_log enable trigger legal_access_log_append;`);
    r=await step(E,db,36);
    assert.deepEqual(codes(r),['row_hash_mismatch']);
    // Hash yeniden hesaplanarak gizlenmeye çalışılırsa da yakalanır (önceki listeyle karşılaştırma).
    await exec(db,`alter table private.legal_access_log disable trigger legal_access_log_append; update private.legal_access_log set row_hash=private.legal_hash(to_jsonb(legal_access_log)) where id=1; alter table private.legal_access_log enable trigger legal_access_log_append;`);
    r=await step(E,db,37);
    assert.deepEqual(codes(r),['row_modified']);
    // 5) Geçmiş kimlikle satır ekleme.
    await exec(db,`alter table private.legal_access_log disable trigger legal_access_log_chain;
      insert into private.legal_access_log(id,at,action,prev_hash,row_hash) values(2,'2026-06-11Z','view_record','',''); alter table private.legal_access_log enable trigger legal_access_log_chain;`);
    r=await step(E,db,38);
    assert.ok(codes(r).includes('row_backfilled'));
    assert.ok(r.openEvents>=4,'her yeni bulgu kümesi olay açar');
  }finally{await finish(db);}
});

test('retention sayısı gözlenenden fazla: görülmemiş satır silinmiş sayılır',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0,1,50]);
    await baseline(E,db,51);
    await db.query('select private.t_retention($1)',[iso(52)]);
    await db.query(`insert into private.retention_runs(ran_at,counts) values($1,'{"legal_access_log_deleted":3}')`,[iso(52)]);
    const r=await step(E,db,53);
    assert.deepEqual(codes(r),['unseen_rows_deleted']);
  }finally{await finish(db);}
});

test('retention_runs kurcalanması ve erken silinmesi',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0,50]);
    await db.query('select private.t_retention($1)',[iso(10)]);
    await baseline(E,db,51);
    await exec(db,`update private.retention_runs set counts='{"legal_access_log_deleted":0}'`);
    let r=await step(E,db,52);
    assert.deepEqual(codes(r),['run_modified']);
    await exec(db,`delete from private.retention_runs`);
    r=await step(E,db,53);
    assert.deepEqual(codes(r),['run_deleted_early']);
  }finally{await finish(db);}
});

test('politika değişikliği: kaydedilir; aynı aralıktaki silme kanıtlanamaz; sonraki aralıkta geçerli',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0,20,40]);
    await baseline(E,db,41);
    // Yalnız değişiklik: bilgi bulgusu, olay yok.
    await exec(db,`update private.legal_policies set retain_days=15 where code='legal_access_log'`);
    let r=await step(E,db,41);
    assert.deepEqual(r.blocking,[]);assert.ok(r.findings.some(f=>f.code==='policy_changed'));
    assert.equal(r.openEvents,0);
    // Değişiklik ve silme aynı aralıkta.
    await exec(db,`update private.legal_policies set retain_days=10 where code='legal_access_log'`);
    await db.query('select private.t_retention($1)',[iso(42)]);
    r=await step(E,db,42);
    assert.deepEqual(codes(r),['deleted_under_policy_change','deleted_under_policy_change']);
    // Politika kararlı kaldıktan sonraki aralıkta meşru silme kabul edilir.
    await db.query('select private.t_retention($1)',[iso(55)]);
    r=await step(E,db,55);
    assert.deepEqual(r.blocking,[]);
    // Onayı geri çekilen politika: silmeye dayanak olamaz; silinen politika bütünlük bulgusudur.
    await exec(db,`update private.legal_policies set approved_at=null,approved_by=null where code='legal_access_log'`);
    r=await step(E,db,56);
    assert.deepEqual(r.blocking,[]);
    await logs(db,[57]);
    r=await step(E,db,57);
    await exec(db,purge(`delete from private.legal_access_log where id=(select min(id) from private.legal_access_log)`));
    r=await step(E,db,80);
    assert.ok(codes(r).includes('deleted_without_policy'));
    await exec(db,`delete from private.legal_policies where code='pending_policy'`);
    r=await step(E,db,81);
    assert.deepEqual(codes(r),['policy_removed']);
  }finally{await finish(db);}
});

test('yasal kayıt imhası: meşru imha kabul; koruma, süre, tutanak, politika ve kurcalama ihlalleri yakalanır',async()=>{
  const db=await legalDb(),E=env();
  try{
    const rid=async(d,policy='court_order')=>Number(Object.values((await db.query('select private.t_open($1,$2)',[policy,iso(d)])).rows[0])[0]);
    const close=(id,d)=>db.query('select private.t_close($1,$2)',[id,iso(d)]);
    const fakeDest=(id,d,month,holds=0)=>`insert into private.legal_destructions(at,record_no,policy,retain_days,opened_month,closed_month,holds_removed,cause,prev_hash,row_hash)
      values('${iso(d)}',${id},'court_order',10,'${month}','${month}',${holds},'retention_expired','','');`;
    const reasons=r=>r.blocking.map(f=>f.code+':'+(f.reasons||[]).join('+'));
    const legit=await rid(0),noDest=await rid(0),held=await rid(0),keep=await rid(0),pend=await rid(0,'pending_policy');
    await close(legit,1);
    await db.query(`insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by,opened_at) values($1,'listing',1,'inceleme',gen_random_uuid(),$2)`,[held,iso(1)]);
    await baseline(E,db,2);
    // Meşru: süre (10 gün) dolduktan sonra retention imha eder; tutanak tutarlıdır.
    await db.query('select private.t_retention($1)',[iso(12)]);
    let r=await step(E,db,12);
    assert.deepEqual(r.blocking,[],'meşru imha');
    // Tutanaksız silme (kapalı görülmüş kayıt).
    await close(noDest,12);await close(keep,12);await close(pend,12);
    r=await step(E,db,13);assert.deepEqual(r.blocking,[]);
    await exec(db,purge(`delete from private.legal_records where id=${noDest}`));
    r=await step(E,db,14);
    assert.deepEqual(reasons(r),['record_deleted_unproven:no_destruction_row']);
    // Açık ve aktif korumalı kaydın silinmesi (sahte tutanakla).
    await exec(db,purge(`delete from private.legal_holds where record_id=${held}; delete from private.legal_records where id=${held}`)+fakeDest(held,15,'2026-06-01',1));
    r=await step(E,db,15);
    assert.deepEqual(reasons(r),['record_deleted_unproven:not_seen_closed+active_hold']);
    // Onaysız politikalı kayıt.
    await exec(db,purge(`delete from private.legal_records where id=${pend}`));
    r=await step(E,db,16);
    assert.deepEqual(reasons(r),['record_deleted_unproven:policy_not_approved+no_destruction_row']);
    // Süre dolmadan imha (tutarlı görünen sahte tutanakla).
    const early=await rid(40);await close(early,41);
    r=await step(E,db,41);assert.deepEqual(r.blocking,[]);
    await exec(db,purge(`delete from private.legal_records where id=${early}`)+fakeDest(early,42,'2026-07-01'));
    r=await step(E,db,42);
    assert.deepEqual(reasons(r),['record_deleted_unproven:retention_not_elapsed']);
    // Tutanak alanları kayıtla uyuşmuyor (ay yanlış).
    const wrong=await rid(43);await close(wrong,43);
    r=await step(E,db,43);
    await exec(db,purge(`delete from private.legal_records where id=${wrong}`)+fakeDest(wrong,60,'2026-06-01'));
    r=await step(E,db,60);
    assert.deepEqual(reasons(r),['record_deleted_unproven:destruction_row_mismatch']);
    // Snapshot kurcalama ve kapalı kaydı yeniden açma.
    await exec(db,`alter table private.legal_records disable trigger legal_records_guard;
      update private.legal_records set snapshot='{"x":1}' where id=${keep}; alter table private.legal_records enable trigger legal_records_guard;`);
    r=await step(E,db,61);
    assert.deepEqual(codes(r),['record_modified','snapshot_hash_mismatch']);
    await exec(db,`alter table private.legal_records disable trigger legal_records_guard;
      update private.legal_records set status='open',closed_at=null,closed_by=null,close_reason=null where id=${keep}; alter table private.legal_records enable trigger legal_records_guard;`);
    r=await step(E,db,62);
    assert.ok(codes(r).includes('record_reopened_or_altered'));
    // Görülmeden açılıp kapatılıp imha edilen kayıt.
    const ghost=await rid(62);await close(ghost,62);
    await db.query('select private.t_retention($1)',[iso(80)]);
    r=await step(E,db,80);
    assert.ok(r.blocking.some(f=>f.code==='destruction_without_seen_record'));
  }finally{await finish(db);}
});

test('korumalar: serbest bırakma tek yönlü; kayıtsız koruma silinemez',async()=>{
  const db=await legalDb(),E=env();
  try{
    const id=Number(Object.values((await db.query('select private.t_open($1,$2)',['court_order',iso(0)])).rows[0])[0]);
    await db.query(`insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by,opened_at) values($1,'listing',1,'inceleme',gen_random_uuid(),$2)`,[id,iso(0)]);
    await baseline(E,db,1);
    await exec(db,`update private.legal_holds set released_at='2026-06-02Z',released_by=gen_random_uuid(),release_reason='bitti'`);
    let r=await step(E,db,2);
    assert.deepEqual(r.blocking,[],'meşru serbest bırakma');
    await exec(db,`alter table private.legal_holds disable trigger legal_holds_guard; update private.legal_holds set released_at=null,released_by=null,release_reason=null; alter table private.legal_holds enable trigger legal_holds_guard;`);
    r=await step(E,db,3);
    assert.deepEqual(codes(r),['hold_modified']);
    await exec(db,purge(`delete from private.legal_holds`));
    r=await step(E,db,4);
    assert.deepEqual(codes(r),['hold_deleted']);
  }finally{await finish(db);}
});

test('K2 serbest bırakma: sahte, süresi geçmiş, yanlış ortam, yanlış kapsam, eski belge, tekrar ve çoklu belge reddedilir',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0]);
    const r1=await step(E,db,1);
    const ev=open(r1)[0];
    const other=testKeyPair();
    const bad=[
      ['yanlış anahtar',releaseFor(E,ev,{key:other})],
      ['yanlış ortam',releaseFor(E,ev,{environment:'production'})],
      ['süresi geçmiş',releaseFor(E,ev,{not_after:new Date(Date.parse(ev.opened_at)+3600000).toISOString(),not_before:ev.opened_at})],
      ['72 saati aşan',releaseFor(E,ev,{not_after:new Date(Date.parse(ev.opened_at)+80*3600000).toISOString()})],
      ['olay açılmadan önce geçerli (eski belge)',releaseFor(E,ev,{not_before:new Date(Date.parse(ev.opened_at)-1000).toISOString()})],
      ['yanlış bağ',releaseFor(E,ev,{event_binding:'0'.repeat(64)})],
      ['yanlış kapsam',releaseFor(E,ev,{scope:{type:'legal_regression',findings_sha256:ev.findings_sha256}})],
      ['kısa gerekçe',releaseFor(E,ev,{reason:'tamam'})],
      ['UUID olmayan kimlik',releaseFor(E,ev,{release_id:'1'})],
    ];
    const tampered={...releaseFor(E,ev),reason:'Değiştirilmiş gerekçe metni burada'};
    bad.push(['imza sonrası değişiklik',tampered]);
    for(const [name,doc] of bad){
      const r=await step(E,db,name==='süresi geçmiş'?1.5:1.01,{releaseDocs:[doc]});
      assert.equal(r.openEvents,1,name);assert.equal(r.releases[0].state,'rejected',name);
    }
    // Aynı olay için iki geçerli belge: ikisi de reddedilir, olay açık kalır; bu belgeler sonradan tek başına da geçmez.
    const a=releaseFor(E,ev),b=releaseFor(E,ev);
    let r=await step(E,db,1.02,{releaseDocs:[a,b]});
    assert.deepEqual(r.releases.map(x=>x.state),['validated','validated','rejected','rejected']);
    assert.equal(r.openEvents,1);
    r=await step(E,db,1.03,{releaseDocs:[a]});
    assert.equal(r.releases[0].reason,'belge daha önce reddedildi');assert.equal(r.openEvents,1);
    // Geçerli tek belge kapatır; aynı belge tekrar gönderilirse reddedilir.
    const good=releaseFor(E,ev);
    r=await step(E,db,1.04,{releaseDocs:[good]});
    assert.equal(r.openEvents,0);
    r=await step(E,db,1.05,{releaseDocs:[good]});
    assert.equal(r.releases[0].reason,'belge daha önce kullanıldı');
    // Eski belge yeni olayı kapatamaz: kimlik ve bağ farklıdır; yeni olayın kimliğiyle yeniden imzalansa bile
    // geçerlilik başlangıcı yeni olaydan önceyse reddedilir.
    await exec(db,purge(`delete from private.legal_access_log`));
    r=await step(E,db,2);
    const ev2=open(r)[0];assert.ok(ev2);
    r=await step(E,db,2.01,{releaseDocs:[good]});
    assert.equal(r.openEvents,1);
    r=await step(E,db,2.02,{releaseDocs:[releaseFor(E,ev2,{not_before:ev.opened_at})]});
    assert.equal(r.openEvents,1);
    // Zincir içi tutarlılık: kapanmış olaylar tüketilmiş belgeyle eşleşir.
    const chain=await C.readChain(E.store,{trustedK1:E.trustedK1});
    const body=await C.loadBody(E.store,chain.head,{k7:E.k7,prevHeader:chain.headers[chain.headers.length-2]});
    assert.deepEqual(SM.selfCheck(body.sm),[]);
    assert.equal(body.sm.releases.filter(x=>x.state==='consumed').length,1);
  }finally{await finish(db);}
});

test('çökme ve yeniden çalıştırma: consumption_pending sonraki çalışmada tamamlanır, iki kez tüketilmez',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0]);
    const r1=await step(E,db,1);const ev=open(r1)[0];
    const doc=releaseFor(E,ev);
    await assert.rejects(step(E,db,1.1,{releaseDocs:[doc],hooks:{afterWrite:async()=>{throw Error('çökme');}}}),/çökme/);
    const chain=await C.readChain(E.store,{trustedK1:E.trustedK1});
    const body=await C.loadBody(E.store,chain.head,{k7:E.k7,prevHeader:chain.headers[chain.headers.length-2]});
    assert.deepEqual(body.sm.releases.map(x=>x.state),['consumption_pending']);
    assert.equal(body.sm.events[0].status,'open','olay bekleyen durumda açık');
    // Yeniden çalıştırma aynı belgeyle (çift gönderim) ya da belgesiz: tek tüketim.
    const r2=await step(E,db,1.2,{releaseDocs:[doc]});
    assert.equal(r2.openEvents,0);assert.deepEqual(r2.consumed,[doc.release_id]);
    const r3=await step(E,db,1.3,{releaseDocs:[doc]});
    assert.equal(r3.releases[0].reason,'belge daha önce kullanıldı');
    // Belgesiz kurtarma da çalışır.
    const db2=await legalDb(),E2=env();
    try{
      await logs(db2,[0]);
      const s1=await step(E2,db2,1);const d2=releaseFor(E2,open(s1)[0]);
      await assert.rejects(step(E2,db2,1.1,{releaseDocs:[d2],hooks:{afterWrite:async()=>{throw Error('çökme');}}}));
      const s2=await step(E2,db2,1.2);
      assert.equal(s2.openEvents,0);assert.deepEqual(s2.consumed,[d2.release_id]);
    }finally{await finish(db2);}
  }finally{await finish(db);}
});

test('eşzamanlı çalışmalar: koşullu yazma varsa biri reddedilir; yoksa çatal dış çapada yakalanır',async()=>{
  for(const conditionalPut of [true,false]){
    const db=await legalDb(),E=env({conditionalPut,verified:conditionalPut});
    try{
      await logs(db,[0]);
      await step(E,db,1);
      // B, A'nın yazmasından önceki zinciri görür (yarış ya da tutarsız okuma simülasyonu).
      const stale=new Map(E.store.objects),staleAnchor=E.anchors[0].recs.slice();
      const view={capabilities:E.store.capabilities,put:(k,b,o)=>E.store.put(k,b,o),get:k=>E.store.get(k),
        list:async p=>[...stale.keys()].filter(k=>k.startsWith(p)).sort().map(key=>({key,size:0,last_modified:''}))};
      const A=await step(E,db,2);
      assert.equal(A.ok,true);
      // Güncel çapayı okuyan bir çalışma bayat zinciri hemen fark eder.
      const seen=await advance({store:view,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,trustedK2:E.trustedK2,anchors:E.anchors,environment:'test',now:at(2),runId:'S',state:await state(db)});
      assert.equal(seen.ok,false);assert.equal(seen.stage,'anchors');
      const anchorView=[{name:'a1',put:(q,h)=>E.anchors[0].put(q,h),list:async()=>staleAnchor}];
      const B=await advance({store:view,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,trustedK2:E.trustedK2,anchors:anchorView,environment:'test',now:at(2),runId:'B',state:await state(db)});
      if(conditionalPut){
        assert.equal(B.ok,false);assert.equal(B.conflict,true);
        assert.equal(A.singleUseGuaranteed,true);
        const next=await step(E,db,3);assert.equal(next.ok,true);
      }else{
        assert.equal(A.singleUseGuaranteed,false,'kanıtlanmamış depoda tek kullanımlılık iddia edilmez');
        assert.equal(B.ok,true,'koşullu yazma yoksa üzerine yazma fark edilmez');
        const next=await step(E,db,3);
        assert.equal(next.ok,false);assert.equal(next.stage,'anchors');assert.match(next.reason,/çatal/);
      }
    }finally{await finish(db);}
  }
});

test('dış yazma hataları ve eksik/bozuk çapalar silmeyi kapalı tutar',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0]);
    const r1=await step(E,db,1);
    E.store.failNext.put=1;
    let r=await step(E,db,1.1,{releaseDocs:[releaseFor(E,open(r1)[0])]});
    assert.equal(r.ok,false);assert.equal(r.stage,'write');
    E.store.failNext.put=0;
    // Gövde yazıldı, başlık yazılamadı: sonraki çalışma aynı sırayı yeniden dener.
    let calls=0;const orig=E.store.put.bind(E.store);
    E.store.put=async(k,b,o)=>(++calls===2?{ok:false,status:500}:orig(k,b,o));
    r=await step(E,db,1.2);
    assert.equal(r.ok,false);
    E.store.put=orig;
    r=await step(E,db,1.3,{releaseDocs:[releaseFor(E,open(r1)[0])]});
    assert.equal(r.ok,true,r.reason);assert.equal(r.openEvents,0);assert.equal(r.anchorsOk,true);
    // Çapa yazılamazsa çalışma kaydedilir ama anchorsOk=false.
    E.anchors[0].put=async()=>{throw Error('çapa erişilemiyor');};
    r=await step(E,db,2);
    assert.equal(r.ok,true);assert.equal(r.anchorsOk,false);
    // Çapa yok.
    const r2=await step({...E,anchors:[]},db,3);
    assert.equal(r2.anchorsOk,false);
    // Çapa zincirde olmayan bir sıra gösteriyorsa (geri sarma) çalışma durur.
    const E3=env();const a=E3.anchors[0];
    await step(E3,db,4);await a.put(9,'f'.repeat(64));
    r=await step(E3,db,5);
    assert.equal(r.ok,false);assert.equal(r.stage,'anchors');
  }finally{await finish(db);}
});

test('zincir kurcalama: başlık değişikliği, eksik halka, gövde değişimi ve anahtar değişimi',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0]);
    await step(E,db,1);await step(E,db,2);await step(E,db,3);
    const key=C.headerKey(2);
    const orig=E.store.objects.get(key);
    const h=JSON.parse(String(orig.body));
    E.store.objects.set(key,{...orig,body:Buffer.from(canonical({...h,counts:{...h.counts,log:99}}))});
    let r=await step(E,db,4);assert.equal(r.ok,false);assert.equal(r.stage,'chain');
    E.store.objects.set(key,orig);
    E.store.objects.delete(key);
    r=await step(E,db,4);assert.equal(r.ok,false);assert.match(r.reason,/kesintili/);
    E.store.objects.set(key,orig);
    // Baş gövdesi önceki gövdeyle değiştirilir.
    const chain=await C.readChain(E.store,{trustedK1:E.trustedK1});
    const b3=E.store.objects.get(chain.head.body_key),b2=E.store.objects.get(chain.headers[1].body_key);
    E.store.objects.set(chain.head.body_key,b2);
    r=await step(E,db,4);assert.equal(r.ok,false);assert.equal(r.stage,'body');
    E.store.objects.set(chain.head.body_key,b3);
    // Güvenilmeyen K1 ve yanlış K7.
    r=await step({...E,trustedK1:{}},db,4);assert.equal(r.ok,false);assert.equal(r.stage,'chain');
    r=await step({...E,k7:crypto.randomBytes(32)},db,4);assert.equal(r.ok,false);assert.equal(r.stage,'body');
    r=await step(E,db,4);assert.equal(r.ok,true);
  }finally{await finish(db);}
});

test('zincir: geçerli K1 imzalı ama tutarsız başlık ya da gövde kabul edilmez (imza tek başına yetmez)',async()=>{
  const db=await legalDb(),E=env();
  try{
    await logs(db,[0]);
    await step(E,db,1);await step(E,db,2);await step(E,db,3);
    const chain=await C.readChain(E.store,{trustedK1:E.trustedK1});
    const [h1,h2,h3]=chain.headers;
    const put=(key,obj)=>E.store.objects.set(key,{body:Buffer.from(canonical(obj)),created:new Date()});
    const resign=h=>sign(C.NAMESPACE,h,E.k1.privateKey,E.k1.keyId);
    const save=new Map(E.store.objects);
    const restore=()=>{E.store.objects=new Map(save);};
    // 1) Önceki hash bağı yanlış (ör. çatalda yazılmış, imzası geçerli başlık).
    put(C.headerKey(3),resign({...h3,prev_sha256:C.headerSha(h1)}));
    let r=await C.readChain(E.store,{trustedK1:E.trustedK1});
    assert.equal(r.ok,false);assert.match(r.reason,/hash bağı/);
    restore();
    // 2) Aynı içerik yeniden şifrelenmiş gövde: başlığın bağladığı baytlar değil.
    const b3=C.openBody(E.store.objects.get(h3.body_key).body,{k7:E.k7,seq:3,prevSha:C.headerSha(h2)});
    E.store.objects.set(h3.body_key,{body:C.sealBody(b3,{k7:E.k7,seq:3,prevSha:C.headerSha(h2)}),created:new Date()});
    await assert.rejects(C.loadBody(E.store,h3,{k7:E.k7,prevHeader:h2}),/gövde hash/);
    restore();
    // 3) Başlık gövdeyi yanlış özetliyor (gövde hash'i doğru, kökler ya da sayılar yanlış).
    for(const lie of [{roots:{...h3.roots,log:'0'.repeat(64)}},{counts:{...h3.counts,log:7}},{events:{...h3.events,open:0}},{findings_sha256:'1'.repeat(64)}]){
      const bad=resign({...h3,...lie});
      await assert.rejects(C.loadBody(E.store,bad,{k7:E.k7,prevHeader:h2}),/başlıkla uyuşmuyor/,JSON.stringify(Object.keys(lie)));
    }
    r=await step(E,db,4);assert.equal(r.ok,true);
  }finally{await finish(db);}
});

test('K6 muafiyeti: olaya bağlı, tek kullanımlık, 7 günü aşınca kabul edilmez; neden kalkınca olay kapanır',async()=>{
  const db=await legalDb(),E=env();
  try{
    await baseline(E,db,0);
    const evaluation={decision:'stop_waivable',waivable_diff_sha256:'d'.repeat(64),nonwaivable:[]};
    let r=await step(E,db,1,{evaluation});
    const pe=r.events.find(e=>e.type==='preflight_waivable'&&e.status==='open');
    assert.ok(pe);assert.equal(r.openEvents,1);
    const w=()=>({waiver_id:randomUUID(),event_id:pe.event_id,diff_sha256:'d'.repeat(64)});
    const w1=w();
    r=await step(E,db,1.1,{evaluation,waiver:{doc:w1,validation:{ok:true}}});
    assert.deepEqual(r.waiver,{ok:true,reason:undefined});
    r=await step(E,db,1.2,{evaluation,waiver:{doc:w1,validation:{ok:true}}});
    assert.equal(r.waiver.ok,false);assert.match(r.waiver.reason,/daha önce/);
    r=await step(E,db,1.3,{evaluation,waiver:{doc:{...w(),event_id:randomUUID()},validation:{ok:true}}});
    assert.match(r.waiver.reason,/bağlı değil/);
    r=await step(E,db,1.4,{evaluation,waiver:{doc:{...w(),diff_sha256:'e'.repeat(64)},validation:{ok:true}}});
    assert.match(r.waiver.reason,/farkına/);
    r=await step(E,db,1.5,{evaluation,waiver:{doc:w(),validation:{ok:false,reason:'imza'}}});
    assert.equal(r.waiver.ok,false);
    r=await step(E,db,9,{evaluation,waiver:{doc:w(),validation:{ok:true}}});
    assert.match(r.waiver.reason,/7 gün/);
    // 7 günü aşan olay yalnız K2 ile kapanır.
    const esc=r.events.find(e=>e.event_id===pe.event_id);
    assert.equal(esc.escalated,true);
    r=await step(E,db,9.1,{evaluation,releaseDocs:[releaseFor(E,esc,{not_before:iso(8.9),not_after:iso(10)})]});
    assert.equal(r.openEvents,0);
    // Yeni fark yeni olay açar; neden kalkınca kapanır.
    r=await step(E,db,10,{evaluation});
    assert.equal(r.openEvents,1);
    r=await step(E,db,11,{evaluation:{decision:'ok'}});
    assert.equal(r.openEvents,0);
  }finally{await finish(db);}
});

test('yasal tablolar yokken n/a; sonradan gelirse başlangıç onayı gerekir; kaybolursa bütünlük olayı',async()=>{
  const E=env();
  const empty=await openDb();
  try{
    const s=await state(empty);
    assert.equal(s.absent,true);
    let r=await advance({store:E.store,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,trustedK2:E.trustedK2,anchors:E.anchors,environment:'test',now:at(0),runId:'x',state:s});
    assert.equal(r.ok,true);assert.equal(r.openEvents,0);assert.equal(r.header.legal_absent,true);
    const db=await legalDb();
    try{
      r=await step(E,db,1);
      assert.deepEqual(codes(r),['genesis_baseline']);
      r=await advance({store:E.store,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,trustedK2:E.trustedK2,anchors:E.anchors,environment:'test',now:at(2),runId:'y',state:s});
      assert.ok(codes(r).includes('legal_tables_missing'));
    }finally{await finish(db);}
  }finally{await finish(empty);}
  await assert.rejects(advance({store:E.store,trustedK1:E.trustedK1,k1:E.k1,k7:E.k7,anchors:E.anchors,environment:'test',now:at(3),runId:'z',state:null}).then(r=>{if(!r.ok)throw Error(r.reason);}),/okunmadı/);
});

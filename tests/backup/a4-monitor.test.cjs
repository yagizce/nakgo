/** B7-A4 izleme Worker'ı testleri: eşikler, imza doğrulaması (Node imzası ↔ WebCrypto doğrulaması), olay hatırlatması,
 * haftalık özet, kalp atışı ve bildirim. Worker dağıtılmaz; R2 bağlaması ve fetch taklittir. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {testKeyPair,sign}=require('../../tools/backup/crypto.cjs');
const {buildManifest,signManifest}=require('../../tools/backup/manifest.cjs');

const load=f=>import(pathToFileURL(path.join(__dirname,'../../ops/backup/monitor',f)).href);
const H=3600000;
const NOW=new Date('2026-11-23T10:17:00Z');// pazartesi değil
const ago=h=>new Date(NOW.getTime()-h*H).toISOString();
const ok=Object.fromEntries(['preflight','dump','restore_test','legal','encryption','upload'].map(k=>[k,{status:'ok'}]));

function header(k1,seq,hoursAgo,extra={}){
  return sign('nakgo-legal-checkpoint/v1',{version:1,seq,created_at:ago(hoursAgo),events:{open:0,root:'x'},single_use_guaranteed:false,observed:true,...extra},k1.privateKey,k1.keyId);
}

test('imza: Node ile imzalanan belge WebCrypto ile doğrulanır; kurcalama ve yabancı anahtar reddedilir',async()=>{
  const {verifySigned}=await load('core.mjs');
  const k1=testKeyPair(),other=testKeyPair(),trusted={[k1.keyId]:k1.publicKey};
  const m=signManifest(buildManifest({runId:'r',createdAt:ago(1),stages:ok,objectKey:'db/x'}),k1);
  assert.equal((await verifySigned('nakgo-backup-manifest/v1',m,trusted)).ok,true);
  assert.equal((await verifySigned('nakgo-backup-manifest/v1',{...m,verified:false},trusted)).ok,false);
  assert.equal((await verifySigned('nakgo-legal-checkpoint/v1',m,trusted)).ok,false,'alan adı');
  assert.equal((await verifySigned('nakgo-backup-manifest/v1',signManifest(buildManifest({runId:'r',createdAt:ago(1),stages:ok}),other),trusted)).ok,false);
  assert.equal((await verifySigned('nakgo-backup-manifest/v1',m,{[k1.keyId]:other.publicKey})).ok,false,'kimlik-anahtar uyuşmazlığı');
});

test('eşikler: 13 saat uyarı, 19 saat kritik; veri yoksa kritik',async()=>{
  const {assess,THRESHOLDS}=await load('core.mjs');
  assert.equal(THRESHOLDS.warnHours,13);assert.equal(THRESHOLDS.critHours,19);
  const k1=testKeyPair();
  const base=h=>({now:NOW,manifests:[{doc:{verified:true,created_at:ago(h)},sigOk:true}],headers:[{doc:header(k1,5,1),sigOk:true}],
    workflow:{status:'completed',conclusion:'success',created_at:ago(1),updated_at:ago(0.5)},oldestDb:ago(24*3),deletionEnabled:false});
  const lvl=h=>assess(base(h)).alerts.filter(a=>a.code==='backup_age').map(a=>a.level)[0]||'ok';
  assert.equal(lvl(12.99),'ok');assert.equal(lvl(13),'warning');assert.equal(lvl(18.99),'warning');assert.equal(lvl(19),'critical');
  assert.equal(assess(base(1)).level,'ok');
  assert.equal(assess({...base(1),manifests:[]}).level,'critical');
  assert.ok(assess({...base(1),manifests:[{doc:{verified:false,created_at:ago(1)},sigOk:true}]}).alerts.some(a=>a.code==='no_verified_backup'&&a.level==='critical'));
  const unsigned=assess({...base(1),manifests:[{doc:{verified:true,created_at:ago(1)},sigOk:false}]});
  assert.equal(unsigned.level,'critical','imzasız "doğrulanmış" sayılmaz');
  assert.ok(unsigned.alerts.some(a=>a.code==='no_verified_backup'));assert.equal(unsigned.last_verified,null);
  assert.equal(assess({...base(1),headers:[]}).level,'critical');
  assert.equal(assess({...base(1),headers:[{doc:header(k1,5,20),sigOk:true}]}).alerts.find(a=>a.code==='checkpoint_age').level,'critical');
  assert.equal(assess({...base(1),headers:[{doc:header(k1,5,1),sigOk:true},{doc:header(k1,3,2),sigOk:true}]}).alerts.some(a=>a.code==='checkpoint_gap'),true);
  assert.equal(assess({...base(1),workflow:null}).level,'warning');
  assert.ok(assess({...base(1),workflow:{status:'completed',conclusion:'failure',created_at:ago(1)}}).alerts.some(a=>a.code==='workflow_failed'&&a.level==='warning'));
  assert.equal(assess({...base(1),workflow:{status:'in_progress',conclusion:null,created_at:ago(3)}}).alerts.some(a=>a.code==='workflow_stuck'),true);
  assert.equal(assess({...base(1),deletionEnabled:true,oldestDb:ago(24*17)}).alerts.some(a=>a.code==='deletion_lag'),true);
  assert.equal(assess({...base(1),deletionEnabled:true,oldestDb:ago(24*15)}).level,'ok');
});

test('açık olay: her çalışmada kritik hatırlatma; 7 günü aşınca yükseltilir',async()=>{
  const {assess}=await load('core.mjs');
  const k1=testKeyPair();
  const hs=[...Array(40)].map((_,i)=>({doc:header(k1,100-i,i*6,{events:{open:i<30?1:0,root:'r'}}),sigOk:true}));
  const r=assess({now:NOW,manifests:[{doc:{verified:true,created_at:ago(1)},sigOk:true}],headers:hs.slice(0,10),workflow:{status:'completed',conclusion:'success',created_at:ago(1)},oldestDb:null});
  assert.equal(r.alerts.find(a=>a.code==='event_open').level,'critical');
  const r2=assess({now:NOW,manifests:[{doc:{verified:true,created_at:ago(1)},sigOk:true}],headers:hs,workflow:{status:'completed',conclusion:'success',created_at:ago(1)},oldestDb:null});
  assert.ok(r2.alerts.some(a=>a.code==='event_escalated'),JSON.stringify(r2.alerts));
});

test('Worker: R2 okur, GitHub durumunu alır, bildirir ve kalp atışı gönderir; hata hâlinde kalp atışı yok',async()=>{
  const W=await load('worker.mjs');
  const k1=testKeyPair();
  const objs=new Map();
  const putJ=(k,v,uploaded=new Date(NOW.getTime()-H))=>objs.set(k,{body:JSON.stringify(v),uploaded});
  putJ('manifests/2026/11/23/a.json',signManifest(buildManifest({runId:'a',createdAt:ago(14),stages:ok,objectKey:'db/2026/11/23/a'}),k1));
  putJ('audit/checkpoints/000000000001.json',header(k1,1,2));
  objs.set('db/2026/11/10/old',{body:'x',uploaded:new Date(ago(24*13))});
  const bucket={
    async list({prefix,limit=1000}){const keys=[...objs.keys()].filter(k=>k.startsWith(prefix)).sort().slice(0,limit);return {objects:keys.map(key=>({key,uploaded:objs.get(key).uploaded})),truncated:false};},
    async get(key){const o=objs.get(key);return o?{text:async()=>o.body}:null;},
  };
  const calls=[];
  const fetchImpl=async(url,opt={})=>{calls.push({url,opt});
    if(String(url).includes('api.github.com'))return {ok:true,json:async()=>({workflow_runs:[{status:'completed',conclusion:'success',created_at:ago(1),updated_at:ago(0.9)}]})};
    return {ok:true};};
  const env={BACKUP_BUCKET:bucket,TRUSTED_K1:JSON.stringify({[k1.keyId]:k1.publicKey}),GITHUB_REPO:'o/r',GITHUB_TOKEN:'t',NOTIFY_WEBHOOK:'https://bildirim.example/h',HEARTBEAT_URL:'https://kalp.example/x',DELETION_ENABLED:'false'};
  const r=await W.run(env,NOW,fetchImpl);
  assert.equal(r.result.level,'warning',JSON.stringify(r.result));
  assert.ok(r.result.alerts.some(a=>a.code==='backup_age'&&a.level==='warning'));
  assert.deepEqual(r.sent,{notify:true,heartbeat:true});
  const body=JSON.parse(calls.find(c=>c.url===env.NOTIFY_WEBHOOK).opt.body);
  assert.equal(body.kind,'alert');assert.ok(!JSON.stringify(body).includes('BEGIN'),'bildirimde anahtar yok');
  assert.equal(calls.find(c=>String(c.url).includes('api.github.com')).opt.headers.authorization,'Bearer t');
  // Her şey yolunda ve pazartesi değil → bildirim yok, kalp atışı var.
  putJ('manifests/2026/11/23/b.json',signManifest(buildManifest({runId:'b',createdAt:ago(1),stages:ok,objectKey:'db/b'}),k1));
  calls.length=0;
  const r2=await W.run(env,NOW,fetchImpl);
  assert.equal(r2.result.level,'ok');assert.deepEqual(r2.sent,{notify:false,heartbeat:true});
  // Pazartesi 06:00 UTC → haftalık özet.
  const monday=new Date('2026-11-23T06:17:00Z');
  calls.length=0;
  const r3=await W.run({...env},monday,fetchImpl);
  assert.equal(r3.result.level,'ok',JSON.stringify(r3.result));
  assert.equal(JSON.parse(calls.find(c=>c.url===env.NOTIFY_WEBHOOK).opt.body).kind,'weekly_digest');
  // Depo okunamıyorsa: kritik bildirim, kalp atışı YOK (ölü adam anahtarı tetiklenir).
  calls.length=0;
  const r4=await W.run({...env,BACKUP_BUCKET:{list:async()=>{throw Error('erişim yok');},get:async()=>null}},NOW,fetchImpl);
  assert.equal(r4.result.level,'critical');assert.equal(r4.sent.heartbeat,false);assert.equal(r4.sent.notify,true);
  // Sahte imzalı manifest "doğrulanmış" sayılmaz.
  const other=testKeyPair();
  objs.clear();putJ('audit/checkpoints/000000000001.json',header(k1,1,2));
  putJ('manifests/2026/11/23/z.json',signManifest(buildManifest({runId:'z',createdAt:ago(1),stages:ok,objectKey:'db/z'}),other));
  const r5=await W.run(env,NOW,fetchImpl);
  assert.equal(r5.result.level,'critical');assert.ok(r5.result.alerts.some(a=>a.code==='manifest_signature'));
});

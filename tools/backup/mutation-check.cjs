/** B7-A3 kasıtlı bozma (mutasyon) denetimi: kanıt, zincir, durum makinesi ve silme kapısındaki her kritik kuralı tek
 * tek kapatır ve ilgili A2–A4 testlerinin bunu yakaladığını doğrular. Kaynak dosya her denemeden sonra geri yazılır.
 * Süre uzun olduğu için CI'da değil, elle çalıştırılır:  NODE_PATH=... node tools/backup/mutation-check.cjs
 * Çıkış kodu: kaçan mutasyon varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const MUTATIONS=[
  ["tools/backup/legal-evidence.cjs", "if(!cutoffOk)add('deleted_before_retention'", "if(false)add('deleted_before_retention'"],
  ["tools/backup/legal-evidence.cjs", "if(counted>deleted.length)", "if(false)"],
  ["tools/backup/legal-evidence.cjs", "if(counted<deleted.length&&deleted.length)", "if(false)"],
  ["tools/backup/legal-evidence.cjs", "add('chain_gap_unexplained'", "void('chain_gap_unexplained'"],
  ["tools/backup/legal-evidence.cjs", "if(p.row_hash!==c.row_hash||p.prev_hash!==c.prev_hash)", "if(false)"],
  ["tools/backup/legal-evidence.cjs", "if(r.recomputed!==r.row_hash)", "if(false)"],
  ["tools/backup/legal-evidence.cjs", "else if(Pp[code].sha!==Pc[code].sha){add('policy_changed','info','policies',code);changed.add(code);}", "else if(Pp[code].sha!==Pc[code].sha){add('policy_changed','info','policies',code);}"],
  ["tools/backup/legal-evidence.cjs", "if(HP.some(h=>h.record_id===p.id&&!h.released))reasons.push('active_hold');", ""],
  ["tools/backup/legal-evidence.cjs", "if(!(big(p.closed_at_us)+BigInt(pol.retain_days)*DAY_US<=big(d.at_us)))reasons.push('retention_not_elapsed');", ""],
  ["tools/backup/legal-evidence.cjs", "if(ds.length!==1)reasons.push", "if(false)reasons.push"],
  ["tools/backup/legal-evidence.cjs", "if(!c){if(!(big(r.ran_at_us)<minus3Years(curRunLatest)))add('run_deleted_early','integrity','runs',id);}", "if(!c){}"],
  ["tools/backup/legal-evidence.cjs", "const y=d.getUTCFullYear()-3,", "const y=d.getUTCFullYear()-2,"],
  ["tools/backup/legal-evidence.cjs", "cur.leaves.runs.filter(r=>big(r.id)>prevRunMax).reduce(", "cur.leaves.runs.reduce("],
  ["tools/backup/checkpoint.cjs", "    if(w){try{extraWraps.push(JSON.parse(String(w)));}catch{", "    if(false){try{extraWraps.push(JSON.parse(String(w)));}catch{"],
  ["tools/backup/legal-evidence.cjs", "if(!c){if(!destroyed.has(p.record_id))add('hold_deleted','integrity','holds',p.id);continue;}", "if(!c)continue;"],
  ["tools/backup/legal-evidence.cjs", "for(const d of newDest)if(!destroyed.has(d.record_no))", "for(const d of [])if(!destroyed.has(d.record_no))"],
  ["tools/backup/state-machine.cjs", "if(doc.event_binding!==e.binding)return no('olay bağı uyuşmuyor');", ""],
  ["tools/backup/state-machine.cjs", "if(nb<Date.parse(e.opened_at))return no", "if(false)return no"],
  ["tools/backup/state-machine.cjs", "if(list.length>1||pending)", "if(pending)"],
  ["tools/backup/state-machine.cjs", "const known=sm.releases.find(r=>r.release_id&&doc&&r.release_id===doc.release_id);", "const known=sm.releases.find(r=>r.release_id&&doc&&r.release_id===doc.release_id&&r.state!=='rejected');"],
  ["tools/backup/state-machine.cjs", "if(sm.waivers.some(w=>w.waiver_id===doc.waiver_id))return reject", "if(false)return reject"],
  ["tools/backup/state-machine.cjs", "if(e.escalated||ctx.now-new Date(e.opened_at)>WAIVER_STREAK_MS)return reject", "if(false)return reject"],
  ["tools/backup/state-machine.cjs", "if(now<nb||now>na)return no", "if(false)return no"],
  ["tools/backup/state-machine.cjs", "if(!environment||doc.environment!==environment)return no", "if(false)return no"],
  ["tools/backup/checkpoint.cjs", "const h=await store.put(headerKey(seq),hb,{ifNoneMatch:true});", "const h=await store.put(headerKey(seq),hb,{});"],
  ["tools/backup/checkpoint.cjs", "if(h.prev_sha256!==want)return", "if(false)return"],
  ["tools/backup/checkpoint.cjs", "if(h.seq!==i+1||o.key!==headerKey(h.seq))return", "if(false)return"],
  ["tools/backup/checkpoint.cjs", "if(sha256(bytes)!==header.body_sha256)throw Error('gövde hash uyuşmuyor');", ""],
  ["tools/backup/checkpoint.cjs", "if(canonical(again[k])!==canonical(header[k]))throw", "if(false)throw"],
  ["tools/backup/legal-run.cjs", "else if(C.headerSha(h)!==r.sha){res.ok=false;", "else if(false){"],
  ["tools/backup/legal-run.cjs", "const res={ok:anchors.length>0,", "const res={ok:true,"],
  ["tools/backup/legal-run.cjs", "flags={single_use_guaranteed:caps.conditionalPut==='verified'&&caps.consistentRead==='verified'", "flags={single_use_guaranteed:true"],
  ["tools/backup/deletion.cjs", "if(keep.length<minRemaining)blockers.push", "if(false)blockers.push"],
  ["tools/backup/deletion.cjs", "if(!(now.getTime()-newest<=maxAge))blockers.push", "if(false)blockers.push"]
,
  ["tools/backup/run.cjs", "environment!=='production'&&config.k6_waiver", "config.k6_waiver"],
  ["tools/backup/run.cjs", "if(backup.verified!==true)blockers.push('bu çalışmanın yedeği doğrulanmadı');", ""],
  ["tools/backup/run.cjs", "summary.legal.open_events===0&&summary.legal.anchors_ok&&", "summary.legal.open_events===0&&"],
  ["tools/backup/run.cjs", "if(config.deletion&&config.deletion.enabled&&!(config.store_capabilities", "if(false&&!(config.store_capabilities"],
  ["tools/backup/run.cjs", "if(!verifyManifest(m,trustedK1).ok){invalid.push(o.key);continue;}", ""],
  ["tools/backup/run.cjs", "store.capabilities={verified:config.store_capabilities.verified===true,", "void {verified:config.store_capabilities.verified===true,"],
  ["tools/backup/legal-run.cjs", "if(seen.has(o.key))continue;", ""],
  ["ops/backup/monitor/core.mjs", "if (h >= THRESHOLDS.critHours) add('critical'", "if (h >= THRESHOLDS.critHours + 1) add('critical'"],
  ["ops/backup/monitor/core.mjs", "const verified = (input.manifests || []).filter(m => m.sigOk && m.doc.verified === true)", "const verified = (input.manifests || []).filter(m => m.doc.verified === true)"],
  ["ops/backup/monitor/worker.mjs", "if (env.HEARTBEAT_URL && !result.alerts.some(a => a.code === 'monitor_error'))", "if (env.HEARTBEAT_URL)"],
  ["tools/backup/run.cjs", "if(!result.ok)del.alarm='deletion_result_missing';", ""],
  ["tools/backup/run.cjs", "if(!journalClean)blockers.push(", "if(false)blockers.push("],
  ["tools/backup/run.cjs", "if(!again.ok||!again.head||again.head.seq!==adv.seq||C.headerSha(again.head)!==adv.sha)", "if(!again.ok)"],
  ["tools/backup/run.cjs", "if(!obj||obj.size!==m.size){invalid.push(o.key);continue;}", "if(!obj){invalid.push(o.key);continue;}"],
  ["tools/backup/run.cjs", "if([...i1].some(x=>i2.has(x)))", "if(false)"],
  ["tools/backup/run.cjs", "if(recipientsSha256(recipientsFile)!==config.recipients_sha256)", "if(false)"],
  ["tools/backup/run.cjs", "&&summary.deletion.record_written&&del.alarm===null&&del.intent_written!==false?0:1;", "&&summary.deletion.record_written?0:1;"],
  ["tools/backup/deletion-journal.cjs", "if(!back||!back.equals(bytes))return {ok:false,error:'geri okunan kayıt farklı'};", "if(!back)return {ok:false,error:'geri okunan kayıt farklı'};"],
  ["tools/backup/deletion-journal.cjs", "if(!results.has(resultKey(seq))){add('deletion_result_missing',seq);unresolved.push(doc);continue;}", "if(!results.has(resultKey(seq)))continue;"],
  ["tools/backup/deletion-journal.cjs", "||!Array.isArray(res.results)||res.results.some(r=>!allowed.has(r.key)||!STATUSES.includes(r.status)))", "||!Array.isArray(res.results))"],
  ["tools/backup/deletion-journal.cjs", "if(!h||C.headerSha(h)!==doc.checkpoint_sha256){add('deletion_intent_unbound',seq);continue;}", "if(!h){add('deletion_intent_unbound',seq);continue;}"],
  ["tools/backup/deletion-journal.cjs", "status:h?'present_after_reconcile':'absent_after_reconcile'", "status:'absent_after_reconcile'"],
  ["tools/backup/deletion-journal.cjs", "try{r=await store.put(key,bytes,{ifNoneMatch:true});}", "try{r=await store.put(key,bytes,{});}"],
  ["tools/backup/state-machine.cjs", "const covered=new Set([...sm.events.filter(e=>e.status==='open'&&e.type===type).flatMap(e=>e.finding_keys),...accepted]);", "const covered=new Set([...sm.events.filter(e=>e.status==='open'&&e.type===type).flatMap(e=>e.finding_keys)]);"],
  ["ops/backup/monitor/core.mjs", "if (input.journal && input.journal.unresolved > 0)", "if (false)"]
];
// Her mutasyon yalnız o dosyayı sınayan test dosyalarıyla denenir (gerçek migration'lı testler uzun sürer).
const T={a2:'tests/backup/a2-core.test.cjs',a3:'tests/backup/a3-legal.test.cjs',a4:'tests/backup/a4-orchestrator.test.cjs',mon:'tests/backup/a4-monitor.test.cjs'};
function testsFor(file){
  if(file.includes('/monitor/'))return [T.mon];
  if(/(^|\/)run\.cjs$|deletion-journal\.cjs$/.test(file))return [T.a4];
  if(/deletion\.cjs$/.test(file))return [T.a2,T.a3,T.a4];
  if(/legal-run\.cjs$|state-machine\.cjs$|checkpoint\.cjs$/.test(file))return [T.a3,T.a4];
  return [T.a3];
}
let escaped=0;
// İsteğe bağlı: NAKGO_MUTATION_ONLY=legal-run.cjs yalnız adı bu metni içeren dosyaların mutasyonlarını dener.
const only=process.env.NAKGO_MUTATION_ONLY;
for(const [file,from,to] of MUTATIONS.filter(m=>!only||m[0].includes(only))){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('mutasyon noktası tekil değil: '+file+' '+from);
  fs.writeFileSync(file,src.replace(from,to));
  let caught;
  try{caught=!/# fail 0\b/.test(spawnSync(process.execPath,['--test',...testsFor(file)],{encoding:'utf8',env:process.env}).stdout);}
  finally{fs.writeFileSync(file,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.slice(0,70));
}
console.log(`kaçan: ${escaped} / ${MUTATIONS.filter(m=>!only||m[0].includes(only)).length}`);
process.exitCode=escaped?1:0;

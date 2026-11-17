/** B7-A3 kasıtlı bozma (mutasyon) denetimi: kanıt, zincir, durum makinesi ve silme kapısındaki her kritik kuralı tek
 * tek kapatır ve A2+A3 testlerinin bunu yakaladığını doğrular. Kaynak dosya her denemeden sonra geri yazılır.
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
  ["tools/backup/legal-evidence.cjs", "if(!c){if(!(big(r.ran_at_us)<curRunLatest-1096n*DAY_US))add('run_deleted_early','integrity','runs',id);}", "if(!c){}"],
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
];
let escaped=0;
for(const [file,from,to] of MUTATIONS){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('mutasyon noktası tekil değil: '+file+' '+from);
  fs.writeFileSync(file,src.replace(from,to));
  let caught;
  try{caught=!/# fail 0\b/.test(spawnSync(process.execPath,['--test','tests/backup/a3-legal.test.cjs','tests/backup/a2-core.test.cjs'],{encoding:'utf8',env:process.env}).stdout);}
  finally{fs.writeFileSync(file,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.slice(0,70));
}
console.log(`kaçan: ${escaped} / ${MUTATIONS.length}`);
process.exitCode=escaped?1:0;

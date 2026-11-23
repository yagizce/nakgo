/** K6b — istisnai elle döküm (yedek rolü ve dışa aktarma fonksiyonları Production'da VARKEN). Bootstrap ile aynı K9 akışı:
 *   node tools/backup/k6b.cjs run --out KLASÖR --recipients ops/backup/recipients.txt --recipients-sha256 HASH --approval "…"
 *   (çevrim dışı) node tools/backup/offline-sign.cjs …
 *   node tools/backup/k6b.cjs finalize --out KLASÖR --response USB/response.json
 * Ön koşul: A1 yetki denetimi "ok" (nakgo_backup rolüyle); fonksiyon kipi; postgres rolüyle K6b alınmaz.
 * Runbook: docs/backup/runbooks/k6b-manual-dump.md. */
'use strict';
const B=require('./bootstrap.cjs');
const {preflightAudit}=require('./run.cjs');
const PA=require('./privilege-audit.cjs');

/** K6b ön kontrolü: önce A1 (yedek rolünün yetkileri izin listesiyle aynı), sonra ortak ön koşullar (fonksiyonlar VAR). */
async function k6bPreflight({conn,approval,allowLocal=false,Client,allowlist}){
  if(conn&&conn.user&&/^postgres(\.|$)/.test(conn.user))return {status:'failed',reason:'K6b yalnız yedek rolüyle alınır (postgres değil)'};
  Client=Client||require('pg').Client;allowlist=allowlist||PA.loadAllowlist();
  let ev;
  try{ev=await preflightAudit({conn,Client,allowlist,allowLocal});}catch(e){return {status:'failed',reason:'A1 yetki denetimi: '+e.message};}
  if(!ev||ev.decision!=='ok')return {status:'failed',reason:'A1 yetki denetimi "ok" değil: '+(ev&&ev.decision)};
  return B.preflight({conn,approval,allowLocal,Client,kind:'k6b'});
}
const runK6b=opts=>B.runManual({...opts,kind:'k6b',preflightHook:()=>k6bPreflight(opts)});

module.exports={runK6b,k6bPreflight};

if(require.main===module)B.cli('k6b',process.argv.slice(2),{preflightHookFor:o=>()=>k6bPreflight(o)}).catch(e=>{console.error('k6b durdu: '+e.message);process.exitCode=1;});

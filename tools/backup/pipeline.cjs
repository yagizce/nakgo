/** B7-A2: yedek boru hattı. Aşamalar sırayla ve birbirinden ayrı yürür; bir aşama başarısızsa sonrakiler "skipped" olur
 * ve yedek doğrulanmış sayılmaz. Şifresiz dosyalar her koşulda (finally) silinir.
 *
 *   preflight → dump → restore_test (+legal hook) → encryption → upload → manifest imzası → manifest yüklemesi
 *
 * hooks.preflight(): {status:'ok'|'failed', reason}   — A4'te A1 yetki denetimi ve muafiyet kararı. Verilmezse 'failed'.
 * hooks.legal(db,source): {ok, detail, na}            — A3/A4'te yasal kanıt; yoksa legal='n/a'.
 * Silme bu boru hattında YOK; A3'ün durum makinesi ve deletion.plan ile ayrı yürür. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {snapshotDump}=require('./dump.cjs');
const {restoreAndVerify}=require('./restore-verify.cjs');
const {packBundle,encryptFile}=require('./encrypt.cjs');
const {buildManifest,signManifest}=require('./manifest.cjs');
const {sha256}=require('./crypto.cjs');

function objectKeys(runId,now){
  // Çalışma kimliği nesne anahtarına girer: yalnız güvenli karakterler (yol ayırıcı, '..', boşluk yok).
  if(typeof runId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)||runId.includes('..'))throw Error('geçersiz çalışma kimliği');
  const iso=now.toISOString();const day=iso.slice(0,10).replace(/-/g,'/');const stamp=iso.replace(/[-:]|\.\d{3}/g,'');
  const base=`${day}/nakgo-${stamp}-${runId}`;
  return {data:`db/${base}.tar.age`,manifest:`manifests/${base}.json`};
}

async function runBackup({conn,scope,store,recipientsFile,pinnedRecipientsSha256,k1,runId,now=new Date(),pgBin,ageBin,allowLocal=false,hooks={},workRoot=os.tmpdir(),dumpOptions={}}){
  const stages={preflight:{status:'pending'},dump:{status:'pending'},restore_test:{status:'pending'},legal:{status:'pending'},encryption:{status:'pending'},upload:{status:'pending'}};
  const extra={manifest_signature:{status:'pending'},manifest_upload:{status:'pending'},plaintext_cleanup:{status:'pending'}};
  const work=fs.mkdtempSync(path.join(workRoot,'nakgo-backup-'));
  fs.chmodSync(work,0o700);
  const keys=objectKeys(runId,now);
  let source=null,enc=null,restoreChecks=null;
  const skipRest=from=>{let on=false;for(const k of Object.keys(stages)){if(k===from)on=true;else if(on&&stages[k].status==='pending')stages[k]={status:'skipped'};}};
  try{
    const pf=hooks.preflight?await hooks.preflight():{status:'failed',reason:'ön kontrol tanımlı değil'};
    stages.preflight=pf;
    if(pf.status!=='ok'){skipRest('preflight');return await finish();}
    const bundle=path.join(work,'bundle');
    let d;
    try{d=await snapshotDump({conn,scope,outDir:bundle,pgBin,allowLocal,...dumpOptions});}
    catch(e){d={status:'failed',stage:'exception',reasons:[e.message]};}// ör. bağlantı kurulamadı
    stages.dump=d.status==='ok'?{status:'ok'}:{status:'failed',code:d.stage,reason:(d.reasons||[]).join('; ')};
    if(d.status!=='ok'){skipRest('dump');return await finish();}
    source=d.source;
    let legalResult=null;
    const r=await restoreAndVerify({bundleDir:bundle,pgBin,hooks:hooks.legal?{legal:async(db,src)=>{legalResult=await hooks.legal(db,src);return legalResult.na?{ok:true,detail:'n/a'}:legalResult;}}:{}});
    restoreChecks=r.checks;
    const failed=r.checks.filter(c=>!c.ok&&c.code!=='legal');
    stages.restore_test=failed.length?{status:'failed',code:failed[0].code,reason:JSON.stringify(failed[0].detail).slice(0,500)}:{status:'ok'};
    stages.legal=!hooks.legal||(legalResult&&legalResult.na)?{status:'n/a'}:legalResult&&legalResult.ok?{status:'ok'}:{status:'failed',code:'legal',reason:JSON.stringify(legalResult&&legalResult.detail).slice(0,500)};
    if(stages.restore_test.status!=='ok'||stages.legal.status==='failed'){skipRest('legal');return await finish();}
    const tar=path.join(work,'bundle.tar'),ct=path.join(work,'bundle.tar.age');
    await packBundle(bundle,tar);
    enc=await encryptFile({input:tar,output:ct,recipientsFile,pinnedRecipientsSha256,ageBin});
    stages.encryption=enc.status==='ok'?{status:'ok'}:{status:'failed',code:enc.code,reason:enc.reason};
    if(enc.status!=='ok'){skipRest('encryption');return await finish();}
    try{
      const body=fs.readFileSync(ct);
      const put=await store.put(keys.data,body,{ifNoneMatch:true});
      // 412 yalnız yeniden denemede ilk yazım yerine ulaşmışsa (ambiguous) ve geri okunan içerik bizimkiyse kabul edilir.
      if(!put.ok&&!(put.status===412&&put.ambiguous))stages.upload={status:'failed',code:'put_'+put.status,reason:put.status===412?'aynı adla nesne var':'yazma reddedildi'};
      else{
        const back=await store.get(keys.data);
        stages.upload=back&&sha256(back)===enc.ciphertext_sha256?{status:'ok'}:{status:'failed',code:put.ok?'roundtrip':'put_412',reason:put.ok?'geri okunan nesnenin hash\'i farklı':'aynı adla başka nesne var'};
      }
    }catch(e){stages.upload={status:'failed',code:'exception',reason:e.message};}
    return await finish();
  }finally{
    try{fs.rmSync(work,{recursive:true,force:true});extra.plaintext_cleanup={status:fs.existsSync(work)?'failed':'ok'};}
    catch(e){extra.plaintext_cleanup={status:'failed',reason:e.message};}
  }
  async function finish(){
    const manifest=buildManifest({runId,createdAt:now.toISOString(),stages,objectKey:stages.upload.status==='ok'?keys.data:null,encryption:enc,source});
    let signed=null;
    try{signed=signManifest(manifest,k1);extra.manifest_signature={status:'ok'};}catch(e){extra.manifest_signature={status:'failed',reason:e.message};}
    if(signed){
      try{
        const body=Buffer.from(JSON.stringify(signed));
        const p=await store.put(keys.manifest,body,{ifNoneMatch:true});
        const landed=p.ok||(p.status===412&&p.ambiguous&&(await store.get(keys.manifest)||Buffer.alloc(0)).equals(body));
        extra.manifest_upload=landed?{status:'ok',key:keys.manifest}:{status:'failed',code:'put_'+p.status};
      }catch(e){extra.manifest_upload={status:'failed',reason:e.message};}
    }
    return {verified:manifest.verified,stages,extra,manifest:signed||manifest,keys,restore_checks:restoreChecks,source_summary:manifest.source};
  }
}

module.exports={runBackup,objectKeys};

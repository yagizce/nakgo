/** B7-A4: silme günlüğü — niyet ÖNCE, sonuç SONRA; ikisi de K1 imzalı, değiştirilemez, kontrol noktası zincirine bağlı.
 *
 *   audit/deletions/intents/<seq 12 hane>.json   niyet: hangi nesneler, hangi yedeklerin (manifest) parçası, hangi kontrol
 *                                                noktasına (sıra + başlık hash'i) dayanarak. Sıra başına tek niyet.
 *   audit/deletions/results/<seq 12 hane>.json   sonuç: niyetin hash'i ve nesne başına gerçekleşen durum.
 *
 * Kurallar
 *  - Niyet "yoksa yaz" ile yazılır ve GERİ OKUNUP baytı baytına doğrulanır; doğrulanmadan silme başlamaz.
 *  - Niyet yazılmadan önce zincirin başı yeniden okunur: niyetin dayandığı kontrol noktası hâlâ baş olmalı (araya başka
 *    çalışma girmemeli).
 *  - Silinen her nesne niyette olmalı; sonuç niyette olmayan nesne içeremez.
 *  - Sonucu olmayan niyet (çökme, yazma hatası) "silme gerçekleşmiş olabilir ama kanıtı yok" demektir: otomatik devam
 *    YOK. Bulgu → bütünlük olayı → insan incelemesi → K2 serbest bırakma. Serbest bırakmadan sonra eşleştirme (reconcile)
 *    nesnelerin gerçek durumunu okuyup "reconciled" işaretli bir sonuç yazar; eski niyet bir daha YÜRÜTÜLMEZ.
 *  - Sonraki kontrol noktası niyet ve sonuç nesnelerini anahtar + SHA-256 ile bağlar (attachmentPrefix) ve bu modülün
 *    denetimi (audit) her çalışmada bütün niyetleri doğrular. */
'use strict';
const {canonical,sha256,sha256Json,sign,verify,randomUUID}=require('./crypto.cjs');
const C=require('./checkpoint.cjs');

const INTENT_NS='nakgo-backup-deletion-intent/v1';
const RESULT_NS='nakgo-backup-deletion-result/v1';
const INTENTS='audit/deletions/intents/';
const RESULTS='audit/deletions/results/';
const pad=seq=>String(seq).padStart(12,'0');
const intentKey=seq=>INTENTS+pad(seq)+'.json';
const resultKey=seq=>RESULTS+pad(seq)+'.json';
const STATUSES=['deleted','already_deleted','refused','error','present_after_reconcile','absent_after_reconcile'];
const findingId=seq=>'intent-'+pad(seq);

async function putVerified(store,key,doc){
  const bytes=Buffer.from(canonical(doc));
  let r;
  try{r=await store.put(key,bytes,{ifNoneMatch:true});}catch(e){return {ok:false,error:'yazma hatası: '+e.message};}
  if(!r.ok)return {ok:false,error:'yazılamadı: '+r.status,conflict:r.status===412};
  let back;
  try{back=await store.get(key);}catch(e){return {ok:false,error:'geri okunamadı: '+e.message};}
  if(!back||!back.equals(bytes))return {ok:false,error:'geri okunan kayıt farklı'};
  return {ok:true};
}

/** Niyet: plan.delete içindeki nesneler; refs = {nesne anahtarı: {manifest_key, ciphertext_sha256}}. */
async function writeIntent(store,{k1,runId,checkpoint,keys,refs={},now}){
  const doc=sign(INTENT_NS,{version:1,intent_id:randomUUID(),run_id:runId,created_at:now.toISOString(),
    checkpoint_seq:checkpoint.seq,checkpoint_sha256:checkpoint.sha,
    objects:keys.map(key=>({key,manifest_key:refs[key]?refs[key].manifest_key:null,ciphertext_sha256:refs[key]?refs[key].ciphertext_sha256:null}))},k1.privateKey,k1.keyId);
  const w=await putVerified(store,intentKey(checkpoint.seq),doc);
  return w.ok?{ok:true,doc}:{ok:false,error:w.error,conflict:w.conflict};
}

async function writeResult(store,{k1,intent,results,now,reconciled=false}){
  const doc=sign(RESULT_NS,{version:1,intent_id:intent.intent_id,intent_sha256:sha256Json(intent),checkpoint_seq:intent.checkpoint_seq,
    created_at:now.toISOString(),reconciled,results:results.map(r=>({key:r.key,status:r.status,...(r.http?{http:r.http}:{})}))},k1.privateKey,k1.keyId);
  const w=await putVerified(store,resultKey(intent.checkpoint_seq),doc);
  return w.ok?{ok:true,doc}:{ok:false,error:w.error};
}

/** Bütün niyet ve sonuçları doğrular. headers: readChain'den gelen doğrulanmış başlıklar.
 * Dönüş: {findings, unresolved:[intent], intents:n}. Bulgular olay açar (severity integrity). */
async function audit(store,{trustedK1,headers}){
  const findings=[],unresolved=[];
  const add=(code,seq,extra)=>findings.push({code,severity:'integrity',table:'deletions',id:findingId(seq),...(extra||{})});
  const read=async key=>{try{const b=await store.get(key);return b?JSON.parse(String(b)):null;}catch{return undefined;}};
  const intents=(await store.list(INTENTS)).map(o=>o.key);
  const results=new Set((await store.list(RESULTS)).map(o=>o.key));
  for(const key of intents){
    const m=/(\d{12})\.json$/.exec(key);const seq=m?Number(m[1]):NaN;
    const doc=await read(key);
    if(!m||!doc||!verify(INTENT_NS,doc,trustedK1).ok||doc.checkpoint_seq!==seq){add('deletion_intent_invalid',m?seq:key);continue;}
    const h=headers[seq-1];
    if(!h||C.headerSha(h)!==doc.checkpoint_sha256){add('deletion_intent_unbound',seq);continue;}
    if(!results.has(resultKey(seq))){add('deletion_result_missing',seq);unresolved.push(doc);continue;}
    const res=await read(resultKey(seq));
    const allowed=new Set(doc.objects.map(o=>o.key));
    if(!res||!verify(RESULT_NS,res,trustedK1).ok||res.intent_sha256!==sha256Json(doc)||res.intent_id!==doc.intent_id
      ||!Array.isArray(res.results)||res.results.some(r=>!allowed.has(r.key)||!STATUSES.includes(r.status)))
      add('deletion_result_invalid',seq);
  }
  for(const key of results){
    const m=/(\d{12})\.json$/.exec(key);
    if(!m||!intents.includes(intentKey(Number(m[1]))))add('deletion_result_without_intent',m?Number(m[1]):key);
  }
  return {findings,unresolved,intents:intents.length};
}

/** K2 ile kapatılmış olaya ait sonuçsuz niyet: nesnelerin gerçek durumunu okur ve "reconciled" sonuç yazar.
 * Hiçbir nesneyi SİLMEZ. */
async function reconcile(store,{k1,intent,now}){
  const results=[];
  for(const o of intent.objects){
    const h=await store.head(o.key);
    results.push({key:o.key,status:h?'present_after_reconcile':'absent_after_reconcile'});
  }
  return writeResult(store,{k1,intent,results,now,reconciled:true});
}

module.exports={INTENT_NS,RESULT_NS,INTENTS,RESULTS,intentKey,resultKey,findingId,writeIntent,writeResult,audit,reconcile};

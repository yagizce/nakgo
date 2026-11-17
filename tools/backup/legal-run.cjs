/** B7-A3: bir yedek çalışmasının yasal kanıt adımı — zinciri oku, geçişi doğrula, olayları ve belgeleri işle,
 * yeni kontrol noktasını yaz, dış çapalara bildir. Silme kararı için gereken her şeyi döndürür; kendisi silmez.
 *
 * Sıra:
 *  1. Zincir baştan doğrulanır (imza, sıra, hash bağı); dış çapalar zincirle karşılaştırılır (geri sarma/çatal tespiti).
 *  2. Baş kontrol noktasının gövdesi açılır ve başlıkla birebir karşılaştırılır.
 *  3. Şimdiki durumdan yapraklar; önceki gövdeyle geçiş doğrulaması (ilk noktada "başlangıç" olayı).
 *  4. Olaylar açılır; ön kontrol olayı ve K6 muafiyeti işlenir; K2 belgeleri doğrulanır.
 *  5. Kontrol noktası N yazılır. Bekleyen belge varsa N+1'de tüketilir (iki aşama: çökme sonrası kurtarılabilir).
 *  6. Dış çapalara yazılır. Herhangi bir adım başarısızsa ok:false ve silme kapısı kapalı kalır.
 *
 * state === 'carry': bu çalışmada yasal durum gözlenemedi (ör. döküm alınamadı). Önceki gövdenin listeleri aynen taşınır,
 *   geçiş doğrulaması yapılmaz, başlıkta observed=false yazılır; olay/muafiyet/belge durumu yine de zincire işlenir.
 *   Gözlem yapılmayan aralıktaki değişiklikler bir sonraki gözlemde bütün olarak doğrulanır.
 * attachmentPrefix: bu önek altındaki ve önceki gövdede bulunmayan nesneler (ör. imzalı silme kayıtları) anahtar ve
 *   SHA-256'larıyla gövdeye bağlanır.
 * extraFindings: zincir dışı denetimlerin bulguları (silme günlüğü); geçiş bulgularıyla aynı kurallarla olay açar.
 * hooks.afterWrite(seq): yalnız testler için çökme enjeksiyonu. */
'use strict';
const C=require('./checkpoint.cjs');
const E=require('./legal-evidence.cjs');
const SM=require('./state-machine.cjs');
const {sha256}=require('./crypto.cjs');

const EMPTY_LEAVES=()=>Object.fromEntries(E.LISTS.map(k=>[k,[]]));

/** Çapa arayüzü: {name, async put(seq,sha), async list() → [{seq,sha}]}. */
async function checkAnchors(anchors,headers){
  const res={ok:anchors.length>0,confirmed:{},problems:[]};
  if(!anchors.length)res.problems.push('dış çapa tanımlı değil');
  for(const a of anchors){
    let recs;
    try{recs=await a.list();}catch(e){res.ok=false;res.problems.push(a.name+': okunamadı');continue;}
    for(const r of recs){
      const h=headers[r.seq-1];
      if(!h){res.ok=false;res.problems.push(`${a.name}: zincirde olmayan sıra ${r.seq} (geri sarma ya da silinmiş kontrol noktası)`);}
      else if(C.headerSha(h)!==r.sha){res.ok=false;res.problems.push(`${a.name}: sıra ${r.seq} hash farklı (çatal)`);}
    }
    const head=headers[headers.length-1];
    res.confirmed[a.name]=Boolean(head&&recs.some(r=>r.seq===head.seq&&r.sha===C.headerSha(head)));
    if(head&&!res.confirmed[a.name])res.ok=false;
  }
  return res;
}

async function advance({store,trustedK1,k1,k7,trustedK2,anchors=[],environment,now=new Date(),runId,state,releaseDocs=[],evaluation,waiver,backup=null,ageRecipientsFile,attachmentPrefix,extraFindings=[],hooks={}}){
  const fail=(stage,reason,extra)=>({ok:false,stage,reason,openEvents:null,anchorsOk:false,...extra});
  const chain=await C.readChain(store,{trustedK1});
  if(!chain.ok)return fail('chain',chain.reason);
  const headers=chain.headers,head=chain.head;
  const before=await checkAnchors(anchors,headers);
  if(before.problems.some(p=>/çatal|geri sarma/.test(p)))return fail('anchors',before.problems.join('; '));
  let prevBody=null;
  if(head){
    try{prevBody=await C.loadBody(store,head,{k7,prevHeader:headers[headers.length-2]||null});}
    catch(e){return fail('body',e.message);}
    const p=SM.selfCheck(prevBody.sm);
    if(p.length)return fail('state',p.join('; '));
  }

  if(!state)return fail('state','yasal durum okunmadı');
  const carry=state==='carry';
  const absent=carry?(prevBody?Boolean(prevBody.legal_absent):true):Boolean(state.absent);
  const leaves=carry?(prevBody?prevBody.leaves:EMPTY_LEAVES()):absent?EMPTY_LEAVES():E.buildLeaves(state);
  const policies=carry?(prevBody?prevBody.policies:[]):absent?[]:state.policies;
  let findings=carry||absent?[]:E.internalChecks(state);
  if(carry){/* gözlem yok: geçiş bir sonraki gözlemde doğrulanır */}
  else if(prevBody&&!prevBody.legal_absent&&absent)findings.push({code:'legal_tables_missing',severity:'integrity',table:'*',id:'*'});
  else if(!absent&&(!prevBody||prevBody.legal_absent))findings=findings.concat(E.genesisFindings(leaves));
  else if(!absent)findings=findings.concat(E.verifyTransition(prevBody,{leaves,policies}));
  const attachments=[];
  if(attachmentPrefix){
    try{
      const seen=new Set(((prevBody&&prevBody.all_attachments)||[]).map(a=>a.key));
      for(const o of await store.list(attachmentPrefix)){
        if(seen.has(o.key))continue;
        const b=await store.get(o.key);
        if(b)attachments.push({key:o.key,sha256:sha256(b)});
      }
    }catch(e){return fail('attachments',e.message);}
  }
  // Zincir dışındaki denetimlerin bulguları (ör. silme günlüğü) da olay açar ve kayda geçer.
  findings=findings.concat(extraFindings);
  const allAttachments=[...((prevBody&&prevBody.all_attachments)||[]),...attachments];

  const seq=(head?head.seq:0)+1;
  const prevSha=head?C.headerSha(head):null;
  const ctx={seq,prevSha,now};
  let sm=SM.openEvents(prevBody?prevBody.sm:SM.empty(),findings,ctx);
  if(evaluation)sm=SM.preflight(sm,evaluation,ctx);
  let waiverResult=null;
  if(waiver){const r=SM.consumeWaiver(sm,waiver.doc,waiver.validation,ctx);waiverResult={ok:r.ok,reason:r.reason};if(r.ok)sm=r.sm;}
  const rel=SM.processReleases(sm,releaseDocs,{trustedK2,environment,now,seq});
  sm=rel.sm;

  const caps=store.capabilities||{};
  const flags={single_use_guaranteed:caps.conditionalPut==='verified'&&caps.consistentRead==='verified',anchors_confirmed:before.confirmed,backup};
  const body={leaves,policies,findings,sm,legal_absent:absent,observed:!carry,sequences:carry?(prevBody?prevBody.sequences:null):absent?null:state.sequences,
    attachments,all_attachments:allAttachments};
  const w1=await C.writeCheckpoint(store,{seq,prevHeader:head,body,k1,k7,createdAt:now.toISOString(),runId,flags,ageRecipientsFile});
  if(!w1.ok)return fail('write',w1.error,{conflict:Boolean(w1.conflict)});
  let last=w1.header;
  if(hooks.afterWrite)await hooks.afterWrite(seq);

  let consumed=[];
  if(sm.releases.some(r=>r.state==='consumption_pending')){
    const c=SM.completePending(sm,{seq:seq+1,now});
    sm=c.sm;consumed=c.done;
    const w2=await C.writeCheckpoint(store,{seq:seq+1,prevHeader:last,body:{...body,findings:[],sm,attachments:[]},k1,k7,createdAt:now.toISOString(),runId,
      flags:{...flags,anchors_confirmed:{}},ageRecipientsFile});
    if(!w2.ok)return fail('write',w2.error,{conflict:Boolean(w2.conflict),pending:true});
    last=w2.header;
    if(hooks.afterWrite)await hooks.afterWrite(seq+1);
  }

  const sha=C.headerSha(last);
  const anchorErrors=[];
  for(const a of anchors){try{await a.put(last.seq,sha);}catch(e){anchorErrors.push(a.name+': '+e.message);}}
  const after=await checkAnchors(anchors,[...headers,...(last.seq>seq?[w1.header,last]:[last])]);
  return {
    ok:true,seq:last.seq,header:last,sha,findings,blocking:E.blocking(findings),releases:rel.log,consumed,waiver:waiverResult,
    openEvents:SM.openCount(sm),events:sm.events,anchorsOk:after.ok&&!anchorErrors.length,anchorProblems:[...after.problems,...anchorErrors],
    singleUseGuaranteed:flags.single_use_guaranteed,
  };
}

module.exports={advance,checkAnchors};

/** B7-A3: olaylar, K2 serbest bırakmaları ve K6 muafiyetleri için durum makinesi.
 * Durumun TEK kaynağı imzalı kontrol noktası zinciridir (checkpoint.cjs): bu modül saf fonksiyonlardan oluşur, yalnız
 * önceki gövdedeki durumdan yeni durumu üretir; hiçbir şeyi kendi başına saklamaz.
 *
 * Olay türleri
 *   integrity, legal_regression  yalnız geçerli bir K2 serbest bırakma belgesiyle kapanır
 *   preflight_waivable           neden ortadan kalkınca kapanır; o sürede her çalışma tek kullanımlık K6 muafiyetiyle
 *                                ilerleyebilir; 7 günü aşarsa muafiyet kabul edilmez, yalnız K2 ile kapanır
 * Olay kimliği rastgele UUIDv4'tür ve açıldığı kontrol noktasına bağlanır:
 *   binding = sha256(canonical{event_id,type,opened_seq,opened_prev_sha256,findings_sha256})
 * Bu bağ açılış kontrol noktasının imzalı gövdesinde (events kökü başlıkta) durur.
 *
 * Serbest bırakma belgesi (K2 imzalı, alan adı nakgo-legal-release/v1):
 *   {version:1, release_id, event_id, event_binding, scope:{type,findings_sha256}, reason, environment,
 *    not_before, not_after, key_id, signature}
 * Durumlar: issued (gelen kutusunda, zincirde yok) → validated (bu çalışmada doğrulandı) → consumption_pending
 * (kontrol noktası N'ye yazıldı) → consumed (N+1'e yazıldı, olay kapandı) | rejected (gerekçesiyle).
 * consumption_pending'de çöken çalışmayı sonraki çalışma tamamlar; aynı belge ikinci kez consumed olamaz.
 * Tek kullanımlılık, zincirin tek doğrusal kalmasına (her sıra numarasının bir kez yazılabilmesine) dayanır; bu da
 * deponun koşullu yazmasının gerçekten çalışmasını gerektirir. Kanıtlanana kadar single_use_guaranteed=false. */
'use strict';
const {sha256Json,verify,isUuidV4,randomUUID}=require('./crypto.cjs');

const RELEASE_NS='nakgo-legal-release/v1';
const MAX_RELEASE_WINDOW_MS=72*3600*1000;
const WAIVER_STREAK_MS=7*86400*1000;
const RELEASE_TYPES=['integrity','legal_regression'];

const empty=()=>({events:[],releases:[],waivers:[]});
const clone=sm=>JSON.parse(JSON.stringify(sm||empty()));
const findingKey=f=>`${f.code}|${f.table}|${f.id}`;
const bindingOf=e=>sha256Json({event_id:e.event_id,type:e.type,opened_seq:e.opened_seq,opened_prev_sha256:e.opened_prev_sha256,findings_sha256:e.findings_sha256});

function newEvent(type,{seq,prevSha,now,uuid=randomUUID},findingsSha,keys){
  const e={event_id:uuid(),type,opened_seq:seq,opened_prev_sha256:prevSha||null,opened_at:now.toISOString(),findings_sha256:findingsSha,finding_keys:keys,status:'open'};
  if(!isUuidV4(e.event_id))throw Error('olay kimliği UUIDv4 değil');
  e.binding=bindingOf(e);
  return e;
}

/** Engelleyici bulgulardan olay açar. Açık bir olayın zaten kapsadığı bulgu yeni olay açmaz. */
function openEvents(sm0,findings,ctx){
  const sm=clone(sm0);
  for(const type of RELEASE_TYPES){
    const covered=new Set(sm.events.filter(e=>e.status==='open'&&e.type===type).flatMap(e=>e.finding_keys));
    const fresh=findings.filter(f=>f.severity===type).map(findingKey).filter(k=>!covered.has(k));
    const keys=[...new Set(fresh)].sort();
    if(keys.length)sm.events.push(newEvent(type,ctx,sha256Json(keys),keys));
  }
  return sm;
}

/** A1 değerlendirmesine göre ön kontrol olayını yönetir: stop_waivable → olay (yoksa) açılır; ok → açık olay kapanır. */
function preflight(sm0,evaluation,ctx){
  const sm=clone(sm0);
  const open=sm.events.filter(e=>e.status==='open'&&e.type==='preflight_waivable');
  if(evaluation.decision==='ok'){for(const e of open)Object.assign(e,{status:'closed',closed_seq:ctx.seq,closed_reason:'resolved'});return sm;}
  if(evaluation.decision==='stop_waivable'&&!open.some(e=>e.findings_sha256===evaluation.waivable_diff_sha256))
    sm.events.push(newEvent('preflight_waivable',ctx,evaluation.waivable_diff_sha256,[]));
  for(const e of sm.events)if(e.status==='open'&&e.type==='preflight_waivable'&&ctx.now-new Date(e.opened_at)>WAIVER_STREAK_MS)e.escalated=true;
  return sm;
}

/** K6 muafiyetini tek kullanımlık olarak tüketir. validation: waiver.validateWaiver sonucu (ok olmalı). */
function consumeWaiver(sm0,doc,validation,ctx){
  const sm=clone(sm0);
  const reject=reason=>({sm,ok:false,reason});
  if(!validation||!validation.ok)return reject('muafiyet doğrulanmadı: '+(validation&&validation.reason));
  if(sm.waivers.some(w=>w.waiver_id===doc.waiver_id))return reject('muafiyet daha önce kullanıldı');
  const e=sm.events.find(x=>x.event_id===doc.event_id);
  if(!e||e.status!=='open'||e.type!=='preflight_waivable')return reject('muafiyet açık bir ön kontrol olayına bağlı değil');
  if(e.findings_sha256!==doc.diff_sha256)return reject('muafiyet olayın farkına bağlı değil');
  if(e.escalated||ctx.now-new Date(e.opened_at)>WAIVER_STREAK_MS)return reject('olay 7 günü aştı; yalnız K2 serbest bırakmasıyla kapanır');
  sm.waivers.push({waiver_id:doc.waiver_id,event_id:e.event_id,doc_sha256:sha256Json(doc),state:'consumed',seq:ctx.seq,at:ctx.now.toISOString()});
  return {sm,ok:true};
}

/** Tek bir serbest bırakma belgesinin biçim, imza, kapsam ve süre denetimi (tekrar kullanım ayrıca bakılır). */
function validateRelease(doc,{sm,trustedK2,environment,now}){
  const no=reason=>({ok:false,reason});
  const v=verify(RELEASE_NS,doc,trustedK2);
  if(!v.ok)return no('imza: '+v.reason);
  if(doc.version!==1)return no('sürüm');
  if(!isUuidV4(doc.release_id)||!isUuidV4(doc.event_id))return no('kimlikler UUIDv4 değil');
  if(!environment||doc.environment!==environment)return no('ortam uyuşmuyor');
  if(typeof doc.reason!=='string'||doc.reason.trim().length<10)return no('gerekçe en az 10 karakter');
  const e=sm.events.find(x=>x.event_id===doc.event_id);
  if(!e)return no('olay zincirde yok');
  if(e.status!=='open')return no('olay açık değil');
  const closable=RELEASE_TYPES.includes(e.type)||(e.type==='preflight_waivable'&&e.escalated);
  if(!closable)return no('bu olay türü serbest bırakmayla kapanmaz');
  if(doc.event_binding!==e.binding)return no('olay bağı uyuşmuyor');
  if(!doc.scope||doc.scope.type!==e.type||doc.scope.findings_sha256!==e.findings_sha256)return no('kapsam olayla uyuşmuyor');
  const nb=Date.parse(doc.not_before),na=Date.parse(doc.not_after);
  if(!Number.isFinite(nb)||!Number.isFinite(na)||na<=nb)return no('geçerlilik aralığı bozuk');
  if(na-nb>MAX_RELEASE_WINDOW_MS)return no('geçerlilik 72 saati aşıyor');
  if(nb<Date.parse(e.opened_at))return no('belge olay açılmadan önce geçerli; eski belge yeni olayı kapatamaz');
  if(now<nb||now>na)return no('geçerlilik dışında');
  return {ok:true,event:e};
}

/** Gelen belgeleri işler. Aynı olay için birden çok geçerli belge varsa HEPSİ reddedilir ve olay açık kalır. */
function processReleases(sm0,docs,{trustedK2,environment,now,seq}){
  const sm=clone(sm0);const log=[];
  const reject=(doc,reason)=>{
    const id=isUuidV4(doc&&doc.release_id)&&verify(RELEASE_NS,doc,trustedK2).ok?doc.release_id:null;
    const rec={release_id:id,doc_sha256:sha256Json(doc||null),event_id:doc&&doc.event_id||null,state:'rejected',reason,seq,at:now.toISOString()};
    if(!sm.releases.some(r=>r.doc_sha256===rec.doc_sha256&&r.state==='rejected'))sm.releases.push(rec);
    log.push({release_id:id,state:'rejected',reason});
  };
  const valid=[];
  for(const doc of docs){
    // Zincirde bir kez görünen release_id (hangi durumda olursa olsun) bir daha kabul edilmez; yalnız aynı belgenin
    // bekleyen tüketimi kurtarma olarak sürer.
    const known=sm.releases.find(r=>r.release_id&&doc&&r.release_id===doc.release_id);
    if(known){
      if(known.state==='consumption_pending'&&known.doc_sha256===sha256Json(doc)){log.push({release_id:known.release_id,state:'consumption_pending',reason:'kurtarma'});continue;}
      reject(doc,{consumed:'belge daha önce kullanıldı',rejected:'belge daha önce reddedildi'}[known.state]||'aynı kimlikli başka belge');continue;
    }
    const v=validateRelease(doc,{sm,trustedK2,environment,now});
    if(!v.ok){reject(doc,v.reason);continue;}
    log.push({release_id:doc.release_id,state:'validated'});
    valid.push(doc);
  }
  const byEvent=new Map();
  for(const d of valid)byEvent.set(d.event_id,[...(byEvent.get(d.event_id)||[]),d]);
  for(const [eventId,list] of byEvent){
    const pending=sm.releases.some(r=>r.event_id===eventId&&r.state==='consumption_pending');
    if(list.length>1||pending){for(const d of list)reject(d,list.length>1?'aynı olay için birden çok geçerli belge':'olayın bekleyen başka bir belgesi var');continue;}
    const d=list[0];
    sm.releases.push({release_id:d.release_id,doc_sha256:sha256Json(d),event_id:eventId,state:'consumption_pending',pending_seq:seq,validated_at:now.toISOString()});
    log.push({release_id:d.release_id,state:'consumption_pending'});
  }
  return {sm,log};
}

/** consumption_pending → consumed; olay kapanır. Olay artık açık değil ya da bağ değişmişse belge reddedilir. */
function completePending(sm0,{seq,now}){
  const sm=clone(sm0);const done=[];
  for(const r of sm.releases.filter(x=>x.state==='consumption_pending')){
    const e=sm.events.find(x=>x.event_id===r.event_id);
    if(!e||e.status!=='open'||bindingOf(e)!==e.binding){Object.assign(r,{state:'rejected',reason:'olay kapanmış ya da bağ bozulmuş',seq});continue;}
    Object.assign(r,{state:'consumed',consumed_seq:seq,consumed_at:now.toISOString()});
    Object.assign(e,{status:'closed',closed_seq:seq,closed_by_release:r.release_id});
    done.push(r.release_id);
  }
  return {sm,done};
}

/** Olay bağlarının ve kayıtların iç tutarlılığı (gövde açıldıktan sonra). Bozuksa zincire güvenilmez. */
function selfCheck(sm){
  const problems=[];
  for(const e of sm.events)if(bindingOf(e)!==e.binding)problems.push('olay bağı bozuk: '+e.event_id);
  const consumed=sm.releases.filter(r=>r.state==='consumed').map(r=>r.release_id);
  if(new Set(consumed).size!==consumed.length)problems.push('aynı belge iki kez tüketilmiş');
  for(const e of sm.events.filter(x=>x.status==='closed'&&x.closed_by_release))
    if(!sm.releases.some(r=>r.release_id===e.closed_by_release&&r.state==='consumed'&&r.event_id===e.event_id))problems.push('kapanış belgesi yok: '+e.event_id);
  const w=sm.waivers.map(x=>x.waiver_id);
  if(new Set(w).size!==w.length)problems.push('aynı muafiyet iki kez kullanılmış');
  return problems;
}

const openCount=sm=>sm.events.filter(e=>e.status==='open').length;

module.exports={RELEASE_NS,MAX_RELEASE_WINDOW_MS,WAIVER_STREAK_MS,empty,openEvents,preflight,consumeWaiver,validateRelease,processReleases,completePending,selfCheck,openCount,bindingOf,findingKey};

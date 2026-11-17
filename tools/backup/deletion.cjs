/** B7-A2: kapılı silme (D1: R2 yaşam döngüsüyle otomatik silme YOK; silme yalnız buradan).
 *
 * plan() fail-closed çalışır. Silmeye izin için HEPSİ gerekli:
 *   gate.enabled               otomatik silme açıkça etkin (varsayılan KAPALI; K3 kanıtı ve ayrı onay olmadan açılmaz)
 *   gate.capabilityVerified    deponun koşullu yazma / tutarlı okuma / kilit davranışı gerçek ortamda kanıtlandı (K3)
 *   gate.openEvents===0        imzalı zincirde açık durdurma olayı yok (A3)
 *   gate.anchorsOk             son durumu yetkilendiren kontrol noktası dış çapaya yazıldı (A3/A4)
 * Kova kilidi ayrıca bağımsız bir sınırdır: kilit süresi dolmamış nesne silinemez (depo 403 döner); bu kod kilidi aşamaz.
 * Silme tekrar edilebilir: olmayan nesne "zaten silinmiş" sayılır. Her sonuç bir sonraki kontrol noktasına yazılır. */
'use strict';
const DAY=86400000;

function plan({objects,now=new Date(),retentionDays=15,gate={}}){
  const blockers=[];
  if(gate.enabled!==true)blockers.push('otomatik silme kapalı (K3 kanıtı ve ayrı onay gerekli)');
  if(gate.capabilityVerified!==true)blockers.push('depo davranışı gerçek ortamda doğrulanmadı (V1–V3)');
  if(!(gate.openEvents===0))blockers.push('açık durdurma olayı var ya da durum bilinmiyor');
  if(gate.anchorsOk!==true)blockers.push('dış çapa eksik');
  const due=objects.filter(o=>now.getTime()-new Date(o.last_modified).getTime()>retentionDays*DAY).map(o=>o.key).sort();
  return blockers.length?{allowed:false,blockers,due,delete:[]}:{allowed:true,blockers:[],due,delete:due};
}

async function execute(store,p){
  const log=[];
  for(const key of p.delete){
    try{const r=await store.delete(key);log.push({key,status:r.ok?(r.status===404?'already_deleted':'deleted'):'refused',http:r.status});}
    catch(e){log.push({key,status:'error',error:e.message});}
  }
  return log;
}

module.exports={plan,execute};

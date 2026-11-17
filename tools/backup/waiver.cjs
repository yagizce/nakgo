/** B7-A1: K6 muafiyet belgesinin doğrulanması.
 *
 * K6, gerçek elle döküm ya da postgres ile güvenlik kontrolünü atlama yolu DEĞİLDİR. Yalnız şu durumda işe yarar:
 * privilege-audit "stop_waivable" kararı verdi (izin listesinde olmayan ya da değişmiş, çağrılabilir SECURITY DEFINER
 * fonksiyon) ve proje sahibi bu FARKIN TAMAMINI, çevrim dışı K2 anahtarıyla, kısa süreli ve tek kullanımlık olarak
 * muaf tuttu. Muafiyet izin listesini değiştirmez.
 *
 * Varsayılan KAPALI: options.enabled===true ve belge ile seçeneklerdeki environment aynı olmadıkça hiçbir belge geçmez.
 * Production iş akışı enabled=false ile çalışır; açılması ayrı onaydır. Tek kullanımlılık burada değil, imzalı kontrol
 * noktası zincirindeki durum makinesinde (tools/backup/state-machine.cjs) sağlanır.
 *
 * Asla muaf tutulamayanlar (evaluation.nonwaivable dolu ise belge ne olursa olsun reddedilir): yedek rolüne SELECT dışı
 * yetki, üyelik, CREATE, rol özelliği değişikliği. Ayrıca TLS/hedef sunucu, alıcı anahtar parmak izi, imza/zincir ve
 * geri yükleme testi (S1) hataları bu mekanizmanın kapsamı dışındadır; o aşamalar muafiyete hiç bakmaz. */
'use strict';
const {verify,isUuidV4,canonical}=require('./crypto.cjs');
const NAMESPACE='nakgo-backup-waiver/v1';
const MAX_WINDOW_MS=48*3600*1000;

function validateWaiver(doc,{enabled=false,environment,trustedKeys={},now=new Date(),evaluation}={}){
  const no=reason=>({ok:false,reason});
  if(!enabled)return no('K6 muafiyeti kapalı');
  if(!evaluation)return no('denetim sonucu yok');
  if(evaluation.nonwaivable&&evaluation.nonwaivable.length)return no('muaf tutulamayan bulgu var: '+evaluation.nonwaivable.map(x=>x.code).join(','));
  if(evaluation.decision!=='stop_waivable')return no('muafiyet gerektiren bir fark yok');
  if(!doc||doc.version!==1)return no('belge sürümü geçersiz');
  const sig=verify(NAMESPACE,doc,trustedKeys);
  if(!sig.ok)return no(sig.reason);
  if(!environment||doc.environment!==environment)return no('ortam uyuşmuyor: '+doc.environment);
  if(!isUuidV4(doc.waiver_id))return no('waiver_id rastgele UUIDv4 olmalı');
  if(!isUuidV4(doc.event_id))return no('event_id rastgele UUIDv4 olmalı');
  if(typeof doc.reason!=='string'||doc.reason.trim().length<10)return no('gerekçe eksik');
  if(doc.diff_sha256!==evaluation.waivable_diff_sha256)return no('belge bu farkı kapsamıyor (diff hash uyuşmuyor)');
  const want=canonical([...evaluation.waivable].map(w=>({id:w.id,fingerprint_sha256:w.fingerprint_sha256})).sort((a,b)=>a.id<b.id?-1:1));
  const got=canonical([...(doc.covers||[])].sort((a,b)=>a.id<b.id?-1:1));
  if(want!==got)return no('kapsanan fonksiyon listesi farkla birebir aynı değil');
  const issued=Date.parse(doc.issued_at),until=Date.parse(doc.not_after);
  if(!Number.isFinite(issued)||!Number.isFinite(until))return no('tarih alanları geçersiz');
  if(until-issued>MAX_WINDOW_MS)return no('geçerlilik süresi 48 saati aşıyor');
  if(now.getTime()<issued)return no('belge henüz geçerli değil');
  if(now.getTime()>until)return no('belgenin süresi dolmuş');
  return {ok:true,waiver_id:doc.waiver_id,event_id:doc.event_id};
}

module.exports={NAMESPACE,MAX_WINDOW_MS,validateWaiver};

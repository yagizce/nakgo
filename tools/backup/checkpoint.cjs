/** B7-A3: K1 imzalı kontrol noktası zinciri — yasal kanıtın ve olay/serbest bırakma durumunun TEK doğruluk kaynağı.
 *
 * Her kontrol noktası iki nesnedir:
 *   audit/checkpoints/<seq 12 hane>.body.<gövde sha ilk 16>   şifreli gövde: tam yaprak listeleri, politikalar,
 *                                                            retention_runs, bulgular, olaylar, serbest bırakmalar
 *   audit/checkpoints/<seq 12 hane>.json                      açık başlık (K1 imzalı): sıra, önceki başlığın hash'i,
 *                                                            gövde hash'i, kökler, sayılar, olay özeti, bayraklar
 * İkisi de "yoksa yaz" (If-None-Match) ile yazılır; aynı sırayı iki çalışma yazamaz — bu garanti yalnız deponun koşullu
 * yazması gerçekten çalışıyorsa geçerlidir (V1). Doğrulanana kadar başlıkta single_use_guaranteed=false yazılır.
 *
 * Gövde gizliliği: AES-256-GCM, rastgele veri anahtarı. Veri anahtarı K7 (yalnız CI'da duran 32 baytlık gizli anahtar)
 * ile ve çevrim dışı age alıcılarına (A, B) sarılır. K7 kaybolursa gövde age ile açılır ve veri anahtarı yeni K7 ile
 * ayrı bir "rewrap" nesnesine sarılır (rewrapWithAge); kilitli gövde değişmez. Rotasyon: k7 = [yeni, ...eski]. Açık başlıkta kişisel veri,
 * kimlik ya da gün yoktur; yalnız kökler ve sayılar vardır. Ek bilgi (AAD) = sıra + önceki başlık hash'i: gövde başka bir
 * kontrol noktasına taşınamaz. */
'use strict';
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {canonical,sha256,sha256Json,sign,verify}=require('./crypto.cjs');
const merkle=require('./merkle.cjs');
const {LISTS}=require('./legal-evidence.cjs');

const NAMESPACE='nakgo-legal-checkpoint/v1';
const PREFIX='audit/checkpoints/';
const pad=seq=>String(seq).padStart(12,'0');
const headerKey=seq=>PREFIX+pad(seq)+'.json';
const bodyKey=(seq,sha)=>PREFIX+pad(seq)+'.body.'+sha.slice(0,16);
const k7Id=k7=>sha256(Buffer.concat([Buffer.from('nakgo-k7-id\n'),k7])).slice(0,16);
const aadOf=(seq,prevSha)=>Buffer.from(`nakgo-checkpoint-body/v1\n${seq}\n${prevSha||''}`);

function gcm(key,data,aad){
  const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(aad);
  const ct=Buffer.concat([c.update(data),c.final()]);
  return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ct:ct.toString('base64')};
}
function ungcm(key,{iv,tag,ct},aad){
  const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAAD(aad);d.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([d.update(Buffer.from(ct,'base64')),d.final()]);
}

/** Gövdeyi şifreler. k7: 32 baytlık Buffer. ageRecipientsFile verilirse veri anahtarı age ile de sarılır. */
function sealBody(body,{k7:k7in,seq,prevSha,ageRecipientsFile,ageBin='age'}){
  const k7=Array.isArray(k7in)?k7in[0]:k7in;
  if(!Buffer.isBuffer(k7)||k7.length!==32)throw Error('K7 32 baytlık anahtar olmalı');
  const dek=crypto.randomBytes(32),aad=aadOf(seq,prevSha);
  const wraps=[{kind:'k7',key_id:k7Id(k7),...gcm(k7,dek,aad)}];
  if(ageRecipientsFile){
    const r=spawnSync(ageBin,['-a','-R',ageRecipientsFile],{input:dek});
    if(r.status!==0)throw Error('age sarma başarısız: '+String(r.stderr).trim());
    wraps.push({kind:'age',armored:String(r.stdout)});
  }
  const obj={v:1,alg:'AES-256-GCM',wraps,...gcm(dek,Buffer.from(canonical(body)),aad)};
  dek.fill(0);
  return Buffer.from(canonical(obj));
}
/** K7 anahtar halkası: tek Buffer ya da [güncel, ...eski] dizisi. Yazma her zaman güncel (ilk) anahtarla yapılır;
 * okuma halkadaki herhangi bir anahtarla. Rotasyonda eski anahtar, onunla sarılmış gövdeler okunabilsin diye halkada kalır. */
const ring=k7=>(Array.isArray(k7)?k7:[k7]).filter(k=>Buffer.isBuffer(k)&&k.length===32);
const decryptWith=(obj,dek,aad)=>{try{return JSON.parse(String(ungcm(dek,obj,aad)));}finally{dek.fill(0);}};

/** extraWraps: gövde dışında saklanan yeniden sarma kayıtları (rewrap). Yanlış ya da sahte bir sarma yalnız çözmeyi
 * başarısız kılar; içerik bütünlüğü GCM etiketi ve imzalı başlıktaki gövde hash'iyle korunur. */
function openBody(bytes,{k7,seq,prevSha,extraWraps=[]}){
  const obj=JSON.parse(String(bytes));const aad=aadOf(seq,prevSha);
  const keys=ring(k7);
  for(const w of [...obj.wraps,...extraWraps].filter(x=>x.kind==='k7')){
    const key=keys.find(k=>k7Id(k)===w.key_id);
    if(key)return decryptWith(obj,ungcm(key,w,aad),aad);
  }
  throw Error('gövde bu K7 halkasıyla sarılmamış');
}

/** Kurtarma: K7 kaybolduğunda gövde, çevrim dışı age kimliğiyle (A ya da B) açılır. */
function openBodyWithAge(bytes,{identityFile,seq,prevSha,ageBin='age'}){
  const obj=JSON.parse(String(bytes));
  const w=obj.wraps.find(x=>x.kind==='age');
  if(!w)throw Error('gövdede age sarması yok');
  const r=spawnSync(ageBin,['-d','-i',identityFile],{input:w.armored});
  if(r.status!==0)throw Error('age ile açılamadı');
  return decryptWith(obj,Buffer.from(r.stdout),aadOf(seq,prevSha));
}

/** Kurtarma/rotasyon: age kimliğiyle açılan veri anahtarını YENİ K7 ile sarar. Gövde (kilitli) değişmez; sonuç ayrı bir
 * nesne olarak yazılır: audit/checkpoints/<seq>.rewrap.<yeni K7 kimliği>. Bu işlem çevrim dışı makinede yapılır. */
function rewrapWithAge(bytes,{identityFile,newK7,seq,prevSha,ageBin='age'}){
  const obj=JSON.parse(String(bytes));
  const w=obj.wraps.find(x=>x.kind==='age');
  if(!w)throw Error('gövdede age sarması yok');
  const r=spawnSync(ageBin,['-d','-i',identityFile],{input:w.armored});
  if(r.status!==0)throw Error('age ile açılamadı');
  const dek=Buffer.from(r.stdout);
  try{decryptWith(obj,Buffer.from(dek),aadOf(seq,prevSha));return {kind:'k7',key_id:k7Id(newK7),...gcm(newK7,dek,aadOf(seq,prevSha))};}
  finally{dek.fill(0);}
}
const rewrapKey=(seq,k7)=>PREFIX+pad(seq)+'.rewrap.'+k7Id(k7);

const headerSha=h=>sha256Json(h);

/** Başlığı gövdeden türetir; kökler ve sayılar gövdedeki tam listelerden hesaplanır (başlık listeye bağlıdır). */
function makeHeader({seq,prevHeader,body,bodyBytes,createdAt,runId,flags}){
  const leaves=body.leaves;
  return {
    version:1,seq,prev_sha256:prevHeader?headerSha(prevHeader):null,created_at:createdAt,run_id:runId,
    body_key:bodyKey(seq,sha256(bodyBytes)),body_sha256:sha256(bodyBytes),
    roots:Object.fromEntries(LISTS.map(k=>[k,merkle.root(leaves[k].map(canonical))])),
    counts:Object.fromEntries(LISTS.map(k=>[k,leaves[k].length])),
    policy_set_sha256:sha256Json(body.policies),retention_runs_sha256:sha256Json(leaves.runs),
    findings_sha256:sha256Json(body.findings),
    events:{open:body.sm.events.filter(e=>e.status==='open').length,root:sha256Json(body.sm.events)},
    releases_sha256:sha256Json(body.sm.releases),waivers_sha256:sha256Json(body.sm.waivers),
    legal_absent:Boolean(body.legal_absent),observed:body.observed!==false,
    attachments_sha256:sha256Json(body.attachments||[]),
    single_use_guaranteed:flags.single_use_guaranteed===true,
    anchors_confirmed:flags.anchors_confirmed||{},
    backup:flags.backup||null,
  };
}

/** Kontrol noktasını yazar: önce gövde, sonra imzalı başlık; ikisi de "yoksa yaz". Yazılanı geri okuyup karşılaştırır.
 * Dönüş: {ok:true,header,sha} | {ok:false,conflict|error}. Çakışmada (412) hiçbir şey kabul edilmez. */
async function writeCheckpoint(store,{seq,prevHeader,body,k1,k7,createdAt,runId,flags={},ageRecipientsFile}){
  const prevSha=prevHeader?headerSha(prevHeader):null;
  const bodyBytes=sealBody(body,{k7,seq,prevSha,ageRecipientsFile});
  const header=sign(NAMESPACE,makeHeader({seq,prevHeader,body,bodyBytes,createdAt,runId,flags}),k1.privateKey,k1.keyId);
  const hb=Buffer.from(canonical(header));
  try{
    const b=await store.put(header.body_key,bodyBytes,{ifNoneMatch:true});
    if(!b.ok)return {ok:false,conflict:b.status===412,error:'gövde yazılamadı: '+b.status};
    const h=await store.put(headerKey(seq),hb,{ifNoneMatch:true});
    if(!h.ok)return {ok:false,conflict:h.status===412,error:'başlık yazılamadı: '+h.status};
    const back=await store.get(headerKey(seq));
    if(!back||!back.equals(hb))return {ok:false,conflict:true,error:'geri okunan başlık farklı (eşzamanlı yazıcı ya da tutarsız okuma)'};
  }catch(e){return {ok:false,error:'yazma hatası: '+e.message};}
  return {ok:true,header,sha:headerSha(header)};
}

/** Zinciri baştan doğrular: her başlığın imzası, kesintisiz sıra, önceki hash bağı. Herhangi bir kusur → ok:false.
 * Yalnız başlıklar okunur; gövde gerektiğinde loadBody ile açılır. */
async function readChain(store,{trustedK1}){
  let objs;
  try{objs=(await store.list(PREFIX)).filter(o=>/\/\d{12}\.json$/.test(o.key)).sort((a,b)=>a.key<b.key?-1:1);}
  catch(e){return {ok:false,reason:'liste okunamadı: '+e.message};}
  const headers=[];
  for(const [i,o] of objs.entries()){
    let h;
    try{h=JSON.parse(String(await store.get(o.key)));}catch(e){return {ok:false,reason:'başlık okunamadı: '+o.key};}
    const v=verify(NAMESPACE,h,trustedK1);
    if(!v.ok)return {ok:false,reason:`başlık ${o.key}: ${v.reason}`};
    if(h.seq!==i+1||o.key!==headerKey(h.seq))return {ok:false,reason:'sıra kesintili ya da ad uyumsuz: '+o.key};
    const want=i?headerSha(headers[i-1]):null;
    if(h.prev_sha256!==want)return {ok:false,reason:'önceki hash bağı kopuk: seq '+h.seq};
    headers.push(h);
  }
  return {ok:true,headers,head:headers[headers.length-1]||null};
}

/** Gövdeyi açar ve başlıktaki kökler/sayılar/özetlerle birebir karşılaştırır. */
async function loadBody(store,header,{k7,prevHeader}){
  const bytes=await store.get(header.body_key);
  if(!bytes)throw Error('gövde yok: '+header.body_key);
  if(sha256(bytes)!==header.body_sha256)throw Error('gövde hash uyuşmuyor');
  const extraWraps=[];
  for(const key of ring(k7)){
    const w=await store.get(rewrapKey(header.seq,key));
    if(w){try{extraWraps.push(JSON.parse(String(w)));}catch{/* bozuk yeniden sarma yok sayılır; çözme başarısız olur */}}
  }
  const body=openBody(bytes,{k7,seq:header.seq,prevSha:prevHeader?headerSha(prevHeader):null,extraWraps});
  const again=makeHeader({seq:header.seq,prevHeader,body,bodyBytes:bytes,createdAt:header.created_at,runId:header.run_id,
    flags:{single_use_guaranteed:header.single_use_guaranteed,anchors_confirmed:header.anchors_confirmed,backup:header.backup}});
  for(const k of ['roots','counts','policy_set_sha256','retention_runs_sha256','findings_sha256','events','releases_sha256','waivers_sha256','legal_absent','observed','attachments_sha256'])
    if(canonical(again[k])!==canonical(header[k]))throw Error('gövde başlıkla uyuşmuyor: '+k);
  return body;
}

module.exports={NAMESPACE,PREFIX,headerKey,bodyKey,k7Id,sealBody,openBody,openBodyWithAge,rewrapWithAge,rewrapKey,makeHeader,writeCheckpoint,readChain,loadBody,headerSha};

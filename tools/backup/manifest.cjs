/** B7-A2: çalışma manifestosu ve aşama durumları.
 *
 * Aşamalar birbirinden ayrı raporlanır; biri bile "ok" değilse yedek DOĞRULANMIŞ SAYILMAZ:
 *   preflight      yetki denetimi (A1) ve bağlantı kuralları
 *   dump           tutarlı anlık görüntüden döküm
 *   restore_test   S1: düz PostgreSQL'e geri yükleme + bütünlük kontrolleri
 *   legal          yasal kayıt kanıtı (A3); yasal tablolar yoksa "n/a"
 *   encryption     age ile şifreleme + başlık denetimi
 *   upload         nesnenin koşullu yazımı ve geri okunan hash'in eşitliği
 * Manifest imzası (K1) ve manifestin kendisinin yüklenmesi ayrı alanlardır; bir sonraki kontrol noktası bunları kaydeder.
 * Manifestte tablo bazında sayılar YOKTUR (gizli meta veri); onlar şifreli paketin içindeki source.json'dadır. */
'use strict';
const {sign,verify}=require('./crypto.cjs');
const NAMESPACE='nakgo-backup-manifest/v1';
const DATA_STAGES=['preflight','dump','restore_test','legal','encryption','upload'];

function isVerified(stages){
  return DATA_STAGES.every(s=>stages[s]&&(stages[s].status==='ok'||(s==='legal'&&stages[s].status==='n/a')));
}

function buildManifest({runId,createdAt,stages,objectKey,encryption,source}){
  return {
    version:1,run_id:runId,created_at:createdAt,
    stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,{status:v.status,...(v.code?{code:v.code}:{}),...(v.reason?{reason:String(v.reason).slice(0,500)}:{})}])),
    verified:isVerified(stages),
    object_key:objectKey||null,
    ciphertext_sha256:encryption&&encryption.ciphertext_sha256||null,
    size:encryption&&encryption.size||null,
    recipients_sha256:encryption&&encryption.recipients_sha256||null,
    source:source?{taken_at:source.taken_at,server_version:source.server_version,auth_version:source.auth_version,
      table_count:Object.keys(source.counts||{}).length,fingerprint_sha256:source.fingerprint_sha256,s1_open_ms:source.s1_open_ms}:null
  };
}
const signManifest=(m,k1)=>sign(NAMESPACE,m,k1.privateKey,k1.keyId);
const verifyManifest=(m,trusted)=>verify(NAMESPACE,m,trusted);

module.exports={NAMESPACE,DATA_STAGES,isVerified,buildManifest,signManifest,verifyManifest};

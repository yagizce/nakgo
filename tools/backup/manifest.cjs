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
 * Manifestte tablo bazında sayılar YOKTUR (gizli meta veri); onlar şifreli paketin içindeki source.json'dadır.
 * Manifest şifresizdir: aşama nedenleri YALNIZ safeReason'dan geçerek yazılır (ham hata metni yalnız terminale gider). */
'use strict';
const {sign,verify}=require('./crypto.cjs');
const NAMESPACE='nakgo-backup-manifest/v1';
const DATA_STAGES=['preflight','dump','restore_test','legal','encryption','upload'];

function isVerified(stages){
  return DATA_STAGES.every(s=>stages[s]&&(stages[s].status==='ok'||(s==='legal'&&stages[s].status==='n/a')));
}

/** Manifest için hata metni temizleme (tek ve merkezi). pg_restore / pg_dump / doğrulama hataları satır verisi taşıyabilir:
 * tırnak içi değerler, CONTEXT/DETAIL/HINT/QUERY/WHERE/STATEMENT/LINE n/Command was bölümleri, Key (...) ifadeleri,
 * e-posta, UUID, uzun sayı dizileri ve uzun belirteç benzeri dizgiler maskelenir. Her girdide (boş, çok uzun, çok satırlı,
 * dizgi olmayan, JSON'a çevrilemeyen) güvenli bir dizgi döner; çıktı en çok REASON_MAX karakterdir. Önce maskele, sonra kes:
 * kesim maskelenmemiş bir değerin parçasını açığa çıkaramaz. */
const REASON_MAX=500,REASON_INPUT_MAX=20000,MASK='[gizli]';
/** Yapılandırılmış ayrıntıyı (nesne, dizi, JSON metni) "anahtar: değer | …" düz metnine çevirir; tırnak eşleşmesi kaymaz. */
function flatText(v,depth=0){
  if(v===null||v===undefined)return '';
  if(typeof v==='string'){
    if(depth===0&&/^\s*[\[{"]/.test(v)){try{const j=JSON.parse(v);if(typeof j!=='number'&&typeof j!=='boolean')return flatText(j,1);}catch{}}
    return v;
  }
  if(typeof v==='number'||typeof v==='boolean'||typeof v==='bigint')return String(v);
  if(depth>6)return MASK;
  if(Array.isArray(v))return v.slice(0,50).map(x=>flatText(x,depth+1)).join(' | ');
  if(typeof v==='object')return Object.keys(v).slice(0,50).map(k=>k+': '+flatText(v[k],depth+1)).join(' | ');
  return '';
}
function safeReason(input){
  let s;
  try{s=flatText(input);}catch{return '[hata metni okunamadı]';}
  if(typeof s!=='string')return '[hata metni okunamadı]';
  let capped=false;
  if(s.length>REASON_INPUT_MAX){s=s.slice(0,REASON_INPUT_MAX-64);capped=true;}   // kesik son parça hiç yazılmaz
  s=s.replace(/\r?\n|\r/g,' | ').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ')
    // Bölümler bir sonraki " | " ayırıcısına kadar tümüyle maskelenir.
    .replace(/\b(CONTEXT|DETAIL|HINT|QUERY|WHERE|STATEMENT|LINE \d+|Command was)\s*:[^|]*/gi,(m,k)=>k+': '+MASK+' ')
    .replace(/\bKey\s*\([^|]*/g,'Key ('+MASK+') ')
    // Tırnaklar: metindeki İLK tırnaktan SON tırnağa kadar tümü (açgözlü, satır/ayırıcı ötesinde de): değerin içindeki
    // tırnak, satır sonu ya da "|" eşleşmeyi kaydıramaz; tek tırnak varsa metin sonuna kadar. Türkçe kesme işareti
    // (harften sonra gelen ') değer başlangıcı sayılmaz.
    .replace(/"[\s\S]*(?:"|$)/,'"'+MASK+'"')
    .replace(/(?<![\p{L}\p{N}])'[\s\S]*(?:'|$)/u,"'"+MASK+"'")
    .replace(/`[\s\S]*(?:`|$)/,'`'+MASK+'`')
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/gu,'[e-posta]')
    .replace(/\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi,'[uuid]')
    .replace(/[A-Za-z0-9+_=-]{40,}/g,'[uzun-dizgi]')
    .replace(/\+?\d(?:[\s.-]?\d){9,}/g,'[sayı]')
    .replace(/\s+/g,' ').trim();
  const out=[...s];
  return out.length>REASON_MAX?out.slice(0,REASON_MAX-1).join('')+'…':(capped?s+' …':s);
}
const safeCode=c=>typeof c==='string'&&/^[A-Za-z0-9_.:-]{1,64}$/.test(c)?c:'unknown';

function buildManifest({runId,createdAt,stages,objectKey,encryption,source}){
  return {
    version:1,run_id:runId,created_at:createdAt,
    stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>{const reason=v.reason?safeReason(v.reason):'';
      return [k,{status:v.status,...(v.code?{code:safeCode(v.code)}:{}),...(reason?{reason}:{})}];})),
    verified:isVerified(stages),
    object_key:objectKey||null,
    ciphertext_sha256:encryption&&encryption.ciphertext_sha256||null,
    size:encryption&&encryption.size||null,
    recipients_sha256:encryption&&encryption.recipients_sha256||null,
    source:source?{taken_at:source.taken_at,server_version:source.server_version,auth_version:source.auth_version,
      table_count:Object.keys(source.counts||{}).length,fingerprint_sha256:source.fingerprint_sha256,s1_open_ms:source.s1_open_ms,
      ...(source.mode&&source.mode!=='functions'?{mode:source.mode}:{})}:null
  };
}
const signManifest=(m,k1)=>sign(NAMESPACE,m,k1.privateKey,k1.keyId);
const verifyManifest=(m,trusted)=>verify(NAMESPACE,m,trusted);

module.exports={NAMESPACE,DATA_STAGES,isVerified,buildManifest,signManifest,verifyManifest,safeReason,REASON_MAX};

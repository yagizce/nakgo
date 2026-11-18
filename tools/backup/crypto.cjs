/** B7 yedek araçlarının ortak kriptografik yardımcıları. Yalnız Node'un yerleşik crypto modülünü kullanır.
 * - canonical(): anahtarları sıralı, boşluksuz JSON; imza ve hash'ler bu biçim üzerinden alınır.
 * - İmzalar ed25519; her imza bir alan adı etiketiyle (namespace) bağlanır, böylece bir amaç için atılmış imza
 *   başka bir amaçta (ör. muafiyet yerine serbest bırakma) kullanılamaz.
 * - keyId: açık anahtarın (SPKI DER) SHA-256'sının ilk 16 hex karakteri. */
'use strict';
const crypto=require('node:crypto');

function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const sha256Json=value=>sha256(canonical(value));

function keyIdOf(publicKey){
  const key=typeof publicKey==='string'?crypto.createPublicKey(publicKey):publicKey;
  return sha256(key.export({type:'spki',format:'der'})).slice(0,16);
}

/** Yalnız testler için: bellekte geçici anahtar çifti üretir; diske yazmaz. */
function testKeyPair(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const pub=publicKey.export({type:'spki',format:'pem'});
  return {publicKey:pub,privateKey:privateKey.export({type:'pkcs8',format:'pem'}),keyId:keyIdOf(pub)};
}

const payload=(namespace,doc)=>Buffer.from(namespace+'\n'+canonical(doc),'utf8');

/** doc içindeki "signature" alanı hariç her şeyi imzalar ve imzayı ekler. */
function sign(namespace,doc,privateKeyPem,keyId){
  const body={...doc,signature:undefined,sig_alg:'ed25519',key_id:keyId,namespace};
  const sig=crypto.sign(null,payload(namespace,body),crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return {...body,signature:sig};
}

/** İmzayı doğrular. trustedKeys: {key_id: publicKeyPem}. Herhangi bir uyumsuzlukta {ok:false,reason}. */
function verify(namespace,doc,trustedKeys){
  if(!doc||typeof doc!=='object')return {ok:false,reason:'belge yok'};
  if(doc.sig_alg!=='ed25519')return {ok:false,reason:'imza algoritması ed25519 değil'};
  if(doc.namespace!==namespace)return {ok:false,reason:'imza alan adı uyuşmuyor: '+doc.namespace};
  const pem=trustedKeys&&Object.prototype.hasOwnProperty.call(trustedKeys,doc.key_id)?trustedKeys[doc.key_id]:null;
  if(!pem)return {ok:false,reason:'bilinmeyen anahtar: '+doc.key_id};
  if(keyIdOf(pem)!==doc.key_id)return {ok:false,reason:'anahtar kimliği açık anahtarla uyuşmuyor'};
  if(typeof doc.signature!=='string')return {ok:false,reason:'imza yok'};
  let ok=false;
  try{ok=crypto.verify(null,payload(namespace,{...doc,signature:undefined}),crypto.createPublicKey(pem),Buffer.from(doc.signature,'base64'));}catch{ok=false;}
  return ok?{ok:true}:{ok:false,reason:'imza geçersiz'};
}

const isUuidV4=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);

module.exports={canonical,sha256,sha256Json,keyIdOf,testKeyPair,sign,verify,isUuidV4,randomUUID:()=>crypto.randomUUID()};

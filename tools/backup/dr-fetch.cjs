/** B7: felaket kurtarma 2. adımı — yedeği seç, indir ve doğrula (restore-dr.md). ŞİFRE ÇÖZMEZ.
 *
 * Bir manifest için sırayla, biri bile tutmazsa durur:
 *   manifest var ve JSON · K1 imzası güvenilir anahtarla geçerli · verified=true · alıcı listesi hash'i sabitlenenle aynı
 *   · object_key ve run_id manifestin kendi anahtarına bağlı (başka yedeğe yönlendirme yok) · nesne var
 *   · boyut ve SHA-256 manifestle aynı.
 * Geçen şifreli dosya yalnız yeni bir dosyaya (0600, var olanın üzerine yazmaz) kaydedilir. Şifre çözme çevrim dışı
 * makinede, insan tarafından yapılır.
 *
 * latest: manifests/ altında en yeniden eskiye gider. İmzası geçerli ama verified=false olanlar atlanır. Daha yeni bir
 * manifestte imza, bağlama ya da hash sorunu varsa DURUR: önce o incelenmeli; insan isterse --manifest ile seçer.
 *
 * Elle alınan yedekler (K6b, ilk yedek/bootstrap) 'manual/' önekindedir: latest bunları SEÇMEZ ve K1 yolu (fetchVerified)
 * onları reddeder. Yalnız --manifest ile ve fetchManual üzerinden, çevrim dışı K9 zinciriyle doğrulanır
 * (manual-flow.verifyStored: K9 imzaları, güvenilir çapa, ZORUNLU imzalı kayıt, paket hash'i; bekleyen istek varsa bağı,
 * --require-request ile istek yoksa red). --dir ile S3 yerine yerel klasördeki kopya okunur. */
'use strict';
const fs=require('node:fs');
const {verifyManifest}=require('./manifest.cjs');
const {sha256}=require('./crypto.cjs');
const MF=require('./manual-flow.cjs');

const MANIFEST_RE=/^(manual\/)?manifests\/(\d{4}\/\d{2}\/\d{2}\/nakgo-\d{8}T\d{6}Z-([A-Za-z0-9][A-Za-z0-9._-]{0,63}))\.json$/;

async function check(store,manifestKey,{trustedK1,pinnedRecipientsSha256}){
  const m=MANIFEST_RE.exec(manifestKey||'');
  if(!m)return {ok:false,code:'manifest_key',reason:'manifest anahtarı beklenen biçimde değil'};
  if(m[1])return {ok:false,code:'manual_key',reason:'elle alınan yedek yalnız K9 zinciriyle (fetchManual) doğrulanır'};
  const raw=await store.get(manifestKey);
  if(!raw)return {ok:false,code:'manifest_missing',reason:'manifest yok'};
  let doc;try{doc=JSON.parse(raw.toString('utf8'));}catch{return {ok:false,code:'manifest_parse',reason:'manifest JSON değil'};}
  const v=verifyManifest(doc,trustedK1);
  if(!v.ok)return {ok:false,code:'signature',reason:v.reason};
  if(doc.verified!==true)return {ok:false,code:'not_verified',reason:'yedek doğrulanmamış (verified=false)',benign:true};
  if(!/^[0-9a-f]{64}$/.test(pinnedRecipientsSha256||''))return {ok:false,code:'pin',reason:'sabitlenmiş alıcı listesi hash\'i yok'};
  if(doc.recipients_sha256!==pinnedRecipientsSha256)return {ok:false,code:'recipients',reason:'alıcı listesi hash\'i sabitlenenle uyuşmuyor'};
  if(doc.object_key!==(m[1]||'')+'db/'+m[2]+'.tar.age'||doc.run_id!==m[3])return {ok:false,code:'binding',reason:'manifest başka bir nesneye ya da çalışmaya işaret ediyor'};
  if(!/^[0-9a-f]{64}$/.test(doc.ciphertext_sha256||'')||!Number.isSafeInteger(doc.size)||doc.size<=0)return {ok:false,code:'manifest_fields',reason:'hash ya da boyut alanı geçersiz'};
  const body=await store.get(doc.object_key);
  if(!body)return {ok:false,code:'object_missing',reason:'şifreli nesne yok'};
  if(body.length!==doc.size)return {ok:false,code:'size',reason:`boyut farklı (${body.length} ≠ ${doc.size})`};
  if(sha256(body)!==doc.ciphertext_sha256)return {ok:false,code:'sha256',reason:'SHA-256 manifestle uyuşmuyor'};
  return {ok:true,manifest:doc,body};
}

function save(outFile,body){
  const fd=fs.openSync(outFile,'wx',0o600);
  try{fs.writeSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

/** Tek manifest. Dönüş: {ok, code?, reason?, manifest_key, object_key?, size?, ciphertext_sha256?, run_id?} */
async function fetchVerified({store,manifestKey,trustedK1,pinnedRecipientsSha256,outFile}){
  const r=await check(store,manifestKey,{trustedK1,pinnedRecipientsSha256});
  if(!r.ok)return {ok:false,code:r.code,reason:r.reason,manifest_key:manifestKey};
  save(outFile,r.body);
  return {ok:true,manifest_key:manifestKey,object_key:r.manifest.object_key,run_id:r.manifest.run_id,created_at:r.manifest.created_at,
    size:r.manifest.size,ciphertext_sha256:r.manifest.ciphertext_sha256};
}

/** En yeni doğrulanmış yedek. Daha yeni bir manifestte doğrulanmamışlık dışında bir sorun varsa durur. */
async function fetchLatest({store,trustedK1,pinnedRecipientsSha256,outFile}){
  const keys=(await store.list('manifests/')).map(o=>o.key).filter(k=>k.startsWith('manifests/')&&MANIFEST_RE.test(k)).sort().reverse();
  const skipped=[];
  for(const key of keys){
    const r=await check(store,key,{trustedK1,pinnedRecipientsSha256});
    if(r.ok){save(outFile,r.body);return {ok:true,manifest_key:key,object_key:r.manifest.object_key,run_id:r.manifest.run_id,created_at:r.manifest.created_at,
      size:r.manifest.size,ciphertext_sha256:r.manifest.ciphertext_sha256,skipped};}
    skipped.push({manifest_key:key,code:r.code,reason:r.reason});
    if(!r.benign)return {ok:false,code:'integrity',reason:'daha yeni bir manifestte bütünlük sorunu: önce incelenmeli ('+key+': '+r.code+')',skipped};
  }
  return {ok:false,code:'none',reason:'doğrulanmış yedek bulunamadı',skipped};
}

/** Elle yedek (bootstrap, K6b): K9 zinciri. Dönüş: {ok, code?, reason?, manifest_key, ..., request_binding}. */
async function fetchManual({store,manifestKey,config,outFile,requireRequest=false}){
  let v;
  try{v=await MF.verifyStored({store,config,manifestKey,requireRequest});}
  catch(e){return {ok:false,code:e.code||'error',reason:e.message,manifest_key:manifestKey};}
  save(outFile,v.packageBytes);
  return {ok:true,manifest_key:manifestKey,object_key:v.keys.data_key,run_id:v.record.run_id,created_at:v.record.created_at,size:v.record.size,
    ciphertext_sha256:v.record.ciphertext_sha256,request_binding:v.request_binding,level:v.record.offline.level,k9_key_id:v.record.k9_key_id};
}

module.exports={fetchVerified,fetchLatest,fetchManual,MANIFEST_RE};

/* Komut satırı (kurtarma tatbikatı ve felaket):
 *   node tools/backup/dr-fetch.cjs --out DOSYA (--latest | --manifest manifests/....json | --manifest manual/manifests/....json [--require-request]) [--dir KLASÖR]
 * Depo erişimi NAKGO_R2_* ortam değişkenlerinden; güvenilir K1/K9, çapalar ve alıcı hash'i ops/backup/config.json'dan. */
if(require.main===module)(async()=>{
  const path=require('node:path');
  const {S3Store,FileStore}=require('./store.cjs');
  const arg=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:undefined;};
  const out=arg('--out'),manifestKey=arg('--manifest'),latest=process.argv.includes('--latest');
  if(!out||(!manifestKey)===!latest)throw Error('kullanım: --out DOSYA ve --latest ya da --manifest ANAHTAR');
  const env=process.env,need=k=>{if(!env[k])throw Error('eksik ortam değişkeni: '+k);return env[k];};
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','ops/backup/config.json'),'utf8'));
  const dir=arg('--dir'),manual=(manifestKey||'').startsWith('manual/');
  if(manual&&latest)throw Error('elle alınan yedek yalnız --manifest ile seçilir');
  const store=dir?new FileStore({dir}):new S3Store({endpoint:need('NAKGO_R2_ENDPOINT'),bucket:need('NAKGO_R2_BUCKET'),accessKeyId:need('NAKGO_R2_ACCESS_KEY_ID'),secretAccessKey:need('NAKGO_R2_SECRET_ACCESS_KEY')});
  const opts={store,trustedK1:config.trusted_k1,pinnedRecipientsSha256:config.recipients_sha256,outFile:out};
  const r=manual?await fetchManual({store,manifestKey,config,outFile:out,requireRequest:process.argv.includes('--require-request')})
    :latest?await fetchLatest(opts):await fetchVerified({...opts,manifestKey});
  console.log(JSON.stringify(r,null,2));
  process.exitCode=r.ok?0:1;
})().catch(e=>{console.error('kurtarma indirmesi durdu: '+e.message);process.exitCode=1;});

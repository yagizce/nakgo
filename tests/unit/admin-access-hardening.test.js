/* Admin sitesi: bilinmeyen kid anahtar indirmeyi tetikleyemez, sertifika istisnası yalnız tek dosya adıdır. */
module.exports=({test,fs,path,ROOT})=>{
 test('Admin erişimi: anahtar yenileme sınırı ve dar sertifika yolu',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const vm=require('node:vm');
  const code=fs.readFileSync(path.join(ROOT,'middleware.js'),'utf8')
   .replace(/^export default async function /m,'async function ')
   .replace(/^export (async )?function /gm,'$1function ');
  const ctx=vm.createContext({crypto:globalThis.crypto,atob,TextEncoder,TextDecoder,Response,URL,Date,__out:null});
  vm.runInContext(code+'\n;__out={default:middleware,_resetKeyCache};',ctx);
  const mw=ctx.__out;
  const src=fs.readFileSync(path.join(ROOT,'middleware.js'),'utf8');
  const TEAM=src.match(/const TEAM = '([^']+)'/)[1], AUD=src.match(/const AUD = '([^']+)'/)[1];
  const {subtle}=globalThis.crypto;
  const pair=await subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const pub=await subtle.exportKey('jwk',pair.publicKey);
  const b64=b=>Buffer.from(b).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const sign=async(kid)=>{const h=b64(JSON.stringify({alg:'RS256',kid,typ:'JWT'})),p=b64(JSON.stringify({iss:TEAM,aud:[AUD],exp:now+600}));
   return h+'.'+p+'.'+b64(new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(h+'.'+p))));};
  let calls=0, keys=[{...pub,kid:'k1'}];
  const opts={fetcher:async()=>{calls++;return {ok:true,json:async()=>({keys})};}};
  const req=(pathname,headers={})=>new Request('https://admin.nakgolojistik.com'+pathname,{headers:{host:'admin.nakgolojistik.com',...headers}});
  const status=async r=>{const res=await mw.default(r,{},opts);return res.headers.get('x-middleware-next')==='1'?'pass':res.status;};
  mw._resetKeyCache();
  ok(await status(req('/',{'cf-access-jwt-assertion':await sign('k1')}))==='pass','geçerli belge açılır');
  const before=calls;
  for(let i=0;i<5;i++) ok(await status(req('/',{'cf-access-jwt-assertion':await sign('rastgele-'+i)}))===403,'bilinmeyen kid reddedilir');
  ok(calls-before<=1,'bilinmeyen kid en fazla bir kez yenileme yaptırır ('+(calls-before)+')');
  // Gerçek anahtar değişimi yine çalışır (ilk zorla yenileme).
  mw._resetKeyCache(); keys=[{...pub,kid:'k1'}];
  ok(await status(req('/',{'cf-access-jwt-assertion':await sign('k1')}))==='pass','önbellek dolu');
  keys=[{...pub,kid:'k2'}];
  ok(await status(req('/',{'cf-access-jwt-assertion':await sign('k2')}))==='pass','döndürülen anahtar kabul edilir');
  ok(await status(req('/.well-known/acme-challenge/AbC-12_x'))==='pass','sertifika doğrulama dosyası açık');
  ok(await status(req('/.well-known/acme-challenge/..%2findex.html'))===403,'kodlanmış yol ile istisna kullanılamaz');
  ok(await status(req('/.well-known/acme-challenge/a/b'))===403,'alt klasör istisna değildir');
  ok(await status(req('/.well-known/acme-challenge/'))===403,'boş ad istisna değildir');
  return out;
 });
};

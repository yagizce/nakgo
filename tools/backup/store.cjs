/** B7-A2: nesne deposu katmanı.
 *
 * S3Store: R2'nin S3 uyumlu API'si için AWS SigV4 imzalı en küçük istemci (put/get/head/list/delete). Harici paket yok.
 *   put(key, body, {ifNoneMatch:true}) → "yoksa yaz" (If-None-Match: *). Var olan nesnede {ok:false,status:412}.
 * MemoryStore: testler için bellek içi depo. Kilit (lockDays) ve koşullu yazma davranışını SİMÜLE EDER.
 *
 * ÖNEMLİ: Bu taklitlerle geçen testler gerçek R2 davranışını kanıtlamaz. R2'de koşullu PUT (V1), yazdıktan sonra tutarlı
 * okuma/listeleme (V2) ve kova kilidinin silme/üzerine yazmayı engellemesi (V3) B7-B'de K3 test kovasında kanıtlanır.
 * O kanıt gelene kadar capabilities.verified=false kalır ve silme ile tek kullanımlılık garantisi fail-closed çalışır. */
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const sha256hex=b=>crypto.createHash('sha256').update(b).digest('hex');
const hmac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest();
const encSeg=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const encPath=p=>p.split('/').map(encSeg).join('/');

/** SigV4 imzası (testlerdeki taklit sunucu da aynı fonksiyonla doğrular). */
function signV4({method,url,headers,body,accessKeyId,secretAccessKey,region='auto',service='s3',date=new Date()}){
  const u=new URL(url);
  const amzDate=date.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=amzDate.slice(0,8);
  const payloadHash=sha256hex(body||'');
  const h={...headers,host:u.host,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash};
  const names=Object.keys(h).map(k=>k.toLowerCase()).sort();
  const lower=Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),String(v).trim()]));
  const query=[...u.searchParams.entries()].map(([k,v])=>[encSeg(k),encSeg(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(([k,v])=>k+'='+v).join('&');
  const canonical=[method,encPath(decodeURIComponent(u.pathname)),query,names.map(n=>n+':'+lower[n]).join('\n')+'\n',names.join(';'),payloadHash].join('\n');
  const scope=day+'/'+region+'/'+service+'/aws4_request';
  const toSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256hex(canonical)].join('\n');
  const kSigning=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,day),region),service),'aws4_request');
  const signature=crypto.createHmac('sha256',kSigning).update(toSign).digest('hex');
  return {...h,authorization:`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`};
}

/* Geçici hatalar: her istek timeoutMs ile sınırlı; ağ hatası, zaman aşımı, yarım gövde, 5xx ve 429 en çok `retries` kez
 * artan beklemeyle yeniden denenir. 4xx (403 kilit, 412 koşul) asla yeniden denenmez. Hata mesajlarına URL, imza ya da
 * gizli değer yazılmaz. Koşullu PUT yeniden denendiğinde 412 dönerse ilk deneme yerine ulaşmış olabilir: sonuç
 * {ambiguous:true} ile işaretlenir; çağıran içeriği geri okuyup karşılaştırmadan bunu başarı saymamalıdır. */
const nonRetryable=e=>Object.assign(e,{nonRetryable:true});
class S3Store{
  constructor({endpoint,bucket,accessKeyId,secretAccessKey,region='auto',fetchImpl=globalThis.fetch,capabilities={verified:false},
    timeoutMs=120000,retries=3,backoffMs=500,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
    if(!/^https:\/\//.test(endpoint)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(endpoint))throw Error('Depo uç noktası HTTPS olmalı (yalnız testlerde yerel http)');
    Object.assign(this,{endpoint:endpoint.replace(/\/$/,''),bucket,accessKeyId,secretAccessKey,region,fetchImpl,capabilities,timeoutMs,retries,backoffMs,sleep});
  }
  async req(method,key,{body,headers={},query}={}){
    const url=new URL(this.endpoint+'/'+encSeg(this.bucket)+(key!==undefined?'/'+encPath(key):''));
    if(query)for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
    const signed=signV4({method,url:url.toString(),headers,body,accessKeyId:this.accessKeyId,secretAccessKey:this.secretAccessKey,region:this.region});
    delete signed.host;
    return this.fetchImpl(url,{method,headers:signed,body:body??undefined,signal:AbortSignal.timeout(this.timeoutMs)});
  }
  /** İsteği ve gövde okumasını (handle) birlikte yeniden dener. handle(r, attempt) sonucu döner. */
  async call(method,key,opts,handle){
    const label=method+' '+(key??(opts&&opts.query&&opts.query.prefix)??'');
    let last;
    for(let attempt=0;attempt<=this.retries;attempt++){
      if(attempt)await this.sleep(this.backoffMs*2**(attempt-1));
      try{
        const r=await this.req(method,key,opts);
        if(r.status>=500||r.status===429){await r.arrayBuffer().catch(()=>{});last=Error(label+': '+r.status);continue;}
        return await handle(r,attempt);
      }catch(e){
        if(e.nonRetryable)throw e;
        last=Error(label+': '+(e.name==='TimeoutError'||e.name==='AbortError'?'zaman aşımı':'ağ hatası'));
      }
    }
    throw last;
  }
  /** Hesap düzeyinde kova listeleme (ListBuckets). Yalnız yetki ölçümü için: kovaya bağlı belirteçte reddedilmelidir. */
  async listBucketsStatus(){
    const url=new URL(this.endpoint+'/');
    const signed=signV4({method:'GET',url:url.toString(),headers:{},body:'',accessKeyId:this.accessKeyId,secretAccessKey:this.secretAccessKey,region:this.region});
    delete signed.host;
    const r=await this.fetchImpl(url,{method:'GET',headers:signed,signal:AbortSignal.timeout(this.timeoutMs)});
    return r.status;
  }
  async put(key,body,{ifNoneMatch=false}={}){
    return this.call('PUT',key,{body,headers:ifNoneMatch?{'if-none-match':'*'}:{}},async(r,attempt)=>{
      await r.arrayBuffer().catch(()=>{});
      return {ok:r.ok,status:r.status,etag:r.headers.get('etag'),...(ifNoneMatch&&r.status===412&&attempt>0?{ambiguous:true}:{})};
    });
  }
  async get(key){
    return this.call('GET',key,{},async r=>{
      if(r.status===404)return null;
      if(!r.ok)throw nonRetryable(Error('GET '+key+': '+r.status));
      return Buffer.from(await r.arrayBuffer());// yarım gövde burada hata fırlatır ve yeniden denenir
    });
  }
  async head(key){
    return this.call('HEAD',key,{},async r=>{
      if(r.status===404)return null;
      if(!r.ok)throw nonRetryable(Error('HEAD '+key+': '+r.status));
      return {size:Number(r.headers.get('content-length')),last_modified:r.headers.get('last-modified')};
    });
  }
  async list(prefix){
    const out=[];let token;
    do{
      const q={'list-type':'2',prefix};if(token)q['continuation-token']=token;
      const xml=await this.call('GET',undefined,{query:q},async r=>{
        if(!r.ok)throw nonRetryable(Error('LIST '+prefix+': '+r.status));
        return r.text();
      });
      for(const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)){
        const g=t=>(m[1].match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>'))||[])[1];
        out.push({key:g('Key').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),size:Number(g('Size')),last_modified:g('LastModified')});
      }
      token=/<IsTruncated>true<\/IsTruncated>/.test(xml)?(xml.match(/<NextContinuationToken>([^<]*)</)||[])[1]:null;
    }while(token);
    return out;
  }
  async delete(key){return this.call('DELETE',key,{},async r=>{await r.arrayBuffer().catch(()=>{});return {ok:r.ok||r.status===404,status:r.status};});}
}

/** Bellek içi depo; kilit ve koşullu yazma simülasyonu. clock() testte zamanı ilerletmek için. */
class MemoryStore{
  constructor({lockDays=0,lockPrefixes=[],conditionalPut=true,clock=()=>new Date(),capabilities={verified:false}}={}){
    Object.assign(this,{lockDays,lockPrefixes,conditionalPut,clock,capabilities,objects:new Map(),failNext:{}});
  }
  locked(key){
    const o=this.objects.get(key);if(!o)return false;
    if(!this.lockPrefixes.some(p=>key.startsWith(p)))return false;
    return this.clock().getTime()-o.created.getTime()<this.lockDays*86400000;
  }
  async put(key,body,{ifNoneMatch=false}={}){
    if(this.failNext.put){this.failNext.put--;throw Error('simüle edilmiş yazma hatası');}
    if(ifNoneMatch&&this.conditionalPut&&this.objects.has(key))return {ok:false,status:412};
    if(this.locked(key))return {ok:false,status:403};
    this.objects.set(key,{body:Buffer.from(body),created:this.clock()});
    return {ok:true,status:200};
  }
  async get(key){if(this.failNext.get){this.failNext.get--;throw Error('simüle edilmiş okuma hatası');}const o=this.objects.get(key);return o?Buffer.from(o.body):null;}
  async head(key){const o=this.objects.get(key);return o?{size:o.body.length,last_modified:o.created.toISOString()}:null;}
  async list(prefix){return [...this.objects.entries()].filter(([k])=>k.startsWith(prefix)).sort().map(([k,o])=>({key:k,size:o.body.length,last_modified:o.created.toISOString()}));}
  async delete(key){if(!this.objects.has(key))return {ok:true,status:404};if(this.locked(key))return {ok:false,status:403};this.objects.delete(key);return {ok:true,status:204};}
}

/** Yerel klasör deposu: elle alınan yedeklerin (bootstrap, K6b) çevrim dışı ortama yazılması ve oradan okunması için.
 * Atomik yazma: içerik aynı klasörde geçici bir dosyaya tam olarak yazılır ve fsync edilir, sonra hedef ada BAĞLANIR
 * (link: hedef varsa EEXIST → 412, üzerine YAZMAZ; yarım dosya hedef adla hiç görünmez), geçici dosya silinir ve klasör
 * fsync edilir. Dosyalar 0600, klasörler 0700. Silme yoktur.
 * Anahtar biçimi denetlenir: göreli, '..' ve boş parça içermez.
 * probe(): atomik ve üzerine yazmayan yazımın dayandığı hard link'in bu klasörde çalıştığını, HİÇBİR veri yazılmadan ve
 * veritabanına bağlanılmadan önce doğrular. Hard link yoksa (EPERM, ENOTSUP, EOPNOTSUPP, EXDEV, ENOSYS, EACCES...) rename,
 * kopyalama ya da başka bir yönteme geçilmez: depo kullanılamaz sayılır. */
const TMP_PREFIX='.nakgo-tmp-';
const SF=require('./safe-fs.cjs');
const LINK_UNSUPPORTED=['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS','EACCES','EMLINK','EROFS'];
class FileStore{
  constructor({dir,maxBytes=2**31-1}){if(!dir)throw Error('klasör gerekli');this.dir=path.resolve(dir);this.maxBytes=maxBytes;this.capabilities={verified:false};}
  file(key){
    if(typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('geçersiz anahtar');
    return path.join(this.dir,key);
  }
  async put(key,body,{ifNoneMatch=false}={}){
    // Üzerine yazmayan yazım güvenli yoldan (safe-fs: bağlantı, hard link ve yarış denetimli, atomik, üzerine yazmaz).
    if(ifNoneMatch){this.file(key);fs.mkdirSync(this.dir,{recursive:true,mode:0o700});return SF.writeNewAtomic(this.dir,key,body,{tmpPrefix:TMP_PREFIX});}
    const f=this.file(key);const dir=path.dirname(f);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    if(ifNoneMatch&&fs.existsSync(f))return {ok:false,status:412};
    const tmp=path.join(dir,TMP_PREFIX+require('node:crypto').randomBytes(8).toString('hex'));
    const buf=Buffer.from(body);
    try{
      const fd=fs.openSync(tmp,'wx',0o600);
      try{for(let off=0;off<buf.length;)off+=fs.writeSync(fd,buf,off,buf.length-off);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(ifNoneMatch){try{fs.linkSync(tmp,f);}catch(e){if(e.code==='EEXIST')return {ok:false,status:412};throw e;}}
      else fs.renameSync(tmp,f);
    }finally{fs.rmSync(tmp,{force:true});}
    const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
    return {ok:true,status:200};
  }
  /** Güvenli okuma: sembolik bağlantı, hard link, FIFO ve yarış reddedilir (safe-fs). */
  async get(key){this.file(key);if(!fs.existsSync(this.dir))return null;return SF.readFileSafe(this.dir,key,{maxBytes:this.maxBytes,missingOk:true});}
  async head(key){const f=this.file(key);let st;try{st=fs.lstatSync(f);}catch(e){if(e.code==='ENOENT')return null;throw e;}if(!st.isFile())throw Object.assign(Error('normal dosya değil'),{code:'ETYPE'});return {size:st.size,last_modified:st.mtime.toISOString()};}
  async list(prefix){
    const out=[];
    const walk=d=>{if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else out.push(p);}};
    walk(this.dir);
    return out.filter(p=>!path.basename(p).startsWith(TMP_PREFIX)).map(p=>path.relative(this.dir,p).split(path.sep).join('/')).filter(k=>k.startsWith(prefix)).sort()
      .map(k=>{const st=fs.statSync(path.join(this.dir,k));return {key:k,size:st.size,last_modified:st.mtime.toISOString()};});
  }
  async delete(){return {ok:false,status:403};}
  /** Ön kontrol. keys: bu çalışmanın yazacağı nesne anahtarları; her birinin KENDİ klasörü ayrıca denenir (ayrı bağlama
   * noktası ya da farklı dosya sistemi kendi klasöründe yakalanır). Dönüş: {ok:true, dirs} ya da {ok:false, step, code, dir, reason}.
   * Yalnız denemek için oluşturulan klasörler sonunda (başarıda da) silinir; gerçek yazım onları yeniden oluşturur. Deneme
   * dosyaları ve oluşturulan klasörler silinemezse bu da başarısızlıktır (yutulmaz). */
  probe(keys=[]){
    const rel=d=>path.relative(this.dir,d)||'.';
    const created=[];let fail=null,rootDev=null;const done=[];
    try{
      if(!fs.existsSync(this.dir)){const chain=[];for(let x=this.dir;!fs.existsSync(x);x=path.dirname(x))chain.unshift(x);for(const x of chain){fs.mkdirSync(x,{mode:0o700});created.push(x);}}
      rootDev=fs.statSync(this.dir).dev;
      const dirs=[this.dir,...new Set(keys.map(k=>path.dirname(this.file(k))))];
      for(const d of dirs){
        // Eksik ataları kökten başlayarak tek tek oluştur ve kaydet (yalnız bizim oluşturduklarımız silinir).
        const chain=[];for(let x=d;x!==this.dir&&!fs.existsSync(x);x=path.dirname(x))chain.unshift(x);
        for(const x of chain){try{fs.mkdirSync(x,{mode:0o700});created.push(x);}catch(e){fail={ok:false,step:'mkdir',code:e.code||'ERROR',dir:rel(x),reason:`çıktı klasörü ön kontrolü başarısız (mkdir: ${e.code||'ERROR'}) [${rel(x)}]`};break;}}
        if(fail)break;
        const st=fs.statSync(d);
        if(st.dev!==rootDev){fail={ok:false,step:'device',code:'EXDEVICE',dir:rel(d),reason:`çıktı klasörü tek dosya sisteminde değil: ${rel(d)} farklı bir bağlama noktasında`};break;}
        const r=this._probeDir(d);
        if(!r.ok){fail={...r,dir:rel(d),reason:r.reason+' ['+rel(d)+']'};break;}
        done.push(rel(d));
      }
    }catch(e){fail=fail||{ok:false,step:'prepare',code:e.code||'ERROR',reason:`çıktı klasörü ön kontrolü başarısız (prepare: ${e.code||e.message})`};}
    finally{
      const left=[];
      for(const x of created.reverse()){try{fs.rmdirSync(x);}catch(e){left.push(rel(x)+': '+(e.code||e.message));}}
      if(left.length)fail={ok:false,step:'cleanup',code:'ECLEANUP',reason:'ön kontrol klasörleri silinemedi: '+left.join('; ')+(fail?' (önce: '+fail.reason+')':'')};
    }
    return fail||{ok:true,dirs:done};
  }
  /** Tek klasörde: deneme dosyası (fsync) → hard link → aynı dosya mı → klasör fsync; iki dosya her yolda silinir. */
  _probeDir(dir){
    let step='create',fail=null;
    const id=require('node:crypto').randomBytes(8).toString('hex');
    const a=path.join(dir,TMP_PREFIX+'probe-'+id),b=a+'-link';
    try{
      const fd=fs.openSync(a,'wx',0o600);
      try{fs.writeSync(fd,Buffer.from('nakgo-probe\n'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      step='link';fs.linkSync(a,b);
      step='verify';
      const sa=fs.statSync(a),sb=fs.statSync(b);
      if(sa.ino!==sb.ino||sa.dev!==sb.dev||sa.nlink<2)throw Object.assign(Error('bağlantı aynı dosyayı göstermiyor'),{code:'ELINKVERIFY'});
      step='fsync_dir';
      const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
    }catch(e){
      const code=e&&e.code||'ERROR';
      fail={ok:false,step,code,reason:step==='link'&&LINK_UNSUPPORTED.includes(code)
        ?`çıktı klasörü hard link desteklemiyor (${code}); atomik ve üzerine yazmayan yazım yapılamaz`
        :`çıktı klasörü ön kontrolü başarısız (${step}: ${code})`};
    }finally{
      const left=[];
      for(const f of [b,a]){try{fs.rmSync(f,{force:true});}catch(e){left.push(path.basename(f)+': '+(e.code||e.message));}if(fs.existsSync(f)&&!left.some(x=>x.startsWith(path.basename(f))))left.push(path.basename(f)+': silinemedi');}
      if(left.length)fail={ok:false,step:'cleanup',code:'ECLEANUP',reason:'ön kontrol dosyaları silinemedi: '+left.join('; ')+(fail?' (önce: '+fail.reason+')':'')};
    }
    return fail||{ok:true};
  }
}

module.exports={S3Store,MemoryStore,FileStore,signV4,sha256hex,TMP_PREFIX,LINK_UNSUPPORTED};

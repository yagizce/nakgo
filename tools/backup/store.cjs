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
const crypto=require('node:crypto');
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

class S3Store{
  constructor({endpoint,bucket,accessKeyId,secretAccessKey,region='auto',fetchImpl=globalThis.fetch,capabilities={verified:false}}){
    if(!/^https:\/\//.test(endpoint)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(endpoint))throw Error('Depo uç noktası HTTPS olmalı (yalnız testlerde yerel http)');
    Object.assign(this,{endpoint:endpoint.replace(/\/$/,''),bucket,accessKeyId,secretAccessKey,region,fetchImpl,capabilities});
  }
  async req(method,key,{body,headers={},query}={}){
    const url=new URL(this.endpoint+'/'+encSeg(this.bucket)+(key!==undefined?'/'+encPath(key):''));
    if(query)for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
    const signed=signV4({method,url:url.toString(),headers,body,accessKeyId:this.accessKeyId,secretAccessKey:this.secretAccessKey,region:this.region});
    delete signed.host;
    return this.fetchImpl(url,{method,headers:signed,body:body??undefined});
  }
  async put(key,body,{ifNoneMatch=false}={}){
    const r=await this.req('PUT',key,{body,headers:ifNoneMatch?{'if-none-match':'*'}:{}});
    return {ok:r.ok,status:r.status,etag:r.headers.get('etag')};
  }
  async get(key){const r=await this.req('GET',key);if(r.status===404)return null;if(!r.ok)throw Error('GET '+key+': '+r.status);return Buffer.from(await r.arrayBuffer());}
  async head(key){const r=await this.req('HEAD',key);if(r.status===404)return null;if(!r.ok)throw Error('HEAD '+key+': '+r.status);return {size:Number(r.headers.get('content-length')),last_modified:r.headers.get('last-modified')};}
  async list(prefix){
    const out=[];let token;
    do{
      const q={'list-type':'2',prefix};if(token)q['continuation-token']=token;
      const r=await this.req('GET',undefined,{query:q});
      if(!r.ok)throw Error('LIST '+prefix+': '+r.status);
      const xml=await r.text();
      for(const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)){
        const g=t=>(m[1].match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>'))||[])[1];
        out.push({key:g('Key').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),size:Number(g('Size')),last_modified:g('LastModified')});
      }
      token=/<IsTruncated>true<\/IsTruncated>/.test(xml)?(xml.match(/<NextContinuationToken>([^<]*)</)||[])[1]:null;
    }while(token);
    return out;
  }
  async delete(key){const r=await this.req('DELETE',key);return {ok:r.ok||r.status===404,status:r.status};}
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

module.exports={S3Store,MemoryStore,signV4,sha256hex};

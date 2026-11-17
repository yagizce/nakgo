/** Yalnız testler için yerel S3 taklidi (127.0.0.1). SigV4 imzasını aynı gizli anahtarla yeniden hesaplayıp doğrular;
 * PUT (If-None-Match), GET, HEAD, DELETE ve ListObjectsV2 destekler. Davranış MemoryStore üzerinden simüle edilir
 * (kilit ve koşullu yazma dahil). Gerçek R2'nin davranışını KANITLAMAZ. */
'use strict';
const http=require('node:http');
const {MemoryStore,signV4}=require('../../tools/backup/store.cjs');

function start({accessKeyId,secretAccessKey,bucket,store=new MemoryStore()}){
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=Buffer.concat(chunks);
    const url=new URL(req.url,'http://'+req.headers.host);
    const auth=req.headers.authorization||'';
    const m=/Credential=([^/]+)\/[^,]+, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
    if(!m||m[1]!==accessKeyId){res.writeHead(403);return res.end('kimlik yok');}
    const signedNames=m[2].split(';');
    const hdrs={};for(const n of signedNames)if(!['host','x-amz-date','x-amz-content-sha256'].includes(n))hdrs[n]=req.headers[n];
    const amz=req.headers['x-amz-date'];
    const date=new Date(Date.UTC(+amz.slice(0,4),+amz.slice(4,6)-1,+amz.slice(6,8),+amz.slice(9,11),+amz.slice(11,13),+amz.slice(13,15)));
    const expect=signV4({method:req.method,url:url.toString(),headers:hdrs,body:['PUT','POST'].includes(req.method)?body:'',accessKeyId,secretAccessKey,date});
    if(expect.authorization!==auth){res.writeHead(403);return res.end('imza geçersiz');}
    const parts=url.pathname.split('/').slice(1);
    if(decodeURIComponent(parts[0])!==bucket){res.writeHead(404);return res.end();}
    const key=parts.slice(1).map(decodeURIComponent).join('/');
    if(req.method==='GET'&&!key){
      const list=await store.list(url.searchParams.get('prefix')||'');
      const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      res.writeHead(200,{'content-type':'application/xml'});
      return res.end('<ListBucketResult><IsTruncated>false</IsTruncated>'+list.map(o=>`<Contents><Key>${esc(o.key)}</Key><Size>${o.size}</Size><LastModified>${o.last_modified}</LastModified></Contents>`).join('')+'</ListBucketResult>');
    }
    if(req.method==='PUT'){const r=await store.put(key,body,{ifNoneMatch:req.headers['if-none-match']==='*'});res.writeHead(r.status);return res.end();}
    if(req.method==='GET'){const b=await store.get(key);if(!b){res.writeHead(404);return res.end();}res.writeHead(200);return res.end(b);}
    if(req.method==='HEAD'){const h=await store.head(key);if(!h){res.writeHead(404);return res.end();}res.writeHead(200,{'content-length':h.size,'last-modified':new Date(h.last_modified).toUTCString()});return res.end();}
    if(req.method==='DELETE'){const r=await store.delete(key);res.writeHead(r.status===404?404:r.ok?204:403);return res.end();}
    res.writeHead(405);res.end();
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,store,endpoint:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))})));
}

module.exports={start};

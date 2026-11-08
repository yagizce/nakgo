/* Yerel sunucu ve servis çalışanı sınırları. */
module.exports=({test,fs,path,ROOT})=>{
  test("Yerel sunucu dosya ve erişim sınırları",async()=>{
    const {createServer}=require('../../tools/serve.js'),http=require('node:http'),server=createServer(),out=[];
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const request=(p,method='GET')=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:server.address().port,path:p,method},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode,type:r.headers['content-type'],body}));});q.on('error',reject);q.end();});
    try {
      const index=await request('/'),manifest=await request('/manifest.webmanifest');
      out.push([index.status===200&&index.type.includes('text/html')&&index.body.includes('NakGo'),'HTML sunulur']);
      out.push([manifest.type==='application/manifest+json','manifest doğru türde']);
      for(const p of ['/.git/config','/%2e%2e%2fpackage.json','/%5c..%5c.git%5cconfig'])out.push([(await request(p)).status===403,'gizli/üst dizin engeli: '+p]);
      out.push([(await request('/missing.js')).status===404,'eksik varlık HTML olmaz']);
      out.push([(await request('/','POST')).status===405,'yazma yöntemi kapalı']);
    } finally {await new Promise(r=>server.close(r));}
    return out;
  });
  test("Çevrimdışı önbellek yalnızca başarılı uygulama dosyalarını tutar",async()=>{
    const vm=require('node:vm'),events={},writes=[],pending=[],out=[];
    const headers=new Headers({'X-NakGo-Offline-Asset':'1'});
    const publicAsset={ok:true,redirected:false,headers};
    const failedAsset={ok:false,redirected:false,headers};
    const cache={put:(...args)=>writes.push(args),match:async key=>writes.find(([saved])=>saved===key)?.[1]};
    let offline=false;
    const ctx={URL,Response,location:{origin:'https://test'},self:{registration:{scope:'https://test/'},skipWaiting(){},addEventListener:(n,f)=>events[n]=f},caches:{open:async()=>cache},fetch:async r=>{
      if(offline)throw Error('offline');
      return (r instanceof URL?r.href:r.url).endsWith('icon-192.png')?failedAsset:publicAsset;
    }};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),ctx);
    const get=async(url,mode='cors')=>{let p;events.fetch({request:{url,method:'GET',mode},waitUntil:p=>pending.push(p),respondWith:x=>p=x});const r=await p;await Promise.all(pending);return r;};
    out.push([await get('https://test/api/private')===undefined,'API önbelleğe girmez']);
    out.push([await get('https://tile.openstreetmap.org/a.png')===undefined,'harita önbelleğe girmez']);
    out.push([await get('https://external.example/index.html','navigate')===undefined,'izinli dosya adı başka origin için geçerli değildir']);
    events.install({waitUntil:p=>pending.push(p)});await Promise.all(pending);
    const installed=writes.length;
    await get('https://test/index.html?go=post','navigate');out.push([writes.length===installed&&writes.some(([key])=>key==='https://test/'),'yalnız kurulumun kanonik kabuğu saklanır']);
    await get('https://test/icons/icon-192.png');out.push([writes.length===installed&&!writes.some(([key])=>key.endsWith('icon-192.png')),'başarısız yanıt işaretli olsa da saklanmaz']);
    offline=true;out.push([await get('https://test/','navigate')===publicAsset,'çevrimdışı gezinme gerçekten kaydedilmiş kabuğu açar']);
    out.push([(await get('https://test/icons/icon-192.png')).type==='error','eksik resme HTML verilmez']);
    return out;
  });
};

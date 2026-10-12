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
    let response={ok:true,redirected:false,clone:()=>({copy:true})},offline=false;
    const ctx={URL,Response,location:{origin:'https://test'},self:{registration:{scope:'https://test/'},addEventListener:(n,f)=>events[n]=f},caches:{open:async()=>({put:(...a)=>writes.push(a)}),match:async k=>k.includes('index.html')?{cached:true}:null},fetch:async()=>{if(offline)throw Error('offline');return response;}};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),ctx);
    const get=async(url,mode='cors')=>{let p;events.fetch({request:{url,method:'GET',mode},waitUntil:p=>pending.push(p),respondWith:x=>p=x});const r=await p;await Promise.all(pending);return r;};
    out.push([await get('https://test/api/private')===undefined,'API önbelleğe girmez']);
    out.push([await get('https://tile.openstreetmap.org/a.png')===undefined,'harita önbelleğe girmez']);
    await get('https://test/index.html?go=post','navigate');out.push([writes.length===1&&writes[0][0]==='https://test/index.html','kabuk sorgu bağımsız anahtarla saklanır']);
    response={ok:false,redirected:false};await get('https://test/icons/icon-192.png');out.push([writes.length===1,'404/500 saklanmaz']);
    offline=true;out.push([(await get('https://test/','navigate')).cached,'çevrimdışı gezinme kabuğu açar']);
    out.push([(await get('https://test/icons/icon-192.png')).type==='error','eksik resme HTML verilmez']);
    return out;
  });
};

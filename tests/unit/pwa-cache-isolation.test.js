/* Authentication callbacks must never replace the offline application shell. */
module.exports=({test,fs,path,ROOT})=>{
  test('Offline shell survives OAuth callback and private cache responses',async()=>{
    const vm=require('node:vm'),events={},entries=new Map();
    const origin='https://nakgo.example',shell=origin+'/';
    const cache={put:async(key,response)=>entries.set(key,response),match:async key=>entries.get(key)?.clone()};
    const installs=[];
    let network;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),{
      URL,Response,location:{origin},self:{registration:{scope:shell},skipWaiting(){},addEventListener:(name,fn)=>events[name]=fn},
      caches:{open:async()=>cache},
      fetch:async(request,options)=>{
        if(request instanceof URL){
          installs.push([request,options]);
          if(request.href===shell)return new Response('public shell',{headers:{'X-NakGo-Offline-Asset':'1'}});
          if(request.pathname.endsWith('icon.svg'))return new Response('not reusable',{headers:{'X-NakGo-Offline-Asset':'1','Cache-Control':'No-Cache'}});
          if(request.pathname.endsWith('manifest.webmanifest'))return new Response('synthetic session response');
          return new Response('varies by account',{headers:{'X-NakGo-Offline-Asset':'1','Vary':'Accept-Encoding, Cookie'}});
        }
        if(!network)throw Error('offline');
        return network;
      }
    });
    async function navigate(url){
      let response;const pending=[];
      events.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
      const result=await response;
      await Promise.all(pending);
      return result.text();
    }
    let install;
    events.install({waitUntil:p=>install=p});
    await install;
    network=new Response('synthetic callback content');
    const callback=await navigate(shell+'?code=synthetic&auth=recovery');
    network=new Response('synthetic private content',{headers:{'Cache-Control':'private, no-store'}});
    const privatePage=await navigate(shell);
    network=new Response('synthetic cookie body',{headers:{'Set-Cookie':'synthetic=1; HttpOnly','Cache-Control':'no-cache'}});
    const shortcut=await navigate(shell+'?go=mine');
    network=null;
    return [
      [callback==='synthetic callback content'&&privatePage==='synthetic private content','online navigation preserves the actual response'],
      [shortcut==='synthetic cookie body'&&await navigate(shell+'?go=mine')==='public shell','allowed shortcut and Set-Cookie body cannot poison offline shell'],
      [await navigate(shell+'index.html')==='public shell','OAuth callback and private response cannot poison offline shell'],
      [installs.length>1&&installs.every(([url,options])=>!url.search&&options.credentials==='omit'&&options.cache==='no-store'),'static installation bypasses cookies and the HTTP cache'],
      [entries.size===1,'installation rejects no-cache, unmarked and cookie-varying responses']
    ];
  });
  test('A worker update keeps the old offline shell until the new shell is cached',async()=>{
    const vm=require('node:vm');
    const source=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
    const origin='https://nakgo.example',shell=origin+'/',oldVersion='nakgo-old-worker';
    const out=[];
    for(const failure of ['network','unmarked','write',null]){
      const events={},previous=new Map([[shell,'old shell']]),entries=new Map([[oldVersion,previous]]);
      let skipped=false,claimed=false,installed=false,pending;
      vm.runInNewContext(source,{
        URL,Response,location:{origin},
        self:{registration:{scope:shell},addEventListener:(name,fn)=>events[name]=fn,
          skipWaiting(){skipped=true;},clients:{claim(){claimed=true;}}},
        caches:{
          open:async name=>{
            if(!entries.has(name))entries.set(name,new Map());
            return {put:async(key,value)=>{
              if(key===shell&&failure==='write')throw Error('cache write failed');
              entries.get(name).set(key,await value.text());
            }};
          },
          keys:async()=>[...entries.keys()],delete:async name=>entries.delete(name)
        },
        fetch:async url=>{
          if(url.href!==shell||failure==='network')throw Error('network unavailable');
          return new Response('new shell',{headers:failure==='unmarked'?{}:{'X-NakGo-Offline-Asset':'1'}});
        }
      });
      const event={waitUntil:promise=>pending=promise};
      events.install(event);
      try{await pending;installed=true;}catch{}
      // Only a successfully installed worker can reach activation.
      if(installed){events.activate(event);await pending;}
      if(failure)out.push([!installed&&!skipped&&!claimed&&entries.get(oldVersion)?.get(shell)==='old shell',
        'failed shell installation keeps the old cache: '+failure]);
      else out.push([installed&&skipped&&claimed&&!entries.has(oldVersion)&&[...entries.values()].some(cache=>cache.get(shell)==='new shell'),
        'cached shell permits activation even if optional assets fail']);
    }
    return out;
  });
};

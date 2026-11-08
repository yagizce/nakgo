/* Authentication callbacks must never replace the offline application shell. */
module.exports=({test,fs,path,ROOT})=>{
  test('Offline shell survives OAuth callback and private cache responses',async()=>{
    const vm=require('node:vm'),events={},entries=new Map();
    const origin='https://nakgo.example',shell=origin+'/index.html';
    const cache={put:async(key,response)=>entries.set(key,response)};
    let network;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),{
      URL,Response,location:{origin},self:{registration:{scope:origin+'/'},addEventListener:(name,fn)=>events[name]=fn},
      caches:{open:async()=>cache,match:async key=>entries.get(key)},
      fetch:async()=>{if(!network)throw Error('offline');return network;}
    });
    async function navigate(url){
      let response;const pending=[];
      events.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
      const result=await response;
      await Promise.all(pending);
      return result.text();
    }
    network=new Response('public shell');
    await navigate(shell);
    network=new Response('synthetic callback content');
    const callback=await navigate(shell+'?code=synthetic&auth=recovery');
    network=new Response('synthetic private content',{headers:{'Cache-Control':'private, no-store'}});
    const privatePage=await navigate(shell);
    network=null;
    return [
      [callback==='synthetic callback content'&&privatePage==='synthetic private content','online navigation preserves the actual response'],
      [await navigate(shell)==='public shell','OAuth callback and private response cannot poison offline shell']
    ];
  });
};

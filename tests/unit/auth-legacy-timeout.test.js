/* Additional tests, discovered by the existing npm test runner. */
module.exports = ({test,fs,path,ROOT}) => {
    test('Eski tarayıcıda AbortSignal.timeout yokken hesap girişi kapanmaz', async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        const sdk={auth:{onAuthStateChange(){},async getSession(){return {data:{session:null},error:null};},async getUser(){return {data:{user:null},error:null};}}};
        const start=async extra=>{
            let signal='unset';
            const ctx={URL,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async(url,options)=>{signal=options.signal;return {ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})};},supabase:{createClient:()=>sdk}},...extra};
            vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);
            await ctx.auth.init();
            return {enabled:ctx.auth.snapshot().enabled,ready:ctx.auth.snapshot().ready,signal};
        };
        const legacy=await start({AbortSignal:function AbortSignal(){},AbortController});
        ok(legacy.enabled&&legacy.ready,'AbortSignal.timeout olmadan giriş etkin');
        ok(legacy.signal&&typeof legacy.signal.aborted==='boolean','eski tarayıcıda zaman aşımı sinyali yine kurulur');
        const bare=await start({});
        ok(bare.enabled&&bare.ready&&bare.signal===undefined,'AbortController da yokken giriş etkin');
        const modern=await start({AbortSignal,AbortController});
        ok(modern.enabled&&modern.ready&&modern.signal instanceof AbortSignal,'güncel tarayıcı davranışı değişmedi');
        return out;
    });
};

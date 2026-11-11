/* Additional tests, discovered by the existing npm test runner. */
// A slow or dropped mobile connection must not look like a sign-out; a rejected session still signs out.
module.exports = ({test,fs,path,ROOT}) => {
    const vm=require('node:vm');
    const config={enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'};
    const boot=({userResults,fetches})=>{
        const timers=[],listeners={};let calls=0;
        const session={access_token:'t',user:{id:'user-a'}};
        const sdk={auth:{onAuthStateChange(){},async getSession(){return {data:{session},error:null};},
            async getUser(){const r=userResults[Math.min(calls++,userResults.length-1)];return r;}},
            from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'user-a',display_name:'A'},error:null})})})})};
        let fetchCall=0;
        const ctx={URL,AbortSignal,AbortController,clearTimeout(id){if(timers[id])timers[id].done=true;},
            setTimeout(fn,ms){timers.push({fn,ms,done:false});return timers.length-1;},
            tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},
            localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},
            document:{visibilityState:'visible',addEventListener(k,f){listeners[k]=f;},createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},
            window:{addEventListener(k,f){listeners[k]=f;},supabase:{createClient:()=>sdk},
                fetch:async()=>{const f=fetches[Math.min(fetchCall++,fetches.length-1)];if(f==='fail')throw TypeError('Failed to fetch');return f==='500'?{ok:false,status:500}:{ok:true,status:200,json:async()=>config};}}};
        vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);
        // Run pending timers until init finishes; returns once no timer is queued.
        const flush=async()=>{for(let i=0;i<20;i++){await new Promise(r=>setImmediate(r));const t=timers.find(t=>!t.done);if(!t)return;t.done=true;t.fn();}};
        return {ctx,timers,listeners,flush,userCalls:()=>calls,fetchCalls:()=>fetchCall};
    };
    const offline={data:{user:null},error:Object.assign(Error('Failed to fetch'),{name:'AuthRetryableFetchError',status:0})};
    const ok200={data:{user:{id:'user-a',email:'a@example.test',user_metadata:{}}},error:null};
    const rejected={data:{user:null},error:Object.assign(Error('invalid JWT'),{name:'AuthApiError',status:403,code:'bad_jwt'})};

    test('Bağlantı koptuğunda oturum silinmez, bağlantı gelince hesap geri açılır', async()=>{
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const a=boot({userResults:[offline,offline,ok200],fetches:['ok']});
        const init=a.ctx.auth.init();await new Promise(r=>setImmediate(r));await init.catch(()=>{});
        ok(!a.ctx.auth.snapshot().user,'doğrulanamayan oturum hesap gibi gösterilmez');
        ok(a.timers.some(t=>!t.done&&t.ms===2000),'yeniden doğrulama zamanlandı');
        await a.flush();
        ok(a.ctx.auth.snapshot().user?.id==='user-a','bağlantı dönünce aynı oturumla hesap açılır, yeniden giriş istenmez');
        ok(a.userCalls()===3,'kimlik sunucuda yeniden doğrulandı');
        return out;
    });
    test('Sunucu oturumu reddederse hesap kapanır ve tekrar denenmez', async()=>{
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const a=boot({userResults:[rejected,ok200],fetches:['ok']});
        await a.ctx.auth.init().catch(()=>{});
        ok(!a.ctx.auth.snapshot().user,'reddedilen oturum açık sayılmaz');
        ok(!a.timers.some(t=>!t.done&&t.ms>=2000),'reddedilen oturum için yeniden deneme yok');
        a.listeners.online?.();await new Promise(r=>setImmediate(r));
        ok(a.userCalls()===1&&!a.ctx.auth.snapshot().user,'çevrimiçi olayı reddedilen oturumu geri açmaz');
        return out;
    });
    test('Yavaş açılışta hesap ayarı yeniden istenir', async()=>{
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const a=boot({userResults:[ok200],fetches:['fail','500','ok']});
        const init=a.ctx.auth.init();await a.flush();await init;
        ok(a.fetchCalls()===3&&a.ctx.auth.snapshot().enabled,'iki başarısız denemeden sonra hesap girişi etkin');
        ok(a.ctx.auth.snapshot().user?.id==='user-a','kayıtlı oturum açılır');
        const b=boot({userResults:[ok200],fetches:['fail']});
        const initB=b.ctx.auth.init();await b.flush();await initB;
        ok(b.fetchCalls()===3&&!b.ctx.auth.snapshot().enabled,'en fazla üç deneme, sonra sessizce kapalı kalır');
        return out;
    });
};

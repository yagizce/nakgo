/* Additional tests, discovered by the existing npm test runner. */
module.exports = ({test,run,fs,path,ROOT}) => {
    test('Auth config yalnız preview ve publishable key kabul eder', async()=>{
        const {publicAuthConfig,default:handler}=await import('../../api/auth/config.mjs');
        const good={NAKGO_AUTH_ENABLED:'true',VERCEL_ENV:'preview',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrst'};
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        ok(publicAuthConfig(good)?.enabled,'preview enabled');
        ok(!publicAuthConfig({...good,VERCEL_ENV:'production'}).enabled,'production fails closed');
        ok(!publicAuthConfig({...good,NAKGO_AUTH_ENABLED:'false'}).enabled,'feature disabled');
        for(const key of ['sb_secret_abcdefghijklmnopqrst','eyJ.service_role.token',''])ok(publicAuthConfig({...good,SUPABASE_PUBLISHABLE_KEY:key})===null,'reject private/legacy/missing key');
        for(const url of ['http://localhost','https://evil.example','https://abcdefghijklmnopqrst.supabase.co@evil.example','https://abcdefghijklmnopqrst.supabase.co/path'])ok(publicAuthConfig({...good,SUPABASE_URL:url})===null,'reject untrusted URL');
        const headers={},res={setHeader:(k,v)=>headers[k]=v,end(value){this.body=value;}};
        handler({method:'POST'},res);
        ok(res.statusCode===405&&headers.Allow==='GET, HEAD','method protection');
        ok(headers['Cache-Control'].includes('no-store'),'no cache');
        return out;
    });
    run('Hesap bağlantısı demo kimliğini ve yerel kayıtları değiştirmez',(r,ok)=>{
        ok(r('return !nakgoAuth.snapshot().enabled && authCardHTML() === ""'),'disabled without config');
        ok(!r('return nakgoAuth.configOK({enabled:true,url:"https://bad.example",publishableKey:"sb_publishable_1234567890123456"})'),'client rejects bad config');
        ok(r('return nakgoAuth.message({code:"invalid_credentials",message:"secret-token"})').includes('doğru değil'),'known errors are translated');
        ok(!r('return nakgoAuth.message({message:"secret-token"})').includes('secret-token'),'raw server error never rendered');
        ok(r('return !cloud && me === ""'),'demo identity isolated');
    });
    test('Supabase oturum ve profil yaşam döngüsü',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        let session=null,user=null,callback=null,authError=null,logoutError=null,recoveryArgs=null,options=null,profile=null,patch=null;
        const sdk={
            auth:{
                onAuthStateChange(cb){callback=cb;},
                async getSession(){return {data:{session},error:null};},
                async getUser(){return {data:{user},error:authError};},
                async signInWithPassword(){session={access_token:'test'};user={id:'user-a',email:'a@example.test',user_metadata:{display_name:'Test A',account_type:'carrier'}};return {error:null};},
                async signUp(args){options=args;return {data:{session:null},error:null};},
                async resetPasswordForEmail(email,opts){recoveryArgs={email,...opts};return {error:null};},
                async updateUser(args){patch=args;return {error:null};},
                async signOut(){if(logoutError)return {error:logoutError};session=null;callback('SIGNED_OUT');return {error:null};}
            },
            from(table){
                if(table!=='profiles')throw Error('wrong table');
                let value=null,mode='read',id=null;
                const result=()=>{if(mode==='insert')profile=value;if(mode==='update')profile={...profile,...value};return {data:profile,error:null};};
                const q={select(){return q;},eq(k,v){id=v;return q;},insert(v){mode='insert';value=v;return q;},update(v){mode='update';value=v;ok(!('id' in v)&&!('created_at' in v),'only editable profile fields');return q;},async single(){return result();},async maybeSingle(){return result();},then(resolve,reject){ok(id===user.id,'profile request scoped to identity');return Promise.resolve(result()).then(resolve,reject);}};
                return q;
            }
        };
        let clientOptions=null;
        const window={fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient(url,key,opts){clientOptions=opts;return sdk;}}};
        const ctx={window,document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},tab:'list',render(){},setTimeout,clearTimeout,AbortSignal,URL,location:{origin:'https://preview.example',href:'https://preview.example/'},history:{},$:()=>null,openAuth(){}};
        vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+'\nthis.auth=nakgoAuth;',ctx);
        await ctx.auth.init();
        ok(ctx.auth.snapshot().ready&&!ctx.auth.snapshot().user,'signed out on first start');
        ok(clientOptions.auth.flowType==='pkce'&&clientOptions.auth.storageKey==='ng-auth-abcdefghijklmnopqrst','PKCE and isolated storage');
        await ctx.auth.signUp('a@example.test','not-a-real-password',' Test A ','carrier');
        ok(options.options.emailRedirectTo==='https://preview.example/','fixed same-origin redirect');
        ok(!ctx.auth.snapshot().user&&profile===null,'unconfirmed signup does not create a profile');
        await ctx.auth.signIn('a@example.test','not-a-real-password');
        ok(ctx.auth.snapshot().profile.display_name==='Test A','profile created after valid login');
        ok(!JSON.stringify(ctx.auth.snapshot()).includes('access_token'),'snapshot never contains tokens');
        await ctx.auth.saveProfile('Updated','owner');
        ok(ctx.auth.snapshot().profile.display_name==='Updated','profile update');
        await ctx.auth.recover('a@example.test');
        ok(recoveryArgs.redirectTo==='https://preview.example/','password reset exact redirect');
        let denied=false;try{await ctx.auth.password('not-a-real-password');}catch{denied=true;}
        ok(denied&&!patch,'no password change without recovery event');
        callback('PASSWORD_RECOVERY');await new Promise(r=>setTimeout(r,20));
        await ctx.auth.password('new-not-a-real-password');
        ok(patch.password==='new-not-a-real-password'&&!ctx.auth.snapshot().user,'reset signs out');
        await ctx.auth.signIn('a@example.test','not-a-real-password');
        logoutError={code:'network'};let failed=false;try{await ctx.auth.signOut();}catch{failed=true;}
        ok(failed&&ctx.auth.snapshot().user,'failed signout not reported as success');
        logoutError=null;await ctx.auth.signOut();
        ok(!ctx.auth.snapshot().user&&!ctx.auth.snapshot().profile,'signout clears account data');
        authError={code:'invalid_credentials'};try{await ctx.auth.signIn('a@example.test','x');}catch{}
        ok(!ctx.auth.snapshot().user,'getUser failure rejects locally cached identity');
        return out;
    });
};

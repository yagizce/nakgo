/* Additive OAuth coverage; existing auth tests and quality gate are unchanged. */
module.exports=({test,fs,path,ROOT})=>{
    test('Google OAuth: PKCE istemcisi, sabit dönüş ve kimlik sınırı',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        const source=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+'\nthis.auth=nakgoAuth;';
        function setup({href='https://preview.example/',marker=false,fail=false}={}) {
            const values=new Map(marker?[['ng-google-return','1']]:[]);
            let args=null,session=null,user=null,profile=null,nav=0;
            const sdk={auth:{
                onAuthStateChange(){},async getSession(){return {data:{session},error:null};},
                async getUser(){return {data:{user},error:null};},
                async signInWithOAuth(value){args=value;return {error:fail?{message:'private-server-detail'}:null};}
            },from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:profile,error:null};},insert(value){profile=value;return q;},async single(){return {data:profile,error:null};}};return q;}};
            const ctx={window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient(){return sdk;}}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},tab:'list',render(){},setNav(){nav++;},setTimeout,clearTimeout,AbortSignal,URL,location:{origin:'https://preview.example',href},history:{replaceState(a,b,value){ctx.location.href='https://preview.example'+value;}},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
            vm.createContext(ctx);vm.runInContext(source,ctx);
            return {ctx,values,args:()=>args,nav:()=>nav,login(){session={access_token:'mock'};user={id:'google-user',email:'test@example.test',user_metadata:{full_name:' Google Name '}};}};
        }
        const start=setup();
        let denied=false;try{await start.ctx.auth.signInGoogle();}catch{denied=true;}
        ok(denied&&start.args()===null,'OAuth unavailable before validated config and SDK');
        await start.ctx.auth.init();await start.ctx.auth.signInGoogle();
        ok(start.args().provider==='google','fixed Google provider');
        ok(start.args().options.redirectTo==='https://preview.example/','redirect cannot be supplied by user input');
        ok(!start.args().options.queryParams&&!start.args().options.scopes,'no offline access or extra permissions');
        ok(start.values.get('ng-google-return')==='1','return marker set');
        ok(!start.ctx.auth.snapshot().user,'redirect request does not authenticate');
        const failed=setup({fail:true});await failed.ctx.auth.init();
        let error=null;try{await failed.ctx.auth.signInGoogle();}catch(e){error=e;}
        ok(!!error&&!failed.values.has('ng-google-return'),'failed request clears return marker');
        ok(!failed.ctx.auth.message(error).includes('private-server-detail'),'raw OAuth error not exposed');
        const returned=setup({marker:true});returned.login();await returned.ctx.auth.init();
        ok(returned.ctx.tab==='me'&&returned.nav()===1,'return opens account screen');
        ok(returned.ctx.auth.snapshot().profile.display_name==='Google Name','Google name is bounded profile text');
        ok(returned.ctx.auth.snapshot().profile.account_type===null,'Google login does not invent account type');
        ok(!returned.values.has('ng-google-return'),'return marker consumed');
        for(const suffix of ['?error=access_denied&error_description=private-detail','#error=access_denied&error_description=private-detail']) {
            const cancel=setup({marker:true,href:'https://preview.example/'+suffix});await cancel.ctx.auth.init();
            ok(cancel.ctx.tab==='me'&&!cancel.ctx.auth.snapshot().user,'cancel returns to account without identity');
            ok(cancel.ctx.auth.snapshot().error.includes('Google ile giriş tamamlanmadı'),'cancel is retryable');
            ok(!cancel.ctx.location.href.includes('error'),'callback error removed from address');
            ok(!JSON.stringify(cancel.ctx.auth.snapshot()).includes('private-detail'),'provider detail never rendered');
        }
        const spoof=setup({marker:true});await spoof.ctx.auth.init();
        ok(!spoof.ctx.auth.snapshot().user,'forged navigation marker cannot create session');
        return out;
    });
};

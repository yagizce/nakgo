/* Girişli kullanıcının şifre değiştirmesi: mevcut şifre doğrulanmadan yeni şifre yazılmaz. */
module.exports = ({test,fs,path,ROOT}) => {
    test('Şifre değiştir: mevcut şifre doğrulaması',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        let user=null,patch=null,checked=null;
        const sdk={
            auth:{
                onAuthStateChange(){},
                async getSession(){return {data:{session:user?{access_token:'t'}:null},error:null};},
                async getUser(){return {data:{user},error:null};},
                async signInWithPassword(args){checked=args;if(args.password!=='old-password-123')return {error:{code:'invalid_credentials'}};user={id:'u1',email:'a@example.test',user_metadata:{}};return {error:null};},
                async updateUser(args){patch=args;return {error:null};},
                async signOut(){user=null;return {error:null};}
            },
            from(){const q={select(){return q;},eq(){return q;},insert(){return q;},update(){return q;},async single(){return {data:{display_name:'A'},error:null};},async maybeSingle(){return {data:{display_name:'A'},error:null};},then(r,j){return Promise.resolve({data:{display_name:'A'},error:null}).then(r,j);}};return q;}
        };
        const window={fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient(){return sdk;}}};
        const ctx={window,document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},tab:'list',render(){},setTimeout,clearTimeout,AbortSignal,URL,location:{origin:'https://preview.example',href:'https://preview.example/',protocol:'https:'},history:{},$:()=>null,openAuth(){}};
        vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+'\nthis.auth=nakgoAuth;',ctx);
        await ctx.auth.init();
        let denied=false;try{await ctx.auth.changePassword('old-password-123','new-password-456');}catch{denied=true;}
        ok(denied&&!patch,'oturum yokken şifre değişmez');
        await ctx.auth.signIn('a@example.test','old-password-123');
        let code='';try{await ctx.auth.changePassword('wrong-password','new-password-456');}catch(e){code=e.code;}
        ok(code==='wrong_current_password'&&!patch,'yanlış mevcut şifrede yeni şifre yazılmaz');
        ok(ctx.auth.message({code})==='Mevcut şifren doğru değil.','anlaşılır hata mesajı');
        let short='';try{await ctx.auth.changePassword('old-password-123','kisa123');}catch(e){short=e.code;}
        ok(short==='password_too_short'&&!patch&&ctx.auth.message({code:short})==='Şifre en az 10 karakter olmalı.','10 karakterden kısa yeni şifre reddedilir');
        await ctx.auth.changePassword('old-password-123','new-password-456');
        ok(checked.email==='a@example.test'&&patch.password==='new-password-456','mevcut şifre aynı hesapla doğrulanır, sonra güncellenir');
        ok(ctx.auth.snapshot().user,'şifre değişince oturum açık kalır');
        return out;
    });
};

module.exports=({test,fs,path,ROOT})=>{
    test('Recovery return shows a verified form or visible retry without granting from URL hints',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        async function scenario({href,recovery=false,identityError=false}) {
            let listener,opened='',profiles=0,verified=0;
            const feedback={textContent:''},onb={style:{}},source=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
            const sdk={auth:{onAuthStateChange(cb){listener=cb;if(recovery)cb('PASSWORD_RECOVERY');},async getSession(){return {data:{session:recovery?{}:null},error:null};},async getUser(){verified++;return {data:{user:{id:'test',email:'test@example.test'}},error:identityError?{code:'invalid_credentials'}:null};}},from(){profiles++;throw Error('Profile offline');}};
            const store=new Map([['ng-recovery-request',String(Date.now())]]);
            const ctx={URL,Date,AbortSignal,setTimeout,clearTimeout,tab:'list',location:{href,origin:'https://preview.example'},history:{replaceState(){}},setNav(){},render(){},openAuth(kind){opened=kind;},$:s=>s==='#onb'?onb:feedback,localStorage:{getItem:k=>store.get(k)},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient(){return sdk;}}}};
            vm.createContext(ctx);vm.runInContext(source+'\nthis.auth=nakgoAuth;',ctx);
            await ctx.auth.init();await new Promise(resolve=>setTimeout(resolve,25));
            return {opened,profiles,verified,state:ctx.auth.snapshot(),feedback:feedback.textContent,ctx};
        }
        const expired=await scenario({href:'https://preview.example/?error=access_denied&error_code=otp_expired#sb='});
        ok(expired.opened==='recover'&&expired.feedback.includes('kullanılamadı'),'expired link visibly offers retry');
        const missing=await scenario({href:'https://preview.example/#sb='});
        ok(missing.opened==='recover'&&!missing.state.recovery&&!missing.state.user,'return hint never grants recovery');
        let denied=false;try{await missing.ctx.auth.password('not-a-real-password');}catch{denied=true;}
        ok(denied,'password update blocked for a navigation hint');
        const valid=await scenario({href:'https://preview.example/?code=mock#sb=',recovery:true});
        ok(valid.opened==='password'&&valid.verified>0&&valid.profiles===0,'verified recovery form does not depend on profiles');
        const rejected=await scenario({href:'https://preview.example/?code=mock#sb=',recovery:true,identityError:true});
        ok(rejected.opened==='recover'&&!rejected.state.user,'invalid identity cannot open password form');
        return out;
    });
};

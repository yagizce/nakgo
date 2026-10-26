module.exports=({test,run,fs,path,ROOT})=>{
    test('Private profile writes whitelist fields and reject stale account results',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        let event,updated,filter,resolveWrite,fail=false;
        const profile={id:'a',display_name:'Account A',account_type:'carrier',city:'',about:'',phone:''};
        const sdk={auth:{onAuthStateChange(cb){event=cb;},async getSession(){return {data:{session:{}},error:null};},async getUser(){return {data:{user:{id:'a',email:'test@example.test'}},error:null};}},from(){return {select(){return this;},eq(key,id){filter=[key,id];return this;},async maybeSingle(){return {data:{...profile},error:null};},update(values){updated=values;return this;},async single(){if(fail)return {data:null,error:{code:'offline'}};return new Promise(resolve=>{resolveWrite=()=>resolve({data:{...profile,...updated},error:null});});}};}};
        const ctx={URL,AbortSignal,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
        vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);await ctx.auth.init();
        const pending=ctx.auth.saveProfileDetails({city:' Ankara ',phone:'05555555555',id:'b',account_type:'admin',created_at:'forged'});
        ok(JSON.stringify(updated)==='{"city":"Ankara","phone":"05555555555"}'&&filter[0]==='id'&&filter[1]==='a','only editable fields target verified own ID');
        resolveWrite();await pending;
        ok(ctx.auth.snapshot().profile.city==='Ankara','successful saved row updates private state');
        let denied=false;try{await ctx.auth.saveProfileDetails({phone:'123'});}catch{denied=true;}ok(denied,'invalid phone rejected');
        fail=true;denied=false;try{await ctx.auth.saveProfileDetails({city:'Izmir'});}catch{denied=true;}ok(denied&&ctx.auth.snapshot().profile.city==='Ankara','failure preserves prior row');
        fail=false;const stale=ctx.auth.saveProfileDetails({city:'Bursa'});event('SIGNED_OUT');resolveWrite();denied=false;try{await stale;}catch{denied=true;}ok(denied&&!ctx.auth.snapshot().user&&!ctx.auth.snapshot().profile,'sign-out prevents late response repopulating account');
        denied=false;try{await ctx.auth.saveProfileDetails({city:'Ankara'});}catch{denied=true;}ok(denied,'signed-out write denied');
        return out;
    });
    run('Authenticated profile form uses only account data and saves outside demo',async(r,ok)=>{
        r("myCar.displayName='Other demo';myCar.phone='0555 000 00 00';nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:'a'},profile:{display_name:'Account A',city:'Ankara',about:'Private',phone:'05555555555'}});");
        ok(r("return profileInfoHTML().includes('Account A')&&!profileInfoHTML().includes('Other demo')&&!phoneCard().includes('0555 000')"),'account form never imports local demo');
        r("nakgoAuth.saveProfileDetails=async patch=>{window.savedProfile=patch;};renderProfile(el('#main'));el('#profile-name').value='Updated';el('#profile-city').value='Ankara';el('#profile-about').value='About';");
        await r("return el('#profile-save').onclick();");
        ok(r("return window.savedProfile.display_name==='Updated'&&myCar.displayName==='Other demo'"),'authenticated save leaves demo untouched');
        r("nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:'b'},profile:null});");
        ok(r("return !profileInfoHTML().includes('Other demo')&&profileInfoHTML().includes('disabled')&&!phoneCard().includes('0555 000')"),'loading second account fails closed');
    },{win:{}});
    run('Signed-out profile retains the existing local demo fields',(r,ok)=>{
        r("myCar.displayName='Demo Name';myCar.city='Ankara';myCar.phone='0555 555 55 55';");
        ok(r("return privateProfile()===null"),'demo stays separate from auth');
        ok(r("return profileInfoHTML().includes('Demo Name')&&phoneCard().includes('0555 555 55 55')"),'signed-out form preserves demo');
    });
};

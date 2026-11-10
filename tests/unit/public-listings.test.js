/* Additional tests, discovered by the existing npm test runner. */
module.exports = ({run,test,fs,path,ROOT}) => {
    run('Girişsiz ziyaretçi demo ilan görmez, iletişim için hesaba yönlendirilir',(r,ok)=>{
        ok(r('return loads.length>0 && !nakgoMarket.guest()'),'auth kapalıyken demo ilanlar duruyor');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:false,checked:false,user:null,recovery:false})');
        ok(r('return nakgoMarket.guest() && nakgoMarket.locked() && !nakgoMarket.active()'),'misafir modu açıldı');
        ok(r('return loads.length===0 && trucks.length===0 && offers.length===0'),'demo veri gizlendi');
        ok(r('return save()===false'),'misafirde yerel yazma yapılmaz');
        ok(r('return contactDockHTML().includes("kayıt ol")'),'iletişim alanı kayıt ister');
        ok(r('return contactAllowed({id:1},false)===false'),'arama izni yok');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:{id:"u-1"},profile:null,recovery:false})');
        ok(r('return nakgoMarket.active() && !nakgoMarket.guest()'),'giriş yapınca hesap modu');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:null,recovery:false})');
        ok(r('return nakgoMarket.guest() && loads.length===0'),'çıkışta demo değil misafir modu');
        r('nakgoMarket.sync({enabled:false,marketplace:false,ready:false,checked:false,user:null,recovery:false})');
        ok(r('return !nakgoMarket.locked() && loads.length>0'),'auth kapanırsa demo geri gelir');
    });
    test('Açık ilan okuması yalnız güvenli fonksiyonu kullanır',async()=>{
        const vm=require('node:vm'),out=[],ok=(v,m)=>out.push([!!v,m]);
        let rpc=null,session=null;
        const sdk={auth:{onAuthStateChange(){},async getSession(){return {data:{session},error:null};},async getUser(){return {data:{user:{id:'u-1',email:'a@example.test'}},error:null};}},
            rpc(name,args){rpc={name,args};return Promise.resolve({data:[{id:5,kind:'load'}],error:null});},
            from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{id:'u-1',display_name:'A'},error:null};}};return q;}};
        const ctx={URL,AbortSignal,AbortController,setTimeout,clearTimeout,tab:'list',render(){},location:{href:'https://preview.example/',origin:'https://preview.example'},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,removeItem(){}},document:{createElement:()=>({remove(){}}),head:{appendChild:s=>queueMicrotask(()=>s.onload())}},window:{fetch:async()=>({ok:true,json:async()=>({enabled:true,url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrst'})}),supabase:{createClient:()=>sdk}}};
        vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8')+';this.auth=nakgoAuth;',ctx);
        await ctx.auth.init();
        ok(ctx.auth.snapshot().checked===true&&!ctx.auth.snapshot().user,'oturumsuz kontrol tamamlandı');
        const rows=await ctx.auth.publicListings({before:9});
        ok(rpc.name==='nakgo_public_listings'&&rpc.args.p_before===9&&rows.length===1,'yalnız açık ilan fonksiyonu çağrılır');
        let denied=false;try{await ctx.auth.publicListings({before:-1});}catch{denied=true;}ok(denied,'geçersiz imleç reddedilir');
        const src=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261110010000_public_listings.sql'),'utf8');
        ok(!/owner_id\s*,|owner_label|\bnote\b|image_data|contact_phone/.test(src.split('returns table')[1].split('language')[0]),'açık fonksiyon kişisel sütun döndürmez');
        ok(/grant execute on function public\.nakgo_public_listings\(bigint\) to anon, authenticated;/.test(src)&&!/grant select[^;]*listings[^;]*anon/i.test(src),'tablo anon için kapalı kalır');
        return out;
    });
};

/* Telefon görüntüleme sınırı: sunucu numara yerine null dönerse kullanıcı sınır mesajını görür, arama/WhatsApp açılmaz. */
module.exports = ({run}) => {
    run('Telefon sınırı aşılınca numara açılmaz, sınır mesajı gösterilir',async(r,ok)=>{
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:{id:"u-1"},profile:{id:"u-1",display_name:"A"},recovery:false})');
        const item='({...loads[0],_remote:true,remoteId:7,dateText:"bugün",ts:Date.now()})';
        const press=async ret=>{
            r('window.location.href="";$("#toast").textContent="";nakgoAuth.listingContact=async()=>'+ret+';bindPhoneContact('+item+',false)');
            await r('return $("#call").onclick()');
            return {toast:r('return $("#toast").textContent'),href:r('return window.location.href')};
        };
        const limited=await press('null');
        ok(/sınırına ulaştın/.test(limited.toast)&&!/tel:/.test(limited.href),'null → sınır mesajı, arama açılmaz');
        const empty=await press('""');
        ok(/paylaşılan bir telefon numarası yok/.test(empty.toast),'boş/geçersiz numara eski mesajı korur');
        const fine=await press('"+905321234567"');
        ok(fine.href==='tel:+905321234567'&&fine.toast==='','geçerli numara aranır');
    },{win:{location:{href:''}}});
};

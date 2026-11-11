/* İlan telefonu, yayın izni ve Ara/WhatsApp düğmeleri. */
module.exports = ({run,test,fs,path,ROOT}) => {
    run('İlan telefonu doğrulanır ve yalnız gerçek hesapta istenir',(r,ok)=>{
        ok(r('return normalizeListingPhone("0532 123 45 67")==="+905321234567"&&normalizeListingPhone("+90 212 555 11 22")==="+902125551122"'),'Türkiye numaraları normalleşir');
        ok(r('return ["","abc","1111111111","0532123456","+1 555 123 4567"].every(v=>normalizeListingPhone(v)==="")'),'geçersiz numaralar reddedilir');
        const base='{from:"İstanbul",to:"Ankara",ton:5,cargo:"Palet",veh:vehicles[0],body:bodies[0],dateText:"bugün"}';
        ok(r('return postError('+base+')===""&&postError({...'+base+',phone:"05551234567"})===""'),'demo/eski istemci izin alanı olmadan geçer');
        ok(r('return postError({...'+base+',phone:"05",contactConsent:true})==="Geçerli bir Türkiye telefon numarası gir"'),'geçersiz telefon durdurur');
        ok(r('return postError({...'+base+',phone:"05321234567",contactConsent:false}).includes("izin")'),'yayın izni zorunlu');
        ok(r('return postError({...'+base+',phone:"05321234567",contactConsent:true})===""'),'telefon ve izinle geçer');
        ok(r('return listingContactFields()===""'),'demo modda telefon alanı yok');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:{id:"u-1"},profile:{id:"u-1",display_name:"A"},recovery:false})');
        ok(r('return nakgoMarket.active()&&listingContactFields().includes("post-phone")&&!listingContactFields().includes("checkbox")&&listingContactFields().includes("gösterilir")'),'gerçek hesapta telefon alanı ve bilgi notu, onay kutusu yok');
        const dock=r('return contactDockHTML(false,false)');
        ok(dock.includes('id="call"')&&dock.includes('wa-btn')&&!dock.includes('id="mg"')&&!dock.includes('hazırlanıyor'),'yalnız Ara ve yeşil WhatsApp; uygulama içi mesaj yok');
        ok((r('return contactDockHTML(false,true)').match(/disabled/g)||[]).length===2,'kendi ilanında düğmeler kapalı');
        r('nakgoMarket.sync({enabled:true,marketplace:true,ready:true,checked:true,user:null,recovery:false})');
        ok(r('return nakgoMarket.guest()&&contactDockHTML(false,false).includes("kayıt ol")&&!contactDockHTML(false,false).includes("id=\\"mg\\"")'),'misafir kayda yönlendirilir, mesaj düğmesi yok');
    });
    test('Telefon yalnız izinli sunucu fonksiyonundan okunur',async()=>{
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const cloud=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
        const cols=/const listingColumns='([^']+)'/.exec(cloud)[1].split(',');
        ok(!cols.includes('contact_phone'),'liste sorgusu telefon sütununu istemez');
        ok(/rpc\('nakgo_listing_contact',\{p_id:id\}\)/.test(cloud),'numara RPC ile alınır');
        ok(/contact_phone:normalizeListingPhone\(x\.phone\)\|\|null,contact_consent:x\.contactConsent===true/.test(cloud),'izin açıkça gönderilir');
        const sql=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261111050000_listing_contact.sql'),'utf8');
        const grant=/grant select\(([^)]+)\)/.exec(sql)[1];
        ok(!/contact_phone/.test(grant)&&/revoke select on public\.listings from authenticated/.test(sql),'tablo okuma izni telefonu kapsamaz');
        return out;
    });
};

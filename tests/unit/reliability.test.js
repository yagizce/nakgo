/* Kullanıcı verisi, tarih ve başarısız kayıt regresyonları. */
module.exports = ({run,test,boot}) => {
  run("Ham veri bütün ekranlarda metin olarak gösterilir",(r,ok)=>{
    r("loads[0].cargo='<img src=x onerror=boom>';loads[0].note='<svg onload=boom>';loads[0].owner='A & B <firma>';render()");
    ok(!r("return main()").includes('<img src=x'),"kartta HTML çalışmaz");
    r("openLoad(loads[0].id)");const h=r("return sheet()");
    ok(h.includes('&lt;img src=x')&&h.includes('&lt;svg onload')&&h.includes('A &amp; B &lt;firma&gt;'),"detay, not ve ad bir kez kaçışlanır");
    r("q='\" autofocus onfocus=boom x=\"';render()");
    ok(r("return main()").includes('value="&quot; autofocus'),"arama özniteliğinden çıkamaz");
    r("openProfile({name:'<img src=x onerror=boom>'})");
    ok(!r("return sheet()").includes('<img src=x'),"profil adı güvenli");
  });
  test("Eksik ve bozuk kayıt eski veriyi kaybetmeden açılır",async()=>{
    const out=[];
    for(const raw of ['{}','null','{broken','[]',JSON.stringify({loads:[],offers:null,trucks:[],chats:7,calc:null})]){
      const r=boot({initialStore:{yy2:raw}});
      out.push([r("return Array.isArray(loads)&&Array.isArray(offers)&&Array.isArray(trucks)&&Number.isFinite(calc.km)"),"bozuk kayıt: "+raw]);
      out.push([r("return storageNotice.length>0"),"kurtarma açıklaması"]);
    }
    const r=boot({initialStore:{yy2:JSON.stringify({loads:[],offers:[],trucks:[],myCar:{displayName:'Korunan firma'}})}});
    out.push([r("return myCar.displayName==='Korunan firma'&&loads.length===0"),"geçerli boş liste ve profil korunur"]);
    return out;
  });
  run("Yazma başarısızsa ilan ve profil başarı sayılmaz",(r,ok)=>{
    const old=r("return loads.length");
    r("localStorage.setItem=()=>{throw Error('quota')};loads.unshift({...loads[0],id:991});");
    ok(r("return save()")===false,"başarısızlık çağırana döner");
    ok(r("return loads.length")===old,"hayali ilan geri alınır");
    ok(r("return setCar({displayName:'Kaybolacak'})")===false&&r("return myCar.displayName")!=="Kaybolacak","profil eski kalıcı duruma döner");
    ok(r("return el('#toast').textContent").includes('Kaydedilemedi'),"hata açıkça görünür");
  });
  run("Çizim ve arama depolamayı tekrar yazmaz",(r,ok)=>{
    r("localStorage.auditCount=0;localStorage.originalSet=localStorage.setItem;localStorage.setItem=(k,v)=>{if(k==='yy2')localStorage.auditCount++;localStorage.originalSet(k,v)};loads[0].note='Geçici bellek değişikliği';q='ank';render();render()");
    ok(r("return localStorage.auditCount")===0,"çizim kalıcı durumu yazmaz");
  });
  test("Belge fotoğrafı ve eski yüklenmiş işareti tutarlı",async()=>{
    const r=boot();r("cdocs['local/src']='data:image/jpeg;base64,AAAA';setCar({src:true,docs:{src:true}})");
    const saved=r("return localStorage.getItem('yy2')"),r2=boot({initialStore:{yy2:saved}});
    const r3=boot({initialStore:{yy2:JSON.stringify({loads:[],trucks:[],offers:[],myCar:{src:true,docs:{src:true}}})}});
    return [[r2("return cdocs['local/src']&&myCar.docs.src"),"belge yeniden açılır"],[r3("return myCar.src&&!myCar.docs.src"),"fotoğrafı olmayan eski kayıtta Yüklendi yazmaz, beyan korunur"]];
  });
  run("Takvim tarihi, hafta aralığı ve eski ilan geçişi",(r,ok)=>{
    ok(r("return dateFields('Yarın',new Date('2026-10-11T12:00:00').getTime()).date")==='2026-10-12',"yarın gerçek tarih");
    ok(r("return dateFields('Bu hafta',new Date('2026-10-05T12:00:00').getTime()).dateEnd")==='2026-10-11',"hafta sonu sabit");
    ok(r("return dateLabel({date:'2026-10-11'},new Date('2026-10-12T12:00:00').getTime())")!=='Bugün',"bugün etiketi ertesi gün eskir");
    ok(r("return expired({date:'2020-01-01',ts:Date.now()},'load')"),"geçmiş yükleme tarihi kapalı");
    ok(r("return expired(normalizeListing({id:Date.now()-30*864e5,mine:true,from:'A',to:'B',date:'Bugün'}),'load')"),"eski yerel kimlikten tarih taşınır");
    ok(r("return !validDay('2026-02-31')"),"geçersiz takvim günü reddedilir");
  });
  run("Güncel telefon, mesafe ve kapalı ilan kuralları",(r,ok)=>{
    r("myCar.phone='0555 111 22 33';loads[0].mine=true;loads[0].phone='Eski'");
    ok(r("return phoneOf(loads[0])")==='0555 111 22 33',"eski ilan güncel profil telefonunu kullanır");
    r("sort='km'");
    ok(r("return sortL([{id:1,km:450},{id:2,from:'Mersin',to:'Adana'}])[0].id")===2,"hesaplanan mesafe sıralamaya katılır");
    r("loads[1].closed=true");ok(r("return requestLoad(loads[1])")===false,"kapalı ilana iş açılmaz");
    r("loads[2].date='2020-01-01'");ok(r("return requestLoad(loads[2])")===false,"süresi dolmuş ilana iş açılmaz");
    r("q='İstanbul';openFilter()");
    ok(r("return el('#fs').textContent").startsWith(String(r("return loads.filter(x=>visibleListing(x)).length"))),"filtre ve liste sayısı aynı");
  });
  run("Engelleme ve silinen ilan iş geçmişini korur",(r,ok)=>{
    r("requestLoad(loads[0]);blockUser('other')");ok(r("return offers.length")===1,"yerelde engelleme iş listesini silmez");
    r("cloud=true;me='carrier';allO=[{loadId:990,bidder:'carrier',ownerUid:'owner',status:'ok',stage:3,listing:{id:990,from:'İzmir',to:'Ankara',cargo:'Geçmiş'}}];rebuild()");
    ok(r("return offers.length===1&&offers[0].from==='İzmir'&&offers[0].stage===3"),"silinen ilan özeti işte saklanır");
    r("delete allO[0].listing;offers=[];rebuild()");ok(r("return offers.length===1&&offers[0].from==='İlan kaldırıldı'"),"eski özetsiz iş de kaybolmaz");
  });
};

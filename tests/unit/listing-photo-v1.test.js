/* B3-d: ilan ayrıntısında fotoğrafın sonradan yüklenmesi (API v1 listesi yalnız has_photo taşır). Yer tutucu, başarı, boş
   yanıt, hata + yeniden dene, zaman aşımı ve başka ilan açıldığında eski sonucun ekrana yazılmaması. */
module.exports=({test,boot})=>{
 test('İlan ayrıntısı: fotoğraf sonradan yüklenir; hata, boş veri ve ağ kesintisi ele alınır',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const r=boot();
  const JPEG='data:image/jpeg;base64,/9j/AAAA';
  r(`nakgoMarket.active=()=>true;nakgoMarket.token=()=>'hesap:1';globalThis.__photo=null;nakgoAuth.listingPhoto=id=>globalThis.__photo(id);`);
  const tick=()=>new Promise(res=>setTimeout(res,0));
  const slot=()=>r(`const s=$("#detail-photo");return {html:s.innerHTML,outer:s.outerHTML||'',text:s.textContent};`);
  const fresh=()=>r(`delete $("#detail-photo").outerHTML;$("#detail-photo").innerHTML='';$("#detail-photo").textContent='';`);
  // Yer tutucu yalnız uzak, fotoğraflı ve henüz fotoğrafı gelmemiş ilanda.
  ok(r(`return detailPhotoHTML({_remote:true,hasPhoto:true,img:''})`).includes('Fotoğraf yükleniyor'),'yer tutucu');
  ok(r(`return detailPhotoHTML({_remote:true,hasPhoto:true,img:'${JPEG}'})`).startsWith('<img class="ph"'),'fotoğraf varsa doğrudan gösterilir (v0 satırı)');
  ok(r(`return detailPhotoHTML({_remote:true,hasPhoto:false,img:''})`)==='','fotoğrafsız ilan: hiçbir şey');
  ok(r(`nakgoMarket.active=()=>false;const h=detailPhotoHTML({_remote:true,hasPhoto:true,img:''});nakgoMarket.active=()=>true;return h`)==='','misafir: yer tutucu yok (v1 fotoğrafı yalnız üyeye verir)');
  // Başarı.
  r(`globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:5};globalThis.__photo=async id=>id===5?'${JPEG}':'';loadDetailPhoto(globalThis.__l);`);
  await tick();
  ok(slot().outer.includes(JPEG)&&r(`return globalThis.__l.img`)===JPEG,'fotoğraf geldi: yer tutucu fotoğrafla değişti, ilana önbellek');
  // Boş yanıt (fotoğraf bu arada kaldırılmış).
  fresh();r(`globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:6};globalThis.__photo=async()=> '';loadDetailPhoto(globalThis.__l);`);await tick();
  ok(r(`return globalThis.__l.hasPhoto`)===false&&!slot().outer,'boş yanıt: yer tutucu kaldırılır, hata gösterilmez');
  // Hata ve yeniden dene.
  fresh();r(`globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:7};globalThis.__photo=async()=>{throw new TypeError('fetch failed')};loadDetailPhoto(globalThis.__l);`);await tick();
  ok(slot().html.includes('Fotoğraf yüklenemedi')&&slot().html.includes('Yeniden dene'),'ağ hatası: mesaj ve yeniden dene');
  r(`globalThis.__photo=async()=>'${JPEG}';$("#detail-photo-retry").onclick();`);await tick();
  ok(slot().outer.includes(JPEG),'yeniden dene: fotoğraf geldi');
  // Zaman aşımı: yanıt hiç gelmezse 15 sn sonra hata.
  fresh();r(`globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:8};globalThis.__photo=()=>new Promise(()=>{});loadDetailPhoto(globalThis.__l);flush();`);await tick();
  ok(slot().html.includes('Fotoğraf yüklenemedi'),'zaman aşımı: yeniden dene gösterilir');
  // Eski sonuç: başka ilan açıldıktan sonra gelen fotoğraf yazılmaz.
  fresh();
  r(`let done;globalThis.__photo=()=>new Promise(res=>{done=res;});globalThis.__done=v=>done(v);globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:9};loadDetailPhoto(globalThis.__l);`);
  r(`globalThis.__photo=()=>new Promise(()=>{});loadDetailPhoto({_remote:true,hasPhoto:true,img:'',remoteId:10});globalThis.__done('${JPEG}');`);await tick();
  ok(!slot().outer,'eski ilanın fotoğrafı yeni ayrıntıya yazılmadı');
  // Oturum değişirse yazılmaz.
  fresh();r(`let done;globalThis.__photo=()=>new Promise(res=>{done=res;});globalThis.__l={_remote:true,hasPhoto:true,img:'',remoteId:11};loadDetailPhoto(globalThis.__l);nakgoMarket.token=()=>'hesap:2';done('${JPEG}');`);await tick();
  ok(!slot().outer,'oturum değişince yazılmadı');
  return out;
 });
};

module.exports=({test,fs,path,ROOT})=>{
 // Panel betiği vm içinde çalışır; düğmeler innerHTML'deki data-* özniteliklerinden üretilen sahte öğelerdir.
 function harness(adminLive){
  const vm=require('node:vm'),elements={},made={},timers=[];
  const body={dataset:{},innerHTML:'',clientWidth:1200,querySelectorAll(selector){
   const list=[];for(const attr of selector.match(/data-[a-z-]+/g)||[]){const re=new RegExp(attr+'="([^"]*)"','g');let m;
    while((m=re.exec(body.innerHTML))){const key=attr.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());const el={dataset:{[key]:m[1]},onclick:null,classList:{toggle(){}}};list.push(el);(made[attr]=made[attr]||[]).push(el);}}
   return list;}};
  elements['#sheetBody']=body;
  const store=new Map(),overview={users:3,listings:2,listing_states:{all:2}};
  const ctx={nakgoMarket:{active:()=>true,token:()=>'admin'},console,esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]),
   nakgoAuth:{adminPage:async section=>section==='overview'?overview:[],adminLive},
   cities:['İzmir','Manisa'],vehicles:['Tır'],bodies:['Tenteli'],LL:{'İzmir':[27.14,38.42],'Manisa':[27.43,38.61],'Hakkari':[43.74,37.58]},
   localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
   setTimeout:(fn,ms)=>{timers.push([fn,ms]);return timers.length;},clearTimeout(){},
   closeSheet(){body.dataset.k='';},
   $:key=>{if(key==='#sheetBody')return body;if(key.startsWith('#admin-')&&!body.innerHTML.includes('id="'+key.slice(1)+'"'))return null;return elements[key]||(elements[key]={classList:{add(){}},onclick:null});}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/js/screens/admin.js'),'utf8'),ctx);
  const click=async(attr,value)=>{const el=(made[attr]||[]).filter(e=>Object.values(e.dataset)[0]===value).pop();if(!el)throw Error('missing '+attr+'='+value);await el.onclick();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
  return {ctx,body,elements,timers,store,click,made};
 }
 const sample=(kind)=>({at:'2026-11-15T09:30:00Z',active:7,today:12,yesterday:8,last_hour:3,users_today:2,calls:5,whatsapp:9,clicks_yesterday:7,
  hours:Array.from({length:24},(_,h)=>({h,loads:h===12?4:0,trucks:h===12?1:0,clicks:h===12?6:0})),minutes:Array.from({length:60},(_,i)=>i===59?2:0),
  recent:[{id:41,kind:kind||'load',from_city:'İzmir',to_city:'Manisa',vehicle:'Tır',created_at:'2026-11-15T09:28:00Z'}],
  from_cities:{'İzmir':3,'Hakkari':1},to_cities:{'Manisa':4}});
 test('Canlı sayfa yalnız sunucudaki sayıları gösterir, sekmeler ve yenileme çalışır',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]),calls=[];let fail=false;
  const h=harness(async kind=>{calls.push(kind);if(fail)throw Error('offline');return sample(kind);});
  await h.ctx.openAdminPanel();
  ok(h.body.innerHTML.includes('data-admin-section="live"')&&h.body.innerHTML.includes('Canlı'),'menüde Canlı bölümü var');
  ok(calls.length===0,'Canlı açılmadan canlı veri istenmez');
  await h.click('data-admin-section','live');
  const html=h.body.innerHTML;
  ok(calls[0]===''&&html.includes('Ara tıklaması')&&html.includes('WhatsApp tıklaması'),'tüm ilanlar için özet ve tıklama kartları');
  ok(html.includes('>5<')&&html.includes('>9<')&&html.includes('Dün bu saate göre +50%'),'sayılar ve düne göre değişim gösterilir');
  ok(html.includes('İzmir → Manisa')&&html.includes('data-admin-live-open="41"'),'son ilanlar akışı');
  ok(html.includes('class="adm-map"')&&html.includes('İzmir: 3 ilan')&&html.includes('Hakkari: 1 ilan'),'il haritası çıkış sayılarını çizer');
  ok(!html.includes('adm-dark'),'varsayılan açık görünüm');
  ok(h.timers.length===1&&h.timers[0][1]===30000,'30 saniyede bir yenilenir');
  await h.click('data-admin-live-side','to');
  ok(h.body.innerHTML.includes('Manisa: 4 ilan')&&!h.body.innerHTML.includes('İzmir: 3 ilan'),'Varış haritası');
  await h.click('data-admin-live-kind','truck');
  ok(calls[calls.length-1]==='truck'&&h.body.innerHTML.includes('Yayında boş araç ilanı'),'Boş araç sekmesi sunucuya tür ile sorar');
  await h.elements['#admin-live-theme'].onclick();
  ok(h.body.innerHTML.includes('adm adm-dark')&&h.store.get('nakgo-admin-live-dark')==='1','koyu görünüm isteğe bağlı ve hatırlanır');
  fail=true;await h.timers[h.timers.length-1][0]();await new Promise(r=>setImmediate(r));
  ok(h.body.innerHTML.includes('Bağlantı kurulamadı')&&h.body.innerHTML.includes('İzmir → Manisa'),'geçici hatada son veriler kalır');
  fail=false;const before=calls.length;await h.click('data-admin-section','overview');
  const pending=h.timers.length;await h.timers[pending-1][0]();
  ok(calls.length===before&&!h.body.innerHTML.includes('adm-dark'),'Canlı bölümünden çıkınca yenileme durur ve koyu görünüm uygulanmaz');
  await h.click('data-admin-section','live');await h.click('data-admin-live-open','41');
  ok(h.body.innerHTML.includes('İlanlar'),'akıştaki ilan İlanlar bölümünde açılır');
  return out;
 });
 test('Canlı sayfa yetki yoksa veri göstermez',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const h=harness(async()=>{throw Error('Admin required');});
  await h.ctx.openAdminPanel();await h.click('data-admin-section','live');
  ok(h.body.innerHTML.includes('Canlı veriler alınamadı')&&!h.body.innerHTML.includes('Ara tıklaması'),'hata ekranı, sayı yok');
  ok(h.timers.length===0,'hatada yenileme kurulmaz');
  return out;
 });
 test('Ara ve WhatsApp tıklaması kanal bilgisiyle sunucuya gider',()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const details=fs.readFileSync(path.join(ROOT,'src/js/screens/details.js'),'utf8'),cloud=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
  ok(details.includes('nakgoAuth.listingContact(item.remoteId, channel)'),'detay ekranı kanalı iletir');
  ok(cloud.includes("{p_id:id,p_channel:channel}")&&cloud.includes("channel==='call'||channel==='whatsapp'"),'yalnız call/whatsapp gönderilir');
  const sql=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261115010000_admin_live.sql'),'utf8');
  const table=(/create table private\.contact_clicks \(([\s\S]*?)\n\);/.exec(sql)||[])[1]||'';
  ok(/hour timestamptz/.test(table)&&/channel text/.test(table)&&!/user|listing|phone|ip\b|actor/.test(table),'sayaç tablosunda kişi veya ilan bilgisi yok');
  ok(/revoke all on private\.contact_clicks from public,anon,authenticated/.test(sql)&&/if not private\.is_nakgo_admin\(\)/.test(sql),'sayaç doğrudan okunamaz, canlı veri yalnız yöneticiye');
  return out;
 });
};

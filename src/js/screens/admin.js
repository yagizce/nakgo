/**
 * Yönetici paneli
 * Ortak erişimi her istekte sunucu tarafından doğrulanır.
 */
const nakgoAdminAccess=(()=>{
    let generation=0,account='',ready=false,busy=false,authorized=false;
    const isAdmin=()=>nakgoMarket.active()&&ready&&authorized&&account===nakgoMarket.token();
    function reset(){generation++;account='';ready=busy=authorized=false;}
    async function refresh(){
        if(!nakgoMarket.active()||busy)return;
        const current=nakgoMarket.token(),ticket=++generation;busy=true;authorized=false;
        try{const role=await nakgoAuth.adminRole();if(ticket!==generation||current!==nakgoMarket.token())return;account=current;authorized=role===true;ready=true;}
        catch(error){if(ticket===generation&&current===nakgoMarket.token()){account=current;authorized=false;ready=true;}}
        finally{if(ticket===generation&&current===nakgoMarket.token()){busy=false;if(tab==='me')render();}}
    }
    function ensure(){if(nakgoMarket.active()&&!busy&&(!ready||account!==nakgoMarket.token()))refresh();}
    return {isAdmin,reset,refresh,ensure};
})();
let adminPanelGeneration=0;
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const generation=++adminPanelGeneration,account=nakgoMarket.token(), body=$('#sheetBody');
    let section='overview',offset=0,search='',request=0;
    const titles={overview:'Genel bakış',whatsapp:'WhatsApp ilanları',users:'Kullanıcılar',listings:'İlanlar',moderation:'Yönetim işlem geçmişi'};
    const valid=()=>generation===adminPanelGeneration&&account===nakgoMarket.token()&&body.dataset.k==='admin';
    const date=value=>new Date(value).toLocaleString('tr-TR');
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        body.innerHTML='<div class="detail-top"><b>NakGo · Yönetici paneli</b><button class="chip" id="admin-close">Kapat ×</button></div><div class="load">'+
            (authorized?'<div role="group" aria-label="Yönetim bölümleri" class="admin-tabs">'+Object.entries(titles).map(([key,label])=>'<button class="chip '+(section===key?'on':'')+'" data-admin-section="'+key+'" aria-pressed="'+(section===key)+'">'+label+'</button>').join('')+'</div>':'')+content+'</div>';
        $('#admin-close').onclick=closeSheet;
        body.querySelectorAll('[data-admin-section]').forEach(button=>button.onclick=()=>{section=button.dataset.adminSection;offset=0;search='';load();});
    }
    // WhatsApp taslakları: yalnız mesajda yazılı numara, güzergâh ve araç tipi zorunlu; yayın her zaman yönetici onayıyla.
    const waStatus=v=>({draft:'Taslak',published:'Yayında',rejected:'Reddedildi',withdrawn:'Yayından kaldırıldı',purged:'Saklama süresi doldu'})[v]||v;
    const waPoint=p=>p&&p.city?p.city+(p.district?' ('+p.district+')':''):'?';
    const waReady=f=>!!(f&&f.from&&f.from.city&&f.destinations&&f.destinations[0]&&f.destinations[0].city&&f.vehicle&&f.contactPhone);
    async function whatsappPage(ticket){
        const data=await nakgoAuth.whatsappRPC('page',{p_offset:offset});
        if(!valid()||ticket!==request)return;
        const rows=data.drafts.slice(0,20),more=data.drafts.length>20;
        frame('<h2>WhatsApp ilanları</h2><p>İşlenmeyi bekleyen mesaj: '+esc(String(data.pending))+' · Hatalı: '+esc(String(data.failed))+'</p>'+(data.failed?'<button class="chip" id="wa-retry">Hatalı mesajları tekrar dene</button>':'')+
            (rows.map(r=>{const f=r.fields||{};return '<article class="load"><b>#'+esc(String(r.id))+' · '+esc(waPoint(f.from))+' → '+esc(waPoint((f.destinations||[])[0]))+'</b><p>'+esc((f.vehicle||'Araç belirsiz')+' · '+(f.contactPhone||'Numara yok'))+'</p><p>'+esc(waStatus(r.status))+(r.status==='draft'?(waReady(f)?' · Yayına hazır':' · Eksik bilgi'):'')+'</p><button class="chip" data-wa-open="'+esc(String(r.id))+'">İncele</button></article>';}).join('')||'<p>Henüz WhatsApp mesajı yok.</p>')+
            '<div class="admin-tabs"><button class="chip" id="wa-prev" '+(offset===0?'disabled':'')+'>Önceki</button><button class="chip" id="wa-refresh">Yenile</button><button class="chip" id="wa-next" '+(more?'':'disabled')+'>Sonraki</button></div>',true);
        body.querySelectorAll('[data-wa-open]').forEach(b=>b.onclick=()=>whatsappDetail(Number(b.dataset.waOpen)));
        $('#wa-prev').onclick=()=>{offset=Math.max(0,offset-20);load();};$('#wa-next').onclick=()=>{offset+=20;load();};$('#wa-refresh').onclick=load;
        if($('#wa-retry'))$('#wa-retry').onclick=async()=>{try{await nakgoAuth.whatsappRPC('retry');if(valid())load();}catch{if(valid())toast('Tekrar deneme başlatılamadı');}};
    }
    async function whatsappDetail(id){
        const ticket=++request;frame('<p role="status">Taslak yükleniyor…</p>');
        try{
            const d=await nakgoAuth.whatsappRPC('detail',{p_id:id});if(!valid()||ticket!==request)return;
            const f=d.fields||{},dest=(f.destinations||[])[0]||{},o=(list,v,empty)=>(empty?'<option value="">'+empty+'</option>':'')+list.map(x=>'<option '+(x===v?'selected':'')+'>'+esc(x)+'</option>').join('');
            const cityOpts=v=>o(cities,v,'Seç');
            frame('<h2>WhatsApp taslağı #'+esc(String(id))+'</h2><p>'+esc(waStatus(d.status))+'</p>'+
                '<h3>Kaynak mesaj (değiştirilemez)</h3><pre class="wa-source">'+esc((d.source&&d.source.text)||'Kaynak saklama süresi dolmuş.')+'</pre>'+
                '<form id="wa-form"><label for="wa-kind">İlan türü</label><select id="wa-kind"><option value="load" '+(f.kind!=='truck'?'selected':'')+'>Yük</option><option value="truck" '+(f.kind==='truck'?'selected':'')+'>Boş araç</option></select>'+
                '<div class="row"><div><label for="wa-from">Nereden</label><select id="wa-from">'+cityOpts(f.from&&f.from.city)+'</select></div><div><label for="wa-fromd">İlçe</label><input id="wa-fromd" maxlength="40" value="'+esc((f.from&&f.from.district)||'')+'"></div></div>'+
                '<div class="row"><div><label for="wa-to">Nereye</label><select id="wa-to">'+cityOpts(dest.city)+'</select></div><div><label for="wa-tod">İlçe</label><input id="wa-tod" maxlength="40" value="'+esc(dest.district||'')+'"></div></div>'+
                '<label for="wa-vehicle">Araç tipi</label><select id="wa-vehicle">'+o(vehicles,f.vehicle,'Seç')+'</select>'+
                '<label for="wa-phone">Mesajdaki telefon</label><input id="wa-phone" type="tel" maxlength="32" value="'+esc(f.contactPhone||'')+'">'+
                '<label for="wa-body">Kasa tipi (isteğe bağlı)</label><select id="wa-body">'+o(bodies,f.body,'Belirtilmedi')+'</select>'+
                '<div class="row"><div><label for="wa-amount">Tonaj (isteğe bağlı)</label><input id="wa-amount" type="number" min="0" step="any" value="'+esc(f.amount==null?'':String(f.amount))+'"></div><div><label for="wa-cargo">Yük cinsi (isteğe bağlı)</label><input id="wa-cargo" maxlength="120" value="'+esc(f.cargo||'')+'"></div></div>'+
                '<label for="wa-timing">Yükleme zamanı (isteğe bağlı)</label><input id="wa-timing" maxlength="32" value="'+esc(f.timing||'')+'">'+
                '<label for="wa-note">İlan notu (isteğe bağlı)</label><textarea id="wa-note" maxlength="1000" rows="2">'+esc(f.publicNote||'')+'</textarea>'+
                '<label for="wa-basis">Yayın gerekçesi</label><input id="wa-basis" maxlength="1000" value="Kendi paylaştığı grup ilanı (alenileştirme)">'+
                '<p id="wa-error" role="alert"></p><div class="admin-tabs"><button class="btn" type="button" data-wa-action="publish">Yayınla</button><button class="chip" type="button" data-wa-action="save">Kaydet</button>'+
                (d.status==='published'?'<button class="chip" type="button" data-wa-action="withdraw">Yayından kaldır</button>':'<button class="chip" type="button" data-wa-action="reject">Reddet</button>')+'<button class="chip" type="button" id="wa-back">Listeye dön</button></div></form>');
            $('#wa-back').onclick=load;let sending=false;
            body.querySelectorAll('[data-wa-action]').forEach(b=>b.onclick=async()=>{
                if(sending||!valid())return;const action=b.dataset.waAction,v=s=>$(s).value.trim();
                const amount=v('#wa-amount'),phone=normalizeListingPhone(v('#wa-phone'));
                const next={...f,kind:v('#wa-kind'),from:{city:v('#wa-from')||null,district:v('#wa-fromd')||null},destinations:[{city:v('#wa-to')||null,district:v('#wa-tod')||null},...(f.destinations||[]).slice(1)],
                    vehicle:v('#wa-vehicle')||null,body:v('#wa-body')||null,amount:amount===''?null:Number(amount),cargo:v('#wa-cargo')||null,timing:v('#wa-timing')||null,publicNote:v('#wa-note')||null,contactPhone:phone||null};
                if(action==='publish'&&!waReady(next)){$('#wa-error').textContent='Yayın için nereden, nereye, araç tipi ve mesajdaki telefon gerekli.';return;}
                if(next.amount!==null&&!(next.amount>0)){$('#wa-error').textContent='Tonaj sıfırdan büyük olmalı ya da boş bırakılmalı.';return;}
                sending=true;body.querySelectorAll('button').forEach(x=>x.disabled=true);
                try{await nakgoAuth.whatsappRPC('change',{p_id:id,p_revision:d.revision,p_action:action,p_fields:next,p_basis:action==='publish'?v('#wa-basis'):null});if(valid())await whatsappDetail(id);}
                catch(e){if(!valid())return;frame('<p role="alert">'+esc(e&&e.code==='40001'?'Kayıt başka bir yerde değişmiş. Güncel kaydı yükle.':'İşlem doğrulanamadı. Alanları ve yayın gerekçesini kontrol et.')+'</p><button class="chip" id="wa-reload">Güncel kaydı yükle</button>');$('#wa-reload').onclick=()=>whatsappDetail(id);}
            });
        }catch{if(valid()&&ticket===request){frame('<p role="alert">Taslak açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="wa-back">Listeye dön</button>');$('#wa-back').onclick=load;}}
    }
    async function load(){
        const ticket=++request;frame('<p role="status">Yönetici erişimi kontrol ediliyor…</p>');
        try{
            if(section==='whatsapp'){await whatsappPage(ticket);return;}
            const data=await nakgoAuth.adminPage(section,offset,search);
            if(!valid()||ticket!==request)return;
            if(section==='overview'){
                frame('<h2>Genel bakış</h2><div class="stat profile-stats">'+[['users','Kullanıcı'],['listings','Aktif ilan']].map(([key,label])=>'<div><b>'+esc(String(data[key]))+'</b><span>'+label+'</span></div>').join('')+'</div><button class="chip" id="admin-refresh">Yenile</button>',true);
                $('#admin-refresh').onclick=load;return;
            }
            const rows=data.slice(0,20),more=data.length>20;
            const searchForm=['users','listings'].includes(section)?'<form id="admin-search"><label for="admin-term">Ad veya güzergâh ara</label><input id="admin-term" maxlength="100" value="'+esc(search)+'"><button class="chip" type="submit">Ara</button></form>':'';
            const cards=rows.map((row,index)=>{
                const actionButton=section==='users'?(row.protected?'<p>Yönetici hesabı · Korumalı</p>':'<p>'+esc(row.suspended?'Faaliyetleri askıda':'Aktif hesap')+'</p><button class="chip" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>'):'<button class="chip" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
                const reason=row.reason?'<p>Gerekçe: '+esc(row.reason)+'</p>':'';
                if(section==='users')return '<article class="load"><b>'+esc(row.display_name||'İsimsiz hesap')+'</b><p>'+esc(row.city||'')+' · '+esc(row.account_type==='carrier'?'Taşıyıcı':row.account_type==='owner'?'Yük sahibi':'Belirtilmemiş')+'</p><small>'+esc(date(row.created_at))+'</small>'+reason+actionButton+'</article>';
                if(section==='listings')return '<article class="load"><b>#'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</b><p>'+esc(row.owner_label)+' · '+esc(row.kind==='load'?'Yük':'Araç')+'</p><small>'+esc(({active:'Aktif',closed:'Kapalı',archived:'Arşiv'})[row.status]||row.status)+'</small>'+reason+actionButton+'</article>';
                if(section==='moderation')return '<article class="load"><b>'+esc(({suspend:'Faaliyetler askıya alındı',resume:'Askı kaldırıldı',remove:'İlan kaldırıldı',restore:'İlan engeli açıldı'})[row.action]||row.action)+'</b><p>'+esc(row.reason)+'</p><small>'+esc(row.actor_label)+' · '+esc(date(row.created_at))+'</small><p>Hedef: '+esc(row.target)+'</p></article>';
                return '<article class="load"><b>Başvuru #'+esc(String(row.application_id))+' · '+esc(({submit:'Gönderildi',withdraw:'Geri çekildi',approved:'Onaylandı',rejected:'Düzeltme istendi'})[row.action]||row.action)+'</b><p>'+esc(row.note||'')+'</p><small>'+esc(date(row.created_at))+' · İşlemi yapan: '+esc(row.actor_id)+'</small></article>';
            }).join('');
            frame('<h2>'+titles[section]+'</h2>'+searchForm+(cards||'<p>Kayıt bulunamadı.</p>')+'<div class="admin-tabs"><button class="chip" id="admin-prev" '+(offset===0?'disabled':'')+'>Önceki</button><span>Sayfa '+(offset/20+1)+'</span><button class="chip" id="admin-next" '+(!more?'disabled':'')+'>Sonraki</button><button class="chip" id="admin-refresh">Yenile</button></div>',true);
            body.querySelectorAll('[data-admin-action]').forEach(button=>button.onclick=()=>confirmAction(rows[Number(button.dataset.adminAction)]));
            $('#admin-prev').onclick=()=>{offset=Math.max(0,offset-20);load();};$('#admin-next').onclick=()=>{offset+=20;load();};$('#admin-refresh').onclick=load;
            if($('#admin-search'))$('#admin-search').onsubmit=event=>{event.preventDefault();search=$('#admin-term').value.trim();offset=0;load();};
        }catch(error){if(valid()&&ticket===request){frame('<p role="alert">Yönetici paneli açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="admin-retry">Tekrar dene</button>');$('#admin-retry').onclick=load;}}
    }
    function confirmAction(row){
        if(!valid())return;
        ++request;
        const kind=section==='users'?'user':'listing',action=kind==='user'?(row.suspended?'resume':'suspend'):(row.removed?'restore':'remove');
        const label=({suspend:'Faaliyetleri askıya al',resume:'Askıyı kaldır',remove:'İlanı yayından kaldır',restore:'Kaldırma engelini aç'})[action];
        const explanation=({suspend:'Yeni ilan ve mesaj işlemleri durdurulur. Hesaba giriş devam eder. Mevcut ilanlar otomatik kaldırılmaz.',resume:'Hesabın yeni işlem yapmasına yeniden izin verilir.',remove:'İlan yayından kalkar ve sahibi yeniden yayımlayamaz. Mevcut iş ve görüşme geçmişi korunur.',restore:'İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.'})[action];
        const target=kind==='listing'?'<p id="admin-target">İlan #'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</p>':'';
        frame('<h2>'+label+'</h2><b>'+esc(row.display_name||row.owner_label||'')+'</b>'+target+'<p>'+explanation+'</p><form id="admin-confirm"><label for="admin-reason">İşlem gerekçesi (zorunlu)</label><textarea id="admin-reason" minlength="3" maxlength="500" required></textarea><p id="admin-action-error" role="alert"></p><button class="btn" id="admin-submit" type="submit">'+label+'</button><button class="chip" id="admin-cancel" type="button">Vazgeç</button></form>');
        $('#admin-cancel').onclick=load;
        let sending=false;
        $('#admin-confirm').onsubmit=async event=>{
            event.preventDefault();if(sending||!valid())return;
            const reason=$('#admin-reason').value.trim();if(reason.length<3){$('#admin-action-error').textContent='En az 3 karakterlik bir gerekçe yaz.';return;}
            sending=true;$('#admin-submit').disabled=true;$('#admin-cancel').disabled=true;
            try{await nakgoAuth.adminModerate(kind,String(row.id),action,reason,Number(row.revision));if(valid())await load();}
            catch(error){if(!valid())return;
                frame('<p role="alert">'+(error?.code==='40001'?'Bu kayıt başka bir yönetici tarafından değiştirildi. Güncel durumu yükle.':'İşlem sonucu doğrulanamadı. Yeniden işlem yapmadan önce güncel durumu yükle.')+'</p><button class="chip" id="admin-reload">Güncel durumu yükle</button>');
                $('#admin-reload').onclick=load;
            }
        };
    }
    await load();
}

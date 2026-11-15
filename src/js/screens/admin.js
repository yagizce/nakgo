/**
 * Yönetici paneli
 * Ortak erişimi her istekte sunucu tarafından doğrulanır.
 */
const nakgoAdminAccess=(()=>{
    let generation=0,account='',ready=false,busy=false,authorized=false;
    const isAdmin=()=>nakgoMarket.active()&&ready&&authorized&&account===nakgoMarket.token();
    function reset(){generation++;account='';ready=busy=authorized=false;}
    // Profil yüklenmeden gelen "giriş gerekli" hatası ret sayılmaz; profil gelince yeniden sorulur.
    async function refresh(){
        if(!nakgoMarket.active()||busy)return;
        const current=nakgoMarket.token(),ticket=++generation;busy=true;authorized=false;let retry=false;
        try{const role=await nakgoAuth.adminRole();if(ticket!==generation||current!==nakgoMarket.token())return;account=current;authorized=role===true;ready=true;}
        catch(error){if(ticket===generation&&current===nakgoMarket.token()){if(error?.message==='Sign in required')retry=true;else{account=current;authorized=false;ready=true;}}}
        finally{if(ticket===generation&&current===nakgoMarket.token()){busy=false;if(!retry&&(tab==='me'||ADMIN_HOST))render();}}
    }
    function ensure(){if(nakgoMarket.active()&&!busy&&(!ready||account!==nakgoMarket.token()))refresh();}
    const checked=()=>ready&&account===nakgoMarket.token();
    return {isAdmin,checked,reset,refresh,ensure};
})();
let adminPanelGeneration=0,adminHostOpened=false;
// Yönetici adresi: giriş, yetki kontrolü ve tam ekran panel. Yetki her istekte sunucuda yeniden doğrulanır.
// Yönetici sitesinin giriş ekranı: uygulama açılışı ve uygulama giriş penceresi yerine panelle aynı tasarım.
function renderAdminHost(m){
    const frame=(body)=>'<div class="adm-login"><div class="adm-login-brand"><i aria-hidden="true"></i><div><b>NakGo</b><p>Yönetici paneli</p></div></div><section class="adm-login-card">'+body+'</section></div>';
    const out=()=>{adminHostOpened=false;nakgoAuth.signOut();};
    if(!nakgoMarket.active()){
        adminHostOpened=false;
        m.innerHTML=frame('<h1>Yönetici girişi</h1><p>Panel yalnız yönetici hesaplarına açılır.</p>'+
            '<button class="adm-login-google" id="admin-signin" type="button"><span aria-hidden="true">G</span>Google ile giriş yap</button>'+
            '<p class="adm-login-or"><span>veya e-postayla</span></p>'+
            '<form id="admin-login-form" class="adm-login-form"><label for="admin-login-email">E-posta</label><input id="admin-login-email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" required maxlength="254">'+
            '<label for="admin-login-password">Şifre</label><input id="admin-login-password" type="password" autocomplete="current-password" required maxlength="128">'+
            '<p id="admin-login-msg" role="status" aria-live="polite"></p><button class="adm-login-submit" id="admin-login-submit" type="submit">Giriş yap</button></form>');
        const google=$('#admin-signin'),form=$('#admin-login-form'),submit=$('#admin-login-submit'),msg=$('#admin-login-msg');
        const busy=on=>{google.disabled=on;submit.disabled=on;};
        google.onclick=async()=>{if(google.disabled)return;busy(true);msg.textContent='Google’a yönlendiriliyorsun…';
            try{await nakgoAuth.signInGoogle();}catch(error){if(!form.isConnected)return;msg.textContent=nakgoAuth.message(error);busy(false);}};
        form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;busy(true);msg.textContent='Giriş yapılıyor…';
            try{await nakgoAuth.signIn($('#admin-login-email').value.trim(),$('#admin-login-password').value);}
            catch(error){if(!form.isConnected)return;msg.textContent=nakgoAuth.message(error);busy(false);}};
        return;
    }
    nakgoAdminAccess.ensure();
    if(!nakgoAdminAccess.checked()){m.innerHTML=frame('<h1>Yönetici girişi</h1><p role="status">Yetki kontrol ediliyor…</p>');return;}
    if(!nakgoAdminAccess.isAdmin()){m.innerHTML=frame('<h1>Bu hesap yönetici değil</h1><p role="alert">Bu hesabın yönetici yetkisi yok. Yönetici hesabınla tekrar giriş yap.</p><button class="adm-login-submit" id="admin-signout" type="button">Çıkış yap</button>');$('#admin-signout').onclick=out;return;}
    m.innerHTML=frame('<h1>Yönetici paneli</h1><p>Panel bu ekranın üstünde açılır. Kapattıysan yeniden açabilirsin.</p><button class="adm-login-submit" id="admin-open" type="button">Paneli aç</button><button class="adm-login-google" id="admin-signout" type="button">Çıkış yap</button>');
    $('#admin-open').onclick=openAdminPanel;$('#admin-signout').onclick=out;
    if(!adminHostOpened){adminHostOpened=true;openAdminPanel();}
}
// Panel: yan menü, özet kartları, filtreli liste ve seçili kaydın ayrıntısı. Yerleşim kapsayıcı genişliğine göre
// değişir: dar ekranda liste kartlara döner, ayrıntı tam ekran açılır. Görünen her değer esc ile kaçırılır.
const adminIcons={overview:'<path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z"/>',live:'<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',listings:'<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.4c1.6.6 2.6 2.1 3 4.6"/>',
    moderation:'<path d="M12 4 5 7v5c0 4 3 6.7 7 8 4-1.3 7-4 7-8V7z"/><path d="m9 12 2 2 4-4"/>',archive:'<path d="M4 5h16v4H4zM5.5 9v10h13V9"/><path d="M10 13h4"/>',stats:'<path d="M5 20V10M12 20V4M19 20v-7"/>',
    refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'};
const adminIcon=name=>'<svg class="adm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+adminIcons[name]+'</svg>';
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const generation=++adminPanelGeneration,account=nakgoMarket.token(), body=$('#sheetBody');
    const host=typeof ADMIN_HOST!=='undefined'&&ADMIN_HOST;
    let section='overview',offset=0,search='',filter='',request=0,stats=null,rows=[],more=false,selected=0,panel=null,period='day';
    // query: birleşik filtreler (sunucuda doğrulanır). checked: toplu işlem için seçili ilanlar (yalnız bu sayfa).
    let retention=null,query={},checked=new Map(),filtersOpen=false,range={days:30,from:'',to:''},insights=null,dayPage=0,tip=-1;
    // Canlı sayfa: 30 sn'de bir kendini yeniler; sekme gizliyken istek atmaz. Koyu görünüm yalnız bu sayfada ve isteğe bağlıdır.
    let live=null,liveKind='',liveSide='from',liveTimer=0,liveStale=false,liveDark=false;
    try{liveDark=localStorage.getItem('nakgo-admin-live-dark')==='1';}catch{}
    const history=new Map();
    const titles={overview:'Genel bakış',live:'Canlı',listings:'İlanlar',users:'Kullanıcılar',moderation:'İşlem geçmişi',archive:'Arşiv ve saklama',stats:'İstatistikler'};
    const valid=()=>generation===adminPanelGeneration&&account===nakgoMarket.token()&&body.dataset.k==='admin';
    // Tüm saatler Türkiye saatiyle gösterilir; cihazın saat dilimi sonucu değiştirmez.
    const TZ='Europe/Istanbul';
    const date=value=>value?new Date(value).toLocaleString('tr-TR',{timeZone:TZ,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
    const day=value=>value?new Date(value).toLocaleDateString('tr-TR',{timeZone:TZ,day:'numeric',month:'short',year:'numeric'}):'—';
    const shortDay=value=>new Date(value).toLocaleDateString('tr-TR',{timeZone:TZ,day:'numeric',month:'short'});
    const isoToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const addDays=(iso,n)=>new Date(Date.parse(iso+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
    const num=value=>value===undefined||value===null||value===''?'—':esc(Number(value).toLocaleString('tr-TR'));
    const pct=(part,whole)=>Number(whole)>0&&part!==undefined&&part!==null?Math.round(Number(part)/Number(whole)*1000)/10:null;
    const pctText=value=>value===null?'—':'%'+value.toLocaleString('tr-TR');
    const change=(now,before)=>Number(before)>0?Math.round((Number(now)-Number(before))/Number(before)*100):null;
    const changeText=value=>value===null?'önceki dönemde kayıt yok':(value>0?'+':'')+value+'%';
    const plus=(value,days)=>value?new Date(Date.parse(value)+days*864e5).toISOString():null;
    const place=(city,district)=>esc(city||'?')+(district?' <small>'+esc(district)+'</small>':'');
    const kindText=k=>k==='load'?'Yük':k==='truck'?'Boş araç':'—';
    const typeText=t=>t==='carrier'?'Taşıyıcı':t==='owner'?'Yük sahibi':'Belirtilmemiş';
    // Eski satırlarda state yoksa durum basitçe çıkarılır.
    const stateOf=row=>row.state||(row.removed?'removed':row.status==='active'?'active':'closed');
    const states={active:['Yayında','ok'],expired:['Süresi doldu','warn'],closed:['Kapalı','mute'],removed:['Kaldırıldı','bad'],redacted:['Temizlendi','mute']};
    const statusText={active:'Yayında',closed:'Kapalı',archived:'Arşiv'};
    const pill=(text,tone)=>'<span class="adm-pill '+tone+'">'+esc(text)+'</span>';
    const actionText={suspend:'Faaliyetler askıya alındı',resume:'Askı kaldırıldı',remove:'İlan kaldırıldı',restore:'İlan engeli açıldı',ban:'Kalıcı engellendi',unban:'Engel kaldırıldı',
        delete:'Hesap silindi',self_delete:'Kullanıcı hesabını sildi',grant_admin:'Yönetici yapıldı',revoke_admin:'Yöneticilik alındı',hold:'Yasal saklamaya alındı',release:'Yasal saklama kaldırıldı'};
    // Hesap durumu: ana yönetici, yönetici, silindi, engelli, askıda veya aktif.
    const userState=row=>row.owner?['Ana yönetici','brand']:row.protected?['Yönetici','brand']:row.deleted_at?['Silindi','mute']:row.banned?['Engelli','bad']:row.suspended?['Askıda','bad']:['Aktif','ok'];
    const option=(value,label,current)=>'<option value="'+esc(value)+'"'+(current===value?' selected':'')+'>'+esc(label)+'</option>';
    const list=name=>{try{return name==='cities'?cities:name==='vehicles'?vehicles:bodies;}catch{return [];}};
    const activeFilters=()=>Object.values(query).filter(v=>v!==''&&v!==undefined&&v!==null).length+(search?1:0);
    const reset=()=>{offset=0;selected=0;panel=null;checked=new Map();};
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        if(!authorized){
            // Yükleniyor ve hata durumları da panelle aynı tasarımda gösterilir.
            body.innerHTML='<div class="adm-login adm-state"><div class="adm-login-brand"><i aria-hidden="true"></i><div><b>NakGo</b><p>Yönetici paneli</p></div></div><section class="adm-login-card">'+content+
                '<button class="adm-login-google" id="admin-close" type="button">'+(host?'Çıkış yap':'Kapat')+'</button></section></div>';
            $('#admin-close').onclick=host?()=>{closeSheet();adminHostOpened=false;nakgoAuth.signOut();}:closeSheet;return;
        }
        body.innerHTML='<div class="adm'+(section==='live'&&liveDark?' adm-dark':'')+'"><div class="adm-shell"><div class="adm-nav" role="navigation" aria-label="Yönetim bölümleri"><span class="adm-brand">NakGo</span>'+
            Object.entries(titles).map(([key,label])=>'<button class="adm-nav-btn" data-admin-section="'+key+'" aria-label="'+label+'" aria-pressed="'+(section===key)+'">'+adminIcon(key)+'<span class="l-long">'+label+'</span></button>').join('')+
            '</div><div class="adm-page"><div class="adm-top"><p class="adm-crumb"><span>Yönetici paneli</span> › <b>'+titles[section]+'</b></p><div class="adm-top-act">'+
            '<button class="adm-btn" id="admin-refresh" type="button">'+adminIcon('refresh')+'Yenile</button><button class="adm-btn" id="admin-close" type="button">'+(host?'Çıkış yap':'Kapat ×')+'</button></div></div>'+content+'</div></div></div>';
        $('#admin-close').onclick=host?()=>{closeSheet();adminHostOpened=false;nakgoAuth.signOut();}:closeSheet;
        $('#admin-refresh').onclick=load;
        const on=(selector,fn)=>body.querySelectorAll(selector).forEach(fn);
        on('[data-admin-section],[data-admin-go]',button=>button.onclick=()=>{section=button.dataset.adminSection||button.dataset.adminGo;search='';filter='';query={};reset();load();});
        on('[data-admin-period]',button=>button.onclick=()=>{period=button.dataset.adminPeriod;render();});
        on('[data-admin-filter]',button=>button.onclick=()=>{filter=button.dataset.adminFilter;reset();load();});
        // İlan durum ve tür çipleri diğer filtrelerle birleşir.
        on('[data-admin-state]',button=>button.onclick=()=>{const v=button.dataset.adminState;if(v==='')delete query.state;else query.state=v;reset();load();});
        on('[data-admin-kind]',button=>button.onclick=()=>{const v=button.dataset.adminKind;if(query.kind===v||v==='')delete query.kind;else query.kind=v;reset();load();});
        on('[data-admin-open]',item=>item.onclick=event=>{if(event.target.closest('[data-admin-action],[data-admin-check]'))return;selected=Number(item.dataset.adminOpen);panel={mode:'detail'};render();});
        on('[data-admin-action]',button=>button.onclick=()=>confirmAction(rows[Number(button.dataset.adminAction)]));
        on('[data-admin-do]',button=>button.onclick=()=>confirmAction(rows[Number(button.dataset.adminIndex)],button.dataset.adminDo));
        on('[data-admin-check]',box=>box.onchange=()=>{const row=rows[Number(box.dataset.adminCheck)];if(!row)return;if(box.checked)checked.set(String(row.id),row);else checked.delete(String(row.id));render();});
        on('[data-admin-owner]',button=>button.onclick=()=>{const id=button.dataset.adminOwner;section='users';search='';filter='';query={user:id};reset();load();});
        on('[data-admin-range]',button=>button.onclick=()=>{range={days:Number(button.dataset.adminRange),from:'',to:''};dayPage=0;tip=-1;load();});
        on('[data-admin-tip]',item=>{const show=()=>{if(tip===Number(item.dataset.adminTip))return;tip=Number(item.dataset.adminTip);showTip();};item.onmouseenter=show;item.onclick=show;});
        if($('#admin-check-all'))$('#admin-check-all').onchange=event=>{rows.forEach(row=>{if(event.target.checked&&!row.removed)checked.set(String(row.id),row);else checked.delete(String(row.id));});render();};
        if($('#admin-bulk'))$('#admin-bulk').onclick=bulkRemove;
        if($('#admin-bulk-clear'))$('#admin-bulk-clear').onclick=()=>{checked=new Map();render();};
        if($('#admin-back'))$('#admin-back').onclick=()=>{panel=null;render();};
        if($('#admin-prev')){$('#admin-prev').onclick=()=>{offset=Math.max(0,offset-20);selected=0;checked=new Map();load();};$('#admin-next').onclick=()=>{offset+=20;selected=0;checked=new Map();load();};}
        if($('#admin-days-prev')){$('#admin-days-prev').onclick=()=>{dayPage=Math.max(0,dayPage-1);render();};$('#admin-days-next').onclick=()=>{dayPage++;render();};}
        if($('#admin-search'))$('#admin-search').onsubmit=event=>{event.preventDefault();search=$('#admin-term').value.trim();reset();load();};
        if($('#admin-user-clear'))$('#admin-user-clear').onclick=()=>{delete query.user;reset();load();};
        if($('#admin-filter-box'))$('#admin-filter-box').ontoggle=event=>{filtersOpen=event.target.open;};
        if($('#admin-filters')){
            $('#admin-filters').onsubmit=event=>{event.preventDefault();
                const form=event.target,next={};
                ['from_city','to_city','vehicle','body','kind','state','from','to','id','owner'].forEach(key=>{const v=(form.elements[key]?.value||'').trim();if(v)next[key]=v;});
                if(next.id&&!/^[0-9]{1,15}$/.test(next.id.replace(/^#/,''))){$('#admin-filter-error').textContent='İlan numarası yalnız rakam olmalı.';return;}
                if(next.id)next.id=next.id.replace(/^#/,'');
                if(next.from&&next.to&&next.from>next.to){$('#admin-filter-error').textContent='Başlangıç tarihi bitişten sonra olamaz.';return;}
                search=(form.elements.term?.value||'').trim();query=next;reset();load();};
            $('#admin-filter-reset').onclick=()=>{query={};search='';reset();load();};
        }
        if($('#admin-range-form'))$('#admin-range-form').onsubmit=event=>{event.preventDefault();
            const from=event.target.elements.from.value,to=event.target.elements.to.value||isoToday();
            const span=from?(Date.parse(to)-Date.parse(from))/864e5:-1;
            if(!from||span<0||span>365){$('#admin-range-error').textContent='Geçerli bir aralık seç (en fazla 366 gün).';return;}
            range={days:0,from,to};dayPage=0;tip=-1;load();};
        on('[data-admin-live-kind]',button=>button.onclick=()=>{liveKind=button.dataset.adminLiveKind;load();});
        on('[data-admin-live-side]',button=>button.onclick=()=>{liveSide=button.dataset.adminLiveSide;render();});
        on('[data-admin-live-open]',button=>button.onclick=()=>{section='listings';search='';filter='';query={id:button.dataset.adminLiveOpen};reset();load();});
        if($('#admin-live-theme'))$('#admin-live-theme').onclick=()=>{liveDark=!liveDark;try{localStorage.setItem('nakgo-admin-live-dark',liveDark?'1':'0');}catch{}render();};
        if(section==='stats'&&tip>=0)showTip();
    }
    function kpis(){
        // İlanlar sayfasında üst kartlar yok; durum çipleri sayıları zaten gösterir.
        if(section==='listings')return '';
        const s=stats||{},st=s.listing_states||{},t=s.totals||{},ty=s.user_types||{},month=(s.periods&&s.periods.month)||{};
        // Her kart: değer ve yüzde açıklaması.
        const tile=(label,value,note,tone)=>'<div class="adm-kpi '+tone+'"><span>'+label+'</span><b>'+value+'</b><small>'+note+'</small></div>';
        const removed=Number(s.listings_removed)||0,dayChange=change(s.listings_today,s.yesterday);
        const sets={
            overview:[['Aktif ilan',num(s.listings),pctText(pct(s.listings,st.all))+' kayıtlı ilanların','brand'],
                ['Bugün eklenen',num(s.listings_today),dayChange===null?'dün kayıt yok':'Düne göre '+changeText(dayChange),'ok'],
                ['Kullanıcı',num(s.users),pctText(pct(s.users_week,s.users))+' bu hafta yeni','accent'],
                ['Kaldırılan / askıda',num(removed),pctText(pct(removed,st.all))+' ilanların · '+num(s.accounts_suspended)+' hesap askıda','bad']],
            users:[['Toplam kullanıcı',num(s.users),pctText(pct(ty.carrier,s.users))+' taşıyıcı','brand'],['Bu hafta yeni',num(s.users_week),pctText(pct(s.users_week,s.users))+' toplamın','ok'],
                ['Taşıyıcı',num(ty.carrier),pctText(pct(ty.owner,s.users))+' yük sahibi ('+num(ty.owner)+')','accent'],['Askıda',num(s.accounts_suspended),pctText(pct(s.accounts_suspended,s.users))+' kullanıcıların','bad']],
            moderation:[['Son 30 gün',num(s.actions_month),'yönetici işlemi','brand'],['Kaldırılan ilan',num(s.listings_removed),pctText(pct(removed,st.all))+' ilanların','bad'],
                ['Askıdaki hesap',num(s.accounts_suspended),pctText(pct(s.accounts_suspended,s.users))+' kullanıcıların','accent'],['Aktif ilan',num(s.listings),pctText(pct(s.listings,st.all))+' kayıtlı ilanların','ok']],
            archive:(r=>[['Arşivde',num(r.archived),'kişisel bilgisi temizlenmiş ilan','brand'],['30 gün içinde silinecek',num(r.purge_30),'1 yıllık süresi dolan','bad'],
                ['Temizlik bekleyen',num(r.pending_cleanup),'bitişten 8 gün sonra temizlenir','accent'],['Yasal saklamada',num(r.held),'otomatik silinmez','mute']])(retention||{}),
            stats:[['Toplam ilan',num(t.listings),pctText(pct(month.listings,t.listings))+' son 30 günde','brand'],['Yük ilanı',num(t.loads),pctText(pct(t.loads,t.listings))+' tüm ilanların','ok'],
                ['Boş araç ilanı',num(t.trucks),pctText(pct(t.trucks,t.listings))+' tüm ilanların','accent'],['Toplam kullanıcı',num(s.users),pctText(pct(month.users,s.users))+' son 30 günde katıldı','mute']]};
        return '<section class="adm-kpis" aria-label="Özet">'+sets[section].map(x=>tile(...x)).join('')+'</section>';
    }
    // Gün/Hafta/Ay özeti: sunucudaki sayılardan kural tabanlı metin (yapay zekâ değil).
    function summaryCard(){
        const p=stats&&stats.periods&&stats.periods[period];if(!p)return '';
        const names={day:['Bugün','dün'],week:['Son 7 gün','önceki 7 gün'],month:['Son 30 gün','önceki 30 gün']}[period];
        const c=change(p.listings,p.prev_listings),u=change(p.users,p.prev_users),routes=Array.isArray(p.routes)?p.routes:[];
        const loadShare=pct(p.loads,p.listings);
        const text=names[0]+' '+num(p.listings)+' ilan verildi'+(c===null?'':', '+names[1]+'e göre '+changeText(c))+'. '+
            (Number(p.listings)>0?'İlanların '+pctText(loadShare)+' yük, '+pctText(pct(p.trucks,p.listings))+' boş araç. ':'')+
            (routes[0]?'En yoğun hat '+esc(routes[0].route)+' ('+num(routes[0].count)+' ilan). ':'')+num(p.users)+' yeni kayıt.';
        return '<section class="adm-card adm-period" aria-label="Dönem özeti"><div class="adm-card-head"><h2>Özet</h2><div class="adm-seg" role="group" aria-label="Dönem">'+
            [['day','Gün'],['week','Hafta'],['month','Ay']].map(([k,l])=>'<button type="button" data-admin-period="'+k+'" aria-pressed="'+(period===k)+'">'+l+'</button>').join('')+'</div></div>'+
            '<div class="adm-summary"><span>Otomatik özet</span><p>'+text+'</p></div>'+
            '<div class="adm-grid"><div><span>İlan</span><b>'+num(p.listings)+'</b><small>'+changeText(c)+'</small></div><div><span>Yeni kayıt</span><b>'+num(p.users)+'</b><small>'+changeText(u)+'</small></div>'+
            '<div><span>Yük</span><b>'+num(p.loads)+'</b><small>'+pctText(loadShare)+'</small></div><div><span>Boş araç</span><b>'+num(p.trucks)+'</b><small>'+pctText(pct(p.trucks,p.listings))+'</small></div></div>'+
            (routes.length?'<h4>En yoğun hatlar</h4><ol class="adm-routes">'+routes.map(r=>'<li><span>'+esc(r.route)+'</span><b>'+num(r.count)+'</b></li>').join('')+'</ol>':'')+'</section>';
    }
    function chips(){
        const st=(stats&&stats.listing_states)||{},ty=(stats&&stats.user_types)||{},vu=(stats&&stats.vehicle_users)||{};
        const chip=(attr,key,label,count,pressed)=>'<button class="adm-chip" type="button" '+attr+'="'+key+'" aria-pressed="'+pressed+'">'+label+(count!==undefined&&count!==null?' <b>'+num(count)+'</b>':'')+'</button>';
        if(section==='listings'){
            const stateChips=[['','Tümü',st.all],['active','Yayında',st.active],['expired','Süresi doldu',st.expired],['closed','Kapalı',st.closed],['removed','Kaldırılan',st.removed],['redacted','Temizlendi',st.redacted]];
            return '<div class="adm-chips" role="group" aria-label="Durum">'+stateChips.map(([k,l,c])=>chip('data-admin-state',k,l,c,(query.state||'')===k)).join('')+
                chip('data-admin-kind','load','Yük',undefined,query.kind==='load')+chip('data-admin-kind','truck','Boş araç',undefined,query.kind==='truck')+'</div>';
        }
        const sets={users:[['','Tümü',stats&&stats.users],['new','Bu hafta',stats&&stats.users_week],['carrier','Taşıyıcı',ty.carrier],['owner','Yük sahibi',ty.owner],['tir','Tır',vu.tir],['kamyon','Kamyon',vu.kamyon],['kamyonet','Kamyonet',vu.kamyonet],['suspended','Askıda',stats&&stats.accounts_suspended],
                ['banned','Engelli',stats&&stats.accounts_banned],['admins','Yöneticiler',stats&&stats.admins],['deleted','Silinen',stats&&stats.accounts_deleted]],
            moderation:[['','Tümü'],['listing','İlan işlemleri'],['user','Hesap işlemleri']],
            archive:[['','Tümü',retention&&retention.archived],['soon','30 gün içinde silinecek',retention&&retention.purge_30],['hold','Yasal saklamada',retention&&retention.held]]}[section];
        return sets?'<div class="adm-chips" role="group" aria-label="Filtre">'+sets.map(([key,label,count])=>chip('data-admin-filter',key,label,count,filter===key)).join('')+'</div>':'';
    }
    // Birleşik ilan filtreleri: dar ekranda katlanır, geniş ekranda açık başlar.
    function filterForm(){
        const select=(name,label,items,all='Tümü')=>'<label><span>'+label+'</span><select name="'+name+'">'+option('',all,query[name]||'')+items.map(x=>Array.isArray(x)?option(x[0],x[1],query[name]||''):option(x,x,query[name]||'')).join('')+'</select></label>';
        const input=(name,label,type,extra='')=>'<label><span>'+label+'</span><input name="'+name+'" type="'+type+'" value="'+esc(query[name]||'')+'" '+extra+'></label>';
        const count=activeFilters(),open=filtersOpen||(body.clientWidth||0)>=720;
        return '<details class="adm-filters" id="admin-filter-box"'+(open?' open':'')+'><summary>Filtreler'+(count?' <b>'+count+'</b>':'')+'</summary><form id="admin-filters" class="adm-fgrid">'+
            '<label class="f-wide"><span>Güzergâh ara</span><input name="term" maxlength="100" value="'+esc(search)+'" placeholder="Örn. İzmir, Ankara"></label>'+
            input('id','İlan no','text','inputmode="numeric" maxlength="16" placeholder="Örn. 128"')+input('owner','Kullanıcı adı','text','maxlength="100" placeholder="Ad veya ilandaki isim"')+
            select('from_city','Nereden',list('cities'))+select('to_city','Nereye',list('cities'))+select('vehicle','Araç',list('vehicles'))+select('body','Kasa',list('bodies'))+
            select('kind','İlan türü',[['load','Yük'],['truck','Boş araç']])+select('state','Durum',Object.entries(states).map(([k,v])=>[k,v[0]]))+
            input('from','Oluşturma (başlangıç)','date')+input('to','Oluşturma (bitiş)','date')+
            '<p id="admin-filter-error" class="f-wide" role="alert"></p><div class="f-wide adm-factions"><button class="adm-btn primary" type="submit">Uygula</button><button class="adm-btn" id="admin-filter-reset" type="button">Filtreleri temizle</button></div></form></details>';
    }
    function rowHTML(row,index){
        const open=' data-admin-open="'+index+'"',on=selected===index?' on':'';
        const view='<button class="adm-link" type="button" data-admin-open="'+index+'">Görüntüle</button>';
        if(section==='users'){
            const act=row.protected?'<span class="adm-note">Korumalı</span>':row.deleted_at?'<span class="adm-note">Silindi</span>':row.banned?'<span class="adm-note">Engelli</span>':'<button class="adm-act" type="button" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>';
            const status=pill(...userState(row));
            return '<div class="adm-row'+on+'"'+open+'><b class="c-main">'+esc(row.display_name||'İsimsiz hesap')+'</b><span>'+esc(row.city||'—')+'</span><span>'+typeText(row.account_type)+(Array.isArray(row.vehicles)&&row.vehicles.length?' <small>'+esc(row.vehicles.join(', '))+'</small>':'')+'</span><span>'+day(row.created_at)+'</span><span class="c-num">'+num(row.listings)+' ilan</span><span>'+status+'</span><span class="c-act">'+act+view+'</span></div>';
        }
        if(section==='archive'){
            return '<div class="adm-row'+on+'"'+open+'><b class="c-main">#'+esc(String(row.id))+(row.hold?' '+pill('Yasal saklama','warn'):'')+'</b><span>'+place(row.from_city,row.from_district)+'</span><span>→ '+place(row.to_city,row.to_district)+'</span><span>'+esc(row.vehicle||'—')+' <small>'+kindText(row.kind)+'</small></span><span>'+day(row.redacted_at)+'</span><span>'+(row.hold?'Silinmez':day(row.purge_at))+'</span><span class="c-act">'+view+'</span></div>';
        }
        if(section==='moderation'){
            return '<div class="adm-row'+on+'"'+open+'><b class="c-main">'+esc(actionText[row.action]||row.action)+'</b><span>'+esc(row.target)+'</span><span class="c-wide">'+esc(row.reason)+'</span><span>'+esc(row.actor_label)+'</span><span>'+date(row.created_at)+'</span><span class="c-act">'+view+'</span></div>';
        }
        const [label,tone]=states[stateOf(row)]||states.closed;
        const act='<button class="adm-act" type="button" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
        const box=section==='listings'&&!row.removed?'<input type="checkbox" class="adm-check" data-admin-check="'+index+'" aria-label="İlan #'+esc(String(row.id))+' seç"'+(checked.has(String(row.id))?' checked':'')+'>':'';
        const owner=row.owner_name||row.owner_label;
        return '<div class="adm-row'+on+'"'+open+'><b class="c-main">'+box+'#'+esc(String(row.id))+(owner?' <small>'+esc(owner)+'</small>':'')+'</b><span>'+place(row.from_city,row.from_district)+'</span><span>→ '+place(row.to_city,row.to_district)+'</span><span>'+esc(row.vehicle||'—')+' <small>'+kindText(row.kind)+'</small></span><span>'+pill(label,tone)+'</span><span>'+date(row.created_at)+'</span><span class="c-act">'+act+view+'</span></div>';
    }
    const heads={listings:['İlan','Çıkış','Varış','Araç · tür','Durum','Oluşturma',''],overview:['İlan','Çıkış','Varış','Araç · tür','Durum','Oluşturma',''],users:['Ad','Şehir','Tür','Kayıt','İlan','Durum',''],archive:['İlan','Çıkış','Varış','Araç · tür','Temizlendi','Silinecek',''],moderation:['İşlem','Hedef','Gerekçe','Yönetici','Tarih','']};
    function listCard(){
        const listTitle=section==='overview'?'Son ilanlar · son 24 saat':section==='archive'?'Arşiv kayıtları':titles[section];
        const searchForm=section==='users'?'<form id="admin-search" class="adm-search" role="search"><label for="admin-term">Ada göre ara</label><input id="admin-term" maxlength="100" value="'+esc(search)+'" placeholder="Örn. Ahmet Yılmaz"><button class="adm-btn" type="submit">Ara</button></form>':section==='listings'?filterForm():'';
        const userNote=section==='users'&&query.user?'<p class="adm-filter-note">Tek kullanıcı gösteriliyor (ilan sahibinden). <button class="adm-link" id="admin-user-clear" type="button">Tüm kullanıcılar</button></p>':'';
        const pager=section==='overview'?'<div class="adm-pager"><button class="adm-btn" type="button" data-admin-go="listings">Tüm ilanlar →</button></div>':
            '<div class="adm-pager"><button class="adm-btn" id="admin-prev" type="button" '+(offset===0?'disabled':'')+'>Önceki</button><span>Sayfa '+(offset/20+1)+'</span><button class="adm-btn" id="admin-next" type="button" '+(!more?'disabled':'')+'>Sonraki</button></div>';
        const total=(section==='listings'||section==='archive'||section==='overview')&&rows[0]&&rows[0].total!==undefined?Number(rows[0].total):null;
        const countText=section==='overview'?(total===null?'Son 24 saatte ilan yok':num(total)+' ilan · 24 saati geçen ilanlar listeden çıkar'):section==='archive'?num(total||0)+' kayıt':section==='listings'?(total===null?'0 sonuç':num(total)+' sonuç'+(activeFilters()?' · filtreli':'')):rows.length+(more?'+':'')+' kayıt gösteriliyor';
        const selectable=rows.filter(r=>!r.removed);
        const bulk=section==='listings'&&selectable.length?'<div class="adm-bulk"><label><input type="checkbox" id="admin-check-all"'+(selectable.every(r=>checked.has(String(r.id)))?' checked':'')+'> Sayfadakileri seç</label>'+
            (checked.size?'<b>'+checked.size+' ilan seçildi</b><button class="adm-btn danger" id="admin-bulk" type="button">Seçilenleri kaldır</button><button class="adm-link" id="admin-bulk-clear" type="button">Seçimi temizle</button>':'')+'</div>':'';
        return '<section class="adm-card adm-list"><div class="adm-card-head"><h2>'+listTitle+'</h2><small id="admin-count">'+countText+'</small></div>'+searchForm+userNote+chips()+bulk+
            (rows.length?'<div class="adm-table"><div class="adm-thead" aria-hidden="true">'+heads[section].map(h=>'<span>'+h+'</span>').join('')+'</div>'+rows.map(rowHTML).join('')+'</div>':'<p class="adm-empty">Kayıt bulunamadı.</p>')+pager+'</section>';
    }
    // Saklama kuralları ve gece temizliğinin son çalışmaları (her gün 03:00, Türkiye saati).
    function retentionCard(){
        const r=retention||{},runs=Array.isArray(r.runs)?r.runs:[];
        const run=x=>{const c=x.counts||{};return '<li><span>'+date(x.ran_at)+'</span><b>'+(c.skipped?'Atlandı (başka çalışma sürüyordu)':num(c.listings_redacted)+' temizlendi · '+num(c.listings_deleted)+' silindi')+'</b></li>';};
        return '<section class="adm-card"><div class="adm-card-head"><h2>Saklama kuralları</h2><small>Gece temizliği her gün 03:00</small></div>'+
            '<ol class="adm-steps"><li class="done"><b>Yayın</b><small>İlan 6 saat yayında kalır.</small></li><li class="done"><b>8 gün sonra</b><small>Kapanan veya süresi dolan ilanın kişisel bilgileri (iletişim, not, isim) temizlenir; ilan arşive geçer.</small></li>'+
            '<li class="done"><b>1 yıl sonra</b><small>Arşivdeki kayıt, giriş kayıtları (IP/saat) ve yönetici kararları otomatik silinir. Yönetimin kaldırdığı ilan önce 1 yıl olduğu gibi bekletilir.</small></li>'+
            '<li><b>Yasal saklama</b><small>Resmî talep olan kayıt saklamaya alınırsa kaldırılana kadar temizlenmez ve silinmez.</small></li></ol>'+
            '<div class="adm-grid"><div><span>Yönetimin beklettiği</span><b>'+num(r.removed_held)+'</b></div><div><span>Silinecek hesap kalıntısı</span><b>'+num(r.accounts_pending_purge)+'</b></div><div><span>Giriş kaydı</span><b>'+num(r.access_logs)+'</b></div><div><span>En eski giriş kaydı</span><b>'+day(r.oldest_log)+'</b></div></div>'+
            '<h4>Son çalışmalar</h4>'+(runs.length?'<ol class="adm-routes">'+runs.map(run).join('')+'</ol>':'<p class="adm-note">Gece temizliği henüz çalışmadı.</p>')+'</section>';
    }
    function timeline(items){return '<ol class="adm-steps">'+items.map(([label,when,state])=>'<li class="'+state+'"><b>'+label+'</b><small>'+when+'</small></li>').join('')+'</ol>';}
    // İlan geçmişi: kimin oluşturduğu/değiştirdiği ve yönetici kararları. IP gösterilmez.
    function historyHTML(id){
        const h=history.get(id);
        if(!h||h==='loading')return '<p class="adm-note" role="status">Geçmiş yükleniyor…</p>';
        if(h==='error')return '<p class="adm-note">Geçmiş yüklenemedi. Yenile ile tekrar dene.</p>';
        if(!h.length)return '<p class="adm-note">Kayıtlı değişiklik yok.</p>';
        const what=e=>{
            if(e.kind==='admin')return e.action==='remove'?'Yönetici yayından kaldırdı':'Yönetici kaldırma engelini açtı';
            if(e.action==='listing_create')return 'İlanı oluşturdu';
            const m=/^status:(\w+)>(\w+)$/.exec(e.detail||'');
            return m?'Durumu değiştirdi: '+(statusText[m[1]]||m[1])+' → '+(statusText[m[2]]||m[2]):'İlanı düzenledi';
        };
        return '<ol class="adm-steps adm-history">'+h.map(e=>'<li class="'+(e.kind==='admin'?'bad':'done')+'"><b>'+esc(what(e))+'</b><small>'+esc(e.actor||'')+' · '+date(e.at)+'</small>'+(e.reason?'<small>Gerekçe: '+esc(e.reason)+'</small>':'')+'</li>').join('')+'</ol>';
    }
    async function loadHistory(id){
        if(history.has(id))return;
        history.set(id,'loading');
        try{const r=await nakgoAuth.adminPage('history',0,'','',{id});if(!valid())return;history.set(id,Array.isArray(r)?r:[]);}
        catch{if(!valid())return;history.set(id,'error');}
        // Onay formu açıkken yeniden çizilmez; yoksa yazılan gerekçe ve form bağlantısı kaybolur.
        if((section==='listings'||section==='overview'||section==='archive')&&!(panel&&panel.mode==='confirm'))render();
    }
    function detail(row,index){
        const back='<button class="adm-back" id="admin-back" type="button">‹ Listeye dön</button>';
        const grid=items=>'<div class="adm-grid">'+items.map(([k,v])=>'<div><span>'+k+'</span><b>'+v+'</b></div>').join('')+'</div>';
        if(section==='users'){
            const btn=(action,label,tone='')=>'<button class="adm-btn'+(tone?' '+tone:'')+'" type="button" data-admin-do="'+action+'" data-admin-index="'+index+'">'+label+'</button>';
            let act;
            if(row.is_self)act='<p class="adm-note">Bu senin hesabın. Kendi hesabında işlem yapılamaz.</p>';
            else if(row.owner)act='<p class="adm-note">Ana yönetici hesabı korumalıdır.</p>';
            else if(row.deleted_at)act='<p class="adm-note">Hesap silindi. Kalan kayıt '+day(plus(row.deleted_at,365))+' tarihinde tamamen silinir.</p>';
            else if(row.protected)act='<p class="adm-note">Yönetici hesabı. Engellemek veya silmek için önce yöneticiliği al.</p>'+btn('revoke_admin','Yöneticiliği al','danger');
            else act=(row.banned?'':'<button class="btn adm-detail-act" type="button" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>')+
                '<div class="adm-factions">'+btn(row.banned?'unban':'ban',row.banned?'Engeli kaldır':'Kalıcı engelle',row.banned?'':'danger')+
                (!row.banned&&!row.suspended&&row.verified!==false?btn('grant_admin','Yönetici yap','primary'):'')+btn('delete','Hesabı sil','danger')+'</div>';
            const summary=row.owner?'Ana yönetici. Tüm yetkiler açık; kimse bu hesabı değiştiremez.':row.protected?'Yönetici. Tüm panel yetkileri açık.':row.deleted_at?'Hesap '+day(row.deleted_at)+' tarihinde silindi; kişisel bilgiler temizlendi.':
                row.banned?'Kalıcı engelli: giriş yapamaz, ilan veremez.':row.suspended?'Faaliyetleri askıda: yeni ilan veremez. Hesabına giriş yapabilir.':'Hesap aktif. '+num(row.listings)+' ilanı var.';
            return back+'<div class="adm-d-head"><h3>'+esc(row.display_name||'İsimsiz hesap')+' '+pill(...userState(row))+'</h3><p>'+esc(row.city||'Şehir yok')+' · '+typeText(row.account_type)+'</p></div><div class="adm-summary"><span>Durum özeti</span><p>'+summary+'</p></div>'+
                '<h4>Hesap bilgileri</h4>'+grid([['Kayıt',day(row.created_at)],['İlan sayısı',num(row.listings)],['Tür',typeText(row.account_type)],['Araç (ilanlarından)',Array.isArray(row.vehicles)&&row.vehicles.length?esc(row.vehicles.join(', ')):'—']])+(row.reason?'<h4>Son gerekçe</h4><p class="adm-reason">'+esc(row.reason)+'</p>':'')+'<div class="adm-d-act">'+act+'</div>';
        }
        if(section==='archive'){
            const ended=row.updated_at&&row.expires_at?(Date.parse(row.updated_at)<Date.parse(row.expires_at)?row.updated_at:row.expires_at):row.expires_at;
            const act='<button class="btn adm-detail-act" type="button" data-admin-do="'+(row.hold?'release':'hold')+'" data-admin-index="'+index+'">'+(row.hold?'Yasal saklamayı kaldır':'Yasal saklamaya al')+'</button>';
            loadHistory(String(row.id));
            return back+'<div class="adm-d-head"><h3>İlan #'+esc(String(row.id))+' '+pill(row.hold?'Yasal saklama':'Arşiv',row.hold?'warn':'mute')+'</h3><p class="adm-sign">'+place(row.from_city,row.from_district)+' → '+place(row.to_city,row.to_district)+'</p></div>'+
                '<div class="adm-summary"><span>Saklama durumu</span><p>'+(row.hold?'Yasal saklamada: kaldırılana kadar otomatik silinmez.':'Kişisel bilgiler temizlendi. Kayıt '+day(row.purge_at)+' tarihinde otomatik silinir.')+'</p></div>'+
                '<h4>İlan bilgileri</h4>'+grid([['Tür',kindText(row.kind)],['Araç',esc(row.vehicle||'—')],['Kasa',esc(row.body||'—')],['Yönetici kararı',num(row.decisions)]])+(row.hold_reason?'<h4>Saklama gerekçesi</h4><p class="adm-reason">'+esc(row.hold_reason)+'</p>':'')+
                '<h4>Zaman çizelgesi</h4>'+timeline([['Oluşturuldu',date(row.created_at),'done'],['Yayın bitti',date(ended),'done'],['Kişisel bilgiler temizlendi',date(row.redacted_at),'done'],['Kayıt silinir',row.hold?'Yasal saklamada':day(row.purge_at),'']])+
                '<h4>İşlem geçmişi</h4>'+historyHTML(String(row.id))+'<div class="adm-d-act">'+act+'</div>';
        }
        if(section==='moderation'){
            return back+'<div class="adm-d-head"><h3>'+esc(actionText[row.action]||row.action)+'</h3><p>'+date(row.created_at)+'</p></div><h4>İşlem bilgileri</h4>'+grid([['Hedef',esc(row.target)],['Yönetici',esc(row.actor_label)]])+'<h4>Gerekçe</h4><p class="adm-reason">'+esc(row.reason)+'</p>';
        }
        const state=stateOf(row),[label,tone]=states[state]||states.closed;
        const end=state==='closed'&&row.updated_at&&row.expires_at?(Date.parse(row.updated_at)<Date.parse(row.expires_at)?row.updated_at:row.expires_at):row.expires_at;
        const clean=row.redacted_at||plus(end,8),gone=plus(row.redacted_at||clean,365);
        const left=row.expires_at?Math.max(0,Date.parse(row.expires_at)-Date.now()):0,h=Math.floor(left/36e5),m=Math.floor(left%36e5/6e4);
        const summary={active:'Yayında. '+(row.expires_at?(h?h+' saat ':'')+m+' dakika sonra süresi doluyor.':''),expired:'Yayında değil. Kişisel bilgiler '+day(clean)+' tarihinde temizlenecek.',
            closed:'Sahibi kapattı. Kişisel bilgiler '+day(clean)+' tarihinde temizlenecek.',redacted:'Kişisel bilgiler temizlendi. Kayıt '+day(gone)+' tarihinde tamamen silinecek.',
            removed:'Moderasyonla yayından kaldırıldı. Kayıt 1 yıl bekletilir, sonra kişisel bilgiler temizlenir.'}[state];
        const steps=[['Oluşturuldu',date(row.created_at),'done'],
            state==='removed'?['Yayından kaldırıldı',(row.moderated_at?date(row.moderated_at)+' · ':'')+esc(row.reason||'Moderasyon'),'bad']:['Yayın süresi',state==='active'?'Bitiş '+date(row.expires_at):'Bitti '+date(end),state==='active'?'now':'done'],
            ['Kişisel bilgiler temizlenir',state==='removed'?'Kaldırmadan 1 yıl sonra':day(clean),state==='redacted'?'done':''],['Kayıt silinir',state==='removed'?'—':day(gone),'']];
        const act='<button class="btn adm-detail-act" type="button" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
        const ownerName=row.owner_name||row.owner_label;
        const ownerLink=row.owner_id?'<button class="adm-btn" type="button" data-admin-owner="'+esc(String(row.owner_id))+'">İlan sahibine git</button>':'';
        const id=String(row.id);loadHistory(id);
        const holdBtn='<button class="adm-btn" type="button" data-admin-do="'+(row.hold?'release':'hold')+'" data-admin-index="'+index+'">'+(row.hold?'Yasal saklamayı kaldır':'Yasal saklamaya al')+'</button>';
        return back+'<div class="adm-d-head"><h3>İlan #'+esc(id)+' '+pill(label,tone)+'</h3><p class="adm-sign">'+place(row.from_city,row.from_district)+' → '+place(row.to_city,row.to_district)+'</p></div>'+
            '<div class="adm-summary"><span>Durum özeti</span><p>'+summary+'</p></div><h4>İlan bilgileri</h4>'+
            grid([['Tür',kindText(row.kind)],['Araç',esc(row.vehicle||'—')],['Kasa',esc(row.body||'—')],['Sahibi',esc(ownerName||'—')],['Yükleme',esc(row.loading_text||'—')],['Yük',esc(row.cargo||'—')],['Oluşturma',date(row.created_at)],['Yayın bitişi',date(row.expires_at)]])+
            '<h4>Zaman çizelgesi</h4>'+timeline(steps)+'<h4>İşlem geçmişi</h4>'+historyHTML(id)+'<div class="adm-d-act">'+act+ownerLink+holdBtn+'</div>';
    }
    // Sıralama listesi: ad, sayı ve en yükseğe göre oranlı çubuk.
    function rank(items,unit){return Array.isArray(items)&&items.length?'<ol class="adm-rank">'+items.map(x=>{const top=Math.max(1,...items.map(y=>Number(y.count)||0));return '<li><span>'+esc(x.name||'—')+'</span><b>'+num(x.count)+' '+unit+'</b><i aria-hidden="true"><em style="width:'+Math.round((Number(x.count)||0)/top*100)+'%"></em></i></li>';}).join('')+'</ol>':'<p class="adm-empty">Bu aralıkta kayıt yok.</p>';}
    // İstatistikler: seçilen aralığın her günü (boş günler sıfır), yük turkuaz, boş araç sarı.
    function rangeLabel(){return range.days?'Son '+range.days+' gün':day(range.from+'T12:00:00Z')+' – '+day((range.to||isoToday())+'T12:00:00Z');}
    function showTip(){
        const box=$('#admin-tip'),days=rows.slice().reverse(),d=days[tip];if(!box||!d)return;
        box.innerHTML='<b>'+day(d.day+'T12:00:00Z')+'</b><span>'+num(d.listings)+' ilan · <i class="b-load"></i>'+num(d.loads)+' yük · <i class="b-truck"></i>'+num(d.trucks)+' boş araç</span><span>'+num(d.users)+' yeni kullanıcı</span>';
        body.querySelectorAll('[data-admin-tip]').forEach(g=>g.classList.toggle('on',Number(g.dataset.adminTip)===tip));
    }
    function chartSVG(days,{key,label,h=230,stack=true}){
        const w=1000,top=stack?Math.max(1,...days.map(d=>Number(d.listings)||0)):Math.max(1,...days.map(d=>Number(d[key])||0)),bw=w/Math.max(days.length,1),every=Math.max(1,Math.ceil(days.length/7)),base=h-32,plot=base-16;
        const bars=days.map((d,i)=>{const x=i*bw+bw*.15,bwid=Math.max(1,bw*.7),last=days.length-1-i;
            const parts=stack?[['b-load',Number(d.loads)||0],['b-truck',Number(d.trucks)||0]]:[['b-load',Number(d[key])||0]];
            let y=base;const rects=parts.map(([cls,v])=>{const hh=v/top*plot;y-=hh;return '<rect class="'+cls+'" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bwid.toFixed(1)+'" height="'+hh.toFixed(1)+'"/>';}).join('');
            const total=stack?Number(d.listings)||0:Number(d[key])||0;
            const value=days.length<=31&&total?'<text class="t-val" x="'+(x+bwid/2).toFixed(1)+'" y="'+(y-3).toFixed(1)+'" text-anchor="middle">'+total+'</text>':'';
            const tick=last%every===0?'<text x="'+(i===days.length-1?x+bwid:i===0?x:x+bwid/2).toFixed(1)+'" y="'+(h-4)+'" text-anchor="'+(i===days.length-1?'end':i===0?'start':'middle')+'">'+esc(shortDay(d.day+'T12:00:00Z'))+'</text>':'';
            return '<g'+(stack?' data-admin-tip="'+i+'"':'')+'><rect class="hit" x="'+(i*bw).toFixed(1)+'" y="0" width="'+bw.toFixed(1)+'" height="'+base+'"/>'+rects+value+tick+'<title>'+esc(day(d.day+'T12:00:00Z'))+': '+total+' '+label+'</title></g>';}).join('');
        return '<svg class="adm-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(rangeLabel()+' günlük '+label)+'"><line x1="0" x2="'+w+'" y1="'+base+'" y2="'+base+'"/><text class="t-max" x="2" y="12">en çok '+top+'</text>'+bars+'</svg>';
    }
    function statsCard(){
        const days=rows.slice().reverse(),sum=k=>days.reduce((a,d)=>a+(Number(d[k])||0),0);
        const controls='<div class="adm-range"><div class="adm-seg" role="group" aria-label="Aralık">'+[7,30,90].map(n=>'<button type="button" data-admin-range="'+n+'" aria-pressed="'+(range.days===n)+'">'+n+' gün</button>').join('')+'</div>'+
            '<form id="admin-range-form" class="adm-rform"><label><span>Başlangıç</span><input type="date" name="from" value="'+esc(range.from)+'" max="'+isoToday()+'"></label><label><span>Bitiş</span><input type="date" name="to" value="'+esc(range.to)+'" max="'+isoToday()+'"></label><button class="adm-btn" type="submit">Göster</button><p id="admin-range-error" role="alert"></p></form></div>';
        const chart=days.length?chartSVG(days,{label:'ilan'})+'<div class="adm-tip" id="admin-tip" aria-live="polite"><span>Ayrıntı için bir güne dokun.</span></div><p class="adm-legend"><i class="b-load"></i>Yük <i class="b-truck"></i>Boş araç</p>':'<p class="adm-empty">Kayıt bulunamadı.</p>';
        const totals='<div class="adm-grid adm-totals"><div><span>İlan</span><b>'+num(sum('listings'))+'</b></div><div><span>Yük</span><b>'+num(sum('loads'))+'</b></div><div><span>Boş araç</span><b>'+num(sum('trucks'))+'</b></div><div><span>Yeni kullanıcı</span><b>'+num(sum('users'))+'</b></div></div>';
        const ins=insights||{},bars=rank;
        const avg=ins.avg_hours===null||ins.avg_hours===undefined?'—':esc(Number(ins.avg_hours).toLocaleString('tr-TR'))+' saat';
        const per=14,pages=Math.max(1,Math.ceil(rows.length/per));if(dayPage>=pages)dayPage=pages-1;
        const pageRows=rows.slice(dayPage*per,dayPage*per+per);
        const table=rows.length?'<div class="adm-table adm-days"><div class="adm-thead" aria-hidden="true"><span>Gün</span><span>Toplam ilan</span><span>Yük ilanı</span><span>Boş araç ilanı</span><span>Yeni kullanıcı</span></div>'+
            pageRows.map(d=>'<div class="adm-row"><b class="c-main">'+day(d.day+'T12:00:00Z')+'</b><span>'+num(d.listings)+' ilan</span><span>'+num(d.loads)+' yük</span><span>'+num(d.trucks)+' boş araç</span><span>'+num(d.users)+' yeni kullanıcı</span></div>').join('')+'</div>'+
            '<div class="adm-pager"><button class="adm-btn" id="admin-days-prev" type="button" '+(dayPage===0?'disabled':'')+'>Yeni günler</button><span>'+(dayPage+1)+' / '+pages+'</span><button class="adm-btn" id="admin-days-next" type="button" '+(dayPage>=pages-1?'disabled':'')+'>Eski günler</button></div>':'';
        return '<section class="adm-card"><div class="adm-card-head"><h2>Günlük ilanlar · '+rangeLabel()+'</h2><small>Günlük sayılar kalıcı tutulur; ilanlar temizlense de silinmez.</small></div>'+controls+totals+chart+'</section>'+
            '<div class="adm-duo"><section class="adm-card"><div class="adm-card-head"><h2>En çok ilan çıkan 5 şehir</h2><small>'+rangeLabel()+'</small></div>'+bars(ins.cities,'ilan')+'</section>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>En çok kullanılan araç türleri</h2><small>'+rangeLabel()+'</small></div>'+bars(ins.vehicles,'ilan')+'</section></div>'+
            '<div class="adm-duo"><section class="adm-card"><div class="adm-card-head"><h2>Günlük yeni kullanıcı</h2><small>'+num(sum('users'))+' kişi</small></div>'+(days.length?chartSVG(days,{key:'users',label:'yeni kullanıcı',h:150,stack:false}):'')+'</section>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>Ortalama yayında kalma</h2><small>Biten '+num(ins.ended)+' ilan üzerinden</small></div><p class="adm-big">'+avg+'</p><p class="adm-note">İlanın açılışından süresinin dolmasına, sahibinin kapatmasına ya da kaldırılmasına kadar geçen süre. Kişisel bilgileri temizlenen ilanlar da hesaba katılır.</p></section></div>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>Günlük kayıt</h2><small>'+rangeLabel()+' · en yeni gün üstte</small></div>'+table+'</section>';
    }
    // Canlı sayfa: bugünün (Türkiye saati) ilanları, Ara/WhatsApp tıklamaları, il haritası ve son ilanlar.
    // Sunucu yalnız sayıları ve isimsiz ilan özetini döndürür; kişi, telefon veya ilan sahibi gelmez.
    const clock=v=>new Date(v).toLocaleTimeString('tr-TR',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    function ago(v){const m=Math.floor((Date.parse(live.at)-Date.parse(v))/6e4);return m<1?'az önce':m<60?m+' dk önce':new Date(v).toLocaleTimeString('tr-TR',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});}
    function liveBars(values,{labels,h=150,title,stack}){
        const w=1000,n=values.length,base=h-26,plot=base-14,bw=w/n,top=Math.max(1,...values.map(v=>stack?v[0]+v[1]:v));
        return '<svg class="adm-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(title)+'"><line x1="0" x2="'+w+'" y1="'+base+'" y2="'+base+'"/><text class="t-max" x="2" y="12">en çok '+top+'</text>'+
            values.map((v,i)=>{const x=i*bw+bw*.15,bwid=Math.max(1,bw*.7),parts=stack?[['b-load',v[0]],['b-truck',v[1]]]:[['b-load',v]];let y=base;
                const rects=parts.map(([cls,val])=>{const hh=val/top*plot;y-=hh;return hh?'<rect class="'+cls+'" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bwid.toFixed(1)+'" height="'+hh.toFixed(1)+'"/>':'';}).join('');
                const tick=labels[i]?'<text x="'+(i===n-1?x+bwid:i===0?x:x+bwid/2).toFixed(1)+'" y="'+(h-4)+'" text-anchor="'+(i===n-1?'end':i===0?'start':'middle')+'">'+esc(labels[i])+'</text>':'';
                return '<g>'+rects+tick+(stack?'<title>'+esc(String(i).padStart(2,'0')+':00 · '+v[0]+' yük, '+v[1]+' boş araç, '+v[2]+' tıklama')+'</title>':'')+'</g>';}).join('')+'</svg>';
    }
    // İl haritası: 81 il sınırı (TR_MAP); il rengi o ildeki ilan sayısıyla koyulaşır, en yoğun 5 il yazılır.
    // Çıkış yeşil (yük rengi), varış mavi (boş araç rengi). Harita verisi yoksa yalnız sıralama listeleri kalır.
    // İl yolunun (M x y l dx dy … z) en büyük halkasının alan ağırlık merkezi; bir kez hesaplanır.
    const centers={};
    function mapCenter(map,name){
        if(centers[name])return centers[name];
        let best=null,bestArea=0;
        for(const ring of String(map.il[name]||'').split('z')){const n=ring.match(/-?\d+/g);if(!n||n.length<6)continue;
            const pts=[[+n[0],+n[1]]];for(let i=2;i+1<n.length;i+=2)pts.push([pts[pts.length-1][0]+ +n[i],pts[pts.length-1][1]+ +n[i+1]]);
            let a=0,cx=0,cy=0;pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],f=p[0]*q[1]-q[0]*p[1];a+=f;cx+=(p[0]+q[0])*f;cy+=(p[1]+q[1])*f;});
            if(Math.abs(a)>bestArea){bestArea=Math.abs(a);best=[cx/(3*a),cy/(3*a)];}}
        return best&&(centers[name]=best);
    }
    function liveMap(counts){
        const map=typeof TR_MAP==='object'&&TR_MAP?TR_MAP:null,ll=typeof LL==='object'&&LL?LL:{};
        if(!map)return '<p class="adm-empty">Harita yüklenemedi.</p>';
        const max=Math.max(1,...Object.values(counts).map(Number)),side=liveSide==='from'?'çıkış':'varış';
        const xy=([lon,lat])=>[(lon-map.x0)*map.k*map.s+10,(map.y1-lat)*map.s+10];
        const shapes=Object.entries(map.il).map(([name,d])=>{const c=Number(counts[name])||0,level=c?Math.round(22+Math.sqrt(c/max)*78):0;
            return '<path d="'+d+'"'+(c?' class="on" style="--lv:'+level+'%"':'')+'><title>'+esc(name)+': '+(c?c+' ilan':'ilan yok')+'</title></path>';}).join('');
        // Renklenen her il yazılır; etiket ilin en büyük parçasının ağırlık merkezine konur (il merkezi kıyıda kalabilir).
        const names=Object.entries(counts).filter(([name,c])=>map.il[name]&&Number(c)>0).sort((a,b)=>a[1]-b[1]).map(([name,c])=>{const [x,y]=mapCenter(map,name)||xy(ll[name]||[0,0]);
            return '<text x="'+x.toFixed(1)+'" y="'+(y+5).toFixed(1)+'" text-anchor="middle">'+esc(name)+' <tspan>'+num(c)+'</tspan></text>';}).join('');
        return '<svg class="adm-map '+(liveSide==='from'?'is-from':'is-to')+'" viewBox="0 0 '+map.w+' '+map.h+'" role="img" aria-label="Bugün il bazında '+side+' sayıları">'+shapes+names+'</svg>'+
            '<p class="adm-legend adm-map-scale"><span>Az</span><i aria-hidden="true"></i><span>Çok '+side+'</span></p>';
    }
    function liveHTML(){
        const L=live||{},hours=Array.isArray(L.hours)?L.hours:[],minutes=Array.isArray(L.minutes)?L.minutes:[];
        const seg=(attr,current,items)=>'<div class="adm-seg" role="group">'+items.map(([k,l])=>'<button type="button" '+attr+'="'+k+'" aria-pressed="'+(current===k)+'">'+l+'</button>').join('')+'</div>';
        const tile=(label,value,note)=>'<div class="adm-kpi"><span>'+label+'</span><b>'+value+'</b><small>'+note+'</small></div>';
        const diff=change(L.today,L.yesterday),clicks=(Number(L.calls)||0)+(Number(L.whatsapp)||0),clickDiff=change(clicks,L.clicks_yesterday);
        const what=liveKind==='load'?'yük ilanı':liveKind==='truck'?'boş araç ilanı':'ilan';
        const head='<section class="adm-card adm-live-head"><div><p class="adm-live-dot"><i aria-hidden="true"></i>Canlı</p><small>'+(L.at?'Son güncelleme '+clock(L.at):'')+' · 30 saniyede bir yenilenir'+(liveStale?' · <b>Bağlantı kurulamadı, son veriler gösteriliyor</b>':'')+'</small></div>'+
            seg('data-admin-live-kind',liveKind,[['','Tümü'],['load','Yük'],['truck','Boş araç']])+'<button class="adm-btn" id="admin-live-theme" type="button" aria-pressed="'+liveDark+'">'+(liveDark?'Açık görünüm':'Koyu görünüm')+'</button></section>';
        const kpis='<section class="adm-kpis adm-live-kpis" aria-label="Canlı özet">'+
            tile('Yayında '+what,num(L.active),'şu an açık')+tile('Bugün eklenen',num(L.today),diff===null?'dün bu saatte kayıt yok':'Dün bu saate göre '+changeText(diff))+tile('Son 1 saat',num(L.last_hour),'yeni '+what)+
            tile('Ara tıklaması',num(L.calls),'bugün · numarayı açanlar')+tile('WhatsApp tıklaması',num(L.whatsapp),clickDiff===null?'bugün':'Toplam tıklama dün bu saate göre '+changeText(clickDiff))+tile('Yeni kullanıcı',num(L.users_today),'bugün kayıt olan')+'</section>';
        const minuteLabels=minutes.map((_,i)=>i===0?'60 dk önce':i===30?'30 dk':i===59?'şimdi':'');
        const charts='<div class="adm-duo"><section class="adm-card"><div class="adm-card-head"><h2>Son 60 dakika</h2><small>Dakikalık yeni '+what+'</small></div>'+liveBars(minutes.map(Number),{labels:minuteLabels,title:'Son 60 dakikada dakikalık yeni ilan'})+'</section>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>Bugün saat saat</h2><small>'+num(clicks)+' tıklama</small></div>'+liveBars(hours.map(x=>[Number(x.loads)||0,Number(x.trucks)||0,Number(x.clicks)||0]),{labels:hours.map(x=>x.h%6===0||x.h===23?String(x.h).padStart(2,'0'):''),title:'Bugün saatlik ilan',stack:true})+'<p class="adm-legend"><i class="b-load"></i>Yük <i class="b-truck"></i>Boş araç</p></section></div>';
        const counts=(liveSide==='from'?L.from_cities:L.to_cities)||{},top=c=>Object.entries(c||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}));
        const map='<section class="adm-card adm-live-map"><div class="adm-card-head"><h2>Bugün il haritası</h2>'+seg('data-admin-live-side',liveSide,[['from','Çıkış'],['to','Varış']])+'</div>'+liveMap(counts)+'</section>';
        const ranks='<section class="adm-card"><div class="adm-card-head"><h2>En çok ilan çıkan iller</h2><small>Bugün</small></div>'+rank(top(L.from_cities),'ilan')+'</section>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>En çok gidilen iller</h2><small>Bugün</small></div>'+rank(top(L.to_cities),'ilan')+'</section>';
        const recent=Array.isArray(L.recent)?L.recent:[];
        const feed='<section class="adm-card"><div class="adm-card-head"><h2>Son ilanlar</h2><small>Son 24 saat · en yeni üstte</small></div>'+(recent.length?'<ol class="adm-feed">'+recent.map(r=>
            '<li><span class="t">'+esc(ago(r.created_at))+'</span>'+pill(kindText(r.kind),r.kind==='load'?'ok':'brand')+'<b>'+esc(r.from_city||'?')+' → '+esc(r.to_city||'?')+'</b><small>'+esc(r.vehicle||'')+'</small><button class="adm-link" type="button" data-admin-live-open="'+esc(String(r.id))+'">#'+esc(String(r.id))+'</button></li>').join('')+'</ol>':'<p class="adm-empty">Son 24 saatte ilan yok.</p>')+'</section>';
        return head+kpis+charts+map+'<div class="adm-duo adm-live-bottom">'+feed+'<div class="adm-live-ranks">'+ranks+'</div></div>';
    }
    function scheduleLive(){
        if(typeof setTimeout!=='function')return;
        clearTimeout(liveTimer);
        liveTimer=setTimeout(()=>{if(!valid()||section!=='live')return;if(typeof document!=='undefined'&&document.hidden){scheduleLive();return;}load();},30000);
    }
    function render(){
        if(!valid())return;
        if(section==='live'){frame(liveHTML(),true);return;}
        if(section==='stats'){frame(kpis()+'<div class="adm-main">'+statsCard()+'</div>',true);return;}
        // Ayrıntı yalnız gösterilecekse sayfaya girer: açıldığında ya da yan yana sığacak genişlikte.
        const row=rows[selected],wide=(body.clientWidth||0)>=1080;
        let side='';
        if(panel&&panel.mode==='confirm')side=panel.html;
        else if(row&&(panel||wide))side=detail(row,selected);
        const summary=section==='overview'?summaryCard():'',detailHTML=side?'<aside class="adm-detail'+(panel?' open':'')+'" aria-label="Kayıt ayrıntısı">'+side+'</aside>':'';
        frame(kpis()+(section==='archive'?retentionCard():'')+'<div class="adm-main'+(side||summary?' has-detail':'')+'">'+listCard()+(summary?'<div class="adm-side">'+summary+detailHTML+'</div>':detailHTML)+'</div>',true);
    }
    function statsQuery(){return range.days?{from:addDays(isoToday(),-(range.days-1)),to:isoToday()}:{from:range.from,to:range.to||isoToday()};}
    async function load(){
        const ticket=++request;
        if(section==='live'){
            if(!live)frame('<h1>Yönetici paneli</h1><p role="status">Canlı veriler yükleniyor…</p>');
            try{const r=await nakgoAuth.adminLive(liveKind);if(!valid()||ticket!==request)return;live=r&&typeof r==='object'&&!Array.isArray(r)?r:{};liveStale=false;render();}
            catch(error){if(!valid()||ticket!==request)return;
                // Geçici bağlantı hatasında son veriler kalır; veri hiç yoksa panelin hata ekranı gösterilir.
                if(!live){frame('<h1>Panel açılamadı</h1><p role="alert">Canlı veriler alınamadı. Yetkini ve bağlantını kontrol et.</p><button class="adm-login-submit" id="admin-retry" type="button">Tekrar dene</button>');$('#admin-retry').onclick=load;return;}
                liveStale=true;render();}
            scheduleLive();return;
        }
        if(!stats)frame('<h1>Yönetici paneli</h1><p role="status">Yönetici erişimi kontrol ediliyor…</p>');
        try{
            const overview=await nakgoAuth.adminPage('overview',0,'','');
            if(!valid()||ticket!==request)return;
            const listSection=section==='overview'?'listings':section,listQuery=section==='stats'?statsQuery():section==='overview'?{recent:'24h'}:section==='archive'?null:query;
            const list=await nakgoAuth.adminPage(listSection,section==='overview'||section==='stats'?0:offset,section==='users'||section==='listings'?search:'',section==='users'||section==='moderation'||section==='archive'?filter:'',listQuery);
            if(!valid()||ticket!==request)return;
            let extra=null;
            if(section==='stats'){extra=await nakgoAuth.adminPage('insights',0,'','',listQuery);if(!valid()||ticket!==request)return;}
            if(section==='archive'){const r=await nakgoAuth.adminPage('retention',0,'');if(!valid()||ticket!==request)return;retention=r&&typeof r==='object'&&!Array.isArray(r)?r:{};}
            stats=overview&&typeof overview==='object'?overview:{};
            insights=extra&&typeof extra==='object'?extra:null;
            const all=Array.isArray(list)?list:[];
            rows=section==='stats'?all:all.slice(0,20);more=section!=='stats'&&all.length>20;
            if(selected>=rows.length)selected=0;
            history.clear();
            panel=null;render();
        }catch(error){if(valid()&&ticket===request){stats=null;frame('<h1>Panel açılamadı</h1><p role="alert">Yönetici paneli açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="adm-login-submit" id="admin-retry" type="button">Tekrar dene</button>');$('#admin-retry').onclick=load;}}
    }
    // Toplu kaldırma: tek gerekçe, ilanlar sırayla tek tek işlenir; her biri ayrı denetim kaydı bırakır.
    function bulkRemove(){
        if(!valid()||!checked.size)return;
        const items=[...checked.values()].filter(row=>!row.removed);
        const show=html=>{panel={mode:'confirm',html};render();};
        show('<button class="adm-back" id="admin-back" type="button">‹ Vazgeç</button><div class="adm-d-head"><h3>Seçilen '+items.length+' ilanı kaldır</h3></div>'+
            '<ul class="adm-bulk-list">'+items.map(r=>'<li>İlan #'+esc(String(r.id))+' · '+esc(r.from_city||'?')+' → '+esc(r.to_city||'?')+'</li>').join('')+'</ul>'+
            '<div class="adm-summary"><span>Ne olur?</span><p>Her ilan yayından kalkar ve sahibi yeniden yayımlayamaz. Her biri için ayrı işlem kaydı tutulur.</p></div>'+
            '<form id="admin-bulk-form" class="adm-form"><label for="admin-bulk-reason">Ortak gerekçe (zorunlu)</label><textarea id="admin-bulk-reason" minlength="3" maxlength="500" required></textarea><p id="admin-bulk-status" role="alert"></p><button class="btn" id="admin-bulk-submit" type="submit">'+items.length+' ilanı kaldır</button><button class="chip" id="admin-bulk-cancel" type="button">Vazgeç</button></form>');
        $('#admin-bulk-cancel').onclick=()=>{panel=null;render();};
        let sending=false;
        $('#admin-bulk-form').onsubmit=async event=>{
            event.preventDefault();if(sending||!valid())return;
            const reason=$('#admin-bulk-reason').value.trim();if(reason.length<3){$('#admin-bulk-status').textContent='En az 3 karakterlik bir gerekçe yaz.';return;}
            sending=true;++request;$('#admin-bulk-submit').disabled=true;$('#admin-bulk-cancel').disabled=true;
            const failed=[];let done=0;
            for(const row of items){
                if(!valid())return;
                $('#admin-bulk-status').textContent=(done+failed.length+1)+' / '+items.length+' işleniyor…';
                try{await nakgoAuth.adminModerate('listing',String(row.id),'remove',reason,Number(row.revision));done++;}
                catch(error){failed.push([row,error?.code==='40001'?'başka bir yönetici değiştirdi':'doğrulanamadı']);}
            }
            if(!valid())return;
            checked=new Map();
            show('<div class="adm-d-head"><h3>Toplu kaldırma bitti</h3></div><p role="status">'+done+' ilan kaldırıldı.'+(failed.length?' '+failed.length+' ilan işlenemedi:':'')+'</p>'+
                (failed.length?'<ul class="adm-bulk-list">'+failed.map(([r,why])=>'<li>İlan #'+esc(String(r.id))+' · '+esc(why)+'</li>').join('')+'</ul>':'')+'<button class="btn" id="admin-reload" type="button">Güncel durumu yükle</button>');
            $('#admin-reload').onclick=load;
        };
    }
    function confirmAction(row,forced){
        if(!valid()||!row)return;
        ++request;
        const kind=section==='users'?'user':'listing',action=forced||(kind==='user'?(row.suspended?'resume':'suspend'):(row.removed?'restore':'remove'));
        const label=({suspend:'Faaliyetleri askıya al',resume:'Askıyı kaldır',remove:'İlanı yayından kaldır',restore:'Kaldırma engelini aç',ban:'Kalıcı engelle',unban:'Engeli kaldır',delete:'Hesabı sil',grant_admin:'Yönetici yap',revoke_admin:'Yöneticiliği al',hold:'Yasal saklamaya al',release:'Yasal saklamayı kaldır'})[action];
        const explanation=({suspend:'Yeni ilan verme durdurulur. Hesaba giriş devam eder. Mevcut ilanlar otomatik kaldırılmaz.',resume:'Hesabın yeni işlem yapmasına yeniden izin verilir.',remove:'İlan yayından kalkar ve sahibi yeniden yayımlayamaz. Kayıt 1 yıl bekletilir.',restore:'İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.',
            ban:'Hesaba giriş kapanır, açık oturumlar sonlanır ve yayındaki ilanları kapanır. Engeli kaldırana kadar geri gelemez.',unban:'Hesap yeniden giriş yapabilir. Kapanan ilanları kendisi yeniden yayımlayabilir.',
            delete:'Geri alınamaz. Ad, telefon, şehir, ilan iletişim bilgileri, kayıtlı ilanlar ve rota alarmları hemen silinir; giriş bağlantısı kaldırılır. Kanun gereği giriş kayıtları (IP ve zaman) ile bu işlem kaydı 1 yıl saklanır, sonra hesap tamamen silinir.',
            grant_admin:'Bu kişi yönetici panelindeki tüm yetkileri alır: ilan kaldırma, askıya alma, engelleme, hesap silme ve yönetici atama.',revoke_admin:'Yönetici panelindeki yetkileri hemen kapanır. Hesap normal kullanıcı olarak devam eder.',
            hold:'Resmî bir talep veya inceleme için kullanılır. Bu ilan, geçmişi ve kararları kaldırılana kadar gece temizliğinde temizlenmez ve silinmez.',release:'İlan normal saklama düzenine döner: süresi geçtiyse bir sonraki gece temizliğinde işlenir.'})[action];
        const target=kind==='listing'?'<p id="admin-target">İlan #'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</p>':'';
        const show=html=>{panel={mode:'confirm',html};render();};
        show('<button class="adm-back" id="admin-back" type="button">‹ Vazgeç</button><div class="adm-d-head"><h3>'+label+'</h3><p>'+esc(row.display_name||row.owner_label||'')+'</p></div>'+target+'<div class="adm-summary"><span>Ne olur?</span><p>'+explanation+'</p></div><form id="admin-confirm" class="adm-form"><label for="admin-reason">İşlem gerekçesi (zorunlu)</label><textarea id="admin-reason" minlength="3" maxlength="500" required></textarea>'+(action==='delete'?'<label for="admin-confirm-word">Onaylamak için SİL yaz</label><input id="admin-confirm-word" autocomplete="off" maxlength="10" required>':'')+'<p id="admin-action-error" role="alert"></p><button class="btn" id="admin-submit" type="submit">'+label+'</button><button class="chip" id="admin-cancel" type="button">Vazgeç</button></form>');
        $('#admin-cancel').onclick=()=>{panel=null;render();};
        let sending=false;
        $('#admin-confirm').onsubmit=async event=>{
            event.preventDefault();if(sending||!valid())return;
            const reason=$('#admin-reason').value.trim();if(reason.length<3){$('#admin-action-error').textContent='En az 3 karakterlik bir gerekçe yaz.';return;}
            if(action==='delete'&&$('#admin-confirm-word').value.trim().toLocaleUpperCase('tr-TR')!=='SİL'){$('#admin-action-error').textContent='Silmek için SİL yaz.';return;}
            sending=true;$('#admin-submit').disabled=true;$('#admin-cancel').disabled=true;
            try{await nakgoAuth.adminModerate(kind,String(row.id),action,reason,Number(row.revision));if(valid())await load();}
            catch(error){if(!valid())return;
                show('<div class="adm-d-head"><h3>'+label+'</h3></div><p role="alert">'+(error?.code==='40001'?'Bu kayıt başka bir yönetici tarafından değiştirildi. Güncel durumu yükle.':'İşlem sonucu doğrulanamadı. Yeniden işlem yapmadan önce güncel durumu yükle.')+'</p><button class="btn" id="admin-reload" type="button">Güncel durumu yükle</button>');
                $('#admin-reload').onclick=load;
            }
        };
    }
    await load();
}

// Canlı sayfa il haritası: 81 il sınırı. Kaynak: Natural Earth 1:10m admin-1 (kamu malı, naturalearthdata.com);
// sadeleştirilmiş, eşdikdörtgen izdüşüm: x=(boylam-x0)*k*s+10, y=(y1-enlem)*s+10. Yalnız gösterim içindir.
const TR_MAP={w:1000,h:434,x0:25.6633,y1:42.0988,k:0.77715,s:65.8714,il:{"Ardahan":"M880 44l8 1-2 4 3 2 2-2 7 8 9 6-4 3 3 0 3 4 10 1 1 4-31 14-3 18-12 2-12-17-1-5 3-6 9-7 1-4-5-16 5-4 1-5 5-1z","Artvin":"M869 54l5 16-1 4-9 7-3 6-13 1-4 2 0 6-7 14-8-4-13 6-4-3 2-10-12-4 13-18-7-6-3-8 11-6 6-8 6 2 3-1 0 2 6 3 7-6 3 1 7-1 15 5z","Şırnak":"M894 325l-7-4-4 1-8 14-8 2-2 1-1-9-3-3-3 0-1-3-8 9-8 3-1-4-9-5-1-3 11-7 0-4-4-14 7 3 10 1 4-4 7 0 30 6 3-4 1-3 4-3 14 3-1 9 2 8-2 11-5 0-8-5-9 4z","Hakkari":"M922 330l-6-4 2-11-2-8 1-9 17-3 11 1 3-2 3-7 4-1 4 0 1 2 6 0 5 5 0 2 4 0 2 1 2 3-3 5 3 3-1 10 7 5 5 5-3 5 1 5-8-3-8 7-6 2-2 5-3-1-3-6 0-4 3-3-3-7-10-2-5 6-4 2-3-2-14-1z","Iğdır":"M990 172l-11-9-7 5 0 4-3-1-9 2-17-2-17-12-10 3-2-12 2-4 9-3 7-2 18 7 4-2 11 0 10 7 4 6 5 3 6 10z","Ağrı":"M972 172l-3 14-4 3-13-1-3 1 2 3-7 2-10-2-7 2-4-1-9-6-4 0-4 4-6 2-1 2 4 2-1 8-21 8-3 1 1-15-11-17 4-17-8-3-4-5 8-1 7-5 10 2 16-4 10 0 3 1 1 11 3 2 7-4 5 2 4 5 8 3 1 2 17 2 9-2 3 1z","Van":"M951 192l2 9 6 5-3 10 3 6 4 2-2 13 3 2 0 16 6 0 2 3-4 6-1 6-6 10-2 6-8 1-3 7-3 2-11-1-22 3-9-3-4 3-2-5 2-13-1-10-14-3-3-14 1-3 9-6 7-11 6-6 2-4-10-11 0-5 7-4 0-6-4-2 1-2 6-2 4-4 4 0 9 6 4 1 7-2 10 2 7-2z","Kırklareli":"M91 10l15 13 4-3 4-1 6 1 0-3 10 1 2 6-4 0 0 4 6 9 1 4 5 6-2 3-29 5-7 9-3 1-8-7-22 3-2-3 7-20-4-20 5-1 6-6 6 2 4-3z","Edirne":"M69 19l5 19-7 20 2 4 1 9-6 16 3 18-14 4-3-2-19 1-2-8 4-1 6-10 4-1 3-3-1-3 1-2-2-3 0-11 4-1 7-6 3 2 2-5-2-14-1 1-6-3 1-2-8-3 0-3 2-3 8-1 1-6 3-3 11 0z","Kars":"M920 75l1 6 9 6 4 11 0 10-3 5-5 4 4 4-2 4 6 11-3 3 1 2-16 5-2 4-13-1-16 4-10-2-4-7-7-5-6-1-4-6 2-3 18-9 0-11 12-2 3-18 31-14z","Mardin":"M841 336l-21 5-15 1-15-4-10 1-15 7-8 5-7-10 0-6-5-6-1-8 7-9 8-5 6-4 4 0 3-5 24-1 4-2 8 13 6 4 8-2 15-11 4 14 0 4-11 7 1 3 9 5 1 4z","Şanlıurfa":"M715 366l-13 2-8-2-15 0-13-11-13-3-10 5 1-3-4-8 0-3-5-1-1-17 7-8 5-1 5 3 4-5 13-2 7-7 11-2-3-3 6-1-2-2 4-1-1-3-3 1 2-2 3-1 0-5 3-1 1-5 6-3 12 3 14 11 3 1 1-2 4 3 2 17 6 11 1 8 5 6 0 6 7 10-25 12-17 3z","Kilis":"M617 367l-4 3-10-2-7 1-3 2-4-9-16-5 10-7 3-6 3 5 7 3 7 8 1-1 13 8z","Gaziantep":"M643 357l-26 10-13-8-1 1-7-8-7-3-3-5-3 6-10 7-11-9 12-17 11-9 2 1 2 6 4 1 7-6 20-4 2-1 0-7 12-1 6 2 4 3-2 1-8 8-1 3 2 4-1-1-1 1 2 10 5 1 0 3 4 8-1 3z","Hatay":"M573 357l-3 6-4 17 4 7-1 3 3 2 1 5-9 0-2 2-4-2-1 15-3 0-1 2-4 1-2 8-8-3-1-3-3 0 3-6-10-20 13-15 8-4 1-4-1-8-3-6-6-3-4 3-1-4 5-5 11 0 6 4 5-1 11 9z","İstanbul":"M140 47l9 6 27 12 10 2-3 5 1 2-1 4-3 4-3 1-5 2-10-1-4-7-1 0 1 3-1 3-5-3-13-3-2-9 3-9-2-9 2-3zM194 91l-12-7-1-4 3-3 0-5 6-5 36 6-2 7-9 5-1 3-3-1-4-5-3 0-10 9z","Tekirdağ":"M139 77l-9 3-3 4-11-2-11 1-5 10-7 9-5 5-8 2-3 2-2-10-8-1-3-8 1-10 5-11-1-10 22-3 8 7 6-3 4-7 29-5 2 9-3 9 2 9z","Çanakkale":"M77 111l-15 7-4 7-13 10 1 3-7 6-4 1 2-3 4-9-3-6 18-12 6-1 3-3 4-1-2-10 8 1 2 10zM61 178l-21 5-7 1-2-3 4-10-1-12 2-9 1-2 3 1 3-2 4-6 1-6 5-1 3-4 9-8 13 1 5-5 9-1 4 7 12 4-1 3-7 6 4 3-3 9 2 2-2 7-9 5-12-1-10 5-7 0-2 11zM30 159l1 3-5-2 1-1 3 0zM28 137l-1 2-12 3-5-2 5-5 8-3 3 2-1 4 3-1z","Rize":"M762 83l6-4 4 1 8-4 6-7 5 1 10-6 4-1 2 6 8 8-13 18-10 7-6 1-2 4-15 6 0-9-7-21z","Trabzon":"M700 78l7 1 8-4 10 7 5-1 8 4 6-1 6 4 9-4 3-1 2 4 5 17 0 9-16 2-8-2-7-5-3 3-6-6-4 5-15-5-3-4-1-4-2-1-3 2-2-3 1-17z","Giresun":"M647 85l18 3 9-4 4 1 10-5 12-2-1 11 1 8-6 1-6 5-3 14 11 6 0 2-8 5 1 14-8 1-11-5-5 2-11-9-4-19-5-6 0-15 2-8z","Ordu":"M598 73l8 0 11 7 4-1 5-6 1 2 3-1 1 4 5 6 11 1-2 8 1 8-1 7 5 6-8 3 0 4-6 1-6 4-4-3-6-12-7-1-11-8-11 0-15-6-1-5 7-1 8-6 8-11z","Samsun":"M514 40l6 1 17-7-2 6 3-6 7 7 1 11 13 13 3 2 4-2 5-7 11 1 8 4 2 7 6 3-3 4-5 7-10 6-5 1-2-2-3-1-8 3-10-9-5 7-6 3-4-1-15-1-10-10-25-3-5-12 3-4 9-5 3 7 6 2 11-1-3-16 3-8z","Sinop":"M448 19l6 1 7-2 14 2 7-4 3-6 4 0 4 5 5-1 1 1-5 1-1 6 6 10 15 8-3 8 2 12 0 4-10 1-6-2-3-7-9 5-5 8-9-4-9-1-1-2 0-14 6-9-3-4-20-3 4-9 0-4z","Kastamonu":"M375 26l27-11 46 4 0 4-4 9 20 3 3 4-6 9 0 14-3 0-7 10-4 8 1 2 3 2-1 4-14 3-8-4-2-3 3-5-1-3-21 9-9-6-7-1-3-4-6-2-1-9 5-6 5-1-2-9-4-2-7 1-2-2 0-4 3-3-4-11z","Bartın":"M341 43l7-8 7-2 10-5 10-2 4 11-3 3 0 4-7 6-3 4-6 6-11 1 1-6-3-8-6-4z","Zonguldak":"M301 72l3-3 0-7 13-6 11-7 13-6 6 4 3 8-1 6-4 5-3 15-30-3-11-6z","Düzce":"M281 77l14-1 6-4 11 6 12 2-1 5-2 3-14 4-2 9-4 2-19-1-4-2 1-2-2-11 4-6 0-4z","Sakarya":"M254 71l16 5 11 1 0 4-4 6 2 11-5 5 0 6-7 1-5 9 3 5-1 2-6 0-3-3-5-1-9 2-5-2-6-6-2-6 13-4 5-14 3-4-2-2 9 1 1-7-4 0-1-4 2-5z","Kocaeli":"M226 73l14 0 6-5 8 3-2 5 1 4 4 0 0 2-1 5-9-1 2 2-3 4-3 10-5 6-6 2-11-2-13 4-6-1 1-8 2-2 4 2 10-2 9 0 0-3-2 0-5 1-6-2-15 1-3-4-3 1 2-2-2-2 10-9 3 0 4 5 3 1 1-3 9-5 2-7z","Yalova":"M180 118l-11-4 1-2 10-6 15-2 5-2 3 1-1 8-3 0-6 4-13-5 0 8z","Bursa":"M140 122l15 0-2 1 10 1 6-2 14 2 2-4 4 0-5-3-4 1 0-8 13 5 6-4 9 1 13-4 7 2 1 3-5 4-2 7 1 5-5 7-2 7 5 11-10 2-7-3-3 2-4 12-2 2-2 7-6 2-6-1-5-4-6 0-4-3-2-6-2 2-4-1-14-10-2-7-7-10 2-5-2-4 5-7z","Balıkesir":"M108 127l11 0 5-4-5-1-6-6 4-3 14 4-6 5 0 2 15-2-5 7 2 4-2 5 7 10 2 7 14 10 4 1 2-2 2 6 4 3 6 0 3 2-4 13-4 7-7 3-1 6-4-1-13 3-8 5-2-1-7-11-7 0 2-6-1-2-11 0-8-4-4 2-4-5-3 0-12 7-14 12-3-6-6-1 2-3 2 3 7-8-1-2 7-4 1-3-1-3-2 0-3 1-9 1 2-11 7 0 10-5 12 1 9-5 2-7-2-2 3-9-4-3 7-6 1-4zM112 105l4 1-1 2-6 2-3-1 0-4 6 0z","İzmir":"M92 287l-1-6-5 0-9-5-5 1-6-11-6 1-2 6-4-5-5-3 0 2-2-4-2 2-6-3 4-3-1-3 2-1-1 3 4 1 0-2 5-1-2-4 2 1 2-2-4-2-3 1-2-12 3-3 5 2 7 9 0 3-3 1 0 2 5 8 1-8 3 4 9-1 4-2 4 0 4-3-7 0-5 1-6-7 4 3-3-3 1-3-3 0-4-4 2-1-2-3 5-3 4 2 2-3-2-3 2-1 1 2 0-3 6-2-1-4-9 2-3-3-1-4 4-4-5-6 14-12 12-7 5 2 8 22-1 5-10 6-5 11 5 9 3 3 10 0 3 6 7 4 4 6 2-1 2-4 9 1 3 6 8-2 8 5 4 10-15 6-10 0-12 3-15-1-7 5-7 1z","Aydın":"M99 319l-4 4-4 1-3-2 2-3 0-5-2 1 1-8-10-5 11-4 2-4-1-5 15-8 15 1 12-3 10 0 15-6 7 0 5 7 1 6-2 4 3 5 4 2-9 9-8 1-1 2 3 5-7-1-11-5-6 7-6 1-13-2-13-5-6 10z","Muğla":"M194 392l-8-6 1-1-1-4 1-6-5 1 1-5 3-1 0-1-8-7-4 4 0 4 1-2 1 0-3 4-1-1 1-1-5-4-7-1 0-7-1 1-2-2-1 3-2-1-2-5-4 1 2 2-1 3-4-2-2 1 2-2-2-1-2 2 3 6-3 0-7 8-6 3-1-3 3 0 3-3-2 1 0-4-1 2-3-2 8-2-2-1 1-2 1 1 0-3-11 4-10-1-2 6-6-1-4 2-6-2 0-2 3 0 1-3 6-1 3 0 1-2 6 1 7-2 7 2 1-2-2-3 2-1-1-2 2-1-1-1 6 2 0-3 1 1 1-4 2 1 4-4-10 1-1 1-6-1-11 2-11 0 0 2-6-4-2 0-1 2 0-2-3 1-1 4-2-1-2-6 4-3-3-1 4 0 0-3 1 2 2-1 5 4 5-3-3-4 5 0 0-5-3 0-2 3-1-3-2 1 1-6-2 3-2-1 0-3 2-2-2-1 4-9 3-1 12 5 13 2 6-1 6-7 4 1 7 4 7 1 1 7 5 1 4 8 4 1 9 8 3 10 8 3 2-3 1-6 3-2 0 8 2 0 3-3 6-1 4 7-5 13-1 7-5 4 0 4-6 1-2 9-3 2z","Antalya":"M364 406l-11-6-18-24-10-3-22-12-2-3-21-3-8 1-5-3-6 7 0 17-5 8 3 4-5 8-2 1 0-4-8-3-4 1-2 4-4-1-10 5-3 3-3-2-3 3-1-5-3 1 2-1-11-2 0-3-3 2-5-4 3-2 2-9 6-1 0-4 5-4 1-7 5-13 6-5 5-12 20-9 3 0 5 5 17-1 8-9 4 2 13-5 10 5 18 3 26 23-1 6 7 3 3 14 8 11 0 11-4 12z","Mersin":"M485 364l-2 0-3-4-6-2-9 3-14 12-5 8-5 3 0 6-4 2-2 6-2-5-3-2-9 12-2-4-5 4-5-2-15 2-5 3-6-1-7 5-12-4 4-12 0-11 10 0 10-2 3-6 5 2 1-2-1-2-8-6-3-8 6-3 3 2 3-7 8-4 25-5 5-4 9-2 11-6 7-5 1-2 11-4 3 1 6 10 2 10 7 4-1 4 0 11-6 5z","Adana":"M536 354l-7 7-6 0-4 3 0-1-1 4 3-4 3 1-4 3-1 2 5-4-4 7-4 1-3-2 2 2-4-1-5 4-17-11-4-1 6-5 0-11 1-4-7-4-2-10-6-10 0-4 4-7-2-8 2-2 10 0 7-7 9 1 11 3 2-1-1-12 19-13 9-16 10-5 3 1 5 9-4 7-5 15 2 17-5 4-8 0-9 19 2 10 5 2 2 5-3 7-2 0-5 5 1 4z","Bolu":"M360 102l-3 2 2 9-4 6-4 2-8-1-13 5-18 3-7-3-9 0-9-4-3 11-8 7-6-2-2-2-5-15 4-10 7-1 0-6 4-3 23 3 4-2 2-9 14-4 2-3 1-5 25 2 0 4 11 5 1 4-1 7z","Ankara":"M351 121l4-2 4-6-2-9 7-2 19 7 16 17 4 0 2-4 11 4-2 21-9 2-5 17 1 6 5 7 7 21 12 9 9 3-3 6 2 10-6 5-4 0-14 5-5-11 1-14-3-7-11-7-3 2-2 6-8-3-9 8-4-2-6 4-10-4-10 1-12-8 10-7-3-5-2-14-5-11 1-7-6-5-2-7-15 0-2-2-7-1-3 3-6-2-7 2-4-8 8-7 3-11 9 4 9 0 7 3 18-3 13-5 8 1z","Bilecik":"M264 126l6 11-5 0-5 4-3 10-8 3-4 4-1 7-5 7-10 2-12-7-2-4 1-9 5 0-5-11 2-7 5-7-1-5 4-9 3-2 7 9 5 2 13-2 4 4 6 0z","Eskişehir":"M270 137l6 2 4 8 7-2 6 2 3-3 7 1 2 2 15 0 2 7 6 5-1 7 7 15 0 10 3 5-5 3-5 4-1 5-4 0-16 0-10-12-15 8-5-4-10 8-6-2-5-5-1-5-5-6-2-9-8-9 5-7 1-7 4-4 8-3 3-10 5-4 5 0z","Çankırı":"M361 97l12-8 2-4 7-1 5-2 2-6 2 2 7 1 9 6 21-9 1 3-3 5 2 3 10 5 3 4-2 5 2 10 3 11-3 6-6 3-29-9-2 0-1 4-4 0-16-17-15-7-8 0 1-5z","Karabük":"M361 96l-1-5-11-5 0-4-7-1 3-15 4-5 11-1 6-6 3-4 7-6 2 2 7-1 4 2 2 9-5 1-5 8 1 7 6 2 1 2-2 6-5 2-7 1-2 4-12 7z","Tokat":"M575 91l0 4 13 6 14 1 11 8 7 1 3 7-6 9-9 4-29 4-2 1-4 10-9 4-20 3-3-4 1-6-3-2-6 2-7-1-4 1-8-7 4-6 7-4 6-11 8 1 6 3 4-1 6-4 0-4 4 0 3-4 2-7-4-7 10-4 3 1 2 2z","Sivas":"M641 122l1-5 8-3 6 22 9 6 5-2 5 2 6 3-1 3-1 3-4-1-5 2-5-2-3 1-1 8 7-1 1 1-8 9-2 9 5 7-4 4 2 12-2 4-11 5-11 1-7 4-11 0-1 2 2 9-5 6-11 9-12 1-9-2-7 2 10-30-2-6-8-3-10 2-5-3-17 0-10-7-5-2 10-13 9-7 1-7-6-12 20-3 8-2 7-13 29-4 9-4 6-9 7 8 6-4 5 0z","Çorum":"M461 62l19 7 2-4 5 12 6 0-3 17 4 9 16 5 1 3-1 7-5 9 0 6-7 1-2 9-4 3-7-1-8 3-9 2-8-2-21 6 3-9-7-14 6-3 3-8-5-16 2-8-3-4 12-4 1-4-3-2 0-4 10-16 3 0z","Amasya":"M493 77l19 3 10 10 15 1 4 1 6-3 3-6 3 0 9 8-2 2 4 6-5 11-4 0 0 4-6 4-5 0-9-3-4 0-6 11-7 4-4 6-8-2-1-7 5-9 1-7-1-3-15-4-3-3-2-7 3-17z","Kütahya":"M216 154l-1 9 2 4 12 7 10-2 8 9 2 9 5 6 1 5-4 5-6 3-8 18-11 6 0-6-2-3-8-2-6 1-2 7-13 2-10-3-3 3 1-4-3-6 0-6-4-6-10-3-3-3 1-6 7-3 4-7 4-13 8 3 6-2 2-7 2-2 4-12 3-2 7 3 5-2z","Konya":"M391 199l11 7 3 7-1 14 5 11-5 7-4 16-1 6 4 11 6 6 36-4 2 6 5 2 8 11 0 3-3 12 6 9-2 3-17 10-4-9-13-14-2-9-2-1-5 0-6 7-5 2-21 4-19 25-1 6 6 2 0 4-14 14-1-9-8-4 2-5-9-7-6-7-11-9-18-3-7-5 2-8-2-6 4-3 2-7 0-14 9-5 0-2-17-16-2-5 9-6 9-10 0-8 6-9 0-3-2-2 1-6 7 0 1-5 12 8 10-1 10 4 6-4 4 2 9-8 8 3 2-6 3-2z","Karaman":"M418 303l7 1 2 9 13 14 4 9-7 1-12 7-20 3-8 4-3 7-3-2-6 3 3 8 3 3 6 5-1 2-5-2-3 6-10 2-10 0-5-5-5-11 13-12 2-4-1-2-6-2 1-6 19-25 26-6 6-7z","Niğde":"M463 323l-6-9 3-12 0-3-8-11-5-2-2-6 17-26 10-1 6 4 6-2 3 10 3 3 8 0 3 15-2 2-1 7-7 7-10 0-2 2 2 8-4 7 0 4-3-1-11 4z","Kayseri":"M498 292l1-7 2-2-3-15-8 0-3-3-3-10 8-12 0-9-6-10 3-13 12 2 25-15 4-6 5 2 10 7 17 0 5 3 5-2 9 1 4 2 2 6-10 30-5 9-7 9-5-9-3-1-10 5-9 16-19 13 1 12-2 1-11-3-9-1z","Isparta":"M296 252l2 5 17 16 0 2-9 5 0 14-2 7-4 3 2 6-2 8-16 5-4-2-2-4-3-1-7-14-6-2-4-1-9-9-13 10-3-5 7-3 4-12 15-13 13-5 16-16 8 6z","Manisa":"M163 204l4 3 9 3 4 6 0 6 3 6-1 4-9 8 3 5 0 6-3 9 4 3-4 1-3 8-12 1-5-12-8-3-7 2-3-6-6-1-3 0-2 4-2 1-3-5-8-5-3-6-10 0-8-10 5-13 11-8 0-3-6-19 4-2 8 4 11 0 1 2-2 6 7 0 7 11 2 1 8-5 13-3 4 1z","Denizli":"M165 273l5-1 3-8 4-1 6 3 6-2 3 2 7 0 3-5 7 1 4-2 0-8 6-2 7 2 7 11 1 4-18 14-1 9 6 1 3 5-16 12 3 10-8 13-7 20-1 1-8-3-3-10-9-8-4-1-4-8-5-1-3-9 0-5 8-1 5-6 4-1-1-3-3-1-3-5 2-4-1-6-5-7z","Burdur":"M210 317l-2-9 16-12 9-1 3 5 13-10 9 9 10 3 7 14 4 3 1 2-8 9-17 1-5-5-3 0-11 4-9 5-5 12-6 5-4-7-6 1-3 3-2 0 1-15 9-15-1-2z","Aksaray":"M427 233l6-5-2-10 2-4 6 2 3 5 7-2 1 8-3 7 1 3 8 2-1 10 5 4 2 1-17 26-36 4-6-6-4-11 5-22 5-7 14-5 4 0z","Nevşehir":"M478 257l-6-4-7 2-5-2-5-4 1-10-6 0-3-5 3-7-1-8 5 5 3-1 0-8 12-5 2-3-3-5-1-10 1-5 9 2 5 10 6 5 1 7-3 13 6 10 0 9-8 12-6 2z","Yozgat":"M514 136l8 7 11 0 6-2 3 2-1 6 9 16-1 7-9 7-14 19-25 15-12-2-1-7-6-5-5-10-6-6-5-2-9-13-6-1-6-5-3-1-3-7 21-6 8 2 9-2 8-3 7 1 5-5 1-7 7-1 2 2 7 1z","Kırşehir":"M433 214l1-2-9-3-12-9-1-3 6-10 8-7 6-12 9-8 4 2 6 5 6 1 9 13 7 4 2 3-7-1-1 3 1 12 3 5-2 3-12 5 0 8-3 1-5-5-7 2-3-5-6-2z","Uşak":"M216 222l8 2 2 3 0 6-7 17-6 2 0 8-4 2-7-1-4 5-6 0-3-2-6 2-3-2-7-4 3-9 0-6-3-5 12-11 10 3 13-2 2-7 6-1z","Erzincan":"M679 151l2-6 8-1 23 11 10 1 11-3 4-6 8-1 5-3 8 2-2 7 12 2 3 4 1 5 7 6-3 10-23-3-10 3-6-3-8 5-12 1-8-1-15 4-10 7 1 5-4 2-3 5 2 8-3 1-6-6-11-3 2-4-2-12 4-4-5-7 2-9 8-9-1-1-7 1 1-8 3-1 5 2 5-2 4 1z","Tunceli":"M753 176l19 2-4 4-4-1-2 4-7 2-1 3-7 1-2 8 1 7-1 2-7 2 0 8-5 6-13 3-3 3-20-8-14 0-2-2 1-5-4-11 3-5 4-2-1-5 15-9 10-2 12 1 11-2 5-4 6 3 10-3z","Afyonkarahisar":"M226 233l11-6 8-18 6-3 4-5 9 7 4-1 8-7 5 4 15-8 10 12 13 0-1 6 2 2-6 12 0 8-9 10-9 6-2-1-6-5-16 16-13 5-15 13-4 12-3 3-13 1-3-5-6-1 0-7 19-16-1-4-7-11-7-2 7-17z","Kırıkkale":"M412 197l-12-31 5-17 9-2 2-21 19 5 3 8 3 2 1 4-3 6 2 9-9 8-6 12-8 7-6 10z","Kahramanmaraş":"M565 259l7-9 4-8 8-3 9 2 12-1-3 5 0 4 12 1 14 7 2 5-3 12-8 18-7 8 2 7 8 5 0 7-16 4-9 2-4 5-4-1-2-6-2-1-3 3-6 3-7-7-14 2-2-3-3-7 3-6 0-5 5-4-2-17 5-15 4-7z","Muş":"M838 203l10-4 6-5 2-8 12-4 11 17-1 15-7 5-11-1-7 3-1 4-5 0-1 3 2 5-2 2-7 5-8 0-9 3-7 1-1-7-6-6-4-9 5-13-5-15 2-4 12 0 11 11 9 2z","Erzurum":"M868 182l-12 4-2 8-6 5-10 4-9-2-11-11-12 0-5-6-7-3-6-5-8 4-4-1 3-10-7-6-1-5-3-4-12-2 2-7 11 1 4-4 9-4 3-4 0-1-12-3-4-17 15-6 2-4 6-1 10-7 4 2 8 2-2 10 4 3 13-6 8 4 7-14 0-6 4-2 13-1 1 5 12 17 0 11-18 9-2 3 4 6 6 1 7 5 4 7-7 5-8 1 4 5 8 3-4 17z","Malatya":"M649 209l11-5 13 5 4 4-5 2 2 15-8 0-1 4-4 2-2 5 2 4 5 3 11 4 6-1 8 7 8-1 1 4-1 6-5 4-11 3-12-2 2-6-9 0-7 9-4 2-2 6-3 3-29 6 11-30-2-5-14-7-12-1 0-4 3-5 15-12 0-14 6 1 12-5 11-1z","Elazığ":"M724 227l9-3 3-3 3-13 6 0 17-9 2 3-6 13 5 13-1 4-4-1-2 7 3 5 0 6-17 0-4-2-2 0-3 6-3 2-38 4-5-3-4-5-6 1-11-3-5-3-2-5 2-5 4-2 1-4 8 0-2-13 1-4 7-1 2 3-1 5 2 2 14 0 20 8 3-3 4 0z","Bitlis":"M871 219l16-10 9-2 2 9 8 7-2 4-6 6-7 11-9 7 2 16 3 1-5 16-5-3-18-9-10-7-8 3-11-3-3-20-5-2 9-3 8 0 4-2 5-5-2-5 1-3 5 0 2-4 8-3 9 1z","Bingöl":"M768 182l4-4 8 2 8-4 6 5 7 3 5 6-2 4 5 15-5 13 4 9-15 8-21 1-3 3-2 4-8 2 0-6-3-5 2-7 4 1 1-4-5-13 6-13-2-3-17 9 2-17 7-1 1-3 7-2 2-4 4 1z","Osmaniye":"M553 302l0 5-3 6 5 10 12-3 9 8-7 12-7 8-5 1-6-4-9 0 2-11-6-3-2-10 9-19 8 0z","Adıyaman":"M622 312l-8-5-2-3 2-6 5-6 29-6 3-3 2-6 4-2 7-9 9 0-2 6 12 2 21-8 2 4-1 5-9 5-1 5-3 1 0 5-2 0-3 3 3-1 1 3-4 1 2 2-6 1 3 3-11 2-8 8-12 1-3 2-1 3-5-3-2 1-10-6-12 1z","Diyarbakır":"M808 231l6 6 0 6 3 4-9 5-2 10 0 10-4 11-5 6 2 6-3 2-24 1-3 5-4 0-14 9-7 9-6-11-2-17-10-4-10-7-14-5 3-2 1-7-2-2-5 1 1-6-1-4 7-1 8 2 16-3 3-2 3-6 2 0 4 2 23-1 4-3 0-4 3-1 18 0 18-9z","Batman":"M817 245l5-2 5 2 3 17 0 3-6 10-6 1-1 8 5 5 9 4 6 6-15 11-8 2-6-4-3-7-6-6-2-6 5-6 4-11 0-10 2-10 9-5 0-2z","Siirt":"M849 265l10 7 10 4 12 8 3-3 0-7 3-6 11 2 0 19-1 4 1 8-3 4-30-6-7 0-4 4-10-1-7-3-6-6-9-4-5-5-1-5 2-3 6-1 6-10 11 3 8-3z","Bayburt":"M758 145l-8-2-5 3-8 1-3-8 3-8-2-20 2-2 3 0 5 4 8 2 16-2 4 17 12 3-3 5-9 4-4 4-11-1z","Gümüşhane":"M735 111l2 20-3 8 3 8-4 6-8 2-13 0-23-11-1-14 8-5 0-2-11-6 3-14 6-5 8 0 2-2 6 9 15 5 4-5 6 6z"}};

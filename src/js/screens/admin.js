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
function renderAdminHost(m){
    const head='<div class="load admin-host-card"><h2>NakGo · Yönetici paneli</h2>';
    const out=()=>{adminHostOpened=false;nakgoAuth.signOut();};
    if(!nakgoMarket.active()){adminHostOpened=false;m.innerHTML=head+'<p>Devam etmek için yönetici hesabınla giriş yap.</p><button class="btn" id="admin-signin">Giriş yap</button></div>';$('#admin-signin').onclick=()=>nakgoMarket.requireAccount();return;}
    nakgoAdminAccess.ensure();
    if(!nakgoAdminAccess.checked()){m.innerHTML=head+'<p role="status">Yetki kontrol ediliyor…</p></div>';return;}
    if(!nakgoAdminAccess.isAdmin()){m.innerHTML=head+'<p role="alert">Bu hesabın yönetici yetkisi yok.</p><button class="chip" id="admin-signout">Çıkış yap</button></div>';$('#admin-signout').onclick=out;return;}
    m.innerHTML=head+'<p>Panel bu ekranın üstünde açılır. Kapattıysan yeniden açabilirsin.</p><button class="btn" id="admin-open">Paneli aç</button><button class="chip" id="admin-signout">Çıkış yap</button></div>';
    $('#admin-open').onclick=openAdminPanel;$('#admin-signout').onclick=out;
    if(!adminHostOpened){adminHostOpened=true;openAdminPanel();}
}
// Panel: yan menü, özet kartları, filtreli liste ve seçili kaydın ayrıntısı. Yerleşim kapsayıcı genişliğine göre
// değişir: dar ekranda liste kartlara döner, ayrıntı tam ekran açılır. Görünen her değer esc ile kaçırılır.
const adminIcons={overview:'<path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z"/>',listings:'<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.4c1.6.6 2.6 2.1 3 4.6"/>',
    moderation:'<path d="M12 4 5 7v5c0 4 3 6.7 7 8 4-1.3 7-4 7-8V7z"/><path d="m9 12 2 2 4-4"/>',stats:'<path d="M5 20V10M12 20V4M19 20v-7"/>',
    refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'};
const adminIcon=name=>'<svg class="adm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+adminIcons[name]+'</svg>';
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const generation=++adminPanelGeneration,account=nakgoMarket.token(), body=$('#sheetBody');
    const host=typeof ADMIN_HOST!=='undefined'&&ADMIN_HOST;
    let section='overview',offset=0,search='',filter='',request=0,stats=null,rows=[],more=false,selected=0,panel=null,period='day';
    const titles={overview:'Genel bakış',listings:'İlanlar',users:'Kullanıcılar',moderation:'İşlem geçmişi',stats:'İstatistikler'};
    const short={overview:'Özet',listings:'İlanlar',users:'Kişiler',moderation:'Geçmiş',stats:'Sayılar'};
    const valid=()=>generation===adminPanelGeneration&&account===nakgoMarket.token()&&body.dataset.k==='admin';
    const date=value=>value?new Date(value).toLocaleString('tr-TR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
    const day=value=>value?new Date(value).toLocaleDateString('tr-TR',{day:'numeric',month:'short',year:'numeric'}):'—';
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
    const pill=(text,tone)=>'<span class="adm-pill '+tone+'">'+esc(text)+'</span>';
    const actionText={suspend:'Faaliyetler askıya alındı',resume:'Askı kaldırıldı',remove:'İlan kaldırıldı',restore:'İlan engeli açıldı'};
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        if(!authorized){
            body.innerHTML='<div class="detail-top"><b>NakGo · Yönetici paneli</b><button class="chip" id="admin-close">Kapat ×</button></div><div class="load">'+content+'</div>';
            $('#admin-close').onclick=closeSheet;return;
        }
        body.innerHTML='<div class="adm"><div class="adm-shell"><div class="adm-nav" role="navigation" aria-label="Yönetim bölümleri"><span class="adm-brand">NakGo</span>'+
            Object.entries(titles).map(([key,label])=>'<button class="adm-nav-btn" data-admin-section="'+key+'" aria-label="'+label+'" aria-pressed="'+(section===key)+'">'+adminIcon(key)+'<span class="l-long">'+label+'</span><span class="l-short">'+short[key]+'</span></button>').join('')+
            '</div><div class="adm-page"><div class="adm-top"><p class="adm-crumb"><span>Yönetici paneli</span> › <b>'+titles[section]+'</b></p><div class="adm-top-act">'+
            '<button class="adm-btn" id="admin-refresh" type="button">'+adminIcon('refresh')+'Yenile</button><button class="adm-btn" id="admin-close" type="button">'+(host?'Çıkış yap':'Kapat ×')+'</button></div></div>'+content+'</div></div></div>';
        $('#admin-close').onclick=host?()=>{closeSheet();adminHostOpened=false;nakgoAuth.signOut();}:closeSheet;
        $('#admin-refresh').onclick=load;
        body.querySelectorAll('[data-admin-section],[data-admin-go]').forEach(button=>button.onclick=()=>{section=button.dataset.adminSection||button.dataset.adminGo;offset=0;search='';filter='';selected=0;panel=null;load();});
        body.querySelectorAll('[data-admin-period]').forEach(button=>button.onclick=()=>{period=button.dataset.adminPeriod;render();});
        body.querySelectorAll('[data-admin-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.adminFilter;offset=0;selected=0;panel=null;load();});
        body.querySelectorAll('[data-admin-open]').forEach(item=>item.onclick=event=>{if(event.target.closest('[data-admin-action]'))return;selected=Number(item.dataset.adminOpen);panel={mode:'detail'};render();});
        body.querySelectorAll('[data-admin-action]').forEach(button=>button.onclick=()=>confirmAction(rows[Number(button.dataset.adminAction)]));
        if($('#admin-back'))$('#admin-back').onclick=()=>{panel=null;render();};
        if($('#admin-prev')){$('#admin-prev').onclick=()=>{offset=Math.max(0,offset-20);selected=0;load();};$('#admin-next').onclick=()=>{offset+=20;selected=0;load();};}
        if($('#admin-search'))$('#admin-search').onsubmit=event=>{event.preventDefault();search=$('#admin-term').value.trim();offset=0;selected=0;load();};
    }
    function kpis(){
        const s=stats||{},st=s.listing_states||{},t=s.totals||{},ty=s.user_types||{},month=(s.periods&&s.periods.month)||{};
        // Her kart: değer, yüzde açıklaması ve varsa oran çubuğu.
        const tile=(label,value,note,tone,share)=>'<div class="adm-kpi '+tone+'"><span>'+label+'</span><b>'+value+'</b><small>'+note+'</small>'+
            '<i class="adm-bar'+(share===null||share===undefined?' empty':'')+'" aria-hidden="true"><em style="width:'+Math.min(100,Math.max(0,Number(share)||0))+'%"></em></i></div>';
        const removed=Number(s.listings_removed)||0,dayChange=change(s.listings_today,s.yesterday);
        const sets={
            overview:[['Aktif ilan',num(s.listings),pctText(pct(s.listings,st.all))+' kayıtlı ilanların','brand',pct(s.listings,st.all)],
                ['Bugün eklenen',num(s.listings_today),dayChange===null?'dün kayıt yok':'Düne göre '+changeText(dayChange),'ok',pct(s.listings_today,s.periods&&s.periods.week&&s.periods.week.listings)],
                ['Kullanıcı',num(s.users),pctText(pct(s.users_week,s.users))+' bu hafta yeni','accent',pct(s.users_week,s.users)],
                ['Kaldırılan / askıda',num(removed),pctText(pct(removed,st.all))+' ilanların · '+num(s.accounts_suspended)+' hesap askıda','bad',pct(removed,st.all)]],
            listings:[['Yayında',num(st.active),pctText(pct(st.active,st.all))+' · '+num(st.all)+' ilan kayıtlı','ok',pct(st.active,st.all)],['Süresi doldu',num(st.expired),pctText(pct(st.expired,st.all))+' · 8 gün sonra temizlenir','accent',pct(st.expired,st.all)],
                ['Kapalı',num(st.closed),pctText(pct(st.closed,st.all))+' · sahibi kapattı','brand',pct(st.closed,st.all)],['Kaldırılan',num(st.removed),pctText(pct(st.removed,st.all))+' · moderasyonla','bad',pct(st.removed,st.all)]],
            users:[['Toplam kullanıcı',num(s.users),pctText(pct(ty.carrier,s.users))+' taşıyıcı','brand',pct(ty.carrier,s.users)],['Bu hafta yeni',num(s.users_week),pctText(pct(s.users_week,s.users))+' toplamın','ok',pct(s.users_week,s.users)],
                ['Taşıyıcı',num(ty.carrier),pctText(pct(ty.owner,s.users))+' yük sahibi ('+num(ty.owner)+')','accent',pct(ty.carrier,s.users)],['Askıda',num(s.accounts_suspended),pctText(pct(s.accounts_suspended,s.users))+' kullanıcıların','bad',pct(s.accounts_suspended,s.users)]],
            moderation:[['Son 30 gün',num(s.actions_month),'yönetici işlemi','brand',null],['Kaldırılan ilan',num(s.listings_removed),pctText(pct(removed,st.all))+' ilanların','bad',pct(removed,st.all)],
                ['Askıdaki hesap',num(s.accounts_suspended),pctText(pct(s.accounts_suspended,s.users))+' kullanıcıların','accent',pct(s.accounts_suspended,s.users)],['Aktif ilan',num(s.listings),pctText(pct(s.listings,st.all))+' kayıtlı ilanların','ok',pct(s.listings,st.all)]],
            stats:[['Toplam ilan',num(t.listings),pctText(pct(month.listings,t.listings))+' son 30 günde','brand',pct(month.listings,t.listings)],['Yük ilanı',num(t.loads),pctText(pct(t.loads,t.listings))+' tüm ilanların','ok',pct(t.loads,t.listings)],
                ['Boş araç ilanı',num(t.trucks),pctText(pct(t.trucks,t.listings))+' tüm ilanların','accent',pct(t.trucks,t.listings)],['Toplam kayıt',num(t.users),pctText(pct(month.users,t.users))+' son 30 günde','mute',pct(month.users,t.users)]]};
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
        const sets={listings:[['','Tümü',st.all],['active','Yayında',st.active],['expired','Süresi doldu',st.expired],['closed','Kapalı',st.closed],['removed','Kaldırılan',st.removed],['redacted','Temizlendi',st.redacted],['load','Yük'],['truck','Boş araç']],
            users:[['','Tümü',stats&&stats.users],['new','Bu hafta',stats&&stats.users_week],['carrier','Taşıyıcı',ty.carrier],['owner','Yük sahibi',ty.owner],['tir','Tır',vu.tir],['kamyon','Kamyon',vu.kamyon],['kamyonet','Kamyonet',vu.kamyonet],['suspended','Askıda',stats&&stats.accounts_suspended]],
            moderation:[['','Tümü'],['listing','İlan işlemleri'],['user','Hesap işlemleri']]}[section];
        return sets?'<div class="adm-chips" role="group" aria-label="Filtre">'+sets.map(([key,label,count])=>'<button class="adm-chip" type="button" data-admin-filter="'+key+'" aria-pressed="'+(filter===key)+'">'+label+(count!==undefined&&count!==null?' <b>'+num(count)+'</b>':'')+'</button>').join('')+'</div>':'';
    }
    function rowHTML(row,index){
        const open=' data-admin-open="'+index+'"',on=selected===index?' on':'';
        const view='<button class="adm-link" type="button" data-admin-open="'+index+'">Görüntüle</button>';
        if(section==='users'){
            const act=row.protected?'<span class="adm-note">Korumalı</span>':'<button class="adm-act" type="button" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>';
            const status=row.protected?pill('Yönetici','brand'):row.suspended?pill('Askıda','bad'):pill('Aktif','ok');
            return '<div class="adm-row'+on+'"'+open+'><b class="c-main">'+esc(row.display_name||'İsimsiz hesap')+'</b><span>'+esc(row.city||'—')+'</span><span>'+typeText(row.account_type)+(Array.isArray(row.vehicles)&&row.vehicles.length?' <small>'+esc(row.vehicles.join(', '))+'</small>':'')+'</span><span>'+day(row.created_at)+'</span><span class="c-num">'+num(row.listings)+' ilan</span><span>'+status+'</span><span class="c-act">'+act+view+'</span></div>';
        }
        if(section==='moderation'){
            return '<div class="adm-row'+on+'"'+open+'><b class="c-main">'+esc(actionText[row.action]||row.action)+'</b><span>'+esc(row.target)+'</span><span class="c-wide">'+esc(row.reason)+'</span><span>'+esc(row.actor_label)+'</span><span>'+date(row.created_at)+'</span><span class="c-act">'+view+'</span></div>';
        }
        const [label,tone]=states[stateOf(row)]||states.closed;
        const act='<button class="adm-act" type="button" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
        return '<div class="adm-row'+on+'"'+open+'><b class="c-main">#'+esc(String(row.id))+'</b><span>'+place(row.from_city,row.from_district)+'</span><span>→ '+place(row.to_city,row.to_district)+'</span><span>'+esc(row.vehicle||'—')+' <small>'+kindText(row.kind)+'</small></span><span>'+pill(label,tone)+'</span><span>'+date(row.expires_at)+'</span><span class="c-act">'+act+view+'</span></div>';
    }
    const heads={listings:['İlan','Çıkış','Varış','Araç · tür','Durum','Bitiş',''],overview:['İlan','Çıkış','Varış','Araç · tür','Durum','Bitiş',''],users:['Ad','Şehir','Tür','Kayıt','İlan','Durum',''],moderation:['İşlem','Hedef','Gerekçe','Yönetici','Tarih','']};
    function listCard(){
        const listTitle=section==='overview'?'Son ilanlar':titles[section];
        const searchForm=['users','listings'].includes(section)?'<form id="admin-search" class="adm-search" role="search"><label for="admin-term">'+(section==='users'?'Ada göre ara':'Güzergâh veya ilan sahibi ara')+'</label><input id="admin-term" maxlength="100" value="'+esc(search)+'" placeholder="'+(section==='users'?'Örn. Ahmet Yılmaz':'Örn. İzmir, Ankara')+'"><button class="adm-btn" type="submit">Ara</button></form>':'';
        const pager=section==='overview'?'<div class="adm-pager"><button class="adm-btn" type="button" data-admin-go="listings">Tüm ilanlar →</button></div>':
            '<div class="adm-pager"><button class="adm-btn" id="admin-prev" type="button" '+(offset===0?'disabled':'')+'>Önceki</button><span>Sayfa '+(offset/20+1)+'</span><button class="adm-btn" id="admin-next" type="button" '+(!more?'disabled':'')+'>Sonraki</button></div>';
        return '<section class="adm-card adm-list"><div class="adm-card-head"><h2>'+listTitle+'</h2><small>'+rows.length+(more?'+':'')+' kayıt gösteriliyor</small></div>'+searchForm+chips()+
            (rows.length?'<div class="adm-table"><div class="adm-thead" aria-hidden="true">'+heads[section].map(h=>'<span>'+h+'</span>').join('')+'</div>'+rows.map(rowHTML).join('')+'</div>':'<p class="adm-empty">Kayıt bulunamadı.</p>')+pager+'</section>';
    }
    function timeline(items){return '<ol class="adm-steps">'+items.map(([label,when,state])=>'<li class="'+state+'"><b>'+label+'</b><small>'+when+'</small></li>').join('')+'</ol>';}
    function detail(row,index){
        const back='<button class="adm-back" id="admin-back" type="button">‹ Listeye dön</button>';
        const grid=items=>'<div class="adm-grid">'+items.map(([k,v])=>'<div><span>'+k+'</span><b>'+v+'</b></div>').join('')+'</div>';
        if(section==='users'){
            const act=row.protected?'<p class="adm-note">Yönetici hesabı korumalıdır.</p>':'<button class="btn adm-detail-act" type="button" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>';
            const summary=row.protected?'Yönetici hesabı. Panelden askıya alınamaz.':row.suspended?'Faaliyetleri askıda: yeni ilan veremez. Hesabına giriş yapabilir.':'Hesap aktif. '+num(row.listings)+' ilanı var.';
            return back+'<div class="adm-d-head"><h3>'+esc(row.display_name||'İsimsiz hesap')+'</h3><p>'+esc(row.city||'Şehir yok')+' · '+typeText(row.account_type)+'</p></div><div class="adm-summary"><span>Durum özeti</span><p>'+summary+'</p></div>'+
                '<h4>Hesap bilgileri</h4>'+grid([['Kayıt',day(row.created_at)],['İlan sayısı',num(row.listings)],['Tür',typeText(row.account_type)],['Araç (ilanlarından)',Array.isArray(row.vehicles)&&row.vehicles.length?esc(row.vehicles.join(', ')):'—']])+(row.reason?'<h4>Son gerekçe</h4><p class="adm-reason">'+esc(row.reason)+'</p>':'')+'<div class="adm-d-act">'+act+'</div>';
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
            state==='removed'?['Yayından kaldırıldı',esc(row.reason||'Moderasyon'),'bad']:['Yayın süresi',state==='active'?'Bitiş '+date(row.expires_at):'Bitti '+date(end),state==='active'?'now':'done'],
            ['Kişisel bilgiler temizlenir',state==='removed'?'Kaldırmadan 1 yıl sonra':day(clean),state==='redacted'?'done':''],['Kayıt silinir',state==='removed'?'—':day(gone),'']];
        const act='<button class="btn adm-detail-act" type="button" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
        return back+'<div class="adm-d-head"><h3>İlan #'+esc(String(row.id))+' '+pill(label,tone)+'</h3><p>'+place(row.from_city,row.from_district)+' → '+place(row.to_city,row.to_district)+'</p></div>'+
            '<div class="adm-summary"><span>Durum özeti</span><p>'+summary+'</p></div><h4>İlan bilgileri</h4>'+
            grid([['Tür',kindText(row.kind)],['Araç',esc(row.vehicle||'—')],['Kasa',esc(row.body||'—')],['Sahibi',esc(row.owner_label||'—')],['Yükleme',esc(row.loading_text||'—')],['Yük',esc(row.cargo||'—')]])+
            '<h4>Zaman çizelgesi</h4>'+timeline(steps)+'<div class="adm-d-act">'+act+'</div>';
    }
    function statsCard(){
        const days=rows.slice().reverse().slice(-30),max=Math.max(1,...days.map(d=>Number(d.listings)||0)),w=1000,h=230,bw=w/Math.max(days.length,1);
        const bars=days.map((d,i)=>{const loads=Number(d.loads)||0,trucks=Number(d.trucks)||0,lh=loads/max*(h-30),th=trucks/max*(h-30),x=i*bw+bw*.18,bwid=bw*.64;
            return '<rect class="b-load" x="'+x.toFixed(1)+'" y="'+(h-20-lh).toFixed(1)+'" width="'+bwid.toFixed(1)+'" height="'+lh.toFixed(1)+'"><title>'+day(d.day)+': '+loads+' yük</title></rect>'+
                '<rect class="b-truck" x="'+x.toFixed(1)+'" y="'+(h-20-lh-th).toFixed(1)+'" width="'+bwid.toFixed(1)+'" height="'+th.toFixed(1)+'"><title>'+day(d.day)+': '+trucks+' boş araç</title></rect>'+
                ((days.length-1-i)%7===0?'<text x="'+(i===days.length-1?x+bwid:x+bwid/2).toFixed(1)+'" y="'+(h-4)+'" text-anchor="'+(i===days.length-1?'end':'middle')+'">'+esc(new Date(d.day).toLocaleDateString('tr-TR',{day:'numeric',month:'short'}))+'</text>':'');}).join('');
        const chart=days.length?'<svg class="adm-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Son 30 günde günlük ilan sayısı"><line x1="0" x2="'+w+'" y1="'+(h-20)+'" y2="'+(h-20)+'"/><text class="t-max" x="2" y="12">'+max+' ilan</text>'+bars+'</svg>'+
            '<p class="adm-legend"><i class="b-load"></i>Yük <i class="b-truck"></i>Boş araç</p>':'<p class="adm-empty">Kayıt bulunamadı.</p>';
        const table=rows.length?'<div class="adm-table adm-days"><div class="adm-thead" aria-hidden="true"><span>Gün</span><span>İlan</span><span>Yük</span><span>Boş araç</span><span>Yeni kayıt</span></div>'+
            rows.map(d=>'<div class="adm-row"><b class="c-main">'+day(d.day)+'</b><span>'+num(d.listings)+' ilan</span><span>'+num(d.loads)+' yük</span><span>'+num(d.trucks)+' araç</span><span>'+num(d.users)+' kayıt</span></div>').join('')+'</div>':'';
        return '<section class="adm-card"><div class="adm-card-head"><h2>Son 30 gün</h2><small>Günlük sayılar kalıcı tutulur; ilanlar temizlense de silinmez.</small></div>'+chart+'</section>'+
            '<section class="adm-card"><div class="adm-card-head"><h2>Günlük kayıt</h2><small>Son 90 gün</small></div>'+table+'</section>';
    }
    function render(){
        if(!valid())return;
        if(section==='stats'){frame(kpis()+'<div class="adm-main">'+statsCard()+'</div>',true);return;}
        // Ayrıntı yalnız gösterilecekse sayfaya girer: açıldığında ya da yan yana sığacak genişlikte.
        const row=rows[selected],wide=(body.clientWidth||0)>=1080;
        let side='';
        if(panel&&panel.mode==='confirm')side=panel.html;
        else if(row&&(panel||wide))side=detail(row,selected);
        const summary=section==='overview'?summaryCard():'',detailHTML=side?'<aside class="adm-detail'+(panel?' open':'')+'" aria-label="Kayıt ayrıntısı">'+side+'</aside>':'';
        frame(kpis()+'<div class="adm-main'+(side||summary?' has-detail':'')+'">'+listCard()+(summary?'<div class="adm-side">'+summary+detailHTML+'</div>':detailHTML)+'</div>',true);
    }
    async function load(){
        const ticket=++request;
        if(!stats)frame('<p role="status">Yönetici erişimi kontrol ediliyor…</p>');
        try{
            const overview=await nakgoAuth.adminPage('overview',0,'','');
            if(!valid()||ticket!==request)return;
            const listSection=section==='overview'?'listings':section;
            const list=await nakgoAuth.adminPage(listSection,section==='overview'?0:offset,section==='overview'?'':search,section==='overview'?'':filter);
            if(!valid()||ticket!==request)return;
            stats=overview&&typeof overview==='object'?overview:{};
            const all=Array.isArray(list)?list:[];
            rows=all.slice(0,section==='stats'?90:20);more=section!=='stats'&&all.length>20;
            if(selected>=rows.length)selected=0;
            panel=null;render();
        }catch(error){if(valid()&&ticket===request){stats=null;frame('<p role="alert">Yönetici paneli açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="admin-retry">Tekrar dene</button>');$('#admin-retry').onclick=load;}}
    }
    function confirmAction(row){
        if(!valid()||!row)return;
        ++request;
        const kind=section==='users'?'user':'listing',action=kind==='user'?(row.suspended?'resume':'suspend'):(row.removed?'restore':'remove');
        const label=({suspend:'Faaliyetleri askıya al',resume:'Askıyı kaldır',remove:'İlanı yayından kaldır',restore:'Kaldırma engelini aç'})[action];
        const explanation=({suspend:'Yeni ilan verme durdurulur. Hesaba giriş devam eder. Mevcut ilanlar otomatik kaldırılmaz.',resume:'Hesabın yeni işlem yapmasına yeniden izin verilir.',remove:'İlan yayından kalkar ve sahibi yeniden yayımlayamaz. Kayıt 1 yıl bekletilir.',restore:'İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.'})[action];
        const target=kind==='listing'?'<p id="admin-target">İlan #'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</p>':'';
        const show=html=>{panel={mode:'confirm',html};render();};
        show('<button class="adm-back" id="admin-back" type="button">‹ Vazgeç</button><div class="adm-d-head"><h3>'+label+'</h3><p>'+esc(row.display_name||row.owner_label||'')+'</p></div>'+target+'<div class="adm-summary"><span>Ne olur?</span><p>'+explanation+'</p></div><form id="admin-confirm" class="adm-form"><label for="admin-reason">İşlem gerekçesi (zorunlu)</label><textarea id="admin-reason" minlength="3" maxlength="500" required></textarea><p id="admin-action-error" role="alert"></p><button class="btn" id="admin-submit" type="submit">'+label+'</button><button class="chip" id="admin-cancel" type="button">Vazgeç</button></form>');
        $('#admin-cancel').onclick=()=>{panel=null;render();};
        let sending=false;
        $('#admin-confirm').onsubmit=async event=>{
            event.preventDefault();if(sending||!valid())return;
            const reason=$('#admin-reason').value.trim();if(reason.length<3){$('#admin-action-error').textContent='En az 3 karakterlik bir gerekçe yaz.';return;}
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

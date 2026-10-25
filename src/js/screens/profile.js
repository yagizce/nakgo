/**
 * Profil
 * Kimlik, günlük araçlar ve iletişim grupları; kayıt davranışı hesap özelliğinde kalır.
 */

// A signed-in account never falls back to another device user's demo fields.
function privateProfile() {
    const s=nakgoAuth.snapshot();
    return s.user ? (s.profile || {}) : null;
}
function profileIdentityHTML(own,active,done,name,rating) {
    const profile=privateProfile();
    return `<div class="profile-cover">
        <div class="avatar">${esc(name.replace(/&[^;]+;/g,'?')[0].toUpperCase())}</div>
        <div><span class="profile-eyebrow">NAKGO HESABIM</span>
            <b>${esc(profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim')}${profile ? vbadge(nakgoDocuments.isApproved(nakgoAuth.snapshot().user?.id)?2:0) : vbadge(appr[me||'local']===true?2:cOk(myCar)?1:0)}</b>
            <div class="profile-caption">${(profile ? profile.account_type : role)==='owner'?'Yük sahibi':(profile && !profile.account_type ? 'Hesabım' : 'Taşıyıcı')}${(profile ? profile.city : myCar.city)?' · '+esc(profile ? profile.city : myCar.city):''}</div>
            <div class="profile-caption">${rating?'★ '+rating.avg.toFixed(1)+' · '+rating.n+' değerlendirme':'Henüz değerlendirme yok'}</div>
        </div>
    </div>
    <div class="stat profile-stats">
        <div><b>${own}</b><span>Aktif ilanım</span></div>
        <div><b>${active}</b><span>Devam eden iş</span></div>
        <div><b>${done}</b><span>Onaylanan iş</span></div>
    </div>`;
}

function profileToolsHTML() {
    const saved=nakgoMarket.active()?nakgoFavorites.state():null;
    const favoriteCaption=saved?(saved.ready?saved.count+' kayıtlı ilan':saved.error?'Kayıtlar yüklenemedi':'Kayıtlar yükleniyor…'):favs.length+' kayıtlı ilan';
    const messageState=nakgoMarket.active()?nakgoMessages.state().unread:null;
    const messageCaption=messageState?(messageState.ready?(messageState.count?messageState.count+' okunmamış mesaj':'Görüşmelerin'):messageState.error||'Mesajlar yükleniyor…'):'Görüşmelerin';
    const tools=[
        ['messages','message','Mesajlar',messageCaption],
        ['favorites','heart','Kaydettiklerim',favoriteCaption],
        ['fuel','fuel','Mazot hesabı','Yol giderini planla']
    ];
    return `<div class="profile-shortcuts">
        <button class="profile-tool road-tool" id="profile-map">
            <span class="profile-tool-icon">${uiIcon('map')}</span>
            <span class="profile-tool-copy"><b>Yol haritası</b><small>Türkiye'nin yollarını keşfet</small></span>
            ${uiIcon('arrow')}
        </button>
        ${tools.map(([id,icon,title,caption])=>`<button class="profile-tool" id="profile-${id}">
            <span class="profile-tool-icon">${uiIcon(icon)}</span><b>${title}</b><small>${caption}</small>
        </button>`).join('')}
    </div>`;
}

function profileInfoHTML() {
    const profile=privateProfile(), info=profile ? {displayName:profile.display_name,city:profile.city,about:profile.about} : myCar;
    const s=nakgoAuth.snapshot(), disabled=s.user && (!s.profile || s.recovery) ? ' disabled' : '';
    return `<div class="load profile-info">
        <label for="profile-name">Görünen ad / firma</label>
        <input id="profile-name" maxlength="60" autocomplete="organization" placeholder="Adın veya firma adın" value="${esc(info.displayName||'')}">
        <label for="profile-city">Bulunduğun şehir</label>
        <select id="profile-city"><option value="">Şehir seç</option>${opt2(cities,info.city)}</select>
        <label for="profile-about">Kısa tanıtım</label>
        <textarea id="profile-about" maxlength="200" rows="2" placeholder="Çalıştığın güzergâhlar, taşıma deneyimin">${esc(info.about||'')}</textarea>
        <button class="chip on" id="profile-save"${disabled}>Profili kaydet</button>
    </div>${phoneCard()}`;
}

function renderProfile(main) {
    const own=[...mineL(),...mineT()].filter(item=>!item.closed&&!expired(item,typeof item.id==='string'?'truck':'load'));
    const jobs=[...offers,...incoming];
    const summary=nakgoMarket.active()?nakgoJobs.summary():null;
    const unknown=summary?.error?'—':'…';
    const done=summary?(summary.ready?summary.done:unknown):jobs.filter(job=>job.status==='ok'&&jobStage(job)===3).length;
    const active=summary?(summary.ready?summary.active:unknown):jobs.filter(job=>job.status==='ok'&&jobStage(job)!==3).length;
    const profile=privateProfile(), name=profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim',rating=profile ? null : ratingOf(me||'local');
    main.innerHTML=`${profileIdentityHTML(own.length,active,done,name,rating)}${profile && !nakgoMarket.active() ? '<p class="demo-note"><b>Test ortamı</b> · Profil ve iletişim hesabında saklanır. İlanlar, işler ve diğer işlemler cihazdaki demodur.</p>' : demoNotice()}${profileToolsHTML()}
        <div class="profile-grid">
            <section class="profile-group"><h2>Profil ve iletişim</h2>${profileInfoHTML()}</section>
            <section class="profile-group"><h2>İlanlarım</h2>${myListHTML()}${alertsCard()}
                <details class="profile-panel"><summary>Taşıyıcı belgeleri ve güven</summary>${carCard()}</details>
                ${rating?'<button class="chip" id="profile-ratings">Değerlendirmelerimi gör</button>':''}
            </section>
            <section class="profile-group"><h2>Üyelik ve destek</h2>${authCardHTML()}${premCard()}
                <details class="profile-panel"><summary>Güvenlik ve destek</summary>${adminCard()}${reportsCard()}${blockedCard()}${installCard()}${helpCard()}</details>
            </section>
        </div>`;
    if(summary)main.innerHTML+=(summary.error?'<p role="alert">'+esc(summary.error)+'</p>':'')+'<button class="chip" id="profile-jobs-retry" '+(summary.busy?'disabled':'')+'>İş sayaçlarını yenile</button>';
    if(summary)$('#profile-jobs-retry').onclick=()=>nakgoJobs.refreshSummary();
    if(summary&&!summary.ready&&!summary.busy&&!summary.error)nakgoJobs.refreshSummary();
    carBind();listBind();
    bindAuthCard();
    $('#profile-save').onclick=async()=>{
        const button=$('#profile-save'); if(button.disabled)return;
        const patch={displayName:$('#profile-name').value.trim().slice(0,60),city:$('#profile-city').value,about:$('#profile-about').value.trim().slice(0,200)};
        if(privateProfile()!==null) {
            button.disabled=true;
            try {await nakgoAuth.saveProfileDetails({display_name:patch.displayName,city:patch.city,about:patch.about});toast('Profilin hesabına kaydedildi');}
            catch(error){toast(nakgoAuth.message(error));button.disabled=false;}
        } else {
            if(!setCar(patch))return;
            toast('Profilin kaydedildi');
        }
    };
    $('#profile-messages').onclick=openInbox;
    $('#profile-fuel').onclick=()=>openCalc();
    $('#profile-favorites').onclick=()=>{F=F0();F.fav=true;q='';nearOn=false;tab='list';setNav();render();if(nakgoMarket.active())nakgoFavorites.refresh();};
    $('#profile-map').onclick=()=>openRoadMap();
    if($('#profile-ratings'))$('#profile-ratings').onclick=()=>openProfile({uid:me||'local',name:myCar.displayName||myName||'Profilim',lv:appr[me||'local']===true?2:cOk(myCar)?1:0});
}

/**
 * Profil
 * Kimlik, günlük araçlar ve iletişim grupları; kayıt davranışı hesap özelliğinde kalır.
 */

// A signed-in account never falls back to another device user's demo fields.
function privateProfile() {
    const s=nakgoAuth.snapshot();
    return s.user ? (s.profile || {}) : null;
}
function profileIdentityHTML(own,name) {
    const profile=privateProfile();
    return `<div class="profile-cover">
        <div class="avatar">${esc(name.replace(/&[^;]+;/g,'?')[0].toUpperCase())}</div>
        <div><span class="profile-eyebrow">NAKGO HESABIM</span>
            <b>${esc(profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim')}</b>
            <div class="profile-caption">${(profile ? profile.account_type : role)==='owner'?'Yük sahibi':(profile && !profile.account_type ? 'Hesabım' : 'Taşıyıcı')}${(profile ? profile.city : myCar.city)?' · '+esc(profile ? profile.city : myCar.city):''}</div>
        </div>
    </div>
    <div class="stat profile-stats">
        <div><b>${own}</b><span>Aktif ilanım</span></div>
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
        ['fuel','fuel','Mazot ve Gider Hesaplama','Yol giderini planla']
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
    const profile=privateProfile(), name=profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim';
    main.innerHTML=`${profileIdentityHTML(own.length,name)}${profile && !nakgoMarket.active() ? '<p class="demo-note"><b>Test ortamı</b> · Profil ve iletişim hesabında saklanır. İlanlar ve diğer işlemler cihazdaki demodur.</p>' : demoNotice()}${profileToolsHTML()}
        <div class="profile-grid">
            <section class="profile-group"><h2>Profil ve iletişim</h2>${profileInfoHTML()}</section>
            <section class="profile-group"><h2>İlanlarım</h2>${myListHTML()}${alertsCard()}
            </section>
            <section class="profile-group"><h2>Üyelik ve destek</h2>${authCardHTML()}${premCard()}${nakgoAdminAccess.isAdmin()?'<button class="chip" id="profile-admin">Yönetici paneli</button>':''}
                <details class="profile-panel"><summary>Güvenlik ve destek</summary>${reportsCard()}${blockedCard()}${installCard()}${helpCard()}</details>
            </section>
        </div>`;
    listBind();
    bindAuthCard();
    if(nakgoAuth.snapshot().profile)nakgoAdminAccess.ensure();
    if($('#profile-admin'))$('#profile-admin').onclick=openAdminPanel;
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
}

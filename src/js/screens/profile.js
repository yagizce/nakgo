/**
 * Profil
 * Kimlik, günlük araçlar ve iletişim grupları; kayıt davranışı hesap özelliğinde kalır.
 */

function profileIdentityHTML(own,active,done,name,rating) {
    return `<div class="profile-cover">
        <div class="avatar">${esc(name.replace(/&[^;]+;/g,'?')[0].toUpperCase())}</div>
        <div><span class="profile-eyebrow">NAKGO HESABIM</span>
            <b>${esc(myCar.displayName||myName||'Profilim')}${vbadge(appr[me||'local']===true?2:cOk(myCar)?1:0)}</b>
            <div class="profile-caption">${role==='owner'?'Yük sahibi':'Taşıyıcı'}${myCar.city?' · '+esc(myCar.city):''}</div>
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
    const tools=[
        ['messages','message','Mesajlar','Görüşmelerin'],
        ['favorites','heart','Kaydettiklerim',favs.length+' kayıtlı ilan'],
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
    return `<div class="load profile-info">
        <label for="profile-name">Görünen ad / firma</label>
        <input id="profile-name" maxlength="60" autocomplete="organization" placeholder="Adın veya firma adın" value="${esc(myCar.displayName||'')}">
        <label for="profile-city">Bulunduğun şehir</label>
        <select id="profile-city"><option value="">Şehir seç</option>${opt2(cities,myCar.city)}</select>
        <label for="profile-about">Kısa tanıtım</label>
        <textarea id="profile-about" maxlength="200" rows="2" placeholder="Çalıştığın güzergâhlar, taşıma deneyimin">${esc(myCar.about||'')}</textarea>
        <button class="chip on" id="profile-save">Profili kaydet</button>
    </div>${phoneCard()}`;
}

function renderProfile(main) {
    const own=[...mineL(),...mineT()].filter(item=>!item.closed&&!expired(item,typeof item.id==='string'?'truck':'load'));
    const jobs=[...offers,...incoming];
    const done=jobs.filter(job=>job.status==='ok'&&jobStage(job)===3).length;
    const active=jobs.filter(job=>job.status==='ok'&&jobStage(job)!==3).length;
    const name=myCar.displayName||myName||'Profilim',rating=ratingOf(me||'local');
    main.innerHTML=`${profileIdentityHTML(own.length,active,done,name,rating)}${demoNotice()}${profileToolsHTML()}
        <div class="profile-grid">
            <section class="profile-group"><h2>Profil ve iletişim</h2>${profileInfoHTML()}</section>
            <section class="profile-group"><h2>İlanlarım</h2>${myListHTML()}${alertsCard()}
                <details class="profile-panel"><summary>Taşıyıcı belgeleri ve güven</summary>${carCard()}</details>
                ${rating?'<button class="chip" id="profile-ratings">Değerlendirmelerimi gör</button>':''}
            </section>
            <section class="profile-group"><h2>Üyelik ve destek</h2>${premCard()}
                <details class="profile-panel"><summary>Güvenlik ve destek</summary>${adminCard()}${reportsCard()}${blockedCard()}${installCard()}${helpCard()}</details>
            </section>
        </div>`;
    carBind();listBind();
    $('#profile-save').onclick=()=>{
        if (!setCar({displayName:$('#profile-name').value.trim().slice(0,60),city:$('#profile-city').value,about:$('#profile-about').value.trim().slice(0,200)})) return;
        toast('Profilin kaydedildi');
    };
    $('#profile-messages').onclick=openInbox;
    $('#profile-fuel').onclick=()=>openCalc();
    $('#profile-favorites').onclick=()=>{F=F0();F.fav=true;q='';nearOn=false;tab='list';setNav();render();};
    $('#profile-map').onclick=()=>openRoadMap();
    if($('#profile-ratings'))$('#profile-ratings').onclick=()=>openProfile({uid:me||'local',name:myCar.displayName||myName||'Profilim',lv:appr[me||'local']===true?2:cOk(myCar)?1:0});
}

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
    // Girişsiz ziyaretçi hesaplar açıkken cihazdaki demo profili görmez.
    if(nakgoMarket.guest())return `<div class="profile-cover">
        <div class="avatar">M</div>
        <div><span class="profile-eyebrow">NAKGO HESABIM</span><b>Misafir</b><div class="profile-caption">Giriş yapılmadı</div></div>
    </div>`;
    return `<div class="profile-cover">
        <div class="avatar">${esc(name.replace(/&[^;]+;/g,'?')[0].toUpperCase())}</div>
        <div><span class="profile-eyebrow">NAKGO HESABIM</span>
            <b>${esc(profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim')}</b>
            <div class="profile-caption">${(profile ? profile.account_type : role)==='owner'?'Yük sahibi':(profile && !profile.account_type ? 'Hesabım' : 'Taşıyıcı')}${(profile ? profile.city : myCar.city)?' · '+esc(profile ? profile.city : myCar.city):''}</div>
        </div>
    </div>
    <button class="stat profile-stats profile-own-link" id="profile-own" type="button" aria-label="${own} aktif ilan, İlanlarım sekmesini aç">
        <div><b>${own}</b><span>Aktif ilanım · İlanlarım'da yönet</span></div>
    </button>`;
}

function profileToolsHTML() {
    // Uygulama içi mesajlaşma kapalı: iletişim ilan detayındaki Ara ve WhatsApp ile yapılır.
    // Yol haritası ve mazot kartları aynı yapıda: ikon, tek satır başlık, kısa açıklama, ok.
    return `<div class="profile-shortcuts">
        <button class="profile-tool road-tool" id="profile-map">
            <span class="profile-tool-icon">${uiIcon('map')}</span>
            <span class="profile-tool-copy"><b>Yol haritası</b><small>Türkiye'nin yollarını keşfet</small></span>
            ${uiIcon('arrow')}
        </button>
        <button class="profile-tool road-tool fuel-tool" id="profile-fuel">
            <span class="profile-tool-icon">${uiIcon('fuel')}</span>
            <span class="profile-tool-copy"><b>Mazot ve gider hesaplama</b><small>Sefer giderini önceden hesapla</small></span>
            ${uiIcon('arrow')}
        </button>
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
    const profile=privateProfile(), name=profile ? profile.display_name||'Profilim' : myCar.displayName||myName||'Profilim', guest=nakgoMarket.guest();
    const ownSections=guest
        ? '<section class="profile-group"><h2>Profil</h2><div class="empty">Profil oluşturmak ve iletişim bilgilerini eklemek için ücretsiz kayıt ol veya giriş yap.<br><button class="chip u-mt12" id="profile-signin">Kayıt ol / Giriş yap</button></div></section>'
        : `<section class="profile-group"><h2>Profil ve iletişim</h2>${profileInfoHTML()}</section>
`;
    main.innerHTML=`${profileIdentityHTML(own.length,name)}${profile && !nakgoMarket.active() ? '<p class="demo-note"><b>Test ortamı</b> · Profil ve iletişim hesabında saklanır. İlanlar ve diğer işlemler cihazdaki demodur.</p>' : guest ? '' : demoNotice()}${profileToolsHTML()}
        <div class="profile-grid">
            ${ownSections}
            <section class="profile-group"><h2>Üyelik ve destek</h2>${authCardHTML()}${guest?'':premCard()}
                <details class="profile-panel"><summary>Güvenlik ve destek</summary>${reportsCard()}${blockedCard()}${installCard()}${helpCard()}</details>
            </section>
        </div>`;
    listBind();
    bindAuthCard();
    if(guest){$('#profile-signin').onclick=()=>nakgoMarket.requireAccount();}
    else $('#profile-save').onclick=async()=>{
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
    $('#profile-fuel').onclick=()=>openCalc();
    if($('#profile-own'))$('#profile-own').onclick=()=>{tab='own';setNav();render();$('#main').scrollTop=0;};
    $('#profile-map').onclick=()=>openRoadMap();
}

// Kaydedilen ilan sayısı; hesapta okuma başarılı olmadan sıfır gösterilmez.
function favoriteCaption() {
    const saved=nakgoMarket.active()?nakgoFavorites.state():null;
    return saved?(saved.ready?saved.count+' kayıtlı ilan':saved.error?'Kayıtlar yüklenemedi':'Kayıtlar yükleniyor…'):favs.length+' kayıtlı ilan';
}

// İlanlarım açıkken kalan süre ve süresi dolan ilanlar dakikada bir güncellenir (pencere açıksa beklenir).
let ownTimer=0;
function scheduleOwnRefresh(){
    if(typeof setTimeout!=='function')return;
    clearTimeout(ownTimer);
    ownTimer=setTimeout(()=>{
        if(tab!=='own')return;
        if((typeof document!=='undefined'&&document.hidden)||$('#sheet')?.classList?.contains('open'))return scheduleOwnRefresh();
        render();
    },60000);
    ownTimer?.unref?.();
}

// İlanlarım sekmesi: kendi ilanları, rota alarmları ve kaydedilen ilanlar. Hesap ve destek Profil'de kalır.
function renderMine(main) {
    if(nakgoMarket.guest()){
        main.innerHTML='<section class="profile-group"><h2>İlanlarım</h2><div class="empty">İlan vermek, rota alarmı kurmak ve ilan kaydetmek için ücretsiz kayıt ol veya giriş yap.<br><button class="chip" id="mine-signin">Kayıt ol veya giriş yap</button></div></section>';
        $('#mine-signin').onclick=()=>nakgoMarket.requireAccount();
        return;
    }
    const all=[...mineL().map(x=>[x,'load']),...mineT().map(x=>[x,'truck'])];
    const open=all.filter(([x,k])=>!x.closed&&!expired(x,k)).length;
    const alertCount=nakgoMarket.active()?nakgoAlerts.list().filter(a=>a.active).length:alerts.length;
    main.innerHTML=`<div class="stat profile-stats mine-stats">
            <div><b>${open}</b><span>Yayında</span></div>
            <div><b>${all.length-open}</b><span>Kapanan</span></div>
            <div><b>${alertCount}</b><span>Rota alarmı</span></div>
        </div>
        <div class="profile-shortcuts">
            <button class="profile-tool wide-tool" id="mine-favorites"><span class="profile-tool-icon">${uiIcon('heart')}</span>
                <span class="profile-tool-copy"><b>Kaydettiklerim</b><small>${favoriteCaption()}</small></span>${uiIcon('arrow')}</button>
        </div>
        <div class="profile-grid">
            <section class="profile-group">${myListHTML()}</section>
            <section class="profile-group">${alertsCard()}</section>
        </div>`;
    listBind();
    scheduleOwnRefresh();
    $('#mine-favorites').onclick=()=>{F=F0();F.fav=true;q='';nearOn=false;tab='list';setNav();render();if(nakgoMarket.active())nakgoFavorites.refresh();};
}

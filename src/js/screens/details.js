/**
 * İlan detayları
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function syncDetailViewport() {
    roadMapDispose();
    if (typeof window === "undefined" || !window || !window.visualViewport)
        return;
    const v = window.visualViewport, sheet = $("#sheet");
    sheet.style.setProperty("--detail-height", Math.floor(v.height * .92) + "px");
    sheet.style.setProperty("--keyboard-inset", Math.max(0, window.innerHeight - v.height - v.offsetTop) + "px");
    const app = $("#app");
    app.dataset.keyboard = window.innerHeight - v.height - v.offsetTop > 120 ? "true" : "false";
}

function openLoad(id) {
    roadMapDispose(true);
    const l = findIt("l",id);
    if (!l || !availableListing(l))
        return toast("İlan bulunamadı");
    track("v", id);
    const km = listingDistance(l);
    const unavailable = !availableListing(l);
    const kv = rows => rows.map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("");
    $("#sheetBody").innerHTML = `<div class="load-detail" data-listing-expiry="${listingExpiry(l)}">
      <div class="detail-top"><span>Yük ilanı <span class="detail-id">#${esc(l.id)}</span></span><button class="chip detail-close" id="close" aria-label="İlan detayını kapat">Kapat <span aria-hidden="true">×</span></button></div>
      <div class="detail-scroll" tabindex="0" aria-label="İlan bilgileri">
        <section class="detail-summary">${routeTitle(l)}<div class="summary-tags"><span class="tag">Yükleme: ${esc(dateLabel(l))}</span>${isF(l) ? `<span class="tag ft">Öne çıkan${isDemoFeature(l) ? ' · Örnek' : ''}</span>` : ""}</div></section>
        ${!cloud && !nakgoMarket.active() ? '<p class="demo-note"><b>Demo modu</b> · Bu ekrandaki örnek ilanlar ve talepler deneme amaçlıdır.</p>' : ""}
        ${imgOk(l.img) ? `<img class="ph" src="${l.img}" alt="Yük fotoğrafı">` : ""}
        <section class="detail-group"><h2>Yük bilgileri</h2>${kv([["Yük türü", esc(l.cargo)], ["Tonaj", esc(l.ton) + " ton"], ...(Array.isArray(l.items) && l.items.length ? [["Kalemler", itemsTxt(l)]] : []), ["Yükleme tarihi", esc(dateLabel(l))]])}${l.note ? `<p class="detail-note">${esc(l.note)}</p>` : ""}</section>
        <section class="detail-group"><h2>Taşıma bilgileri</h2>${kv([["Araç / kasa", esc(l.veh + " · " + (l.body || "Belirtilmedi"))], ["Tahmini mesafe", km ? "≈ " + km + " km" : "Belirtilmedi"]])}<p class="estimate-note">Taşıma koşullarını yük sahibiyle telefon veya WhatsApp üzerinden görüşebilirsin.</p></section>
        <section class="detail-group detail-route"><h2>Güzergâh</h2>${routeMapHTML(l.from, l.to)}</section>
        <div class="detail-actions">${l._remote&&!l.mine&&!unavailable?'<button class="chip" id="request-job">Taşıma talebi gönder</button>':""}<button class="chip" id="sh">Paylaş</button><button class="chip" id="rp">Şikayet et</button>${l.uid && l.uid !== me && !l.mine ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div>
      </div>
      ${contactDockHTML(unavailable,l.mine)}
    </div>`;
    $("#sheetBody").scrollTop = 0;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    roadMapBind($("#sheetBody"),()=>openLoad(id));
    $("#close").onclick = closeSheet;
    $("#sh").onclick = () => shareLoad(l);
    if(l._remote&&!l.mine&&!unavailable) {
        const button=$('#request-job');button.onclick=async()=>{
            if(button.disabled)return;button.disabled=true;const account=nakgoMarket.token();
            try {const row=await nakgoJobs.request(l.remoteId);if(!row){button.disabled=false;return;}if($('#request-job')===button){closeSheet();tab='mine';setNav();render();}toast('Taşıma talebin İşlerim bölümüne kaydedildi');}
            catch(e){if(account===nakgoMarket.token()){button.disabled=false;toast('Talep gönderilemedi. İlanları yenileyip tekrar dene.');}}
        };
    }
    bindListingContact(l,false);
    $("#rp").onclick = () => openReport("l", l.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(l.uid);

}

function openTruck(id) {
    roadMapDispose(true);
    const t = findIt("t",id);
    if (!t || !availableListing(t,true)) return toast("İlan bulunamadı");
    const unavailable = !availableListing(t,true);
    $("#sheetBody").innerHTML = `<div class="load-detail" data-listing-expiry="${listingExpiry(t)}"><div class="detail-top"><span>Boş araç ilanı</span><button class="chip detail-close" id="close">Kapat ×</button></div><div class="detail-scroll"><section class="detail-summary">${routeTitle(t)}<div class="summary-tags" style="margin-top:14px"><span class="tag">${esc(t.cap)} ton boş kapasite</span><span class="tag">${esc(dateLabel(t))}</span></div></section>${demoNotice()}<section class="detail-group"><h2>Araç ve taşıyıcı</h2><div style="margin-top:10px">${[["Kalan süre", esc(listingRemaining(t))], ["Araç", esc(t.veh + " · " + t.body)], ["Boş kapasite", esc(t.cap) + " ton"], ["Müsait", esc(dateLabel(t))]].map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("")}</div>${t.note ? `<p class="detail-note">${esc(t.note)}</p>` : ""}</section><section class="detail-group detail-route"><h2>Güzergâh</h2>${routeMapHTML(t.from,t.to)}</section><div class="chips" style="margin-top:14px"><button class="chip" id="rp">Şikayet et</button>${t.uid && t.uid !== me && !t.mine ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div></div>${contactDockHTML(unavailable,t.mine)}</div>`;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    roadMapBind($("#sheetBody"),()=>openTruck(id));
    $("#close").onclick = closeSheet;
    bindListingContact(t,true);
    $("#rp").onclick = () => openReport("t", t.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(t.uid);
}

function contactDockHTML(unavailable=false){return `<div class="contact-dock dual-contact"><button class="btn" id="call" ${unavailable?'disabled':''}>Ara</button><button class="btn alt" id="wa" ${unavailable?'disabled':''}>${uiIcon('whatsapp')} WhatsApp</button></div>`;}
async function contactListing(item,isTruck,channel){
        if(!availableListing(item,isTruck))return toast('İlanın süresi doldu');
        const account=nakgoMarket.token();
        try {
            const phone=item._remote?await nakgoAuth.listingContact(item.remoteId):phoneOf(item);
            if(item._remote&&account!==nakgoMarket.token())return;
            if(!availableListing(item,isTruck))return toast('İlanın süresi doldu');
            const n=normalizeListingPhone(phone);if(!n)return toast('İletişim numarası kullanılamıyor');
            window.location.href=channel==='call'?'tel:'+n:'https://wa.me/'+n.slice(1);
        }catch(e){toast('İlan veya iletişim izni artık geçerli değil');}
}
function bindListingContact(item,isTruck){
    $('#call').onclick=()=>contactListing(item,isTruck,'call');$('#wa').onclick=()=>contactListing(item,isTruck,'whatsapp');
}

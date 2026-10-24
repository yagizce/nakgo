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
    const l = loads.find(x => x.id === id);
    if (!l)
        return toast("İlan bulunamadı");
    track("v", id);
    const km = listingDistance(l);
    const unavailable = !availableListing(l);
    const kv = rows => rows.map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("");
    $("#sheetBody").innerHTML = `<div class="load-detail">
      <div class="detail-top"><span>Yük ilanı <span class="detail-id">#${esc(l.id)}</span></span><button class="chip detail-close" id="close" aria-label="İlan detayını kapat">Kapat <span aria-hidden="true">×</span></button></div>
      <div class="detail-scroll" tabindex="0" aria-label="İlan bilgileri">
        <section class="detail-summary">${routeTitle(l)}<div class="summary-tags"><span class="tag">Yükleme: ${esc(dateLabel(l))}</span>${isF(l) ? `<span class="tag ft">Öne çıkan${isDemoFeature(l) ? ' · Örnek' : ''}</span>` : ""}</div></section>
        ${!cloud && !nakgoMarket.active() ? '<p class="demo-note"><b>Demo modu</b> · Bu ekrandaki örnek ilanlar ve talepler deneme amaçlıdır.</p>' : ""}
        ${imgOk(l.img) ? `<img class="ph" src="${l.img}" alt="Yük fotoğrafı">` : ""}
        <section class="detail-group"><h2>Yük bilgileri</h2>${kv([["Yük türü", esc(l.cargo)], ["Tonaj", esc(l.ton) + " ton"], ...(Array.isArray(l.items) && l.items.length ? [["Kalemler", itemsTxt(l)]] : []), ["Yükleme tarihi", esc(dateLabel(l))]])}${l.note ? `<p class="detail-note">${esc(l.note)}</p>` : ""}</section>
        <section class="detail-group"><h2>Taşıma bilgileri</h2>${kv([["Araç / kasa", esc(l.veh + " · " + (l.body || "Belirtilmedi"))], ["Tahmini mesafe", km ? "≈ " + km + " km" : "Belirtilmedi"]])}<p class="estimate-note">Taşıma koşullarını yük sahibiyle telefon veya mesaj üzerinden görüşebilirsin.</p></section>
        <section class="detail-group detail-route"><h2>Güzergâh</h2>${routeMapHTML(l.from, l.to)}</section>
        <section class="detail-group"><h2>Yük sahibi</h2><div class="owner-summary"><span class="owner-avatar" aria-hidden="true">${esc(String(l.owner || (l.uid ? nm(l.uid) : "Yük sahibi")).charAt(0))}</span><div><b>${esc(l.owner || (l.uid ? nm(l.uid) : "Bireysel"))}</b><p>${starTxt(l)} ${vbadge(l.uid ? lvU(l.uid) : 0)}</p></div></div><div class="detail-actions"><button class="chip" id="pf">Profili gör</button></div></section>
        <div class="detail-actions"><button class="chip" id="sh">Paylaş</button><button class="chip" id="cp2">${cmp.includes(l.id) ? "Karşılaştırmadan çıkar" : "Karşılaştır"}</button><button class="chip" id="rp">Şikayet et</button>${l.uid && l.uid !== me ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div>
      </div>
      ${contactDockHTML(unavailable)}
    </div>`;
    $("#sheetBody").scrollTop = 0;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    roadMapBind($("#sheetBody"),()=>openLoad(id));
    $("#close").onclick = closeSheet;
    $("#sh").onclick = () => shareLoad(l);
    $("#call").onclick = () => {
        if (!contactAllowed(l,false,true)) return;
        track("c", l.id);
        callTo(phoneOf(l));
    };
    $("#cp2").onclick = () => toggleCmp(l.id);
    $("#pf").onclick = () => openProfile({ uid: l.uid, name: l.owner || (l.uid ? nm(l.uid) : "Yük sahibi"), lv: l.uid ? lvU(l.uid) : 0, rate: l.rate });
    $("#rp").onclick = () => openReport("l", l.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(l.uid);
    $("#mg").onclick = () => {
        if (!contactAllowed(l)) return;
        openChat("o" + l.id + "_" + me, l.owner || (l.uid ? nm(l.uid) : "Yük sahibi"), () => offers.some(o=>o.id===l.id&&o.status!=="no"&&!offerExp(o)) || requestLoad(l), () => contactAllowed(l));
    };
}

function openTruck(id) {
    roadMapDispose(true);
    const t = trucks.find(x => x.id === id);
    if (!t) return toast("İlan bulunamadı");
    const unavailable = !availableListing(t,true);
    $("#sheetBody").innerHTML = `<div class="load-detail"><div class="detail-top"><span>Boş araç ilanı</span><button class="chip detail-close" id="close">Kapat ×</button></div><div class="detail-scroll"><section class="detail-summary">${routeTitle(t)}<div class="summary-tags" style="margin-top:14px"><span class="tag">${esc(t.cap)} ton boş kapasite</span><span class="tag">${esc(dateLabel(t))}</span></div></section>${demoNotice()}<section class="detail-group"><h2>Araç ve taşıyıcı</h2><div style="margin-top:10px">${[["Taşıyıcı", esc(t.who || nm(t.uid)) + (lvT(t) === 2 ? " ✓ Onaylı" : vok(t) ? " ✓ Belgeli" : "") + " · " + starTxt(t)], ["Araç", esc(t.veh + " · " + t.body)], ["Boş kapasite", esc(t.cap) + " ton"], ["Müsait", esc(dateLabel(t))]].map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("")}</div></section><section class="detail-group detail-route"><h2>Güzergâh</h2>${routeMapHTML(t.from,t.to)}</section><div class="chips" style="margin-top:14px"><button class="chip" id="pf">Profili gör</button><button class="chip" id="rp">Şikayet et</button>${t.uid && t.uid !== me ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div></div>${contactDockHTML(unavailable)}</div>`;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    roadMapBind($("#sheetBody"),()=>openTruck(id));
    $("#close").onclick = closeSheet;
    $("#mg").onclick = () => { if(contactAllowed(t,true)) openChat("t" + id, t.who || nm(t.uid),null,()=>contactAllowed(t,true)); };
    $("#call").onclick = () => { if(contactAllowed(t,true,true)) callTo(phoneOf(t)); };
    $("#pf").onclick = () => openProfile({ uid: t.uid, name: t.who || nm(t.uid), lv: lvT(t), rate: t.rate });
    $("#rp").onclick = () => openReport("t", t.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(t.uid);
}

function contactDockHTML(unavailable=false) {
    if(nakgoMarket.active())return '<div class="contact-dock dual-contact"><p class="contact-unavailable">Telefon ve mesajlaşma bağlantısı hazırlanıyor.</p><button class="btn" id="call" disabled>Ara</button><button class="btn alt" id="mg" disabled>Mesaj gönder</button></div>';
    const badge=isPrem()?"":'<b class="pm">Premium</b>';
    return `<div class="contact-dock dual-contact">${unavailable?'<p class="contact-unavailable" role="status">Bu ilan kapalı veya süresi dolmuş. Yeni görüşme başlatılamaz.</p>':""}<button class="btn contact-call" id="call" ${unavailable?"disabled":""}><span>${uiIcon("phone")} Ara</span>${badge}</button><button class="btn alt" id="mg" ${unavailable?"disabled":""}><span>${uiIcon("message")} Mesaj gönder</span>${badge}</button></div>`;
}

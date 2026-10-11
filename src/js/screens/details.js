/**
 * İlan detayları
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function syncDetailViewport() {
    if (typeof window === "undefined" || !window || !window.visualViewport)
        return;
    const v = window.visualViewport, sheet = $("#sheet");
    sheet.style.setProperty("--detail-height", Math.floor(v.height * .92) + "px");
    sheet.style.setProperty("--keyboard-inset", Math.max(0, window.innerHeight - v.height - v.offsetTop) + "px");
    const app = $("#app");
    app.dataset.keyboard = window.innerHeight - v.height - v.offsetTop > 120 ? "true" : "false";
}

function openLoad(id) {
    const l = loads.find(x => x.id === id);
    if (!l)
        return toast("İlan bulunamadı");
    track("v", id);
    const km = l.km || dist(l.from, l.to);
    const kv = rows => rows.map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("");
    $("#sheetBody").innerHTML = `<div class="load-detail">
      <div class="detail-top"><span>Yük ilanı <span class="detail-id">#${l.id}</span></span><button class="chip detail-close" id="close" aria-label="İlan detayını kapat">Kapat <span aria-hidden="true">×</span></button></div>
      <div class="detail-scroll" tabindex="0" aria-label="İlan bilgileri">
        <section class="detail-summary">${routeTitle(l)}<div class="summary-tags"><span class="tag">Yükleme: ${l.date}</span>${isF(l) ? '<span class="tag ft">Öne çıkan</span>' : ""}</div></section>
        ${!cloud ? '<p class="demo-note"><b>Demo modu</b> · Bu ekrandaki örnek ilanlar ve talepler deneme amaçlıdır.</p>' : ""}
        ${imgOk(l.img) ? `<img class="ph" src="${l.img}" alt="Yük fotoğrafı">` : ""}
        <section class="detail-group"><h2>Yük bilgileri</h2>${kv([["Yük türü", l.cargo], ["Tonaj", l.ton + " ton"], ...(Array.isArray(l.items) && l.items.length ? [["Kalemler", itemsTxt(l)]] : []), ["Yükleme tarihi", l.date]])}${l.note ? `<p class="detail-note">${l.note}</p>` : ""}</section>
        <section class="detail-group"><h2>Taşıma bilgileri</h2>${kv([["Araç / kasa", l.veh + " · " + (l.body || "Belirtilmedi")], ["Tahmini mesafe", km ? "≈ " + km + " km" : "Belirtilmedi"]])}<p class="estimate-note">Taşıma koşullarını yük sahibiyle telefon veya mesaj üzerinden görüşebilirsin.</p><button class="fuel-shortcut" id="cc"><span aria-hidden="true">${FUEL_ICON}</span><span><b>Mazot hesabı</b><small>Bu güzergâhın tahmini gideri</small></span><span aria-hidden="true">→</span></button></section>
        <section class="detail-group detail-route"><h2>Güzergâh</h2>${mapSVG(l.from, l.to)}</section>
        <section class="detail-group"><h2>Yük sahibi</h2><div class="owner-summary"><span class="owner-avatar" aria-hidden="true">${esc(String(l.owner || (l.uid ? nm(l.uid) : "Yük sahibi")).charAt(0))}</span><div><b>${l.owner || (l.uid ? nm(l.uid) : "Bireysel")}</b><p>${starTxt(l)} ${vbadge(l.uid ? lvU(l.uid) : 0)}</p></div></div><div class="detail-actions"><button class="chip" id="pf">Profili gör</button><button class="chip" id="send">Taşıma talebi gönder</button></div></section>
        <div class="detail-actions"><button class="chip" id="sh">Paylaş</button><button class="chip" id="cp2">${cmp.includes(l.id) ? "Karşılaştırmadan çıkar" : "Karşılaştır"}</button><button class="chip" id="rp">Şikayet et</button>${l.uid && l.uid !== me ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div>
      </div>
      <div class="contact-dock dual-contact"><button class="btn alt" id="call">Ara${isPrem() ? "" : '<b class="pm">Premium</b>'}</button><button class="btn" id="mg">Mesaj gönder →</button></div>
    </div>`;
    $("#sheetBody").scrollTop = 0;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
    $("#sh").onclick = () => shareLoad(l);
    $("#call").onclick = () => {
        track("c", l.id);
        callTo(phoneOf(l));
    };
    $("#cp2").onclick = () => toggleCmp(l.id);
    $("#pf").onclick = () => openProfile({ uid: l.uid, name: l.owner || (l.uid ? nm(l.uid) : "Yük sahibi"), lv: l.uid ? lvU(l.uid) : 0, rate: l.rate });
    $("#rp").onclick = () => openReport("l", l.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(l.uid);
    $("#cc").onclick = () => { calc = { ...calc, km: km || calc.km, cons: CONS[l.veh] || calc.cons }; openCalc(); };
    $("#mg").onclick = () => {
        if (cloud && l.uid === me) return toast("Kendi ilanına mesaj gönderemezsin");
        openChat("o" + l.id + "_" + me, l.owner || (l.uid ? nm(l.uid) : "Yük sahibi"), () => requestLoad(l));
    };
    $("#send").onclick = () => { if(requestLoad(l)){ closeSheet(); toast("Taşıma talebi gönderildi"); } };
}

function openTruck(id) {
    const t = trucks.find(x => x.id === id);
    if (!t) return toast("İlan bulunamadı");
    $("#sheetBody").innerHTML = `<div class="load-detail"><div class="detail-top"><span>Boş araç ilanı</span><button class="chip detail-close" id="close">Kapat ×</button></div><div class="detail-scroll"><section class="detail-summary">${routeTitle(t)}<div class="summary-tags" style="margin-top:14px"><span class="tag">${t.cap} ton boş kapasite</span><span class="tag">${t.date}</span></div></section>${demoNotice()}<section class="detail-group"><h2>Araç ve taşıyıcı</h2>${mapSVG(t.from, t.to)}<div style="margin-top:10px">${[["Taşıyıcı", (t.who || nm(t.uid)) + (lvT(t) === 2 ? " ✓ Onaylı" : vok(t) ? " ✓ Belgeli" : "") + " · " + starTxt(t)], ["Araç", t.veh + " · " + t.body], ["Boş kapasite", t.cap + " ton"], ["Müsait", t.date]].map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join("")}</div></section><button class="btn alt" id="call">Taşıyıcıyı ara${isPrem() ? "" : '<b class="pm">Premium</b>'}</button><div class="chips" style="margin-top:14px"><button class="chip" id="pf">Profili gör</button><button class="chip" id="rp">Şikayet et</button>${t.uid && t.uid !== me ? '<button class="chip" id="bk2">Engelle</button>' : ""}</div></div><div class="contact-dock"><button class="btn" id="mg">Mesaj gönder →</button></div></div>`;
    syncDetailViewport();
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
    $("#mg").onclick = () => openChat("t" + id, t.who || nm(t.uid));
    $("#call").onclick = () => callTo(phoneOf(t));
    $("#pf").onclick = () => openProfile({ uid: t.uid, name: t.who || nm(t.uid), lv: lvT(t), rate: t.rate });
    $("#rp").onclick = () => openReport("t", t.id);
    if ($("#bk2"))
        $("#bk2").onclick = () => blockUser(t.uid);
}

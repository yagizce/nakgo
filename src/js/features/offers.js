/**
 * Bildirimler ve mesajlaşma
 * Uygulama içi bildirimler, rota alarmı ve sohbet.
 */
// ===== Bildirim ve alarm =====
// Uygulama içi bildirimler, zil, rota alarmı.

const alertRoute = a => (a.from_city || "Her yer") + " → " + (a.to_city || "Her yer");
function notifs() {
    if (nakgoMarket.active())
        return nakgoAlerts.matches().map(m => ({ k: "r" + m.alert.id + "_" + m.listing.remoteId, fresh: m.fresh, t: "Alarm: " + alertRoute(m.alert) + (m.alert.kind === "truck" ? " yeni boş araç" : " yeni yük"), s: m.listing.from + " → " + m.listing.to + " · " + (m.alert.kind === "truck" ? m.listing.veh + " · " + m.listing.cap + " ton boş" : (m.listing.cargo || "Yük") + " · " + m.listing.ton + " ton"), tab: "list", mode: m.alert.kind }));
    const a = [];
    alerts.forEach(al => loads.filter(l => availableListing(l) && (!al.from || l.from === al.from) && (!al.to || l.to === al.to) && (!al.veh || l.veh === al.veh) && !(l.uid && l.uid === me)).forEach(l => a.push({ k: "a" + al.id + "_" + l.id, t: "Alarm: " + (al.from || "Her yer") + " → " + (al.to || "Her yer") + " yeni yük", s: l.cargo + " · " + l.ton + " ton", tab: "list" })));
    return a;
}

function bell() {
    const b = $("#bc");
    if (!b)
        return;
    const n = notifs().filter(x => nakgoMarket.active() ? x.fresh : !seen.has(x.k)).length;
    b.textContent = n > 9 ? "9+" : n;
    b.style.display = n ? "grid" : "none";
}

function openBell() {
    const a = notifs(), B = $("#sheetBody"), market = nakgoMarket.active();
    const isNew = x => market ? x.fresh : !seen.has(x.k);
    B.dataset.k = "";
    B.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">Bildirimler</b><button class="chip" id="close">Kapat</button></div>` + (a.length ? a.map(x => `<button class="nt ${isNew(x) ? "new" : ""}" data-nt="${x.tab || "list"}" data-nm="${x.mode === "truck" ? "truck" : "load"}"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></button>`).join("") : `<div class="empty">Henüz bildirim yok.<br>Rota alarmına uyan yeni ilanlar burada görünür.</div>`);
    if (market)
        nakgoAlerts.markSeen();
    else {
        seen = new Set([...seen, ...a.map(x => x.k)]);
        try {
            localStorage.setItem("yy-seen", JSON.stringify([...seen]));
        }
        catch (e) { }
    }
    B.querySelectorAll("[data-nt]").forEach(b => b.onclick = () => {
        closeSheet();
        tab = b.dataset.nt || "list";
        mode = b.dataset.nm === "truck" ? "truck" : "load";
        setNav();
        render();
    });
    $("#close").onclick = () => {
        closeSheet();
        render();
    };
    $("#sheet").classList.add("open");
    bell();
}

function addAlert() {
    if (nakgoMarket.guest()) return nakgoMarket.requireAccount();
    if (nakgoMarket.active()) return openAlertForm({ kind: mode === "truck" ? "truck" : "load", from: F.from, to: F.to, veh: F.veh[0] || "", body: F.body[0] || "" });
    if(nakgoMarket.locked())return nakgoMarket.pending();
    const al = { id: Date.now(), from: F.from || "", to: F.to || "", veh: F.veh[0] || "" };
    if (alerts.some(x => x.from === al.from && x.to === al.to && x.veh === al.veh))
        return toast("Bu alarm zaten kurulu");
    alerts.push(al);
    notifs().filter(x => x.k.startsWith("a" + al.id + "_")).forEach(x => seen.add(x.k));
    try {
        localStorage.setItem("yy-seen", JSON.stringify([...seen]));
    }
    catch (e) { }
    if (!save()) return;
    render();
    toast("Alarm kuruldu: " + (al.from || "Her yer") + " → " + (al.to || "Her yer"));
}

// Hesaplı kullanıcıda alarm formu: nereden/nereye en az biri zorunlu, araç ve kasa isteğe bağlı.
function openAlertForm(pre = {}) {
    if (nakgoMarket.guest()) return nakgoMarket.requireAccount();
    if (!nakgoMarket.active()) return;
    const B = $("#sheetBody"), opt = (list, v) => `<option value="">Fark etmez</option>` + list.map(c => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("");
    let kind = pre.kind === "truck" ? "truck" : "load";
    B.dataset.k = "route-alert";
    B.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">Yeni rota alarmı</b><button class="chip" id="close">Kapat</button></div>
        <p style="color:var(--mute);font-size:14px;margin:6px 0 12px">Bu rotada yeni ilan yayınlanınca zil simgesinde görürsün.</p>
        <div class="seg" role="group" aria-label="Alarm türü"><button data-ak="load" aria-pressed="${kind === "load"}" class="${kind === "load" ? "on" : ""}">Yük ilanları</button><button data-ak="truck" aria-pressed="${kind === "truck"}" class="${kind === "truck" ? "on" : ""}">Boş araçlar</button></div>
        <div class="row"><div><label for="ra-from">Nereden</label><select id="ra-from">${opt(cities, pre.from)}</select></div><div><label for="ra-to">Nereye</label><select id="ra-to">${opt(cities, pre.to)}</select></div></div>
        <div class="row"><div><label for="ra-veh">Araç tipi</label><select id="ra-veh">${opt(vehicles, pre.veh)}</select></div><div><label for="ra-body">Kasa tipi</label><select id="ra-body">${opt(bodies, pre.body)}</select></div></div>
        <p id="ra-msg" role="alert" style="color:var(--bad);font-size:13px;min-height:18px"></p>
        <button class="btn" id="ra-save">Alarmı kur</button>`;
    B.querySelectorAll("[data-ak]").forEach(b => b.onclick = () => {
        kind = b.dataset.ak;
        B.querySelectorAll("[data-ak]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    });
    $("#close").onclick = closeSheet;
    $("#ra-save").onclick = async () => {
        const input = { kind, from: $("#ra-from").value, to: $("#ra-to").value, veh: $("#ra-veh").value, body: $("#ra-body").value };
        if (!input.from && !input.to) { $("#ra-msg").textContent = "Nereden veya nereye alanlarından en az birini seç."; return; }
        $("#ra-save").disabled = true;
        if (await nakgoAlerts.add(input)) closeSheet();
        else if ($("#ra-save")) $("#ra-save").disabled = false;
    };
    $("#sheet").classList.add("open");
}

const accountAlertsCard = () => {
    const st = nakgoAlerts.state(), rows = nakgoAlerts.list(), off = st.working || st.busy ? "disabled" : "";
    const label = a => `${esc(alertRoute(a))} · ${a.kind === "truck" ? "Boş araç" : "Yük"}${a.vehicle ? " · " + esc(a.vehicle) : ""}${a.body ? " · " + esc(a.body) : ""}`;
    return `<div class="load route-alerts" style="cursor:default"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Rota alarmlarım</b><button class="chip" id="ra-new" ${off}>+ Alarm ekle</button></div>`
        + (st.error ? `<p role="alert" style="font-size:13px">${esc(st.error)} <button class="chip" id="ra-retry">Yeniden dene</button></p>` : "")
        + (!st.ready && !st.error ? '<p role="status" style="font-size:13px;color:var(--mute)">Alarmlar yükleniyor…</p>' : "")
        + rows.map(a => `<div class="kv"><span style="color:var(--ink);font-weight:700;${a.active ? "" : "opacity:.55"}">${label(a)}${a.active ? "" : " · Durduruldu"}</span><span style="display:flex;gap:6px"><button class="chip" data-ra-toggle="${a.id}" data-ra-on="${a.active ? 0 : 1}" ${off}>${a.active ? "Durdur" : "Aç"}</button><button class="chip" data-ra-del="${a.id}" ${off}>Kaldır</button></span></div>`).join("")
        + (st.ready && !rows.length ? '<p style="margin-top:8px;font-size:13px;color:var(--mute)">Henüz alarm yok. Takip ettiğin rotayı ekle; yeni ilan gelince zil simgesinde görürsün.</p>' : "")
        + "</div>";
};

const alertsCard = () => nakgoMarket.active() ? accountAlertsCard() : `<div class="load" style="cursor:default"><b>Rota alarmlarım</b>${alerts.length ? alerts.map(x => `<div class="kv"><span style="color:var(--ink);font-weight:700">${esc(x.from || "Her yer")} → ${esc(x.to || "Her yer")}${x.veh ? " · " + esc(x.veh) : ""}</span><button class="chip" data-ad="${esc(x.id)}">Kaldır</button></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Filtre ekranında nereden ve nereye seçip listedeki "Alarm kur"a dokun. Uygun yük çıkınca bildirim gelir.</p>`}</div>`;

// ===== Mesajlaşma =====
// Teklif sohbeti (gerçek kullanıcılar arasında canlı, örnek ilanlarda hazır cevaplı).

function openChat(key, who, onFirstSend, guard) {
    if(nakgoMarket.locked())return nakgoMarket.pending();
    if (!isPrem()) return openPaywall("Uygulama içi mesajlaşma");
    const live = cloud && /^o\d+_./.test(key), B = $("#sheetBody");
    B.dataset.k = key;
    let msgs = live ? [] : (chats[key] = chats[key] || [{ me: 0, t: "Merhaba, nasıl yardımcı olabilirim?" }]);
    const draw = () => {
        if (!$("#msgs") || B.dataset.k !== key)
            return;
        $("#msgs").innerHTML = msgs.map(x => `<div class="bub ${x.me ? "me" : ""}">${esc(x.t)}</div>`).join("");
        $("#msgs").scrollTop = 1e5;
    };
    B.innerHTML = `<div class="load-detail chat-detail"><div class="detail-top"><b>${esc(who)}</b><button class="chip detail-close" id="close" aria-label="Sohbeti kapat">Kapat ×</button></div>${!live ? '<p class="demo-note"><b>Demo sohbet</b> · Mesajlar cihazında tutulur; yanıtlar simüledir.</p>' : ""}<div id="msgs" role="log" aria-live="polite" aria-label="Mesajlar"></div><div class="chat-composer"><label class="sr-only" for="mi">Mesajın</label><input id="mi" placeholder="Mesaj yaz" maxlength="500"><button class="btn" id="ms">Gönder</button></div></div>`;
    if (unChat) {
        unChat();
        unChat = null;
    }
    if (live)
        unChat = db.collection("msgs").where("k", "==", key).onSnapshot(sn => {
            msgs = sn.docs.map(x => x.data()).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(x => ({ me: x.uid === me, t: String(x.t || "") }));
            draw();
        }, () => { });
    draw();
    syncDetailViewport();
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
    const send = async () => {
        if (guard && !guard()) return;
        if (!isPrem()) return openPaywall("Uygulama içi mesajlaşma");
        const t = $("#mi").value.trim().slice(0, 500);
        if (!t)
            return;
        if (live) {
            if (onFirstSend && onFirstSend() === false) return;
            if (await dbw(db.collection("msgs").add({ k: key, uid: me, t, ts: Date.now() }))) { onFirstSend=null; if(B.dataset.k===key) $("#mi").value=""; }
            return;
        }
        const oldOffers=JSON.parse(JSON.stringify(offers));
        msgs.push({me:1,t});
        chats[key]=msgs;
        if (onFirstSend && onFirstSend() === false) { msgs=chats[key]||[]; return; }
        if (!save()) { offers=oldOffers; msgs=chats[key]||[]; return; }
        onFirstSend=null;
        $("#mi").value="";
        draw();
        setTimeout(() => {
            msgs.push({ me: 0, t: ["Tamamdır, yarın sabah yüklemeye hazırız.", "Fiyatta biraz esneyebiliriz, ne düşünüyorsun?", "Telefonla konuşalım mı?"][Math.floor(Math.random() * 3)] });
            chats[key]=msgs;
            if (!save()) {msgs=chats[key]||[];}
            draw();
        }, 1500);
    };
    $("#ms").onclick = send;
    $("#mi").onkeydown = e => {
        if (e.key === "Enter")
            send();
    };
}

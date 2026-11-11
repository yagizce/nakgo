/**
 * Bildirimler ve mesajlaşma
 * Uygulama içi bildirimler, rota alarmı ve sohbet.
 */
// ===== Bildirim ve alarm =====
// Uygulama içi bildirimler, zil, rota alarmı.

function notifs() {
    const a = [];
    alerts.forEach(al => loads.filter(l => availableListing(l) && (!al.from || l.from === al.from) && (!al.to || l.to === al.to) && (!al.veh || l.veh === al.veh) && !(l.uid && l.uid === me)).forEach(l => a.push({ k: "a" + al.id + "_" + l.id, t: "Alarm: " + (al.from || "Her yer") + " → " + (al.to || "Her yer") + " yeni yük", s: l.cargo + " · " + l.ton + " ton", tab: "list" })));
    return a;
}

function bell() {
    const b = $("#bc");
    if (!b)
        return;
    const n = notifs().filter(x => !seen.has(x.k)).length;
    b.textContent = n > 9 ? "9+" : n;
    b.style.display = n ? "grid" : "none";
}

function openBell() {
    const a = notifs(), B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">Bildirimler</b><button class="chip" id="close">Kapat</button></div>` + (a.length ? a.map(x => `<button class="nt ${seen.has(x.k) ? "" : "new"}" data-nt="${x.tab || "list"}"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></button>`).join("") : `<div class="empty">Henüz bildirim yok.<br>Rota alarmına uyan yeni yükler burada görünür.</div>`);
    seen = new Set([...seen, ...a.map(x => x.k)]);
    try {
        localStorage.setItem("yy-seen", JSON.stringify([...seen]));
    }
    catch (e) { }
    B.querySelectorAll("[data-nt]").forEach(b => b.onclick = () => {
        closeSheet();
        tab = b.dataset.nt || "list";
        mode = "load";
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

const alertsCard = () => `<div class="load" style="cursor:default"><b>Rota alarmlarım</b>${alerts.length ? alerts.map(x => `<div class="kv"><span style="color:var(--ink);font-weight:700">${esc(x.from || "Her yer")} → ${esc(x.to || "Her yer")}${x.veh ? " · " + esc(x.veh) : ""}</span><button class="chip" data-ad="${esc(x.id)}">Kaldır</button></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Filtre ekranında nereden ve nereye seçip listedeki "Alarm kur"a dokun. Uygun yük çıkınca bildirim gelir.</p>`}</div>`;

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

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

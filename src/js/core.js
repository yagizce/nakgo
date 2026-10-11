/**
 * Çekirdek: yardımcılar, fotoğraf, kayıt, bulut
 * Kaçışlama ve biçimlendirme, fotoğraf işleme, localStorage kaydı ve geri yükleme, ortak veritabanı katmanı.
 */

// ===== Yardımcılar =====
// Kaçışlama, biçimlendirme, bildirim mesajı ve küçük genel işlevler.

const dk = d => d === "Bugün" || d === "Yarın" ? d : "İleri tarih";

const tog = (a, v) => {
    const i = a.indexOf(v);
    i < 0 ? a.push(v) : a.splice(i, 1);
};

const esc = x => String(x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clean = o => {
    const r = {};
    for (const k in o) {
        const v = o[k];
        r[k] = typeof v === "string" ? esc(v) : v;
    }
    return r;
};

const nm = u => names[u] || "Kullanıcı";

const dec = t => {
    const e = document.createElement("textarea");
    e.innerHTML = t;
    return e.value;
};

const imgOk = u => typeof u === "string" && u.length < 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(u);

const isDark = () => ["#0b1d22", "#101722"].includes(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

const opt2 = (a, d) => a.map(c => `<option ${c === d ? "selected" : ""}>${c}</option>`).join("");

const SKEL = [1, 2, 3].map(() => `<div class="load sk"><i></i><i></i><i></i></div>`).join("");

const weekStart = t => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
};

const f1 = n => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });



const $ = s => document.querySelector(s);

const fmt = n => n.toLocaleString("tr-TR") + " ₺";

function toast(t) {
    const e = $("#toast");
    e.textContent = t;
    e.style.display = "block";
    setTimeout(() => e.style.display = "none", 2000);
}

// ===== Fotoğraf =====
// Fotoğraf seçme, küçültme ve gösterme (ilan, belge, teslim fotoğrafı).

function shrink(file, cb, max, lim) {
    max = max || 720;
    lim = lim || 170000;
    const rd = new FileReader();
    rd.onload = () => {
        const im = new Image();
        im.onload = () => {
            const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
            c.width = Math.round(im.width * k);
            c.height = Math.round(im.height * k);
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            let u = "";
            for (const q of [.6, .45, .3]) {
                u = c.toDataURL("image/jpeg", q);
                if (u.length < lim)
                    break;
            }
            cb(u);
        };
        im.onerror = () => toast("Fotoğraf okunamadı");
        im.src = rd.result;
    };
    rd.readAsDataURL(file);
}

function pickImg(cb, max, lim) {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/*";
    i.onchange = () => {
        const f = i.files && i.files[0];
        if (f)
            shrink(f, cb, max, lim);
    };
    i.click();
}

function showImg(u, t) {
    const B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<b style="font-size:17px">${t}</b><div id="pi" style="margin-top:12px"></div><button class="btn alt" id="close">Kapat</button>`;
    if (typeof u === "string" && u.startsWith("data:image/jpeg;base64,") && u.length < 250000) {
        const im = new Image();
        im.src = u;
        im.alt = t;
        im.style.cssText = "width:100%;border-radius:12px";
        $("#pi").appendChild(im);
    }
    else
        $("#pi").textContent = "Fotoğraf bulunamadı.";
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
}

// ===== Kayıt ve geri yükleme =====
// localStorage ve kullanıcı tercihleri (bulut) kaydı, açılışta geri yükleme ve veri taşıma yamaları.

function savePrefs() {
    if (!cloud)
        return;
    const j = JSON.stringify({ favs, calc, alerts, blocked });
    if (j === lastP)
        return;
    lastP = j;
    clearTimeout(pt);
    pt = setTimeout(() => db.doc("data/users/" + me + "/prefs").set({ favs, calc, alerts, blocked }).catch(() => { }), 800);
}

try {
    seen = new Set(JSON.parse(localStorage.getItem("yy-seen") || "[]"));
}
catch (e) { }

try {
    role = localStorage.getItem("yy-role") || "";
}
catch (e) { }

function save() {
    try {
        localStorage.setItem("yy2", JSON.stringify({ loads, offers, trucks, chats, calc, favs, myCar, alerts, rates, prem, blocked, reports }));
    }
    catch (e) { }
    savePrefs();
}

try {
    const d = JSON.parse(localStorage.getItem("yy2") || "null");
    if (d) {
        loads = d.loads;
        offers = d.offers;
        trucks = d.trucks;
        chats = d.chats;
        calc = d.calc;
        favs = d.favs || [];
        myCar = d.myCar || myCar;
        alerts = d.alerts || [];
        rates = d.rates || [];
        prem = d.prem || prem;
        blocked = d.blocked || [];
        reports = d.reports || [];
    }
}
catch (e) { }

offers.filter(o => o.status === "wait").forEach(o => simulate(o.id));

if (calc.fuel === 45)
    calc.fuel = 95;



// ===== Bulut katmanı =====
// Ortak veritabanı: yazma yardımcıları, okunan verinin duruma çevrilmesi, olay izleme, bulut başlatma.

const dbw = p => p.catch(() => toast("Bu işlem için yazma yetkin yok"));

function rebuild() {
    offers = [];
    incoming = [];
    allO.forEach(od => {
        const L = loads.find(x => x.id === od.loadId);
        if (!L)
            return;
        const B = String(od.bidder);
        const o = { ...L, offer: +od.offer || 0, status: ["wait", "ok", "counter", "no"].includes(od.status) ? od.status : "wait", counter: +od.counter || 0, loadId: L.id, bidder: B, ownerUid: od.ownerUid || "", stage: Math.min(3, Math.max(0, +od.stage || 0)), ots: +od.ts || 0, doneAt: +od.doneAt || 0 };
        if (B === me)
            offers.push(o);
        else if (L.uid && L.uid === me && !blocked.includes(B))
            incoming.push(o);
    });
}

function track(t, id) {
    if (!cloud)
        return;
    const l = loads.find(x => x.id === id);
    if (!l || !l.uid || l.uid === me)
        return;
    const k = t + "_" + id;
    if (tracked.has(k))
        return;
    tracked.add(k);
    db.doc("events/" + k + "_" + me).set({ t, loadId: id, uid: me, ts: Date.now() }).catch(() => { });
}

function untrack(t, id) {
    if (!cloud)
        return;
    const k = t + "_" + id;
    tracked.delete(k);
    db.doc("events/" + k + "_" + me).delete().catch(() => { });
}

async function initCloud() {
    try {
        if (!window.claude || !claude.use)
            return;
        const [d, u] = await Promise.all([claude.use("db"), claude.use("user")]);
        if (!d || !u)
            return;
        me = await u.id();
        if (!me)
            return;
        db = d;
        cloud = true;
        loaded = false;
        myName = esc((await u.me()).name || "");
        names[me] = myName || "Ben";
        const ts = (a, b) => (b.ts || 0) - (a.ts || 0) || String(a.id).localeCompare(String(b.id), "tr", { numeric: true });
        const who = async (list) => {
            const ids = [...new Set(list.filter(Boolean))].filter(i => !names[i]);
            if (!ids.length)
                return;
            const pr = await u.profiles(ids);
            ids.forEach(i => names[i] = esc((pr[i] && pr[i].name) || "") || "Kullanıcı");
            soft();
        };
        const sim = new Set();
        db.collection("loads").onSnapshot(sn => {
            loads = sn.docs.map(x => clean(x.data())).sort(ts);
            who(loads.map(l => l.uid));
            rebuild();
            loaded = true;
            soft();
            deep();
        }, () => {
            loaded = true;
            soft();
        });
        db.collection("trucks").onSnapshot(sn => {
            trucks = sn.docs.map(x => clean(x.data())).sort(ts);
            who(trucks.map(t => t.uid));
            soft();
        }, () => { });
        db.collection("offers").onSnapshot(sn => {
            allO = sn.docs.map(x => x.data());
            rebuild();
            offers.filter(o => o.status === "wait" && !o.ownerUid && !sim.has(o.id)).forEach(o => {
                sim.add(o.id);
                simulate(o.id);
            });
            soft();
        }, () => { });
        let first = true;
        db.collection("carriers").onSnapshot(sn => {
            carriers = {};
            sn.docs.forEach(x => {
                const v = x.data();
                carriers[x.id] = { displayName: String(v.displayName || "").slice(0,60), city: String(v.city || "").slice(0,40), about: String(v.about || "").slice(0,200), phone: esc(String(v.phone || "").slice(0, 20)), ok: v.ok === true, lic: esc(v.lic || ""), src: !!v.src, kb: !!v.kb, ruh: !!v.ruh, docs: { src: !!(v.docs && v.docs.src), kb: !!(v.docs && v.docs.kb), ruh: !!(v.docs && v.docs.ruh) } };
            });
            if (first) {
                if (carriers[me])
                    myCar = { ...carriers[me] };
                first = false;
            }
            who(Object.keys(carriers));
            soft();
        }, () => { });
        admin = await u.isOwner();
        db.collection("events").onSnapshot(sn => {
            events = sn.docs.map(x => {
                const v = x.data();
                return { t: String(v.t || ""), loadId: +v.loadId || 0, uid: String(v.uid || ""), ts: +v.ts || 0 };
            });
            soft();
        }, () => { });
        if (admin)
            db.collection("reports").onSnapshot(sn => {
                reports = sn.docs.map(x => ({ k: x.id, ...clean(x.data()) }));
                soft();
            }, () => { });
        db.collection("ratings").onSnapshot(sn => {
            rates = sn.docs.map(x => {
                const v = x.data();
                return { k: x.id, to: String(v.to || ""), by: String(v.by || ""), stars: Math.min(5, Math.max(1, +v.stars || 1)), text: esc(v.text || ""), ts: +v.ts || 0 };
            });
            soft();
        }, () => { });
        db.collection("approvals").onSnapshot(sn => {
            appr = {};
            sn.docs.forEach(x => {
                appr[x.id] = x.data().ok === true;
            });
            soft();
        }, () => { });
        try {
            const pd = await db.doc("premium/" + me).get();
            if (pd.exists) {
                const v = pd.data();
                prem = { until: +v.until || 0, plan: String(v.plan || "") };
            }
        }
        catch (e) { }
        const ps = await db.doc("data/users/" + me + "/prefs").get();
        if (ps.exists) {
            const v = ps.data();
            favs = Array.isArray(v.favs) ? v.favs.map(String) : [];
            if (v.calc)
                calc = { ...calc, ...v.calc };
            alerts = Array.isArray(v.alerts) ? v.alerts.slice(0, 20) : [];
            blocked = Array.isArray(v.blocked) ? v.blocked.map(String).slice(0, 200) : [];
        }
        lastP = JSON.stringify({ favs, calc, alerts, blocked });
        soft();
    }
    catch (e) { }
}

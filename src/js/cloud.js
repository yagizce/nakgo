/**
 * Eski host bağlantısı
 * Mevcut ortak veri bağdaştırıcısı; normal PWA yayını yerel demo olarak çalışır.
 */
// ===== Bulut katmanı =====
// Ortak veritabanı: yazma yardımcıları, okunan verinin duruma çevrilmesi, olay izleme, bulut başlatma.

const dbw = p => p.then(() => true).catch(() => { toast("Kayıt eşitlenemedi. Bağlantını ve erişimini kontrol edip tekrar dene."); return false; });

function rebuild() {
    if (!cloud) return;
    const previous = [...offers, ...incoming];
    offers = [];
    incoming = [];
    allO.forEach(od => {
        const L = loads.find(x => x.id === od.loadId) || normalizeListing(od.listing) || previous.find(x => x.loadId === od.loadId) || {id:od.loadId,from:"İlan kaldırıldı",to:"Güzergâh kaydı yok",cargo:"",uid:od.ownerUid||""};
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

// Ortak kayıttan gelen değişiklikleri önbelleğe al; tercihleri geri gönderme.
function refreshCloudState() {
    save(false);
    soft();
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
        myName = String((await u.me()).name || "");
        names[me] = myName || "Ben";
        const ts = (a, b) => (b.ts || 0) - (a.ts || 0) || String(a.id).localeCompare(String(b.id), "tr", { numeric: true });
        const who = async (list) => {
            const ids = [...new Set(list.filter(Boolean))].filter(i => !names[i]);
            if (!ids.length)
                return;
            const pr = await u.profiles(ids);
            ids.forEach(i => names[i] = String((pr[i] && pr[i].name) || "") || "Kullanıcı");
            soft();
        };
        const sim = new Set();
        db.collection("loads").onSnapshot(sn => {
            loads = sn.docs.map(x => normalizeListing(x.data())).filter(Boolean).sort(ts);
            who(loads.map(l => l.uid));
            rebuild();
            loaded = true;
            refreshCloudState();
            deep();
        }, () => {
            loaded = true;
            soft();
        });
        db.collection("trucks").onSnapshot(sn => {
            trucks = sn.docs.map(x => normalizeListing(x.data())).filter(Boolean).sort(ts);
            who(trucks.map(t => t.uid));
            refreshCloudState();
        }, () => { });
        db.collection("offers").onSnapshot(sn => {
            allO = sn.docs.map(x => x.data());
            rebuild();
            offers.filter(o => o.status === "wait" && !o.ownerUid && !sim.has(o.id)).forEach(o => {
                sim.add(o.id);
                simulate(o.id);
            });
            refreshCloudState();
        }, () => { });
        let first = true;
        db.collection("carriers").onSnapshot(sn => {
            carriers = {};
            sn.docs.forEach(x => {
                const v = x.data();
                carriers[x.id] = { displayName: String(v.displayName || "").slice(0,60), city: String(v.city || "").slice(0,40), about: String(v.about || "").slice(0,200), phone: String(v.phone || "").slice(0, 20), ok: v.ok === true, lic: String(v.lic || ""), src: !!v.src, kb: !!v.kb, ruh: !!v.ruh, docs: { src: !!(v.docs && v.docs.src), kb: !!(v.docs && v.docs.kb), ruh: !!(v.docs && v.docs.ruh) } };
            });
            if (first) {
                if (carriers[me])
                    myCar = { ...carriers[me] };
                first = false;
            }
            who(Object.keys(carriers));
            refreshCloudState();
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
                refreshCloudState();
            }, () => { });
        db.collection("ratings").onSnapshot(sn => {
            rates = sn.docs.map(x => {
                const v = x.data();
                return { k: x.id, to: String(v.to || ""), by: String(v.by || ""), stars: Math.min(5, Math.max(1, +v.stars || 1)), text: String(v.text || ""), ts: +v.ts || 0 };
            });
            refreshCloudState();
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
        refreshCloudState();
    }
    catch (e) { }
}

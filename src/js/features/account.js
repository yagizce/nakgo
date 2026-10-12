/**
 * Profil, doğrulama ve güven
 * Herkese açık profil, puan, rol ve tanıtım, profil bilgileri; belge rozetleri ve telefon; şikayet, engelleme ve yardım.
 */

// ===== Profil ve kazanç =====
// Herkese açık profil, puan ve yorum, rol ve tanıtım, iletişim bilgileri, ana ekrana ekleme, profil sekmesi olayları.

function listBind() {
    const M = $("#main");
    M.querySelectorAll("[data-rc]").forEach(b => b.onclick = () => {
        const k = b.dataset.rc;
        reports = reports.filter(x => x.k !== k);
        if (!save()) return;
        if (cloud)
            dbw(db.doc("reports/" + k).delete());
        render();
    });
    M.querySelectorAll("[data-ub]").forEach(b => b.onclick = () => {
        blocked = blocked.filter(x => x !== b.dataset.ub);
        rebuild();
        save();
        render();
    });
    if ($("#inst"))
        $("#inst").onclick = async () => {
            if (!deferredInstall)
                return;
            deferredInstall.prompt();
            try {
                await deferredInstall.userChoice;
            }
            catch (e) { }
            deferredInstall = null;
            render();
        };
    if ($("#pm1"))
        $("#pm1").onclick = () => openPaywall("");
    if ($("#pm2"))
        $("#pm2").onclick = () => {
            prem = { until: 0, plan: "" };
            if (!save()) return;
            if (cloud)
                dbw(db.doc("premium/" + me).set(prem));
            render();
        };
    if ($("#phs2"))
        $("#phs2").onclick = savePhone;
    M.querySelectorAll("[data-ro]").forEach(b => b.onclick = () => setRole(b.dataset.ro, 0));
    if ($("#onb2"))
        $("#onb2").onclick = openOnb;
    M.querySelectorAll("[data-ad]").forEach(b => b.onclick = () => {
        alerts = alerts.filter(x => String(x.id) !== b.dataset.ad);
        save();
        render();
    });
    M.querySelectorAll("[data-me]").forEach(b => {
        const [k, id] = b.dataset.me.split("|");
        b.onclick = () => openEdit(k, id);
    });
    M.querySelectorAll("[data-ft]").forEach(b => b.onclick = () => {
        const [k, id] = b.dataset.ft.split("|");
        openFeature(k, id);
    });
    M.querySelectorAll("[data-st2]").forEach(b => b.onclick = () => openStats(b.dataset.st2));
    M.querySelectorAll("[data-mc]").forEach(b => {
        const [k, id] = b.dataset.mc.split("|");
        b.onclick = () => {
            const it = findIt(k, id);
            if (it) {
                const off = it.closed || expired(it, k === "l" ? "load" : "truck");
                if (off && validDay(it.date) && (it.dateEnd||it.date)<localDay()) return openEdit(k,id,true);
                patchIt(k, id, off ? { closed: false, ts: Date.now() } : { closed: true });
            }
        };
    });
    M.querySelectorAll("[data-md2]").forEach(b => {
        const [k, id] = b.dataset.md2.split("|");
        b.onclick = () => askDel(k, id);
    });
}

const ratingOf = u => {
    const r = rates.filter(x => x.to === u && u);
    return r.length ? { avg: r.reduce((t, x) => t + x.stars, 0) / r.length, n: r.length } : null;
};

const starTxt = x => {
    const R = x.uid ? ratingOf(x.uid) : null;
    return R ? "★ " + R.avg.toFixed(1) + " (" + R.n + ")" : "★ " + esc(x.rate || "Yeni");
};

const rkey = (o, as) => o.loadId + "_" + o.bidder + "_" + (as === "owner" ? "o" : "c");

function openRate(o, as) {
    if (!o)
        return;
    const key = rkey(o, as), B = $("#sheetBody");
    B.dataset.k = "";
    let st = 0;
    B.innerHTML = `<b style="font-size:19px">${as === "owner" ? "Taşıyıcıyı puanla" : "Yük sahibini puanla"}</b><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-st="${n}" aria-label="${n} yıldız">★</button>`).join("")}</div><label>Yorum (isteğe bağlı)</label><input id="rt" maxlength="200" placeholder="Nasıldı?"><button class="btn" id="rs2">Gönder</button><button class="btn alt" id="close">Vazgeç</button>`;
    B.querySelectorAll("[data-st]").forEach(b => b.onclick = () => {
        st = +b.dataset.st;
        B.querySelectorAll("[data-st]").forEach(x => x.classList.toggle("on", +x.dataset.st <= st));
    });
    $("#rs2").onclick = () => {
        if (!st)
            return toast("Yıldız seç");
        const to = as === "owner" ? o.bidder : (o.ownerUid || o.uid || "");
        const rec = { k: key, to, by: me || "local", stars: st, text: $("#rt").value.trim().slice(0, 200), ts: Date.now() };
        if (cloud)
            dbw(db.doc("ratings/" + key).set(rec));
        rates = rates.filter(x => x.k !== key);
        rates.push(rec);
        if (!save()) return;
        closeSheet();
        render();
        toast("Teşekkürler, puanın kaydedildi");
    };
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

function myRate() {
    const R = ratingOf(me || "local");
    return R ? " · ★ " + R.avg.toFixed(1) + " (" + R.n + ")" : "";
}


function setRole(r, go) {
    role = r;
    try {
        localStorage.setItem("yy-role", r);
        localStorage.setItem("yy-onb", "1");
    }
    catch (e) { }
    if (r === "owner") {
        mode = "truck";
        postMode = "load";
    }
    else {
        mode = "load";
        postMode = "truck";
    }
    const o = $("#onb");
    if (o)
        o.style.display = "none";
    if (go) {
        tab = "list";
        setNav();
    }
    render();
}

function openOnb() {
    let el = $("#onb");
    if (!el) {
        el = document.createElement("div");
        el.id = "onb";
        el.className = "onb";
        $("#app").appendChild(el);
    }
    let i = 0;
    const dots = n => `<div class="dots">${[0, 1, 2, 3].map(k => `<i class="${k === n ? "on" : ""}"></i>`).join("")}</div>`;
    const draw = () => {
        if (i < 3) {
            const [ic, t, x] = SL[i];
            el.innerHTML = `<button class="chip" id="ob-skip" style="align-self:flex-end">Atla</button><div class="ob-body"><div class="ob-ic"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ic}"/></svg></div><h2>${t}</h2><p>${x}</p></div>${dots(i)}<button class="btn" id="ob-next">İleri</button>`;
            $("#ob-next").onclick = () => {
                i++;
                draw();
            };
            $("#ob-skip").onclick = () => {
                i = 3;
                draw();
            };
        }
        else {
            el.innerHTML = `<div class="ob-body"><h2>Sen kimsin?</h2><p>Ana sayfanı buna göre hazırlayalım.</p><button class="rolebtn" id="r-c"><b>Taşıyıcıyım</b><span>Aracım var, yük arıyorum</span></button><button class="rolebtn" id="r-o"><b>Yük sahibiyim</b><span>Taşıtacak yüküm var</span></button></div>${dots(3)}`;
            $("#r-c").onclick = () => setRole("carrier", 1);
            $("#r-o").onclick = () => setRole("owner", 1);
        }
    };
    draw();
    el.style.display = "flex";
}

const rv = x => {
    const R = x.uid ? ratingOf(x.uid) : null;
    return R ? R.avg : (+x.rate || 0);
};

function openProfile(o) {
    const B = $("#sheetBody");
    B.dataset.k = "";
    const R = o.uid ? rates.filter(x => x.to === o.uid) : [], avg = R.length ? R.reduce((t, x) => t + x.stars, 0) / R.length : (+o.rate || 0);
    const info = o.uid ? carriers[o.uid] || {} : {};
    const act = o.uid ? loads.filter(l => l.uid === o.uid && !l.closed && !expired(l, "load")).length + trucks.filter(t => t.uid === o.uid && !t.closed && !expired(t, "truck")).length : 0;
    const done = o.uid ? allO.filter(x => (x.bidder === o.uid || x.ownerUid === o.uid) && (+x.stage || 0) >= 3).length : 0, n2 = o.name || "Kullanıcı";
    B.innerHTML = `<div style="display:flex;gap:14px;align-items:center"><div class="avatar">${esc((String(n2)[0] || "?").toUpperCase())}</div><div><b style="font-size:18px">${esc(n2)}${vbadge(o.lv || 0)}</b><div style="color:var(--mute);font-size:14px">${avg ? "★ " + avg.toFixed(1) + (R.length ? " (" + R.length + " değerlendirme)" : "") : "Henüz puan yok"}</div></div></div><div class="stat"><div><b>${act}</b><span>Aktif ilan</span></div><div><b>${done}</b><span>Onaylanan iş</span></div><div><b>${R.length}</b><span>Yorum</span></div></div>${info.city || info.about || info.displayName ? `<section class="detail-group"><h2>Hakkında</h2>${info.displayName ? `<p>${esc(info.displayName)}</p>` : ""}${info.city ? `<p>${esc(info.city)}</p>` : ""}${info.about ? `<p class="detail-note">${esc(info.about)}</p>` : ""}</section>` : ""}${R.length ? `<b style="font-size:15px">Yorumlar</b>` + R.slice(-5).reverse().map(x => `<div class="rv"><span class="stars-s">${"★".repeat(x.stars)}${"☆".repeat(5 - x.stars)}</span>${x.text ? `<p>${esc(x.text)}</p>` : ""}</div>`).join("") : ""}<div class="chips" style="margin-top:14px">${o.uid && o.uid !== me ? `<button class="chip" id="pr">Şikayet et</button><button class="chip" id="pb2">Engelle</button>` : ""}</div><button class="btn alt" id="close">Kapat</button>`;
    if ($("#pr"))
        $("#pr").onclick = () => openReport("u", o.uid);
    if ($("#pb2"))
        $("#pb2").onclick = () => blockUser(o.uid);
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

const isNative = () => {
    try {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    }
    catch (e) {
        return false;
    }
};

const standalone = () => {
    try {
        return isNative() || window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    }
    catch (e) {
        return false;
    }
};

const isIOS = () => /iphone|ipad|ipod/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");

const installCard = () => {
    if (standalone())
        return "";
    if (deferredInstall)
        return `<div class="load" style="cursor:default"><b>Uygulamayı yükle</b><p style="font-size:13px;color:var(--mute);margin:6px 0 10px">NakGo'yu ana ekranına ekle, uygulama gibi açılsın.</p><button class="chip on" id="inst">Ana ekrana ekle</button></div>`;
    if (isIOS())
        return `<div class="load" style="cursor:default"><b>Ana ekrana ekle</b><p style="font-size:13px;color:var(--mute);margin-top:6px">Safari'de Paylaş düğmesine, sonra "Ana Ekrana Ekle"ye dokun. NakGo uygulama gibi açılır.</p></div>`;
    return "";
};

// ===== Doğrulama ve iletişim =====
// Belge rozetleri, belge fotoğrafı, yönetici onayı, telefon numarası.

const phoneOf = x => {
    if ((!cloud&&x.mine)||(cloud&&x.uid===me)) return myCar.phone||"";
    if (x.uid) return carrierPhone(x.uid)||x.phone||"";
    return x.phone||"0000 000 00 "+String(x.id).replace(/\D/g,"").padStart(2,"0").slice(-2);
};

const carrierPhone = u => (carriers[u] && carriers[u].phone) || "";

function savePhone() {
    const d = ($("#myph").value || "").replace(/\D/g, ""), n = d.length === 10 ? "0" + d : d;
    if (!/^05\d{9}$/.test(n))
        return toast("Geçerli bir cep numarası gir (05xx xxx xx xx)");
    if (!setCar({ phone: n.slice(0, 4) + " " + n.slice(4, 7) + " " + n.slice(7, 9) + " " + n.slice(9) })) return;
    toast("Numara kaydedildi");
}

const phoneCard = () => `<div class="load" style="cursor:default"><b>Telefon numaram</b><p style="font-size:12.5px;color:var(--mute);margin:6px 0 10px">Arama ekranı Premium erişimi gerektirir. Demo verileri bu cihazda saklanır.</p><input id="myph" inputmode="tel" placeholder="05xx xxx xx xx" value="${esc(myCar.phone || "")}"><button class="chip on" id="phs2" style="margin-top:10px">Kaydet</button></div>`;

const cOk = c => !!(c.lic && c.src && c.kb && c.ruh);

const vok = x => !!(x && (x.verified === true || (x.uid && carriers[x.uid] && carriers[x.uid].ok === true)));

const bok = u => !!(carriers[u] && carriers[u].ok === true);

const lvU = u => appr[u] === true ? 2 : (carriers[u] && carriers[u].ok === true) ? 1 : 0;

const lvT = t => (t.approved === true || (t.uid && appr[t.uid] === true)) ? 2 : vok(t) ? 1 : 0;

const vbadge = l => l === 2 ? VA : l === 1 ? VB : "";

function docPhoto(k) {
    pickImg(u => {
        cdocs[(me || "local") + "/" + k] = u;
        if (cloud)
            dbw(db.doc("carrierDocs/" + me + "/files/" + k).set({ img: u }));
        if (!setCar({ [k]: true, docs: { ...(myCar.docs || {}), [k]: true } })) return;
        toast("Belge fotoğrafı yüklendi");
    });
}

async function viewDoc(uid, k) {
    let u = cdocs[uid + "/" + k];
    if (!u && cloud) {
        try {
            const d = await db.doc("carrierDocs/" + uid + "/files/" + k).get();
            u = d.exists ? d.data().img : "";
        }
        catch (e) { }
    }
    showImg(u, "Belge: " + ({ src: "SRC", kb: "K yetki belgesi", ruh: "Araç ruhsatı" }[k] || ""));
}

const adminCard = () => {
    if (!admin)
        return "";
    const P = Object.entries(carriers).filter(([id, c]) => id !== me && c.docs && (c.docs.src || c.docs.kb || c.docs.ruh) && appr[id] !== true);
    return `<div class="load" style="cursor:default"><b>Onay bekleyen taşıyıcılar</b>${P.length ? P.map(([id, c]) => `<div class="kv" style="display:block"><b style="font-size:14px">${esc(nm(id))}</b> <span style="color:var(--mute);font-size:12px">Ehliyet ${esc(c.lic || "—")}</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${["src", "kb", "ruh"].filter(k => c.docs[k]).map(k => `<button class="chip" data-av="${esc(id)}|${k}">${{ src: "SRC", kb: "K belgesi", ruh: "Ruhsat" }[k]}</button>`).join("")}<button class="chip on" data-ap="${esc(id)}">Onayla</button></div></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Bekleyen başvuru yok.</p>`}</div>`;
};

function setCar(patch) {
    Object.assign(myCar, patch);
    if (!save()) return false;
    const d = { displayName: myCar.displayName || "", city: myCar.city || "", about: myCar.about || "", phone: myCar.phone || "", lic: myCar.lic || "", src: !!myCar.src, kb: !!myCar.kb, ruh: !!myCar.ruh, docs: { src: !!(myCar.docs && myCar.docs.src), kb: !!(myCar.docs && myCar.docs.kb), ruh: !!(myCar.docs && myCar.docs.ruh) } };
    d.ok = cOk(d);
    carriers[me || "local"] = d;
    if (cloud)
        dbw(db.doc("carriers/" + me).set(d));
    render();
    return true;
}

function carBind() {
    $("#main").querySelectorAll("[data-vc]").forEach(i => i.onchange = () => setCar({ [i.dataset.vc]: i.checked }));
    $("#main").querySelectorAll("[data-dp]").forEach(b => b.onclick = () => docPhoto(b.dataset.dp));
    $("#main").querySelectorAll("[data-av]").forEach(b => {
        const [u, k] = b.dataset.av.split("|");
        b.onclick = () => viewDoc(u, k);
    });
    $("#main").querySelectorAll("[data-ap]").forEach(b => b.onclick = () => {
        dbw(db.doc("approvals/" + b.dataset.ap).set({ ok: true }));
        toast("Taşıyıcı onaylandı");
    });
    $("#lic").onchange = e => setCar({ lic: e.target.value });
}

const carCard = () => {
    const c = myCar, n = [c.lic, c.src, c.kb, c.ruh].filter(Boolean).length;
    return `<div class="load" style="cursor:default"><div style="display:flex;justify-content:space-between;align-items:center"><b>Taşıyıcı belgeleri</b><span class="${n === 4 ? "good" : ""}" style="font-size:13px;font-weight:700">${n}/4</span></div><div class="bar2"><i style="width:${n * 25}%"></i></div><label>Ehliyet sınıfı</label><select id="lic"><option value="">Seç</option>${["B", "C", "CE", "D"].map(v => `<option ${c.lic === v ? "selected" : ""}>${v}</option>`).join("")}</select>${[["src", "SRC belgem var"], ["kb", "K yetki belgem var"], ["ruh", "Araç ruhsatım var"]].map(([k, t]) => `<div class="docrow"><label class="chk"><input type="checkbox" data-vc="${k}" ${c[k] ? "checked" : ""}>${t}</label><button class="chip" data-dp="${k}">${c.docs && c.docs[k] ? "Yüklendi ✓" : "Fotoğraf ekle"}</button></div>`).join("")}<p style="font-size:12.5px;color:var(--mute);margin-top:12px">${appr[me || "local"] === true ? "Belgelerin onaylandı: ✓ Onaylı rozeti profilinde görünüyor." : n === 4 ? "✓ Belgeli rozeti açık. Belge fotoğraflarını yüklersen yönetici onayıyla ✓ Onaylı rozeti alırsın." : "Dördünü tamamlayınca ✓ Belgeli rozeti kazanırsın. Fotoğraf yükleyince yönetici onayına girer."}${cloud ? " Belgelerini yalnızca yönetici görür." : ""}</p></div>`;
};

// ===== Güven ve destek =====
// Şikayet, engelleme, yardım ve sık sorulan sorular.

function openReport(kind, id) {
    const B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<b style="font-size:19px">Şikayet et</b><label>Sebep</label><select id="rr">${["Sahte ilan", "Dolandırıcılık şüphesi", "Uygunsuz içerik", "Yanlış bilgi", "Diğer"].map(x => `<option>${x}</option>`).join("")}</select><label>Açıklama (isteğe bağlı)</label><input id="rn" maxlength="200" placeholder="Ne oldu?"><button class="btn" id="rg">Gönder</button><button class="btn alt" id="close">Vazgeç</button>`;
    $("#rg").onclick = () => {
        const rec = { kind, tid: String(id), reason: $("#rr").value, note: $("#rn").value.trim().slice(0, 200), by: me || "local", ts: Date.now() }, key = (me || "local") + "_" + kind + "_" + id;
        if (cloud)
            dbw(db.doc("reports/" + key).set(rec));
        reports = reports.filter(x => x.k !== key);
        reports.push({ k: key, ...rec });
        if (!save()) return;
        closeSheet();
        toast(cloud ? "Şikayetin alındı, teşekkürler" : "Şikayetin bu cihazda kaydedildi. Demo modunda ekibe gönderilmez.");
    };
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

function blockUser(u) {
    if (!u || u === me)
        return;
    if (!blocked.includes(u))
        blocked.push(u);
    rebuild();
    if (!save()) return;
    closeSheet();
    render();
    toast("Kullanıcı engellendi");
}

const reportsCard = () => {
    if (!admin)
        return "";
    return `<div class="load" style="cursor:default"><b>Şikayetler (${reports.length})</b>${reports.length ? reports.map(x => `<div class="kv" style="display:block"><b style="font-size:14px">${esc(x.reason)} · ${x.kind === "l" ? "ilan" : x.kind === "u" ? "kullanıcı" : "boş araç"} ${esc(x.tid)}</b>${x.note ? `<div style="font-size:12.5px;color:var(--mute);margin-top:4px">${esc(x.note)}</div>` : ""}<button class="chip" style="margin-top:8px" data-rc="${esc(x.k)}">Kapat</button></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Şikayet yok.</p>`}</div>`;
};

const blockedCard = () => blocked.length ? `<div class="load" style="cursor:default"><b>Engellenenler</b>${blocked.map(u => `<div class="kv"><span style="color:var(--ink);font-weight:700">${esc(nm(u))}</span><button class="chip" data-ub="${esc(u)}">Kaldır</button></div>`).join("")}</div>` : "";

const helpCard = () => `<div class="load" style="cursor:default"><b>Yardım ve destek</b>${FAQ.map(([q, a]) => `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join("")}${SUPPORT_MAIL.endsWith("@example.com") ? '<p class="estimate-note">Destek iletişim adresi henüz tanımlanmadı.</p>' : `<a class="chip" href="mailto:${SUPPORT_MAIL}" style="display:inline-block;margin-top:12px;text-decoration:none">Bize yaz</a>`}</div>`;

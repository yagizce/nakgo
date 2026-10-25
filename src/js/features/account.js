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

async function savePhone() {
    const button=$("#phs2"); if(button?.disabled)return;
    const d = ($("#myph").value || "").replace(/\D/g, ""), n = d.length === 10 ? "0" + d : d;
    if (!/^05\d{9}$/.test(n))
        return toast("Geçerli bir cep numarası gir (05xx xxx xx xx)");
    if(privateProfile()!==null) {
        if(button)button.disabled=true;
        try {await nakgoAuth.saveProfileDetails({phone:n});toast('Numaran hesabına kaydedildi');}
        catch(error){toast(nakgoAuth.message(error));if(button)button.disabled=false;}
        return;
    }
    if (!setCar({ phone: n.slice(0, 4) + " " + n.slice(4, 7) + " " + n.slice(7, 9) + " " + n.slice(9) })) return;
    toast("Numara kaydedildi");
}

const phoneCard = () => {
    const profile=privateProfile(), s=nakgoAuth.snapshot();
    return `<div class="load" style="cursor:default"><b>Telefon numaram</b><p style="font-size:12.5px;color:var(--mute);margin:6px 0 10px">${profile ? 'Numaran yalnız hesabında saklanır. Telefon doğrulaması yapılmaz.' : 'Arama ekranı Premium erişimi gerektirir. Demo verileri bu cihazda saklanır.'}</p><input id="myph" inputmode="tel" placeholder="05xx xxx xx xx" value="${esc(profile ? profile.phone||"" : myCar.phone||"")}"><button class="chip on" id="phs2" style="margin-top:10px"${s.user && (!s.profile || s.recovery) ? ' disabled' : ''}>Kaydet</button></div>`;
};

const cOk = c => !!(c.lic && c.src && c.kb && c.ruh);

const vok = x => !!(x && (x.verified === true || (x.uid && carriers[x.uid] && carriers[x.uid].ok === true)));

const bok = u => !!(carriers[u] && carriers[u].ok === true);

const lvU = u => appr[u] === true ? 2 : (carriers[u] && carriers[u].ok === true) ? 1 : 0;

const lvT = t => (t.approved === true || (t.uid && appr[t.uid] === true)) ? 2 : vok(t) ? 1 : 0;

const vbadge = l => l === 2 ? VA : l === 1 ? VB : "";

function docPhoto(k) {
    if(nakgoMarket.active())return nakgoMarket.pending();
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
    if(nakgoMarket.active())return nakgoMarket.pending();
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
    if(nakgoMarket.active())return nakgoMarket.pending();
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
    if(nakgoMarket.active())return nakgoMarket.pending();
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

// Auth keeps the existing dialog/focus lifecycle and SDK-backed form behavior.
function authCardHTML() {
    const s=nakgoAuth.snapshot();
    if(!s.enabled)return '';
    return `<div class="load profile-info"><h3>NakGo hesabı · test</h3>
        <p class="estimate-note">${nakgoMarket.active()?"Profil, iletişim, ilanların, taşıma taleplerin ve favorilerin hesabında saklanır. Mesajlar, belgeler ve ödeme henüz kullanıma hazır değil.":"Hesap bağlantısı gerçektir. Profil ve iletişim bilgileri hesabında saklanır. İlanlar, işler, mesajlar ve belgeler henüz cihazdaki demoya aittir."}</p>
        ${s.error?`<p role="status" class="estimate-note">${esc(s.error)}</p>`:''}
        ${!s.ready?'<p role="status">Hesap bağlantısı hazırlanıyor. Bağlantı kurulamazsa sayfayı yenile.</p>':s.user?`
            <p>${esc(s.profile?.display_name||'Hesabım')}</p><p class="estimate-note">${esc(s.user.email)}</p>
            <div class="chips"><button class="chip on" data-auth-open="${s.recovery?'password':'profile'}">${s.recovery?'Yeni şifre belirle':'Hesap bilgileri'}</button><button class="chip" id="account-signout">Çıkış yap</button></div>`:
            '<div class="chips"><button class="chip on" data-auth-open="signin">Giriş yap</button><button class="chip" data-auth-open="signup">Kayıt ol</button></div>'}
        <p id="account-status" role="status" class="estimate-note"></p>
    </div>`;
}

function bindAuthCard() {
    document.querySelectorAll('[data-auth-open]').forEach(button=>button.onclick=()=>openAuth(button.dataset.authOpen));
    const out=$('#account-signout');
    if(out)out.onclick=async()=>{
        if(out.disabled)return;
        out.disabled=true;
        try {await nakgoAuth.signOut();toast('Hesabından çıkış yapıldı');}
        catch(error){const status=$('#account-status');if(status)status.textContent=nakgoAuth.message(error);out.disabled=false;}
    };
}

function openAuth(kind='signin') {
    const s=nakgoAuth.snapshot(), B=$('#sheetBody');
    if(!s.ready)return;
    if(!['signin','signup','recover','password','profile'].includes(kind))return;
    if(kind==='password'&&(!s.user||!s.recovery))return;
    if(kind==='profile'&&!s.user)return;
    const titles={signin:'Giriş yap',signup:'Kayıt ol',recover:'Şifremi unuttum',password:'Yeni şifre belirle',profile:'Hesap bilgileri'};
    const submit={signin:'Giriş yap',signup:'Hesap oluştur',recover:'Sıfırlama bağlantısı gönder',password:'Şifreyi güncelle',profile:'Kaydet'};
    const email=['signin','signup','recover'].includes(kind), password=['signin','signup','password'].includes(kind), details=['signup','profile'].includes(kind);
    B.dataset.k='auth';
    const entry=kind!=='profile';
    const intro={signin:'Yola kaldığın yerden devam et.',signup:'Yükün de yolun da burada buluşsun.',recover:'E-postandaki bağlantıyı bu tarayıcıda aç.',password:'Şifren güncellendikten sonra tekrar giriş yapacaksın.',profile:'NakGo geliştirme hesabı. Demo kayıtları hesabına aktarılmaz.'};
    B.innerHTML=`${entry?`<div class="auth-screen"><section class="auth-paper"><div class="auth-topline"><div class="auth-brand"><img src="icons/brand-logo.png" alt="" width="48" height="48"><span>NakGo<small>Biz bu işin NakGo'suyuz</small></span></div><button class="auth-close" id="close" aria-label="Kapat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>`:''}
        <h2>${titles[kind]}</h2><p class="${entry?'auth-intro':'estimate-note'}">${intro[kind]}</p>
        <form id="account-form">
        ${details?`<label for="account-name">Adın / firma adı</label><input id="account-name" autocomplete="name" required maxlength="60" value="${kind==='profile'?esc(s.profile?.display_name||''):''}">
        <label for="account-type">Hesap türü</label><select id="account-type"><option value="carrier">Taşıyıcı</option><option value="owner" ${s.profile?.account_type==='owner'?'selected':''}>Yük sahibi</option></select>`:''}
        ${email?'<label for="account-email">E-posta</label><input id="account-email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" required maxlength="254">':''}
        ${password?`<label for="account-password">Şifre${kind==='signin'?'':' · en az 10 karakter'}</label><input id="account-password" type="password" autocomplete="${kind==='signin'?'current-password':'new-password'}" required minlength="${kind==='signin'?1:10}" maxlength="128">`:''}
        ${kind==='password'||kind==='signup'?'<label for="account-repeat">Şifre tekrar</label><input id="account-repeat" type="password" autocomplete="new-password" required minlength="10" maxlength="128">':''}
        <p id="account-feedback" role="status" aria-live="polite" class="estimate-note"></p>
        <button type="submit" class="btn" id="account-submit">${submit[kind]}</button>
        </form>
        ${kind==='signin'?'<button class="auth-forgot" id="account-forgot">Şifremi unuttum</button>':''}
        ${entry?`</section><section class="auth-bottom">
            ${kind==='signin'||kind==='signup'?`<div class="auth-divider"><span>veya</span></div><div class="auth-methods" aria-label="Diğer giriş yöntemleri">
            <button type="button" class="auth-provider" id="account-google"><span class="auth-provider-symbol" aria-hidden="true">G</span><span>Google ile devam et</span></button>
            <button type="button" class="auth-provider" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 3c-1.4.1-3 1-3.8 2-.7.8-1.2 2-1 3.2 1.5.1 3-.7 3.9-1.8.8-.9 1.2-2.2.9-3.4ZM20 16.3c-.4 1-1 2.3-1.8 3.4-.8 1-1.7 2.1-3 2.1-1.2 0-1.6-.8-3.1-.8-1.6 0-2 .8-3.2.8-1.3 0-2.2-1.1-3-2.2C3.5 16.4 3 11.8 4.5 9.5c1-1.6 2.6-2.5 4.1-2.5 1.3 0 2.4.8 3.2.8.7 0 2-.9 3.5-.8 1.3.1 2.6.8 3.4 1.9-3 1.6-2.5 5.8 1.3 7.4Z"/></svg><span>Apple ile devam et</span><small>Yakında</small></button></div>
            <p class="auth-switch-copy">${kind==='signin'?'Henüz hesabın yok mu?':'Zaten hesabın var mı?'}</p><button class="btn auth-switch" id="${kind==='signin'?'account-register':'account-back'}">${kind==='signin'?'Kayıt ol':'Giriş yap'}</button>`:
            '<p class="auth-switch-copy">Hesabına dönmeye hazır mısın?</p><button class="btn auth-switch" id="account-back">Giriş yap</button>'}
            <p class="auth-preview-note">Test sürümü · E-posta ve Google ile giriş açık.<br>İlanlar ve mesajlar henüz demo.</p>
        </section></div>`:'<button class="btn alt" id="close">Kapat</button>'}`;
    const form=$('#account-form'), feedback=$('#account-feedback'), button=$('#account-submit');
    const google=$('#account-google');
    if(google)google.onclick=async()=>{
        if(google.disabled||button.disabled)return;
        google.disabled=true;button.disabled=true;feedback.textContent='Google’a yönlendiriliyorsun…';
        try {await nakgoAuth.signInGoogle();}
        catch(error) {
            if(!form.isConnected)return;
            feedback.textContent=nakgoAuth.message(error);google.disabled=false;button.disabled=false;
        }
    };
    $('#close').onclick=closeSheet;
    if(kind==='signin') {$('#account-forgot').onclick=()=>openAuth('recover');$('#account-register').onclick=()=>openAuth('signup');}
    if($('#account-back'))$('#account-back').onclick=()=>openAuth('signin');
    form.onsubmit=async event=>{
        event.preventDefault();
        if(button.disabled||!form.reportValidity())return;
        const address=email?$('#account-email').value.trim():'', secret=password?$('#account-password').value:'';
        const repeat=$('#account-repeat');
        if(repeat&&repeat.value!==secret){feedback.textContent='Şifreler aynı olmalı.';return;}
        const name=details?$('#account-name').value.trim():'', accountType=details?$('#account-type').value:'';
        if(details&&!name){feedback.textContent='Adını veya firma adını gir.';return;}
        button.disabled=true;if(google)google.disabled=true;feedback.textContent='İşlem yapılıyor…';
        try {
            let notice='';
            if(kind==='signin'){await nakgoAuth.signIn(address,secret);notice='Giriş yapıldı';}
            if(kind==='signup'){
                const signedIn=await nakgoAuth.signUp(address,secret,name,accountType);
                notice=signedIn?'Hesabın hazır':'Adres uygunsa doğrulama e-postası gönderildi. Bağlantıyı bu tarayıcıda aç; ardından giriş yap.';
            }
            if(kind==='recover'){await nakgoAuth.recover(address);notice='Adres kayıtlıysa sıfırlama bağlantısı gönderildi. E-postanı ve spam klasörünü kontrol et. Bağlantıyı bu tarayıcıda aç.';}
            if(kind==='password'){await nakgoAuth.password(secret);notice='Şifren güncellendi. Yeni şifrenle giriş yap.';}
            if(kind==='profile'){await nakgoAuth.saveProfile(name,accountType);notice='Hesap bilgilerin kaydedildi';}
            if(!form.isConnected)return;
            if(['signup','recover'].includes(kind)) {form.reset();feedback.textContent=notice;button.textContent='Gönderildi';}
            else {closeSheet();render();toast(notice);}
        } catch(error) {
            if(!form.isConnected)return;
            feedback.textContent=nakgoAuth.message(error);button.disabled=false;if(google)google.disabled=false;
        }
    };
    $('#sheet').classList.add('open');
}

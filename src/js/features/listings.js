/**
 * İlan listesi ve ilanlarım
 * Liste kartları, filtre, sıralama, yakınımda, karşılaştırma, ilan yönetimi; kendi ilanlarını düzenleme, kapatma ve silme.
 */

// ===== İlan listesi =====
// Liste kartları, filtre, sıralama, yakınımda, iki ilanı karşılaştırma, piyasa fiyatı.

function F0() {
    return { veh: [], body: [], date: [], from: "", to: "", tonMin: "", tonMax: "", rate: 0, fav: false, ok: false };
}

function routeSearch() {
    const field = (key, label) => `<div><label for="route-${key}">${label}</label><select id="route-${key}" data-route="${key}"><option value="">Tüm şehirler</option>${cities.map(c => `<option value="${c}" ${F[key] === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>`;
    return `<section class="route-search" aria-labelledby="route-heading"><div class="route-search-heading"><span class="eyebrow">${mode === "truck" ? "BOŞ ARAÇLARI KEŞFET" : "YÜKLERİ KEŞFET"}</span><h2 id="route-heading">Rotanı seç, <em>yola çık.</em></h2></div><div class="route-fields">${field("from", "Nereden?")}<button class="route-swap" id="route-swap" aria-label="Çıkış ve varış şehirlerini değiştir" title="Güzergâhı ters çevir">⇄</button>${field("to", "Nereye?")}</div></section>`;
}

function match(x, isT) {
    if (F.veh.length && !F.veh.includes(x.veh))
        return 0;
    if (F.body.length && !F.body.includes(x.body))
        return 0;
    if (F.from && x.from !== F.from)
        return 0;
    if (F.to && x.to !== F.to)
        return 0;
    const t = isT ? x.cap : x.ton;
    if (F.tonMin !== "" && t < +F.tonMin)
        return 0;
    if (F.tonMax !== "" && t > +F.tonMax)
        return 0;
    if (F.date.length && !F.date.includes(dateBucket(x)))
        return 0;
    const rr = x.uid && ratingOf(x.uid) ? ratingOf(x.uid).avg : x.rate;
    if (F.rate && !(rr >= F.rate))
        return 0;
    if (F.fav && !favs.includes(String(x.id)))
        return 0;
    if (F.ok && isT && !vok(x))
        return 0;
return 1;
}

function fcount() {
    return ["veh", "body", "date"].filter(k => F[k].length).length + (F.from ? 1 : 0) + (F.to ? 1 : 0) + ((F.tonMin !== "" || F.tonMax !== "") ? 1 : 0) + (F.rate ? 1 : 0) + (F.fav ? 1 : 0) + (F.ok ? 1 : 0);
}

function activeChips() {
    const a = [];
    ["veh", "body", "date"].forEach(k => F[k].forEach(v => a.push([k, v, v])));
    if (F.from)
        a.push(["from", "", "Çıkış: " + F.from]);
    if (F.to)
        a.push(["to", "", "Varış: " + F.to]);
    if (F.tonMin !== "" || F.tonMax !== "")
        a.push(["ton", "", (F.tonMin || 0) + "–" + (F.tonMax || "∞") + " ton"]);
    if (F.rate)
        a.push(["rate", "", "★ " + F.rate + "+"]);
    if (F.fav)
        a.push(["fav", "", "♥ Kayıtlılar"]);
    if (F.ok)
        a.push(["ok", "", "✓ Belgeli"]);
    return a;
}

function rmF(k, v) {
    if (Array.isArray(F[k]))
        F[k] = F[k].filter(x => x !== v);
    else if (k === "ton") {
        F.tonMin = F.tonMax = "";
    }
    else
        F[k] = k === "rate" ? 0 : "";
    render();
}

const routeTitle = x => `<div class="route route-title"><span>${esc(x.from)}</span><i aria-hidden="true"></i><span>${esc(x.to)}</span></div>`;

const cardRoute = x => `<div class="card-route"><div><small>Nereden</small><b>${esc(x.from)}</b></div><i aria-hidden="true"></i><div><small>Nereye</small><b>${esc(x.to)}</b></div></div>`;
const cargoIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/></svg>`;

const lCard = l => `<article class="load ${isF(l) ? "feat" : ""}" data-id="${esc(l.id)}" role="button" tabindex="0" aria-label="${esc(l.from)} → ${esc(l.to)}, ${esc(l.ton)} ton yük, ilanı aç">
    ${isF(l) ? `<div class="listing-label"><span class="tag ft">Öne çıkan${isDemoFeature(l) ? ' · Örnek' : ''}</span></div>` : ""}<div class="card-main contact-card">${cardRoute(l)}<div class="card-contact"><span>${l._remote?"İlan detayları":"Doğrudan görüş"}</span><b>${l._remote?"Yük bilgilerini incele":"Ara veya mesajlaş"}</b></div></div>
    <div class="cargo-line">${imgOk(l.img) ? `<img class="th" src="${l.img}" alt="Yük fotoğrafı">` : `<span class="cargo-icon">${cargoIcon}</span>`}<span><b>${esc(l.cargo)}</b>${Array.isArray(l.items) && l.items.length ? " · " + l.items.length + " kalem" : ""}</span><span class="cargo-ton"><b>${esc(l.ton)}</b> ton</span></div>
    <div class="listing-spec"><span>${esc(l.veh)} · ${esc(l.body || "Kasa belirtilmedi")}</span><span class="load-date">Yükleme: <b>${esc(dateLabel(l))}</b></span></div>
    <div class="listing-footer"><span class="listing-trust">${starTxt(l)}${vbadge(l.uid ? lvU(l.uid) : 0)}<span>${nearTxt(l)}${l.km ? "≈ " + l.km + " km" : ""}${ago(l) ? " · " + ago(l) : ""}</span></span><button type="button" aria-label="${favs.includes(String(l.id)) ? "Kaydı kaldır" : "Kaydet"}" aria-pressed="${favs.includes(String(l.id))}" class="fav ${favs.includes(String(l.id)) ? "on" : ""}" data-fav="${esc(l.id)}">${favs.includes(String(l.id)) ? "♥" : "♡"}</button></div>
    </article>`;

const tCard = t => `<article class="load ${isF(t) ? "feat" : ""}" data-tid="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(t.from)} → ${esc(t.to)}, ${esc(t.cap)} ton boş araç, ilanı aç">${isF(t) ? '<div class="listing-label"><span class="tag ft">Öne çıkan</span></div>' : ""}<div class="card-main">${cardRoute(t)}<div class="capacity-summary"><span>Boş kapasite</span><strong class="capacity-value">${esc(t.cap)}<small> ton</small></strong></div></div><div class="cargo-line"><span class="cargo-icon">${cargoIcon}</span><span><b>${esc(t.who || nm(t.uid))}</b>${vbadge(lvT(t))}</span></div><div class="listing-spec"><span>${esc(t.veh)} · ${esc(t.body)}</span><span>Müsait: <b>${esc(dateLabel(t))}</b></span></div><div class="listing-footer"><span class="listing-trust">${starTxt(t)}<span>${nearTxt(t)}</span></span><button type="button" aria-label="${favs.includes(String(t.id)) ? "Kaydı kaldır" : "Kaydet"}" aria-pressed="${favs.includes(String(t.id))}" class="fav ${favs.includes(String(t.id)) ? "on" : ""}" data-fav="${esc(t.id)}">${favs.includes(String(t.id)) ? "♥" : "♡"}</button></div></article>`;

function openFilter() {
    const isT = mode === "truck", B = $("#sheetBody");
    const cnt = () => (isT ? trucks : loads).filter(x => visibleListing(x, isT)).length;
    const grp = (k, t, o) => `<label>${t}</label><div class="chips wrap">${o.map(v => `<button class="chip ${F[k].includes(v) ? "on" : ""}" data-g="${k}" data-v="${v}">${v}</button>`).join("")}</div>`;
    const sel = (k, t, o) => `<div><label>${t}</label><select data-s="${k}"><option value="">Hepsi</option>${o.map(c => `<option ${F[k] === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>`;
    B.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">Filtrele</b><button class="chip" id="fr">Sıfırla</button></div>`
        + grp("veh", "Araç tipi", vehicles) + grp("body", "Kasa tipi", bodies)
        + `<div class="row">${sel("from", "Nereden", cities)}${sel("to", "Nereye", cities)}</div>`
        + `<div class="row"><div><label>${isT ? "Boş kapasite" : "Yük"}: en az (ton)</label><input data-n="tonMin" type="number" inputmode="decimal" value="${F.tonMin}"></div><div><label>En çok (ton)</label><input data-n="tonMax" type="number" inputmode="decimal" value="${F.tonMax}"></div></div>`
        + grp("date", "Yükleme günü", ["Bugün", "Yarın", "İleri tarih"])
        + `<label>Kayıtlılar</label><div class="chips"><button class="chip ${F.fav ? "on" : ""}" id="ff">♥ Sadece kayıtlı olanlar</button>${isT ? `<button class="chip ${F.ok ? "on" : ""}" id="fo">✓ Sadece belgeli taşıyıcılar</button>` : ""}</div><label>Puan</label><div class="chips">${[[0, "Hepsi"], [4.5, "★ 4.5+"], [4.8, "★ 4.8+"]].map(([v, t]) => `<button class="chip ${F.rate === v ? "on" : ""}" data-r="${v}">${t}</button>`).join("")}</div><button class="btn" id="fs" style="position:sticky;bottom:0"></button>`;
    const upd = () => {
        $("#fs").textContent = cnt() + (isT ? " boş aracı göster" : " ilanı göster");
    };
    B.querySelectorAll("[data-g]").forEach(b => b.onclick = () => {
        tog(F[b.dataset.g], b.dataset.v);
        b.classList.toggle("on");
        upd();
    });
    B.querySelectorAll("[data-s]").forEach(e => e.onchange = () => {
        F[e.dataset.s] = e.value;
        upd();
    });
    B.querySelectorAll("[data-n]").forEach(e => e.oninput = () => {
        F[e.dataset.n] = e.value;
        upd();
    });
    B.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
        F.rate = +b.dataset.r;
        B.querySelectorAll("[data-r]").forEach(x => x.classList.toggle("on", x === b));
        upd();
    });
    if ($("#fo"))
        $("#fo").onclick = e => {
            F.ok = !F.ok;
            e.currentTarget.classList.toggle("on", F.ok);
            upd();
        };
    $("#ff").onclick = e => {
        F.fav = !F.fav;
        e.currentTarget.classList.toggle("on", F.fav);
        upd();
    };
    $("#fr").onclick = () => {
        F = F0();
        openFilter();
    };
    $("#fs").onclick = () => {
        closeSheet();
        render();
    };
    upd();
    $("#sheet").classList.add("open");
}

const dKm = x => myPos && LL[x.from] ? hav(myPos, LL[x.from]) : 9e9;

const nearTxt = x => nearOn && myPos && LL[x.from] ? `<b>Sana ${Math.round(dKm(x))} km</b> · ` : "";

function toggleNear() {
    if (nearOn) {
        nearOn = false;
        render();
        return;
    }
    if (myPos) {
        nearOn = true;
        render();
        return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation)
        return toast("Bu cihaz konumu desteklemiyor");
    toast("Konum alınıyor...");
    navigator.geolocation.getCurrentPosition(p => {
        myPos = [p.coords.longitude, p.coords.latitude];
        myCity = nearestCity(myPos);
        nearOn = true;
        render();
        toast("Konumun: " + myCity + " civarı");
    }, e => toast(e && e.code === 1 ? "Konum izni verilmedi. Tarayıcı ayarlarından izin verebilirsin." : "Konum alınamadı"), { timeout: 10000, maximumAge: 600000 });
}

const nearRow = () => nearOn ? `<div class="chips" aria-label="Yakınlık mesafesi">${[100, 250, 500, 0].map(k => `<button class="chip ${nearR === k ? "on" : ""}" data-nr="${k}">${k ? k + " km" : "Tümü"}</button>`).join("")}</div>` : "";

function toggleCmp(id) {
    const i = cmp.indexOf(id);
    if (i >= 0)
        cmp.splice(i, 1);
    else {
        cmp.push(id);
        if (cmp.length > 2)
            cmp.shift();
    }
    closeSheet();
    render();
    toast(i >= 0 ? "Karşılaştırmadan çıkarıldı" : cmp.length === 2 ? "2 ilan seçildi, Karşılaştır'a dokun" : "1 ilan seçildi, bir tane daha seç");
}

const cmpBar = () => cmp.length ? `<div class="cmpbar"><span>${cmp.length} ilan seçildi</span><span style="display:flex;gap:6px"><button class="chip" id="cmpx">Temizle</button>${cmp.length === 2 ? '<button class="chip on" id="cmpgo">Karşılaştır</button>' : ""}</span></div>` : "";

function openCompare() {
    const L = cmp.map(id => loads.find(x => x.id === id)).filter(Boolean);
    if (L.length < 2)
        return toast("İki ilan seç");
    const B = $("#sheetBody");
    B.dataset.k = "";
    const km = l => l.km || dist(l.from, l.to);
    const rows = [["Yük", l => esc(l.cargo), null], ["Ağırlık", l => esc(l.ton) + " ton", null], ["Araç", l => esc(l.veh + " · " + (l.body || "—")), null], ["Mesafe", l => km(l) ? km(l) + " km" : "—", l => -km(l)], ["Yükleme", l => esc(dateLabel(l)), null], ["Puan", l => starTxt(l), rv]];
    const cell = (i, rw) => {
        const g = rw[1], sc = rw[2], win = sc && sc(L[0]) !== sc(L[1]) && sc(L[i]) === Math.max(sc(L[0]), sc(L[1]));
        return `<div class="${win ? "win" : ""}">${g(L[i])}</div>`;
    };
    B.innerHTML = `<b style="font-size:19px">İlanları karşılaştır</b><div class="cmp"><div></div>${L.map(l => `<div class="ch">${esc(l.from)}<br>→ ${esc(l.to)}</div>`).join("")}${rows.map(rw => `<div class="rl">${rw[0]}</div>${cell(0, rw)}${cell(1, rw)}`).join("")}</div><div class="row" style="margin-top:14px">${L.map(l => `<button class="chip" data-gl="${esc(l.id)}">İlana git</button>`).join("")}</div><button class="btn alt" id="close">Kapat</button>`;
    B.querySelectorAll("[data-gl]").forEach(b => b.onclick = () => openLoad(+b.dataset.gl));
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

const sortL = a => sort === "km" ? [...a].sort((x, y) => (listingDistance(x) || 9e9) - (listingDistance(y) || 9e9)) : sort === "rate" ? [...a].sort((x, y) => rv(y) - rv(x)) : a;

// ===== İlanlarım =====
// Kendi ilanlarını ve boş araçlarını düzenleme, kapatma, silme, ilan verirken kalem ve süre yardımcıları.

function postTruck(t) {
    if(nakgoMarket.active())return nakgoMarket.pending();
    const error = postError(t, true);
    if (error) { toast(error); return false; }
    Object.assign(t, dateFields(t.date), {ts:Date.now()});
    if (myCar.phone)
        t.phone = myCar.phone;
    if (cloud) {
        t.uid = me;
        t.ts = Date.now();
        delete t.who;
        dbw(db.doc("trucks/" + t.id).set(t));
    }
    if (!cloud)
        t.mine = true;
    trucks.unshift(t);
    return save();
}

const mineL = () => loads.filter(l => cloud ? l.uid === me : l.mine);

const mineT = () => trucks.filter(t => cloud ? t.uid === me : t.mine);

const findIt = (k, id) => (k === "l" ? loads : trucks).find(x => String(x.id) === String(id));

function patchIt(k, id, patch) {
    if(nakgoMarket.active())return nakgoMarket.update(k,id,patch).catch(e=>{toast(nakgoAuth.message(e));return false;});
    const it = findIt(k, id);
    if (!it)
        return;
    Object.assign(it, patch);
    if (!save()) return false;
    if (cloud)
        dbw(db.doc((k === "l" ? "loads/" : "trucks/") + id).update(patch));
    render();
    return true;
}

function openEdit(k, id, reopen=false) {
    const it = findIt(k, id);
    if (!it)
        return;
    const B = $("#sheetBody"), L = k === "l";
    B.dataset.k = "";
    B.innerHTML = `<b style="font-size:19px">İlanı düzenle</b><div class="route" style="margin-top:10px">${esc(it.from)}<i></i>${esc(it.to)}</div>${L ? "" : `<label>Boş kapasite (ton)</label><input id="ep" type="number" inputmode="decimal" value="${esc(it.cap)}">`}<label>${L ? "Yükleme günü" : "Müsait olduğun gün"}</label><select id="ed">${[...new Set(["Bugün", "Yarın", "Bu hafta", it.date])].map(d => `<option ${it.date === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>${L ? `<label>Not</label><textarea id="en" maxlength="1000" rows="3">${esc(it.note || "")}</textarea>` : ""}<button class="btn" id="es">Kaydet</button><button class="btn alt" id="close">Vazgeç</button>`;
    $("#es").onclick = async () => {
        const v = L ? 0 : +$("#ep").value;
        if (!L && !positiveAmount(v))
            return toast("Geçerli bir değer gir");
        const patch = L ? { date: $("#ed").value, note: $("#en").value.trim().slice(0, 1000) } : { cap: v, date: $("#ed").value };
        const selectedDate=$("#ed").value;
        if (!postDateOK(selectedDate)) return toast("Geçerli bir tarih seç");
        if (selectedDate !== it.date) Object.assign(patch,dateFields(selectedDate));
        if (reopen) {
            const end = selectedDate === it.date ? (it.dateEnd||it.date) : (patch.dateEnd||patch.date);
            if (end<localDay()) return toast("Yeniden açmak için güncel bir yükleme tarihi seç");
            Object.assign(patch,{closed:false,ts:Date.now()});
        }
        const button=$('#es'); if(nakgoMarket.active()){if(button.disabled)return;button.disabled=true;}
        const result=patchIt(k,id,patch);
        if (!(result && typeof result.then==='function' ? await result : result)) {button.disabled=false;return;}
        closeSheet();
        toast("İlan güncellendi");
    };
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

function askDel(k, id) {
    const it = findIt(k, id);
    if (!it)
        return;
    const B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<b style="font-size:19px">İlan silinsin mi?</b><div class="route" style="margin-top:10px">${esc(it.from)}<i></i>${esc(it.to)}</div><p style="margin-top:10px;font-size:14px;color:var(--mute)">${nakgoMarket.active()?"İlan yayından kaldırılır ve arşivlenir.":"Bu işlem geri alınamaz."}</p><button class="btn" id="yes">Evet, sil</button><button class="btn alt" id="close">Vazgeç</button>`;
    $("#yes").onclick = async () => {
        if(nakgoMarket.active()) {
            const button=$("#yes"); if(button.disabled)return; button.disabled=true;
            if(!await patchIt(k,id,{archived:true})){button.disabled=false;return;}
            closeSheet();toast("İlan yayından kaldırıldı");return;
        }
        if (cloud)
            dbw(db.doc((k === "l" ? "loads/" : "trucks/") + id).delete());
        if (k === "l")
            loads = loads.filter(x => String(x.id) !== String(id));
        else
            trucks = trucks.filter(x => String(x.id) !== String(id));
        if (!save()) return;
        closeSheet();
        render();
        toast("İlan silindi");
    };
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

const myListHTML = () => {
    const a = [...mineL().map(l => ({ k: "l", id: l.id, r: l.from + " → " + l.to, v: l.ton + " ton", c: l.closed || expired(l, "load"), s: statLine(l), ff: isF(l) ? Math.max(1, Math.ceil((l.featUntil - Date.now()) / 36e5)) : 0 })), ...mineT().map(t => ({ k: "t", id: t.id, r: t.from + " → " + t.to, v: t.cap + " ton", c: t.closed || expired(t, "truck"), ff: isF(t) ? Math.max(1, Math.ceil((t.featUntil - Date.now()) / 36e5)) : 0 }))];
    return `<div class="load" style="cursor:default"><b>İlanlarım</b>${a.length ? a.map(x => `<div class="kv" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${esc(x.r)}</b><span>${esc(x.v)}</span></div>${x.s ? `<div style="font-size:12.5px;color:var(--mute);margin-top:4px">${x.s}</div>` : ""}<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center"><span class="tag">${x.k === "l" ? "Yük" : "Boş araç"}${x.c ? " · kapalı" : ""}${x.ff ? ` · öne çıkan (${x.ff} sa)` : ""}</span><button class="chip" data-me="${x.k}|${esc(x.id)}">Düzenle</button>${x.k === "l" && !nakgoMarket.active() ? `<button class="chip" data-st2="${esc(x.id)}">İstatistik</button>` : ""}${!x.c ? `<button class="chip" data-ft="${x.k}|${esc(x.id)}">${x.ff ? "Uzat" : "Öne çıkar"}</button>` : ""}<button class="chip" data-mc="${x.k}|${esc(x.id)}">${x.c ? "Yeniden aç" : "Kapat"}</button><button class="chip" data-md2="${x.k}|${esc(x.id)}">Sil</button></div></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Henüz ilan vermedin. İlan ver sekmesinden ekleyebilirsin.</p>`}</div>`;
};

const itemsTxt = l => (Array.isArray(l.items) ? l.items : []).slice(0, 6).map(i => esc(i.n) + " " + (+i.q || 0) + " " + esc(i.u)).join(", ");

function itemsUI() {
    const box = $("#its");
    if (!box)
        return;
    postImg = "";
    const add = () => {
        if (box.children.length >= 6)
            return toast("En fazla 6 kalem");
        const d = document.createElement("div");
        d.className = "itrow";
        d.innerHTML = `<input data-in placeholder="Kalem" maxlength="40"><input data-iq type="number" min="0" step="any" inputmode="decimal" placeholder="Miktar"><select data-iu>${ITEM_UNITS.map(u => `<option>${u}</option>`).join("")}</select><button class="chip" type="button" data-ix aria-label="Kaldır">×</button>`;
        box.appendChild(d);
        d.querySelector("[data-ix]").onclick = () => { d.remove(); capturePostDraft(); };
    };
    $("#addit").onclick = add;
    $("#ph").onclick = () => {
        const preview = $("#phs");
        pickImg(u => {
            // Fotoğraf hazırlanırken başka forma geçildiyse yeni taslağa yazma.
            if (tab !== "post" || postMode !== "load" || $("#phs") !== preview) return;
            postImg = u;
            preview.innerHTML = `<img class="th" src="${u}" alt="Yük fotoğrafı">`;
            capturePostDraft();
        }, 200, 22000);
    };
}

const expired = (x, k) => !!(!x._remote && x.ts && Date.now()-x.ts>TTL[k]*864e5) || (validDay(x.date) && (validDay(x.dateEnd)?x.dateEnd:x.date)<localDay());
const availableListing = (x,isT=false) => !!x && !x.archived && !x.closed && !expired(x,isT?"truck":"load") && !(x.uid && blocked.includes(x.uid));
const visibleListing = (x,isT=false) => availableListing(x,isT) && (!nearOn || !nearR || dKm(x)<=nearR) && match(x,isT) && (!q || (x.from+" "+x.to+" "+(x.cargo||x.who||"")).toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
function contactAllowed(x,isT=false,allowOwn=false) {
    if(nakgoMarket.active())return nakgoMarket.pending();
    const current=x&&findIt(isT?"t":"l",x.id);
    if(!availableListing(current,isT)) { toast("Bu ilan artık açık değil. Yeni iletişim başlatılamaz."); return false; }
    if(!allowOwn && ((cloud && current.uid===me)||(!cloud&&current.mine))) { toast("Kendi ilanına mesaj gönderemezsin"); return false; }
    return true;
}

const ago = x => {
    if (!x.ts)
        return "";
    const d = Math.floor((Date.now() - x.ts) / 864e5);
    return d < 1 ? "bugün eklendi" : d + " gün önce";
};

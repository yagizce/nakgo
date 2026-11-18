/**
 * İlan listesi ve ilanlarım
 * Liste kartları, filtre, sıralama, yakınımda, ilan yönetimi; kendi ilanlarını düzenleme, kapatma ve silme.
 */

// ===== İlan listesi =====
// Liste kartları, filtre, sıralama, yakınımda.

function F0() {
    return { veh: [], body: [], date: [], from: "", to: "", tonMin: "", tonMax: "", fav: false };
}

function routeSearch() {
    const field = (key, label) => `<div><label for="route-${key}">${label}</label><select id="route-${key}" data-route="${key}"><option value="">Tüm şehirler</option>${cities.map(c => `<option value="${c}" ${F[key] === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>`;
    return `<section class="route-search" aria-labelledby="route-heading"><div class="route-search-heading"><span class="eyebrow">${mode === "truck" ? "BOŞ ARAÇLARI KEŞFET" : "YÜKLERİ KEŞFET"}</span><h2 id="route-heading">Rotanı seç, <em>yola çık.</em></h2></div><div class="route-fields">${field("from", "Nereden?")}<button class="route-swap" id="route-swap" aria-label="Çıkış ve varış şehirlerini değiştir" title="Güzergâhı ters çevir">⇄</button>${field("to", "Nereye?")}</div></section>`;
}

const isFavorite=x=>nakgoMarket.active()?nakgoFavorites.has(x.remoteId):favs.includes(String(x.id));
const favoriteDisabled=x=>nakgoMarket.active()&&nakgoFavorites.disabled(x.remoteId)?' disabled':'';
const listingSource=isT=>nakgoMarket.active()&&F.fav?nakgoFavorites.listings().filter(x=>(typeof x.id==='string')===isT):(isT?trucks:loads);
async function changeAccountFavorite(id,saved) {
    const account=nakgoMarket.token();
    try {const result=await nakgoFavorites.setSaved(id,saved);if(result)toast(saved?'İlan hesabına kaydedildi':'İlan kaydın kaldırıldı');}
    catch(e){if(account===nakgoMarket.token())toast('Kaydın değiştirilemedi. Bağlantını kontrol edip tekrar dene.');}
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
    if (F.fav && !isFavorite(x))
        return 0;
return 1;
}

function fcount() {
    return ["veh", "body", "date"].filter(k => F[k].length).length + (F.from ? 1 : 0) + (F.to ? 1 : 0) + ((F.tonMin !== "" || F.tonMax !== "") ? 1 : 0) + (F.fav ? 1 : 0);
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
    if (F.fav)
        a.push(["fav", "", "♥ Kayıtlılar"]);
    return a;
}

function rmF(k, v) {
    if (Array.isArray(F[k]))
        F[k] = F[k].filter(x => x !== v);
    else if (k === "ton") {
        F.tonMin = F.tonMax = "";
    }
    else
        F[k] = "";
    render();
}

const place = (city, district) => esc(city) + (district ? `<small class="district">${esc(district)}</small>` : "");
const routeText = x => [[x.from, x.fromD], [x.to, x.toD]].map(([c, d]) => d ? `${c} (${d})` : c).join(" → ");
const routeHTML = x => `${place(x.from, x.fromD)}<i></i>${place(x.to, x.toD)}`;
const routeTitle = x => `<div class="route route-title"><span>${place(x.from, x.fromD)}</span><i aria-hidden="true"></i><span>${place(x.to, x.toD)}</span></div>`;

const cardRoute = x => `<div class="card-route"><div><small>Nereden</small><b>${place(x.from, x.fromD)}</b></div><i aria-hidden="true"></i><div><small>Nereye</small><b>${place(x.to, x.toD)}</b></div></div>`;
const cargoIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/></svg>`;

// Liste kartı (taslak): üstte rozet, süre ve mesafe; ortada güzergâh, yük ve ton; altta araç, tarih ve kaydet.
const favBtn = x => `<button type="button" aria-label="${isFavorite(x) ? "Kaydı kaldır" : "Kaydet"}" aria-pressed="${isFavorite(x)}" class="fav ${isFavorite(x) ? "on" : ""}" data-fav="${esc(x.id)}"${favoriteDisabled(x)}>${isFavorite(x) ? "♥" : "♡"}</button>`;
// Bugün yüklenecek yük: tarihi bugün seçilmiş ya da yükleme metni (WhatsApp'tan gelen gibi) bugünü yazan ilan.
// Metinde "bugün" yazıyorsa ilan bugün yayınlanmış olmalı; "16.11.2026" gibi yazılan tarih doğrudan bugünle karşılaştırılır.
const textDay = text => {
    const m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text);
    return m ? [m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")].join("-") : "";
};
const loadsToday = x => {
    if (dateBucket(x) === "Bugün") return true;
    if (typeof x.dateText !== "string") return false;
    const text = x.dateText.toLocaleLowerCase("tr");
    return textDay(text) === localDay() || (text.includes("bugün") && !!x.ts && localDay(x.ts) === localDay());
};
const TODAY_BADGE = `<span class="tag today">${CLOCK_ICON}Bugün yükleniyor</span>`;
const cardTop = (x, label, km, today) => `<div class="card-top">${label ? `<span class="tag ft">${label}</span>` : ""}${today ? TODAY_BADGE : ""}<span>${nearTxt(x)}${x.ts ? `<time title="${postedAt(x)}">${ago(x)}</time>` : ""}</span>${km ? `<span class="card-km">${km}</span>` : ""}</div>`;

const lCard = l => `<article class="load ${isF(l) ? "feat" : ""}" data-id="${esc(l.id)}" role="button" tabindex="0" aria-label="${esc(l.from)} → ${esc(l.to)}, ${esc(l.ton)} ton yük, ilanı aç">
    ${cardTop(l, isF(l) ? "Öne çıkan" + (isDemoFeature(l) ? " · Örnek" : "") : "", l.km ? esc(l.km) + " km" : "", loadsToday(l))}<div class="card-main contact-card">${cardRoute(l)}<div class="card-contact"><span>${l._remote?"İlan detayları":"Doğrudan görüş"}</span><b>${l._remote?"Yük bilgilerini incele":"Ara veya mesajlaş"}</b></div></div>
    <div class="cargo-line">${imgOk(l.img) ? `<img class="th" src="${l.img}" alt="Yük fotoğrafı">` : l.hasPhoto ? `<span class="tag">Fotoğraflı</span>` : ""}<span><b>${esc(l.cargo)}</b>${Array.isArray(l.items) && l.items.length ? " · +" + l.items.length + " kalem" : ""}</span><span class="cargo-ton"><b>${esc(l.ton)}</b> ton</span></div>
    <div class="listing-spec"><span>${TRUCK_ICON}${esc(l.veh)} · ${esc(l.body || "Kasa belirtilmedi")}</span><span class="load-date">${CAL_ICON}<span class="sr-only">Yükleme: </span>${esc(dateLabel(l))}</span>${favBtn(l)}</div>
    </article>`;

const tCard = t => `<article class="load ${isF(t) ? "feat" : ""}" data-tid="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(t.from)} → ${esc(t.to)}, ${esc(t.cap)} ton boş araç, ilanı aç">${cardTop(t, isF(t) ? "Öne çıkan" : "", "")}<div class="card-main contact-card">${cardRoute(t)}</div><div class="cargo-line"><span><b>${esc(t.who || nm(t.uid))}</b></span><span class="cargo-ton"><b>${esc(t.cap)}</b> ton boş</span></div><div class="listing-spec"><span>${TRUCK_ICON}${esc(t.veh)} · ${esc(t.body)}</span><span class="load-date">${CAL_ICON}<span class="sr-only">Müsait: </span>${esc(dateLabel(t))}</span>${favBtn(t)}</div></article>`;

function openFilter() {
    const isT = mode === "truck", B = $("#sheetBody");
    const cnt = () => listingSource(isT).filter(x => visibleListing(x, isT)).length;
    const grp = (k, t, o) => `<label>${t}</label><div class="chips wrap">${o.map(v => `<button class="chip ${F[k].includes(v) ? "on" : ""}" data-g="${k}" data-v="${v}">${v}</button>`).join("")}</div>`;
    const sel = (k, t, o) => `<div><label>${t}</label><select data-s="${k}"><option value="">Hepsi</option>${o.map(c => `<option ${F[k] === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>`;
    B.innerHTML = `<div class="u-flex-jsb-aic"><b class="u-fs19">Filtrele</b><button class="chip" id="fr">Sıfırla</button></div>`
        + grp("veh", "Araç tipi", vehicles) + grp("body", "Kasa tipi", bodies)
        + `<div class="row">${sel("from", "Nereden", cities)}${sel("to", "Nereye", cities)}</div>`
        + `<div class="row"><div><label>${isT ? "Boş kapasite" : "Yük"}: en az (ton)</label><input data-n="tonMin" type="number" inputmode="decimal" value="${F.tonMin}"></div><div><label>En çok (ton)</label><input data-n="tonMax" type="number" inputmode="decimal" value="${F.tonMax}"></div></div>`
        + grp("date", "Yükleme günü", ["Bugün", "Yarın", "İleri tarih"])
        + `<label>Kayıtlılar</label><div class="chips"><button class="chip ${F.fav ? "on" : ""}" id="ff">♥ Sadece kayıtlı olanlar</button></div><button class="btn u-sticky-b0" id="fs"></button>`;
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

// Son yayınlanma: hesaplı ilanda bitişten 6 saat önce (yeniden yayınlanınca sunucu süreyi baştan başlatır), demoda ts.
const publishedAt = x => x._remote && Number.isFinite(x.expiresAt) ? x.expiresAt - 6 * 36e5 : (Number(x.ts) || 0);
const sortL = a => sort === "km" ? [...a].sort((x, y) => (listingDistance(x) || 9e9) - (listingDistance(y) || 9e9))
    : sort === "fresh" ? [...a].sort((x, y) => publishedAt(y) - publishedAt(x)) : a;

// ===== İlanlarım =====
// Kendi ilanlarını ve boş araçlarını düzenleme, kapatma, silme, ilan verirken kalem ve süre yardımcıları.

function postTruck(t) {
    if(nakgoMarket.locked())return nakgoMarket.pending();
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

const findIt = (k, id) => {
    const saved=nakgoMarket.active()?nakgoFavorites.listings().filter(x=>(typeof x.id==='string')===(k!=="l")):[];
    const feed=k==='l'?loads:trucks;
    return (F.fav?[...saved,...feed]:[...feed,...saved]).find(x=>String(x.id)===String(id));
};

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
    B.innerHTML = `<b class="u-fs19">İlanı düzenle</b><div class="route u-mt10">${routeHTML(it)}</div>${L ? "" : `<label>Boş kapasite (ton)</label><input id="ep" type="number" inputmode="decimal" value="${esc(it.cap)}">`}<label>${L ? "Yükleme günü" : "Müsait olduğun gün"}</label>${L && 'dateText' in it ? `<input id="ed" type="text" maxlength="32" required value="${esc(it.dateText)}">` : `<select id="ed">${[...new Set(["Bugün", "Yarın", "Bu hafta", it.date])].map(d => `<option ${it.date === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>`}${L ? `<label>Not</label><textarea id="en" maxlength="1000" rows="3">${esc(it.note || "")}</textarea>` : ""}<button class="btn" id="es">Kaydet</button><button class="btn alt" id="close">Vazgeç</button>`;
    $("#es").onclick = async () => {
        const v = L ? 0 : +$("#ep").value;
        if (!L && !positiveAmount(v))
            return toast("Geçerli bir değer gir");
        const patch = L ? { date: $("#ed").value, note: $("#en").value.trim().slice(0, 1000) } : { cap: v, date: $("#ed").value };
        const selectedDate=$("#ed").value;
        if (L && 'dateText' in it) {
            if (!loadingTextOK(selectedDate)) return toast('Yükleme tarihini yaz');
            delete patch.date; Object.assign(patch,{dateText:selectedDate.trim(),date:'',dateEnd:'',time:''});
        } else if (!postDateOK(selectedDate)) return toast("Geçerli bir tarih seç");
        if (!('dateText' in patch) && selectedDate !== it.date) Object.assign(patch,dateFields(selectedDate));
        if (reopen) {
            const end = selectedDate === it.date ? (it.dateEnd||it.date) : (patch.dateEnd||patch.date);
            if (!('dateText' in patch) && end<localDay()) return toast("Yeniden açmak için güncel bir yükleme tarihi seç");
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
    B.innerHTML = `<b class="u-fs19">İlan silinsin mi?</b><div class="route u-mt10">${routeHTML(it)}</div><p class="u-mt10-fs14-mute">${nakgoMarket.active()?"İlan yayından kaldırılır ve arşivlenir.":"Bu işlem geri alınamaz."}</p><button class="btn" id="yes">Evet, sil</button><button class="btn alt" id="close">Vazgeç</button>`;
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

// İlan durumu: yayında (kalan süre), süresi doldu veya sahibi kapattı. Hesaplı ilanlarda süre sunucudan gelir.
const ownState = (it, kind) => {
    const off = it.closed || expired(it, kind);
    if (!off) {
        const left = it._remote && Number.isFinite(it.expiresAt) ? it.expiresAt - Date.now() : 0;
        const h = Math.floor(left / 36e5), m = Math.max(1, Math.ceil(left % 36e5 / 6e4));
        return { off, text: left > 0 ? "Yayında · " + (h ? h + " sa " : "") + m + " dk kaldı" : "Yayında" };
    }
    return { off, text: it._remote && !it.shut ? "Süresi doldu" : it.closed ? "Kapattın" : "Süresi doldu" };
};

const myListHTML = () => {
    const a = [...mineL().map(l => ({ k: "l", id: l.id, r: routeText(l), v: l.ton + " ton", st: ownState(l, "load"), s: statLine(l), ff: isF(l) ? Math.max(1, Math.ceil((l.featUntil - Date.now()) / 36e5)) : 0 })), ...mineT().map(t => ({ k: "t", id: t.id, r: routeText(t), v: t.cap + " ton", st: ownState(t, "truck"), ff: isF(t) ? Math.max(1, Math.ceil((t.featUntil - Date.now()) / 36e5)) : 0 }))]
        .sort((x, y) => x.st.off - y.st.off);
    return `<div class="load u-cdef"><b>İlanlarım</b>${a.length ? a.map(x => { const c = x.st.off; return `<div class="kv own-item u-block${c ? " is-off" : ""}"><div class="u-flex-jsb-g8"><b class="u-fs14">${esc(x.r)}</b><span>${esc(x.v)}</span></div><div class="own-state">${esc(x.st.text)}</div>${x.s ? `<div class="u-fs125-mute-mt4">${x.s}</div>` : ""}<div class="u-flex-g6-wrap-mt8-aic"><span class="tag">${x.k === "l" ? "Yük" : "Boş araç"}${x.ff ? ` · öne çıkan (${x.ff} sa)` : ""}</span>${c ? `<button class="chip on" data-mc="${x.k}|${esc(x.id)}">${nakgoMarket.active() ? "Yeniden yayınla · 6 saat" : "Yeniden yayınla"}</button>` : ""}<button class="chip" data-me="${x.k}|${esc(x.id)}">Düzenle</button>${x.k === "l" && !nakgoMarket.active() ? `<button class="chip" data-st2="${esc(x.id)}">İstatistik</button>` : ""}${!c ? `<button class="chip" data-ft="${x.k}|${esc(x.id)}">${x.ff ? "Uzat" : "Öne çıkar"}</button>` : ""}${!c ? `<button class="chip" data-mc="${x.k}|${esc(x.id)}">Kapat</button>` : ""}<button class="chip" data-md2="${x.k}|${esc(x.id)}">Sil</button></div></div>`; }).join("") : `<p class="u-mt8-fs13-mute">Henüz ilan vermedin. İlan ver sekmesinden ekleyebilirsin.</p>`}</div>`;
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

const expired = (x, k) => !!(!x._remote && x.ts && Date.now()-x.ts>TTL[k]*864e5) || !!(x._remote && !x.shut && Number.isFinite(x.expiresAt) && x.expiresAt<=Date.now()) || (validDay(x.date) && (validDay(x.dateEnd)?x.dateEnd:x.date)<localDay());
const availableListing = (x,isT=false) => !!x && !x.archived && !x.closed && !expired(x,isT?"truck":"load") && !(x.uid && blocked.includes(x.uid));
const visibleListing = (x,isT=false) => availableListing(x,isT) && (!nearOn || !nearR || dKm(x)<=nearR) && match(x,isT) && (!q || (x.from+" "+x.to+" "+(x.cargo||x.who||"")).toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
function contactAllowed(x,isT=false,allowOwn=false) {
    if(nakgoMarket.locked())return nakgoMarket.pending();
    const current=x&&findIt(isT?"t":"l",x.id);
    if(!availableListing(current,isT)) { toast("Bu ilan artık açık değil. Yeni iletişim başlatılamaz."); return false; }
    if(!allowOwn && ((cloud && current.uid===me)||(!cloud&&current.mine))) { toast("Kendi ilanına mesaj gönderemezsin"); return false; }
    return true;
}

// İlanın sunucuya kaydedildiği an, her cihazda Türkiye saatiyle.
const postedAt = (x, long=false) => {
    if (!Number.isFinite(x.ts)) return "";
    const d=new Date(x.ts), tz={timeZone:"Europe/Istanbul"};
    return d.toLocaleDateString("tr-TR",{...tz,day:"numeric",month:long?"long":"short",...(long?{year:"numeric"}:{})})+" "+d.toLocaleTimeString("tr-TR",{...tz,hour:"2-digit",minute:"2-digit"});
};
// Kartta ilanın ne kadar önce yayınlandığı: "12 dk önce", "3 sa önce", "2 gün önce".
const ago = x => {
    if (!x.ts)
        return "";
    const m = Math.max(0, Math.floor((Date.now() - x.ts) / 6e4));
    return m < 1 ? "az önce" : m < 60 ? m + " dk önce" : m < 1440 ? Math.floor(m / 60) + " sa önce" : Math.floor(m / 1440) + " gün önce";
};

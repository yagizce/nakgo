/**
 * Ekranlar ve araçlar
 * Ana çizim işlevi, ilan ve boş araç detayı, alt pencere, gezinti; yakıt hesabı, tema, paylaşma.
 */

// ===== Araçlar =====
// Yakıt hesabı, tema, paylaşma ve derin bağlantı, çevrimdışı uyarısı.


// Paylaşım preview, eski alias veya native origin yerine resmi Production'a gider.
const APPURL = "https://nakgo.vercel.app/";

function deep() {
    if (deepId && loads.some(x => x.id === deepId)) {
        const i = deepId;
        deepId = 0;
        openLoad(i);
    }
}

function shareLoad(l) {
    track("sh", l.id);
    const url = APPURL + "#l=" + l.id, text = l.from + " → " + l.to + " · " + l.cargo + " · " + l.ton + " ton";
    const copy = () => {
        if (navigator.clipboard)
            navigator.clipboard.writeText(text + " " + url).then(() => toast("Bağlantı kopyalandı")).catch(() => toast("Kopyalanamadı"));
        else
            toast("Paylaşım bu cihazda desteklenmiyor");
    };
    if (navigator.share)
        navigator.share({ title: "NakGo", text, url }).catch(e => {
            if (!e || e.name !== "AbortError")
                copy();
        });
    else
        copy();
}

const themeIcon = () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isDark() ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' : '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'}</svg>`;

function updTheme() {
    const b = $("#thh");
    if (b)
        b.innerHTML = themeIcon();
    try {
        const m = document.querySelector('meta[name="theme-color"]');
        if (m)
            m.content = isDark() ? "#43bfb4" : "#29aaa0";
    }
    catch (e) { }
}

function toggleTheme() {
    const r = document.documentElement, d = isDark();
    r.dataset.theme = d ? "light" : "dark";
    try {
        localStorage.setItem("yy-theme", r.dataset.theme);
    }
    catch (e) { }
    updTheme();
}

function openCalc() {
    const m = $("#sheetBody"); m.dataset.k = "";
    const num = (k,t,u) => `<div><label for="calc-${k}">${t}</label><div class="unit"><input id="calc-${k}" data-k="${k}" type="number" min="0" inputmode="decimal" value="${calc[k]}"><em>${u}</em></div></div>`;
    const cur = vehicles.find(v=>CONS[v]===calc.cons) || "";
    m.innerHTML = `<div class="load-detail fuel-detail"><div class="detail-top"><b>Mazot hesabı</b><button class="chip detail-close" id="cx">Kapat ×</button></div><div class="fuel-result" id="res" role="status" aria-live="polite"></div><div class="detail-scroll"><section class="detail-group"><h2>Yol ve araç</h2><label for="cv">Araç tipi</label><select id="cv"><option value="" hidden>Özel tüketim</option>${vehicles.map(v=>`<option ${v===cur?"selected":""}>${v}</option>`).join("")}</select>${num("km","Tek yön mesafe","km")}<label class="chk"><input type="checkbox" id="bk" ${calc.back?"checked":""}> Boş dönüşü de hesapla</label></section><section class="detail-group"><h2>Mazot ve tüketim</h2><div class="row">${num("fuel","Litre fiyatı","₺/L")}${num("cons","Tüketim","L/100 km")}</div><p class="estimate-note">Litre fiyatı hesaplama varsayımıdır. Güncel pompa fiyatını kendin gir.</p></section><details class="profile-panel"><summary>Otoyol ve diğer giderler</summary><div class="row">${num("toll","Otoyol / köprü","₺")}${num("other","Diğer giderler","₺")}</div></details><p class="estimate-note">Sonuç yaklaşık giderdir; trafik, yük ve sürüş koşullarına göre değişir. Boş dönüş seçimi mesafeyi iki katına çıkarır. Girdilerin cihazında saklanır.</p></div></div>`;
    const out=()=>{
        const value=fuelEstimate(calc);
        if(!value){$("#res").textContent="Hesaplamak için geçerli değerler gir.";return;}
        const {distance,litres,fuel,extras,total}=value;
        $("#res").innerHTML=`<span>Tahmini toplam gider</span><strong>${fmt(Math.round(total))}</strong><div class="fuel-metrics"><div><b>${f1(litres)} L</b><span>Mazot</span></div><div><b>${distance.toLocaleString("tr-TR")} km</b><span>Toplam yol</span></div></div><p>Mazot ${fmt(Math.round(fuel))} · Diğer giderler ${fmt(Math.round(extras))}</p>`;
    };
    const update=patch=>{
        const previous={...calc};
        Object.assign(calc,patch);
        let stored=false;
        if(fuelEstimate(calc)) stored=save();
        else {calc=previous;toast("Hesaplama için geçerli, sıfır veya daha büyük değerler gir.");}
        if(!stored){
            m.querySelectorAll("[data-k]").forEach(i=>i.value=calc[i.dataset.k]);
            $("#bk").checked=calc.back;
        }
        $("#cv").value=vehicles.find(v=>CONS[v]===calc.cons)||"";
        out();
    };
    m.querySelectorAll("[data-k]").forEach(i=>i.oninput=()=>update({[i.dataset.k]:+i.value}));
    $("#cv").onchange=e=>{update({cons:CONS[e.target.value]||calc.cons});m.querySelector('[data-k="cons"]').value=calc.cons;};
    $("#bk").onchange=e=>update({back:e.target.checked});
    out();syncDetailViewport();$("#cx").onclick=closeSheet;$("#sheet").classList.add("open");
}

const netUI = () => {
    const o = $("#off");
    if (o)
        o.style.display = (typeof navigator !== "undefined" && navigator.onLine === false) ? "block" : "none";
};

// ===== Ekranlar =====
// Ana çizim işlevi (render), ilan ve boş araç detayı, alt pencere, sekme gezintisi.

const soft = () => {
    if (tab !== "post")
        render();
};


const demoNotice = () => !cloud ? `<p class="demo-note"><b>Demo modu</b> · Veriler bu cihazda tutulur. Yanıtlar ve test satın almaları simüledir; gerçek işlem yapılmaz.</p>` : "";
const screenHeading = (title, note) => `<div class="screen-heading"><h2>${title}</h2><p>${note}</p></div>`;

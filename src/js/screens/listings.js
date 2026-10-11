/**
 * İlan ekranı
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function renderListings(m) {
    m.dataset.comparing = cmp.length ? "true" : "false";
    const SEG = `<div class="seg"><button data-md="load" aria-pressed="${mode === "load"}" class="${mode === "load" ? "on" : ""}">Yükler</button><button data-md="truck" aria-pressed="${mode === "truck"}" class="${mode === "truck" ? "on" : ""}">Boş araçlar</button></div>`;
    const segBind = () => m.querySelectorAll("[data-md]").forEach(b => b.onclick = () => {
        mode = b.dataset.md;
        render();
    });
        const isT = mode === "truck";
        const ok = x => visibleListing(x,isT);
        let items = isT ? trucks.filter(ok) : sortL(loads.filter(ok));
        if (nearOn && myPos)
            items = [...items].sort((a, b) => dKm(a) - dKm(b));
        items = [...items.filter(isF), ...items.filter(x => !isF(x))];
        const n = fcount(), ac = activeChips();
        {
            const sg = JSON.stringify([F, q, mode, sort, nearOn, nearR]);
            if (sg !== lastSig) {
                lastSig = sg;
                shown = 20;
            }
        }
        const st = isT ? [[trucks.filter(x=>availableListing(x,true)).length, "boş araç"], [trucks.filter(x => availableListing(x,true)&&dateBucket(x)==="Bugün").length, "bugün müsait"], [Math.round(trucks.filter(x=>availableListing(x,true)).reduce((a, x) => a + (+x.cap||0), 0)), "ton kapasite"]] : [[loads.filter(x => availableListing(x)).length, "açık ilan"], [loads.filter(x => availableListing(x)&&dateBucket(x)==="Bugün").length, "bugün yükleme"], [new Set(loads.filter(x=>availableListing(x)).map(x=>x.from)).size, "çıkış şehri"]];
        const hero = `<div class="hero">${st.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join("")}</div>`;
        m.innerHTML = routeSearch() + SEG + (!cloud ? '<p class="demo-note"><b>Demo modu</b> · Örnek ilanlar ve talepler deneme amaçlıdır; gerçek taşıma talebi değildir.</p>' : "") + `<div class="row listing-search" style="margin-bottom:12px"><input class="search" id="q" aria-label="İlanlarda ara" placeholder="${isT ? "Şehir veya taşıyıcı ara" : "Şehir veya yük ara"}" value="${esc(q)}" style="margin:0"></div>
    ${nearRow()}${ac.length ? `<div class="chips active-filters wrap">${ac.map(c => `<button class="chip on" data-x="${c[0]}" data-v="${esc(c[1])}">${esc(c[2])} ×</button>`).join("")}</div>` : ""}
    <div class="meta listing-count" style="margin:0 2px 10px"><span>${items.length} ${isT ? "boş araç" : "ilan"}${!isT && (F.from || F.to) ? ` <button class="chip" id="al" style="margin-left:6px;padding:4px 10px;font-size:12px">Alarm kur</button>` : ""}</span><span>Yola çıkmaya hazır</span></div>
    <div class="listing-grid">${!loaded ? SKEL : items.length ? items.slice(0, shown).map(isT ? tCard : lCard).join("") + (items.length > shown ? `<button class="chip" id="more" style="display:block;margin:4px auto 12px">Daha fazla göster (${items.length - shown})</button>` : "") : `<div class="empty">Bu filtrelere uyan ${isT ? "boş araç" : "ilan"} yok.<br><button class="chip" id="rs" style="margin-top:12px">Filtreleri sıfırla</button></div>`}</div><section class="market-stats" aria-label="Pazar özeti"><h2>Pazar özeti</h2>${hero}</section><div class="list-actions" aria-label="İlan araçları">${cmpBar()}<div class="list-controls"><button class="chip ${n ? "on" : ""}" id="fb">${FI} Filtrele${n ? `<b class="bdg">${n}</b>` : ""}</button>${isT ? '<span class="dock-hint">Güzergâhına uygun araçlar</span>' : `<select id="s" aria-label="İlanları sırala"><option value="new">En yeni</option><option value="km" ${sort === "km" ? "selected" : ""}>Mesafe ↑</option><option value="rate" ${sort === "rate" ? "selected" : ""}>Puan ↓</option></select>`}<button class="chip ${nearOn ? "on" : ""}" id="nr0" aria-pressed="${nearOn}" aria-label="Yakınımdaki ilanlar${nearOn && myCity ? ": " + myCity : ""}">Yakınımda</button></div></div>`;
        segBind();
        m.querySelectorAll("[data-fav]").forEach(b => b.onclick = e => {
            e.stopPropagation();
            const f = b.dataset.fav, was = favs.includes(f);
            tog(favs, f);
            if (/^\d+$/.test(f))
                (was ? untrack : track)("s", +f);
            render();
        });
        $("#q").oninput = e => {
            q = e.target.value;
            const p = e.target.selectionStart;
            render();
            const i = $("#q");
            i.focus();
            i.setSelectionRange(p, p);
        };
        $("#fb").onclick = openFilter;
        m.querySelectorAll("[data-route]").forEach(e => e.onchange = () => {
            F[e.dataset.route] = e.value;
            render();
            $("[data-route=\"" + e.dataset.route + "\"]").focus();
        });
        $("#route-swap").onclick = () => {
            [F.from, F.to] = [F.to, F.from];
            render();
            $("#route-swap").focus();
        };
        if ($("#al"))
            $("#al").onclick = addAlert;
        if ($("#more"))
            $("#more").onclick = () => {
                shown += 20;
                render();
            };
        $("#nr0").onclick = toggleNear;
        m.querySelectorAll("[data-nr]").forEach(b => b.onclick = () => {
            nearR = +b.dataset.nr;
            render();
        });
        if ($("#cmpgo"))
            $("#cmpgo").onclick = openCompare;
        if ($("#cmpx"))
            $("#cmpx").onclick = () => {
                cmp = [];
                render();
            };
        if ($("#s"))
            $("#s").onchange = e => {
                sort = e.target.value;
                render();
            };
        if ($("#rs"))
            $("#rs").onclick = () => {
                F = F0();
                q = "";
                nearOn = false;
                render();
            };
        m.querySelectorAll("[data-x]").forEach(b => b.onclick = () => rmF(b.dataset.x, b.dataset.v));
        m.querySelectorAll("[data-tid]").forEach(b => {
            b.onclick = () => openTruck(b.dataset.tid);
            b.onkeydown = e => { if(e.target===b && (e.key==="Enter" || e.key===" ")){e.preventDefault();openTruck(b.dataset.tid);} };
        });
        m.querySelectorAll("[data-id]").forEach(b => {
            b.onclick = () => openLoad(+b.dataset.id);
            b.onkeydown = e => {
                if (e.target === b && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    openLoad(+b.dataset.id);
                }
            };
        });
}

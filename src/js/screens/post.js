/**
 * İlan oluşturma ekranı
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function postValues() {
    const truck = postMode === "truck";
    return {
        from: $("#f").value, to: $("#t").value, veh: $("#v").value,
        body: $(truck ? "#bd" : "#b").value, ...parsePostDate($("#d").value),
        ...(truck ? {cap: +$("#w").value} : {ton: +$("#w").value, cargo: $("#c").value.trim().slice(0,120)})
    };
}

function renderPost(m) {
        postImg = "";
        const opt = a => a.map(c => `<option>${c}</option>`).join("");
        const PS = `<div class="seg"><button data-pm="load" class="${postMode === "load" ? "on" : ""}">Yük ilanı</button><button data-pm="truck" class="${postMode === "truck" ? "on" : ""}">Boş araç ilanı</button></div>`;
        const pb = () => m.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => {
            capturePostDraft();
            postMode = b.dataset.pm;
            try { localStorage.setItem("ng-post-mode",postMode); } catch(e) { }
            render();
        });
        if (postMode === "truck") {
            m.innerHTML = PS + `<label>Nereden</label><select id="f">${opt2(cities, "İstanbul")}</select><label>Nereye</label><select id="t">${opt2(cities, "Ankara")}</select><div class="row"><div><label>Araç tipi</label><select id="v">${opt(vehicles)}</select></div><div><label>Boş kapasite (ton)</label><input id="w" type="number" min="0" step="any" inputmode="decimal" value="10"></div></div><label>Kasa tipi</label><select id="bd">${opt(bodies)}</select><label>Müsait olduğun tarih</label><input id="d" type="text" maxlength="32" placeholder="Örn. 28.10.2026 14:30" aria-describedby="post-date-hint" required><small id="post-date-hint">Gün.ay.yıl ve istersen saat:dakika yaz.</small><button class="btn" id="go">Boş aracı yayınla</button>`;
            pb();
            const publishButton = $("#go");
            publishButton.onclick = async () => {
                if (tab !== "post" || $("#go") !== publishButton) return;
                if(publishButton.disabled)return;
                if(nakgoMarket.active()) {
                    const value=postValues(), error=postError(value,true); if(error)return toast(error);
                    publishButton.disabled=true;
                    try {await nakgoMarket.create(value,true);} catch(e){publishButton.disabled=false;toast(nakgoAuth.message(e));return;}
                } else if (!postTruck({ ...postValues(), id: "t" + Date.now(), who: myCar.displayName || myName || "Ben", rate: "Yeni" })) return;
                const cleared = clearPostDraft('truck');
                if(nakgoMarket.active() && (tab!=='post'||$('#go')!==publishButton)){toast('Boş araç ilanı yayınlandı');return;}
                F = F0(); q = ""; nearOn = false;
                mode = "truck";
                tab = "list";
                setNav();
                render();
                toast(cleared ? "Boş araç ilanı yayınlandı" : "İlan yayınlandı; eski taslak cihazdan temizlenemedi.");
            };
            initPostWizard(m);
            return;
        }
        m.innerHTML = PS + `<label>Nereden</label><select id="f">${opt2(cities, "İstanbul")}</select>
    <label>Nereye</label><select id="t">${opt2(cities, "Ankara")}</select>
    <label>Yük cinsi</label><input id="c" maxlength="120" placeholder="Örn. Paletli gıda">
    <div class="row"><div><label>Ağırlık (ton)</label><input id="w" type="number" min="0" step="any" inputmode="decimal" value="10"></div>
    <div><label>Araç tipi</label><select id="v">${opt(vehicles)}</select></div></div>
    <div class="row"><div><label>Kasa tipi</label><select id="b">${opt(bodies)}</select></div>
    </div>
    <label>Yükleme tarihi</label><input id="d" type="text" maxlength="32" placeholder="Örn. 28.10.2026 14:30" aria-describedby="post-date-hint" required><small id="post-date-hint">Gün.ay.yıl ve istersen saat:dakika yaz.</small>
    <label>Not (isteğe bağlı)</label><textarea id="n" maxlength="1000" rows="3" placeholder="Yükleme saati, özel koşullar"></textarea>
    <label>Yük kalemleri (isteğe bağlı)</label><div id="its"></div><button class="chip" id="addit" type="button" style="margin-top:8px">+ Kalem ekle</button><label>Fotoğraf (isteğe bağlı)</label><div style="display:flex;align-items:center;gap:10px"><button class="chip" id="ph" type="button">Fotoğraf ekle</button><span id="phs"></span></div><button class="btn" id="go">İlanı yayınla</button>`;
        pb();
        itemsUI();
        const publishButton = $("#go");
        publishButton.onclick = async () => {
            if (tab !== "post" || $("#go") !== publishButton) return;
            const l = { ...postValues(), id: Date.now(), note: $("#n").value.trim().slice(0,1000), owner: myCar.displayName || myName || "Ben" };
            if (myCar.phone)
                l.phone = myCar.phone;
            if (postImg)
                l.img = postImg;
            const its = [...document.querySelectorAll("#its .itrow")].map(w => ({ n: w.querySelector("[data-in]").value.trim().slice(0, 40), q: +w.querySelector("[data-iq]").value, u: w.querySelector("[data-iu]").value })).filter(x => x.n).slice(0, 6);
            if (its.length)
                l.items = its;
            const error = postError(l);
            if (error) return toast(error);
            if(publishButton.disabled)return;
            if(nakgoMarket.active()) {
                publishButton.disabled=true;
                try {await nakgoMarket.create(l);} catch(e){publishButton.disabled=false;toast(nakgoAuth.message(e));return;}
            } else {
            Object.assign(l,dateFields(l.date),{ts:Date.now()});
            if (cloud) {
                l.uid = me;
                l.ts = Date.now();
                delete l.owner;
                dbw(db.doc("loads/" + l.id).set(l));
            }
            if (!cloud)
                l.mine = true;
            loads.unshift(l);
            if (!save()) return;
            }
            postImg = "";
            const cleared = clearPostDraft('load');
            if(nakgoMarket.active() && (tab!=='post'||$('#go')!==publishButton)){toast('İlan yayınlandı');return;}
            F = F0(); q = ""; nearOn = false;
            mode = "load";
            tab = "list";
            setNav();
            render();
            toast(cleared ? "İlan yayınlandı" : "İlan yayınlandı; eski taslak cihazdan temizlenemedi.");
        };
        initPostWizard(m);
}

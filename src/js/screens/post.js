/**
 * İlan oluşturma ekranı
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function renderPost(m) {
        const opt = a => a.map(c => `<option>${c}</option>`).join("");
        const PS = `<div class="seg"><button data-pm="load" class="${postMode === "load" ? "on" : ""}">Yük ilanı</button><button data-pm="truck" class="${postMode === "truck" ? "on" : ""}">Boş araç ilanı</button></div>`;
        const pb = () => m.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => {
            postMode = b.dataset.pm;
            try { localStorage.setItem("ng-post-mode",postMode); } catch(e) { }
            render();
        });
        if (postMode === "truck") {
            m.innerHTML = PS + `<label>Nereden</label><select id="f">${opt2(cities, "İstanbul")}</select><label>Nereye</label><select id="t">${opt2(cities, "Ankara")}</select><div class="row"><div><label>Araç tipi</label><select id="v">${opt(vehicles)}</select></div><div><label>Boş kapasite (ton)</label><input id="w" type="number" value="10"></div></div><label>Kasa tipi</label><select id="bd">${opt(bodies)}</select><label>Müsait olduğun gün</label><select id="d">${opt(["Bugün", "Yarın", "Bu hafta"])}</select><button class="btn" id="go">Boş aracı yayınla</button>`;
            pb();
            $("#go").onclick = () => {
                if ($("#f").value === $("#t").value)
                    return toast("Çıkış ve varış şehri farklı olmalı");
                if (!(+$("#w").value > 0))
                    return toast("Boş kapasiteyi gir");
                postTruck({ id: "t" + Date.now(), who: "Ben (Yağız)", from: $("#f").value, to: $("#t").value, veh: $("#v").value, cap: +$("#w").value, body: $("#bd").value, date: $("#d").value, rate: "Yeni" });
                clearPostDraft();
                F = F0(); q = ""; nearOn = false;
                mode = "truck";
                tab = "list";
                setNav();
                render();
                toast("Boş araç ilanı yayınlandı");
            };
            initPostWizard(m);
            return;
        }
        m.innerHTML = PS + `<label>Nereden</label><select id="f">${opt2(cities, "İstanbul")}</select>
    <label>Nereye</label><select id="t">${opt2(cities, "Ankara")}</select>
    <label>Yük cinsi</label><input id="c" placeholder="Örn. Paletli gıda">
    <div class="row"><div><label>Ağırlık (ton)</label><input id="w" type="number" min="1" value="10"></div>
    <div><label>Araç tipi</label><select id="v">${opt(vehicles)}</select></div></div>
    <div class="row"><div><label>Kasa tipi</label><select id="b">${opt(bodies)}</select></div>
    </div>
    <label>Yükleme günü</label><select id="d">${opt(["Bugün", "Yarın", "Bu hafta"])}</select>
    <label>Not (isteğe bağlı)</label><textarea id="n" maxlength="1000" rows="3" placeholder="Yükleme saati, özel koşullar"></textarea>
    <label>Yük kalemleri (isteğe bağlı)</label><div id="its"></div><button class="chip" id="addit" type="button" style="margin-top:8px">+ Kalem ekle</button><label>Fotoğraf (isteğe bağlı)</label><div style="display:flex;align-items:center;gap:10px"><button class="chip" id="ph" type="button">Fotoğraf ekle</button><span id="phs"></span></div><button class="btn" id="go">İlanı yayınla</button>`;
        pb();
        itemsUI();
        $("#go").onclick = () => {
            const l = { id: Date.now(), from: $("#f").value, to: $("#t").value, cargo: $("#c").value.trim(), ton: +$("#w").value, veh: $("#v").value, date: $("#d").value, body: $("#b").value, note: $("#n").value.trim(), owner: "Ben (Yağız)" };
            if (l.from === l.to)
                return toast("Çıkış ve varış şehri farklı olmalı");
            if (!l.cargo || !(l.ton > 0))
                return toast("Yük cinsi ve ağırlığı gir");
            if (myCar.phone)
                l.phone = myCar.phone;
            if (postImg)
                l.img = postImg;
            const its = [...document.querySelectorAll("#its .itrow")].map(w => ({ n: w.querySelector("[data-in]").value.trim().slice(0, 40), q: +w.querySelector("[data-iq]").value || 0, u: w.querySelector("[data-iu]").value })).filter(x => x.n).slice(0, 6);
            if (its.length)
                l.items = its;
            postImg = "";
            if (cloud) {
                l.uid = me;
                l.ts = Date.now();
                delete l.owner;
                dbw(db.doc("loads/" + l.id).set(l));
            }
            if (!cloud)
                l.mine = true;
            loads.unshift(l);
            clearPostDraft();
            F = F0(); q = ""; nearOn = false;
            tab = "list";
            setNav();
            render();
            toast("İlan yayınlandı");
        };
        initPostWizard(m);
}

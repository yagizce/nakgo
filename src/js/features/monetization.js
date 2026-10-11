/**
 * Premium, öne çıkan ilan ve istatistik
 * Üyelik ve arama kapısı, öne çıkarma fiyatı ve etkisi, ilan istatistikleri.
 */

// ===== Premium üyelik =====
// Üyelik ekranı, test modunda satın alma, doğrudan arama kapısı.

const isPrem = () => prem.until > Date.now();

const callChip = a => `<button class="chip" ${a}>Ara${isPrem() ? "" : '<b class="pm">Premium</b>'}</button>`;

function openPaywall(why) {
    const B = $("#sheetBody");
    B.dataset.k = "";
    let pl = "y";
    const pr = id => PLANS.find(x => x.id === id), save12 = Math.round((1 - pr("y").price / (pr("m").price * 12)) * 100);
    const draw = () => {
        B.innerHTML = `<div class="pw"><div class="pw-ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.9 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg></div><h2>NakGo Premium</h2><p>${why ? esc(why) + " özelliği Premium üyelere açık." : "Daha hızlı anlaşmak için doğrudan iletişim."}</p><ul><li>Yük sahiplerini ve taşıyıcıları doğrudan telefonla ara</li><li>Üyeliği istediğin zaman iptal et</li></ul><div class="plans">${PLANS.map(x => `<button class="plan ${x.id === pl ? "on" : ""}" data-pl="${x.id}"><b>${fmt(x.price)}</b><span>${x.name}${x.id === "y" && save12 > 0 ? " · %" + save12 + " tasarruf" : ""}</span></button>`).join("")}</div><button class="btn" id="buy">Premium'a geç</button><p style="font-size:12px">Test modu: gerçek ödeme alınmaz.</p><button class="btn alt" id="close">Şimdi değil</button></div>`;
        B.querySelectorAll("[data-pl]").forEach(b => b.onclick = () => {
            pl = b.dataset.pl;
            draw();
        });
        $("#close").onclick = closeSheet;
        $("#buy").onclick = () => {
            prem = { until: Date.now() + pr(pl).days * 864e5, plan: pl };
            save();
            if (cloud)
                dbw(db.doc("premium/" + me).set(prem));
            closeSheet();
            render();
            toast("Premium aktif");
        };
    };
    draw();
    $("#sheet").classList.add("open");
}

function callTo(phone) {
    if (!phone)
        return toast("Bu kullanıcı henüz numara eklememiş");
    if (!isPrem())
        return openPaywall("Doğrudan arama");
    const B = $("#sheetBody");
    B.dataset.k = "";
    if (/^0000/.test(phone)) {
        B.innerHTML = `<b>Örnek telefon</b><p class="demo-note">Bu demo ilanda gerçek telefon numarası bulunmuyor. Kendi ilanında profilinden numara ekleyebilirsin.</p><button class="btn alt" id="close">Kapat</button>`;
        $("#close").onclick=closeSheet; $("#sheet").classList.add("open"); return;
    }
    const num = String(phone).replace(/[^\d+]/g, "");
    B.innerHTML = `<b style="font-size:19px">Ara</b><p class="callnum">${esc(phone)}</p><a class="btn" href="tel:${num}" style="display:block;text-align:center;text-decoration:none">Şimdi ara</a><button class="btn alt" id="cp">Numarayı kopyala</button><button class="btn alt" id="close">Kapat</button>`;
    $("#cp").onclick = () => {
        if (navigator.clipboard)
            navigator.clipboard.writeText(String(phone)).then(() => toast("Numara kopyalandı")).catch(() => toast("Kopyalanamadı"));
        else
            toast("Kopyalama desteklenmiyor");
    };
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

const premCard = () => `<div class="load" style="cursor:default"><div style="display:flex;justify-content:space-between;align-items:center"><b>Premium üyelik</b>${isPrem() ? '<span class="vb" style="margin:0">Aktif</span>' : '<span class="tag">Üye değil</span>'}</div><p style="font-size:13px;color:var(--mute);margin:8px 0">${isPrem() ? "Bitiş: " + new Date(prem.until).toLocaleDateString("tr-TR") : "Doğrudan arama özelliği Premium üyelere açık."}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="chip on" id="pm1">${isPrem() ? "Planı uzat" : "Premium'a geç"}</button>${isPrem() ? '<button class="chip" id="pm2">Üyeliği sıfırla (test)</button>' : ""}</div></div>`;

// ===== Öne çıkan ilan =====
// Öne çıkarma fiyatı, satın alma ekranı, etkinin ölçülmesi ve özeti.

const featPrice = (kind, hrs) => (FEAT.prices[kind] || FEAT.prices.l)[hrs] || 0;

const isF = x => !!x.featUntil && (x.featFrom || 0) <= Date.now() && Date.now() < x.featUntil;

function openFeature(kind, id) {
    const it = findIt(kind, id);
    if (!it)
        return;
    const B = $("#sheetBody");
    B.dataset.k = "";
    const L = kind === "l", active = !!(it.featUntil && it.featUntil > Date.now()), st = active ? it.featUntil : Date.now(), left = active ? Math.max(1, Math.ceil((it.featUntil - Date.now()) / 36e5)) : 0;
    let dur = 6;
    const draw = () => {
        const price = featPrice(kind, dur);
        B.innerHTML = `<b style="font-size:19px">${L ? "İlanını" : "Boş araç ilanını"} öne çıkar</b><div class="route" style="margin-top:10px">${it.from}<i></i>${it.to}</div>
  <p style="font-size:13px;color:var(--mute);margin:8px 0 12px">Öne çıkan ${L ? "ilanlar" : "boş araç ilanları"} listenin en üstünde "Öne çıkan" etiketiyle gösterilir.${active ? ` Şu an ${left} saat daha öne çıkıyor, yeni süre bitince başlar.` : ""}</p>
  <div class="fopts">${FDUR.map(([h, t]) => {
            const p = featPrice(kind, h);
            return `<button class="fopt ${h === dur ? "on" : ""}" data-fd="${h}"><b>${t}</b><span>${fmt(p)}${h >= 72 ? " · günlük " + fmt(Math.round(p / 3)) : ""}</span></button>`;
        }).join("")}</div>
  <div class="fprice"><b>${fmt(price)}</b><span>${dur >= 72 ? "3 gün" : dur + " saat"} boyunca listenin başında</span></div>
  <button class="btn" id="fbuy">Öne çıkar · ${fmt(price)}</button><p style="font-size:12px;color:var(--mute);text-align:center">Test modu: gerçek ödeme alınmaz.</p><button class="btn alt" id="close">Vazgeç</button>`;
        B.querySelectorAll("[data-fd]").forEach(b => b.onclick = () => {
            dur = +b.dataset.fd;
            draw();
        });
        $("#close").onclick = closeSheet;
        $("#fbuy").onclick = () => {
            const p = featPrice(kind, dur);
            patchIt(kind, id, { featFrom: active ? (it.featFrom || Date.now()) : st, featUntil: st + dur * 36e5, featPaid: (+it.featPaid || 0) + p, featWin: [...featWins(it), [st, st + dur * 36e5]].slice(-10) });
            closeSheet();
            toast(active ? "Öne çıkarma süresi uzatıldı" : "İlanın öne çıkarıldı");
        };
    };
    draw();
    $("#sheet").classList.add("open");
}

const featWins = l => Array.isArray(l.featWin) && l.featWin.length ? l.featWin.map(w => [+w[0] || 0, +w[1] || 0]).filter(w => w[1] > w[0]) : (l.featUntil ? [[l.featFrom || 0, l.featUntil]] : []);

/* Öne çıkarma etkisi: öne çıkarılan saatlerdeki saatlik görüntülenme ile diğer saatlerin karşılaştırması. Neden-sonuç kanıtı değil, kaba bir göstergedir. */
function featEffect(l, E, O, now) {
    const W = featWins(l).map(w => [w[0], Math.min(w[1], now)]).filter(w => w[1] > w[0]);
    if (!W.length)
        return null;
    const start = l.ts || Math.min(...W.map(w => w[0])), inW = t => W.some(w => t >= w[0] && t < w[1]), hF = W.reduce((a, w) => a + (w[1] - w[0]) / 36e5, 0), hO = Math.max(0, (now - start) / 36e5 - hF);
    const V = E.filter(e => e.t === "v").map(e => e.ts), vF = V.filter(inW).length, vO = V.length - vF, oF = O.filter(o => inW(+o.ts || 0)).length, rF = hF > 0 ? vF / hF : 0, rO = hO > 0 ? vO / hO : 0, enough = hF >= 3 && hO >= 3 && V.length >= 8;
    return { demo: false, hF, hO, vF, vO, rF, rO, oF, lift: enough && rO > 0 ? Math.round((rF / rO - 1) * 100) : null, enough };
}

function fxOf(l) {
    const Wn = featWins(l);
    if (!Wn.length)
        return null;
    const now = Date.now();
    if (!cloud) {
        const hF = Wn.reduce((a, w) => a + Math.max(0, Math.min(w[1], now) - w[0]) / 36e5, 0), h = ((l.id * 7919) % 1000) / 1000, rO = +(.5 + h * .6).toFixed(1), rF = +(rO * (1.6 + h * .8)).toFixed(1);
        return { demo: true, hF: Math.max(hF, .1), rO, rF, lift: Math.round((rF / rO - 1) * 100), oF: Math.max(0, Math.round(rF * hF * .05)), enough: true };
    }
    return featEffect(l, events.filter(e => e.loadId === l.id && e.uid !== l.uid), allO.filter(o => o.loadId === l.id), now);
}

const fxBox = fx => {
    if (!fx)
        return "";
    return `<div class="fxbox"><b>Öne çıkarmanın etkisi</b>${fx.lift !== null ? `<p>Öne çıkarıldığı ${Math.max(1, Math.round(fx.hF))} saatte saatlik <b>${f1(fx.rF)}</b> görüntülenme, diğer saatlerde <b>${f1(fx.rO)}</b>. Yaklaşık <b>%${Math.abs(fx.lift)}</b> ${fx.lift >= 0 ? "fazla" : "az"} ilgi.</p>` : `<p>Henüz yeterli veri yok. Anlamlı karşılaştırma için en az 3 saat öne çıkarılmış, 3 saat normal geçmiş ve 8 görüntülenme gerekir.</p>`}<p class="fxn">${fx.oF} teklif öne çıkarma sırasında geldi. ${fx.demo ? "Örnek veri. " : ""}Bu bir karşılaştırmadır, tek başına kesin neden göstermez.</p></div>`;
};

const featSumCard = () => {
    const P = [...mineL(), ...mineT()].filter(x => +x.featPaid > 0);
    if (!P.length)
        return "";
    const tot = P.reduce((a, x) => a + (+x.featPaid || 0), 0), L = mineL().map(l => fxOf(l)).filter(f => f && f.lift !== null), avg = L.length ? Math.round(L.reduce((a, f) => a + f.lift, 0) / L.length) : null;
    return `<div class="load" style="cursor:default"><b>Öne çıkarma özeti</b><div class="stat flat" style="margin:10px 0 4px"><div><b>${fmt(tot)}</b><span>Toplam harcama</span></div><div><b>${P.length}</b><span>Öne çıkan ilan</span></div><div><b>${avg === null ? "—" : "%" + avg}</b><span>Ort. ilgi artışı</span></div></div><p style="font-size:12px;color:var(--mute)">${cloud ? "" : "Yerel modda örnek veri. "}İlgi artışı, öne çıkarılan saatlerle diğer saatlerin görüntülenme farkıdır.</p></div>`;
};

// ===== İlan istatistikleri =====
// Görüntülenme, kayıt, paylaşım, arama isteği sayımı ve istatistik ekranı.

function statsOf0(l) {
    const now = Date.now();
    let daily = [0, 0, 0, 0, 0, 0, 0];
    if (!cloud) {
        const h = ((l.id * 7919) % 1000) / 1000, v = Math.round(18 + h * 60);
        daily = daily.map((_, i) => Math.round(v / 7 * (.5 + ((l.id + i * 37) % 10) / 10)));
        return { demo: true, views: v, saves: Math.round(v * .12), shares: Math.round(v * .05), calls: Math.round(v * .08), offers: Math.round(v * .06), best: Math.round(l.price * (.9 + h * .1)), avg: Math.round(l.price * (.85 + h * .1)), daily, age: l.ts ? Math.floor((now - l.ts) / 864e5) : 0 };
    }
    const E = events.filter(e => e.loadId === l.id && e.uid !== l.uid), O = allO.filter(o => o.loadId === l.id), offs = O.map(o => +o.offer || 0).filter(x => x > 0);
    E.filter(e => e.t === "v").forEach(e => {
        const d = Math.floor((now - e.ts) / 864e5);
        if (d >= 0 && d < 7)
            daily[6 - d]++;
    });
    return { demo: false, views: E.filter(e => e.t === "v").length, saves: E.filter(e => e.t === "s").length, shares: E.filter(e => e.t === "sh").length, calls: E.filter(e => e.t === "c").length, offers: O.length, best: offs.length ? Math.max(...offs) : 0, avg: offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : 0, daily, age: l.ts ? Math.floor((now - l.ts) / 864e5) : 0 };
}

const statLine = l => {
    const s = statsOf(l);
    return s.views + " görüntülenme · " + s.offers + " talep · " + s.saves + " kayıt" + (s.demo ? " (örnek)" : "");
};

function statTips(l, s) {
    const t = [];
    if (s.views >= 10 && s.offers === 0)
        t.push("Görüntülenme var ama taşıma talebi yok. Yük bilgilerini ve açıklamayı gözden geçir.");
    if (s.views < 5 && s.age >= 2)
        t.push(!l.img ? "Az kişi gördü. Fotoğraf eklemek ilgiyi artırır." : "Az kişi gördü. Yükleme gününü ve kasa tipini kontrol et.");
    if (s.calls > 0)
        t.push(s.calls + " kişi seni aramak istedi.");
    if (s.saves > 0)
        t.push(s.saves + " kişi ilanı kaydetti.");
    if (!t.length)
        t.push("Henüz yeterli veri yok. Birkaç gün sonra tekrar bak.");
    return t;
}

function openStats(id) {
    const l = loads.find(x => String(x.id) === String(id));
    if (!l)
        return;
    const s = statsOf(l), B = $("#sheetBody");
    B.dataset.k = "";
    const mx = Math.max(1, ...s.daily), conv = s.views ? Math.round(s.offers / s.views * 100) : 0, now = new Date();
    const bars = s.daily.map((v, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
        return `<div title="${v}"><i style="height:${v ? Math.max(6, Math.round(v / mx * 60)) : 3}px;${v ? "" : "background:var(--line)"}"></i><span>${d.toLocaleDateString("tr-TR", { weekday: "short" })}</span></div>`;
    }).join("");
    const tile = (n, t) => `<div><b>${n}</b><span>${t}</span></div>`;
    B.innerHTML = `<b style="font-size:19px">İlan performansı</b><div class="route" style="margin-top:10px">${l.from}<i></i>${l.to}</div><div class="sg">${tile(s.views, "Görüntülenme")}${tile(s.offers, "Talep")}${tile(s.saves, "Kaydeden")}${tile(s.shares, "Paylaşım")}${tile(s.calls, "Arama isteği")}${tile("%" + conv, "Talep oranı")}</div>${fxBox(s.fx)}<b style="font-size:15px;display:block;margin-top:14px">Son 7 gün görüntülenme</b><div class="wk">${bars}</div><ul class="tips">${statTips(l, s).map(x => `<li>${x}</li>`).join("")}</ul>${s.demo ? '<p style="font-size:12px;color:var(--mute)">Örnek veri: yerel modda gerçek ziyaretçi olmadığı için sayılar temsilidir.</p>' : ""}<button class="btn alt" id="close">Kapat</button>`;
    $("#close").onclick = closeSheet;
    $("#sheet").classList.add("open");
}

function statsOf(l) {
    const s = statsOf0(l);
    s.fx = fxOf(l);
    return s;
}

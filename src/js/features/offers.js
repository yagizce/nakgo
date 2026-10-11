/**
 * Taşıma talepleri
 * İki aşamalı iş takibi, bildirimler ve mesajlaşma.
 */
const opath = o => "offers/" + o.loadId + "_" + o.bidder;
function oup(o,patch){Object.assign(o,patch);if(cloud)dbw(db.doc(opath(o)).update(patch));render();}
// Eski stage 2 yüklenmiş, stage 3 onaylanmış kayıt olarak gösterilir; kayıtlar silinmez.
const jobStage = o => (o.stage || 0) >= 3 ? 3 : (o.stage || 0) >= 1 ? 1 : 0;
const offerExp = o => o.status === "wait" && !!o.ots && Date.now()-o.ots>TTL.offer*864e5;
const stepper = o => `<div class="steps job-steps"><span class="${jobStage(o)>=1?'on':''}"><i></i>Yükledim</span><span class="${jobStage(o)===3?'on':''}"><i></i>Onaylandı</span></div>`;
function requestLoad(l){
    if(cloud&&l.uid===me){toast("Kendi ilanına talep gönderemezsin");return false;}
    if(offers.some(o=>o.id===l.id&&o.status!=="no"&&!offerExp(o))){toast("Bu ilan İşlerim bölümünde kayıtlı");return false;}
    const o={...l,offer:0,status:"wait",loadId:l.id,bidder:me,ownerUid:l.uid||"",ots:Date.now(),stage:0};
    offers=offers.filter(x=>x.id!==l.id);offers.unshift(o);
    if(cloud)dbw(db.doc(opath(o)).set({loadId:l.id,bidder:me,ownerUid:l.uid||"",offer:0,status:"wait",stage:0,ts:o.ots}));
    save();if(!l.uid)simulate(l.id);return true;
}
function setStage(o,n){
    if(!o||o.status!=="ok")return;
    const old=jobStage(o);
    if((n===1&&old!==0)||(n===3&&old!==1)||![1,3].includes(n))return;
    const isOwner=cloud&&o.ownerUid===me;
    if(cloud&&((n===1&&o.bidder!==me)||(n===3&&!isOwner)))return toast("Bu adımı diğer taraf onaylamalı");
    o.stage=n;if(n===3)o.doneAt=Date.now();
    if(cloud)dbw(db.doc(opath(o)).update(n===3?{stage:n,doneAt:o.doneAt}:{stage:n}));
    save();if(tab==="mine"||tab==="me")render();
    if(n===1&&!(o.ownerUid||o.uid))setTimeout(()=>{
        if(jobStage(o)!==1)return;
        // Demo yük sahibi onayı. Gerçek kullanıcı kayıtlarına otomatik onay verilmez.
        o.stage=3;o.doneAt=Date.now();save();if(tab==="mine"||tab==="me")render();toast("Demo: yükleme onaylandı");
    },3000);
}
const stageUI=o=>`<div class="ret">${stepper(o)}<div class="job-actions">${jobStage(o)===0?`<button class="chip on" data-sg="${o.id}|1">Yükledim</button>`:jobStage(o)===1?'<span class="hint">Yük sahibinin onayı bekleniyor</span>':'<span class="st ok">✓ Onaylandı</span>'}${jobStage(o)===3?(rates.some(x=>x.k===rkey(o,"c"))?'<span class="hint">Değerlendirmen kaydedildi</span>':`<button class="chip" data-rt="${o.id}">Yük sahibini puanla</button>`):''}</div></div>`;
const retHTML=o=>{
    const c=loads.filter(l=>!l.closed&&!expired(l,"load")&&l.from===o.to&&l.id!==o.id&&!(l.uid&&l.uid===me)&&!(l.uid&&blocked.includes(l.uid))).sort((a,b)=>(b.to===o.from)-(a.to===o.from)).slice(0,2);
    return c.length?`<div class="ret"><b>Dönüş güzergâhındaki yükler</b>${c.map(l=>`<button class="retc" data-rl="${l.id}"><span>${l.from} → ${l.to}</span><span>${l.veh} · ${l.ton} ton</span></button>`).join('')}</div>`:'';
};
const incHTML=()=>incoming.length?'<h2 class="jobs-heading">Gelen taşıma talepleri</h2>'+incoming.map((o,i)=>`<article class="load job-card">${routeTitle(o)}<div class="meta"><span>${nm(o.bidder)}${vbadge(lvU(o.bidder))}</span><span class="st ${o.status==='ok'?'ok':o.status==='no'?'no':''}">${offerExp(o)?'Süresi doldu':STT[o.status]}</span></div>${o.status==='ok'?stepper(o):''}<div class="job-actions">${['wait','counter'].includes(o.status)&&!offerExp(o)?`<button class="chip on" data-ia="${i}">Kabul et</button><button class="chip" data-ir="${i}">Reddet</button>`:''}${o.status==='ok'&&jobStage(o)===1?`<button class="chip on" data-ic="${i}">Yüklemeyi onayla</button>`:''}${o.status==='ok'&&jobStage(o)===3&&!rates.some(x=>x.k===rkey(o,'o'))?`<button class="chip" data-ir2="${i}">Taşıyıcıyı puanla</button>`:''}<button class="chip" data-bp="${i}">Profil</button><button class="chip" data-bu="${i}">Engelle</button></div></article>`).join('')+'<h2 class="jobs-heading">Taşıma taleplerim</h2>':'';
function simulate(id){setTimeout(()=>{const o=offers.find(x=>x.id===id);if(!o||o.status!=="wait"||(o.ownerUid||o.uid))return;Object.assign(o,{status:"ok"});save();if(tab==="mine"||tab==="me")render();toast("Demo: taşıma talebin kabul edildi");},3000);}

// ===== Bildirim ve alarm =====
// Uygulama içi bildirimler, zil, rota alarmı.

function notifs() {
    const a = [], rt = o => o.from + " → " + o.to;
    incoming.forEach(o => {
        const k = "i" + o.loadId + "_" + o.bidder;
        if (o.status === "wait" && !offerExp(o))
            a.push({ k: k + "w", t: nm(o.bidder) + " taşıma talebi gönderdi", s: rt(o) });
        if (o.status === "ok" && jobStage(o) === 1)
            a.push({ k: k + "s2", t: "Yükleme onayını bekliyor", s: rt(o) });
    });
    offers.forEach(o => {
        const k = "o" + o.id;
        if (o.status === "ok")
            a.push({ k: k + "ok", t: "Taşıma talebin kabul edildi", s: rt(o) });
        if (o.status === "no")
            a.push({ k: k + "no", t: "Taşıma talebin reddedildi", s: rt(o) });
        if (o.status === "counter")
            a.push({ k: k + "c" + o.counter, t: "Taşıma talebine yanıt bekleniyor", s: rt(o) });
        if (o.status === "ok" && (o.stage || 0) === 3)
            a.push({ k: k + "s3", t: "Yükleme onaylandı", s: rt(o) });
    });
    alerts.forEach(al => loads.filter(l => !l.closed && (!al.from || l.from === al.from) && (!al.to || l.to === al.to) && (!al.veh || l.veh === al.veh) && !(l.uid && l.uid === me)).forEach(l => a.push({ k: "a" + al.id + "_" + l.id, t: "Alarm: " + (al.from || "Her yer") + " → " + (al.to || "Her yer") + " yeni yük", s: l.cargo + " · " + l.ton + " ton", tab: "list" })));
    return a;
}

function bell() {
    const b = $("#bc");
    if (!b)
        return;
    const n = notifs().filter(x => !seen.has(x.k)).length;
    b.textContent = n > 9 ? "9+" : n;
    b.style.display = n ? "grid" : "none";
}

function openBell() {
    const a = notifs(), B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">Bildirimler</b><button class="chip" id="close">Kapat</button></div>` + (a.length ? a.map(x => `<button class="nt ${seen.has(x.k) ? "" : "new"}" data-nt="${x.tab || "mine"}"><b>${x.t}</b><span>${x.s}</span></button>`).join("") : `<div class="empty">Henüz bildirim yok.<br>Taşıma talebi geldiğinde veya yanıt aldığında burada görünür.</div>`);
    seen = new Set([...seen, ...a.map(x => x.k)]);
    try {
        localStorage.setItem("yy-seen", JSON.stringify([...seen]));
    }
    catch (e) { }
    B.querySelectorAll("[data-nt]").forEach(b => b.onclick = () => {
        closeSheet();
        tab = b.dataset.nt || "mine";
        mode = "load";
        setNav();
        render();
    });
    $("#close").onclick = () => {
        closeSheet();
        render();
    };
    $("#sheet").classList.add("open");
    bell();
}

function addAlert() {
    const al = { id: Date.now(), from: F.from || "", to: F.to || "", veh: F.veh[0] || "" };
    if (alerts.some(x => x.from === al.from && x.to === al.to && x.veh === al.veh))
        return toast("Bu alarm zaten kurulu");
    alerts.push(al);
    notifs().filter(x => x.k.startsWith("a" + al.id + "_")).forEach(x => seen.add(x.k));
    try {
        localStorage.setItem("yy-seen", JSON.stringify([...seen]));
    }
    catch (e) { }
    save();
    render();
    toast("Alarm kuruldu: " + (al.from || "Her yer") + " → " + (al.to || "Her yer"));
}

const alertsCard = () => `<div class="load" style="cursor:default"><b>Rota alarmlarım</b>${alerts.length ? alerts.map(x => `<div class="kv"><span style="color:var(--ink);font-weight:700">${esc(x.from || "Her yer")} → ${esc(x.to || "Her yer")}${x.veh ? " · " + esc(x.veh) : ""}</span><button class="chip" data-ad="${esc(x.id)}">Kaldır</button></div>`).join("") : `<p style="margin-top:8px;font-size:13px;color:var(--mute)">Filtre ekranında nereden ve nereye seçip listedeki "Alarm kur"a dokun. Uygun yük çıkınca bildirim gelir.</p>`}</div>`;

// ===== Mesajlaşma =====
// Teklif sohbeti (gerçek kullanıcılar arasında canlı, örnek ilanlarda hazır cevaplı).

function openChat(key, who, onFirstSend) {
    const live = cloud && /^o\d+_./.test(key), B = $("#sheetBody");
    B.dataset.k = key;
    let msgs = live ? [] : (chats[key] = chats[key] || [{ me: 0, t: "Merhaba, nasıl yardımcı olabilirim?" }]);
    const draw = () => {
        if (!$("#msgs") || B.dataset.k !== key)
            return;
        $("#msgs").innerHTML = msgs.map(x => `<div class="bub ${x.me ? "me" : ""}">${esc(x.t)}</div>`).join("");
        $("#msgs").scrollTop = 1e5;
    };
    B.innerHTML = `<div class="load-detail chat-detail"><div class="detail-top"><b>${who}</b><button class="chip detail-close" id="close" aria-label="Sohbeti kapat">Kapat ×</button></div>${!live ? '<p class="demo-note"><b>Demo sohbet</b> · Mesajlar cihazında tutulur; yanıtlar simüledir.</p>' : ""}<div id="msgs" role="log" aria-live="polite" aria-label="Mesajlar"></div><div class="chat-composer"><label class="sr-only" for="mi">Mesajın</label><input id="mi" placeholder="Mesaj yaz" maxlength="500"><button class="btn" id="ms">Gönder</button></div></div>`;
    if (unChat) {
        unChat();
        unChat = null;
    }
    if (live)
        unChat = db.collection("msgs").where("k", "==", key).onSnapshot(sn => {
            msgs = sn.docs.map(x => x.data()).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(x => ({ me: x.uid === me, t: String(x.t || "") }));
            draw();
        }, () => { });
    draw();
    syncDetailViewport();
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
    const send = () => {
        const t = $("#mi").value.trim().slice(0, 500);
        if (!t)
            return;
        if (onFirstSend) { onFirstSend(); onFirstSend = null; }
        $("#mi").value = "";
        if (live) {
            dbw(db.collection("msgs").add({ k: key, uid: me, t, ts: Date.now() }));
            return;
        }
        msgs.push({ me: 1, t });
        draw();
        save();
        setTimeout(() => {
            msgs.push({ me: 0, t: ["Tamamdır, yarın sabah yüklemeye hazırız.", "Fiyatta biraz esneyebiliriz, ne düşünüyorsun?", "Telefonla konuşalım mı?"][Math.floor(Math.random() * 3)] });
            draw();
            save();
        }, 1500);
    };
    $("#ms").onclick = send;
    $("#mi").onkeydown = e => {
        if (e.key === "Enter")
            send();
    };
}

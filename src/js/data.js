/**
 * Veri kuralları
 * Tarih, mesafe ve kayıt doğrulama; metinler ham saklanır, çizim sınırında kaçışlanır.
 */
const isRecord = v => !!v && typeof v === "object" && !Array.isArray(v);
const localDay = (value = Date.now()) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-") : "";
};
const validDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && localDay(d+"T12:00:00") === d;
function dateFields(value, now = Date.now()) {
    if (validDay(value)) return {date:value, dateEnd:""};
    const d = new Date(now); d.setHours(12,0,0,0);
    if (value === "Yarın") d.setDate(d.getDate()+1);
    const days = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
    if (days.includes(value)) d.setDate(d.getDate()+(days.indexOf(value)-d.getDay()+7)%7);
    const date = localDay(d);
    if (value === "Bu hafta") { d.setDate(d.getDate()+(7-d.getDay())%7); return {date,dateEnd:localDay(d)}; }
    return {date,dateEnd:""};
}
function dateLabel(x, now = Date.now()) {
    const d = typeof x === "string" ? x : x.date;
    if (!validDay(d)) return String(d || "Belirtilmedi");
    const end = typeof x === "object" && validDay(x.dateEnd) ? x.dateEnd : "";
    const format = v => new Date(v+"T12:00:00").toLocaleDateString("tr-TR",{day:"numeric",month:"short",year:"numeric"});
    if (end && end !== d) return format(d)+" – "+format(end);
    if (d === localDay(now)) return "Bugün";
    if (d === dateFields("Yarın",now).date) return "Yarın";
    return format(d);
}
const dateBucket = x => {
    const d = typeof x === "string" ? x : x.date;
    if (d === "Bugün" || d === "Yarın") return d;
    if (validDay(d)) {
        const end = typeof x === "object" && validDay(x.dateEnd) ? x.dateEnd : d, today=localDay();
        if (d <= today && end >= today) return "Bugün";
        if (d === dateFields("Yarın").date) return "Yarın";
    }
    return "İleri tarih";
};
const listingDistance = x => Number.isFinite(+x.km) && +x.km > 0 ? +x.km : dist(x.from,x.to) || 0;
const imageDataOK = (u, max=250000) => typeof u === "string" && u.length < max && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(u);
function normalizeListing(v) {
    if (!isRecord(v) || !["number","string"].includes(typeof v.id) || !String(v.id) || typeof v.from !== "string" || typeof v.to !== "string") return null;
    const x={...v};
    for (const k of ["cargo","note","owner","who","veh","body","phone","uid","date"]) if (k in x) x[k]=String(x[k]??"");
    for (const k of ["ton","cap","km","ts","featUntil","stage"]) if(k in x) x[k]=Number.isFinite(+x[k])?Math.max(0,+x[k]):0;
    if(Array.isArray(x.items)) x.items=x.items.filter(isRecord).slice(0,6).map(i=>({n:String(i.n||""),q:Math.max(0,+i.q||0),u:String(i.u||"")}));
    else delete x.items;
    if (!imageDataOK(x.img,60000)) delete x.img;
    if (x.mine && !x.ts) {
        const old=Number(String(x.id).replace(/^t/,""));
        x.ts=Number.isFinite(old)&&old>1e12?old:Date.now();
    }
    if ((x.mine || x.uid || x.ts) && !validDay(x.date)) Object.assign(x,dateFields(x.date,x.ts||Date.now()));
    if(Array.isArray(x.featWin)) x.featWin=x.featWin.filter(w=>Array.isArray(w)&&Number.isFinite(+w[0])&&Number.isFinite(+w[1]));
    if (x.status && !["wait","ok","counter","no"].includes(x.status)) x.status="wait";
    return x;
}

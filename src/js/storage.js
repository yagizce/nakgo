/**
 * Cihaz kaydı ve kurtarma
 * Sürümlü yerel veri, kalıcı yazma sonucu, geri alma ve eski kayıtların taşınması.
 */
const STORE_VERSION = 3;
let savedState = "", persistedState = "", recoveryBlocked = false, storageNotice = "";
const stateData = () => ({version:STORE_VERSION,loads,offers,trucks,chats,calc,favs,myCar,alerts,rates,prem,blocked,reports,cdocs});
function applyState(d) {
    ({loads,offers,trucks,chats,calc,favs,myCar,alerts,rates,prem,blocked,reports,cdocs}=d);
    carriers[me||"local"]={...myCar,ok:!!(myCar.lic&&myCar.src&&myCar.kb&&myCar.ruh)};
}
function normalizeState(d) {
    const base=stateData(), out={...base};
    for(const k of ["loads","offers","trucks"]) if(Array.isArray(d[k])) out[k]=d[k].map(normalizeListing).filter(Boolean);
    for(const k of ["favs","blocked"]) if(Array.isArray(d[k])) out[k]=d[k].filter(v=>["string","number"].includes(typeof v)).map(String);
    for(const k of ["alerts","reports"]) if(Array.isArray(d[k])) out[k]=d[k].filter(isRecord);
    if(Array.isArray(d.rates)) out.rates=d.rates.filter(isRecord).map(r=>({...r,stars:Math.min(5,Math.max(1,Math.round(+r.stars||1))),text:String(r.text||"")}));
    out.chats={};
    if(isRecord(d.chats)) for(const [k,msgs] of Object.entries(d.chats)) {
        if(!["__proto__","constructor","prototype"].includes(k)&&Array.isArray(msgs)) out.chats[k]=msgs.filter(isRecord).map(m=>({...m,me:m.me?1:0,t:String(m.t||"")}));
    }
    out.calc={...base.calc};
    if(isRecord(d.calc)) {
        for(const k of ["km","cons","fuel","toll","other"]) if(Number.isFinite(+d.calc[k])&&+d.calc[k]>=0) out.calc[k]=+d.calc[k];
        out.calc.back=d.calc.back===true;
        if (!fuelEstimate(out.calc)) out.calc={...base.calc};
    }
    if(isRecord(d.myCar)) out.myCar={...base.myCar,...d.myCar};
    for(const k of ["displayName","city","about","phone","lic"]) if(k in out.myCar) out.myCar[k]=typeof out.myCar[k]==="string"?out.myCar[k]:"";
    out.myCar.docs={...(isRecord(out.myCar.docs)?out.myCar.docs:{})};
    out.cdocs={};
    if(isRecord(d.cdocs)) for(const [k,u] of Object.entries(d.cdocs)) if(/^(local|[^/]+)\/(src|kb|ruh)$/.test(k)&&imageDataOK(u)) out.cdocs[k]=u;
    for(const k of ["src","kb","ruh"]) if(!out.cdocs["local/"+k]) out.myCar.docs[k]=false;
    if(isRecord(d.prem)) out.prem={until:Math.max(0,+d.prem.until||0),plan:String(d.prem.plan||"")};
    // Eski sürüm yalnızca ad/telefon alanlarını HTML olarak saklıyordu.
    if(!d.version || d.version<STORE_VERSION) {
        const raw=s=>String(s).replace(/&(amp|lt|gt|quot|#39);/g,(_,k)=>({amp:"&",lt:"<",gt:">",quot:'"',"#39":"'"}[k]));
        for(const k of ["loads","trucks","offers"]) out[k]=out[k].map(x=>{const v={...x};for(const key of ["owner","who","phone"])if(typeof v[key]==="string")v[key]=raw(v[key]);return v;});
    }
    return out;
}
function savePrefs() {
    if(!cloud) return;
    const prefs={favs,calc,alerts,blocked}, j=JSON.stringify(prefs);
    if(j===lastP) return;
    clearTimeout(pt);
    pt=setTimeout(()=>db.doc("data/users/"+me+"/prefs").set(prefs).then(()=>{lastP=j;}).catch(()=>toast("Tercihler bağlantı nedeniyle eşitlenemedi")),800);
}
function save(syncPrefs = true) {
    try {
        if(recoveryBlocked) throw new Error("recovery");
        const j=JSON.stringify(stateData());
        if(j!==persistedState) localStorage.setItem("yy2",j);
        persistedState=j;
        savedState=j;
        if (syncPrefs) savePrefs();
        return true;
    } catch(e) {
        if(savedState&&!cloud) applyState(JSON.parse(savedState));
        toast(recoveryBlocked?"Eski kayıt korunuyor; depolama erişimi olmadan yeni kayıt yapılamıyor":"Kaydedilemedi. Cihaz depolama alanını ve tarayıcı izinlerini kontrol et; tekrar dene.");
        return false;
    }
}
function restoreState() {
    try {
        const v=JSON.parse(localStorage.getItem("yy-seen")||"[]");
        seen=new Set(Array.isArray(v)?v.filter(x=>typeof x==="string"):[]);
        role=["owner","carrier"].includes(localStorage.getItem("yy-role"))?localStorage.getItem("yy-role"):"";
    } catch(e) { }
    try {
        const raw=localStorage.getItem("yy2");
        persistedState=raw||"";
        if(raw) {
            let d;
            try { d=JSON.parse(raw); } catch(e) { d=null; }
            const partial=!isRecord(d)||["loads","offers","trucks"].some(k=>!Array.isArray(d[k])||d[k].some(x=>!normalizeListing(x)));
            if(isRecord(d)&&d.version>STORE_VERSION){recoveryBlocked=true;storageNotice="Bu kayıt daha yeni bir uygulama sürümüne ait. Veriyi korumak için kaydetme kapalı; uygulamayı güncelle.";}
            if(partial) {
                // Bozuk/kısmi kaydı silmeden ayrı anahtarda koru. Yedeklenemiyorsa üstüne yazma.
                try { localStorage.setItem("yy2-recovery-"+Date.now(),raw); }
                catch(e) { recoveryBlocked=true; }
                storageNotice="Cihaz kaydının eksik bölümleri onarıldı. Önceki kayıt kurtarma kopyasında korundu.";
                if(recoveryBlocked) storageNotice="Cihaz kaydı okunamadı. Önceki kayıt korundu; depolama erişimi olmadan yeni değişiklikler kaydedilemez.";
            }
            if(isRecord(d)) applyState(normalizeState(d));
        }
    } catch(e) { storageNotice="Cihaz depolamasına erişilemiyor. Değişikliklerin kalıcı kaydı yapılamayabilir."; }
    // İlk başarısız yazmada da bellek güvenli başlangıç durumuna dönebilir.
    savedState=JSON.stringify(stateData());
    if (!recoveryBlocked) save(false);
    offers.filter(o=>o.status==="wait").forEach(o=>simulate(o.id));

}

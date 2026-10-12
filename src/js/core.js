/**
 * Çekirdek: yardımcılar, fotoğraf, kayıt, bulut
 * Kaçışlama ve biçimlendirme, fotoğraf işleme, localStorage kaydı ve geri yükleme, ortak veritabanı katmanı.
 */

// ===== Yardımcılar =====
// Kaçışlama, biçimlendirme, bildirim mesajı ve küçük genel işlevler.

const dk = d => dateBucket(d);

const tog = (a, v) => {
    const i = a.indexOf(v);
    i < 0 ? a.push(v) : a.splice(i, 1);
};

const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clean = o => isRecord(o) ? { ...o } : {};

const nm = u => names[u] || "Kullanıcı";

const dec = t => {
    const e = document.createElement("textarea");
    e.innerHTML = t;
    return e.value;
};

const imgOk = u => typeof u === "string" && u.length < 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(u);

const isDark = () => ["#0b1d22", "#101722"].includes(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

const opt2 = (a, d) => a.map(c => `<option ${c === d ? "selected" : ""}>${esc(c)}</option>`).join("");

const SKEL = [1, 2, 3].map(() => `<div class="load sk"><i></i><i></i><i></i></div>`).join("");

const weekStart = t => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
};

const f1 = n => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });



const $ = s => document.querySelector(s);

const fmt = n => n.toLocaleString("tr-TR") + " ₺";

function toast(t) {
    const e = $("#toast");
    e.textContent = t;
    e.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer=setTimeout(() => e.style.display = "none", 3500);
}

// ===== Fotoğraf =====
// Fotoğraf seçme, küçültme ve gösterme (ilan, belge, teslim fotoğrafı).

function shrink(file, cb, max, lim) {
    max = max || 720;
    lim = lim || 170000;
    const rd = new FileReader();
    rd.onload = () => {
        const im = new Image();
        im.onload = () => {
            const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
            c.width = Math.round(im.width * k);
            c.height = Math.round(im.height * k);
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            let u = "";
            for (const q of [.6, .45, .3]) {
                u = c.toDataURL("image/jpeg", q);
                if (u.length < lim)
                    break;
            }
            if (u.length >= lim) return toast("Fotoğraf çok büyük; daha küçük bir fotoğraf seç");
            cb(u);
        };
        im.onerror = () => toast("Fotoğraf okunamadı");
        im.src = rd.result;
    };
    rd.onerror = () => toast("Fotoğraf okunamadı");
    rd.readAsDataURL(file);
}

function pickImg(cb, max, lim) {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/*";
    i.onchange = () => {
        const f = i.files && i.files[0];
        if (f)
            shrink(f, cb, max, lim);
    };
    i.click();
}

function showImg(u, t) {
    const B = $("#sheetBody");
    B.dataset.k = "";
    B.innerHTML = `<b style="font-size:17px">${esc(t)}</b><div id="pi" style="margin-top:12px"></div><button class="btn alt" id="close">Kapat</button>`;
    if (imageDataOK(u)) {
        const im = new Image();
        im.src = u;
        im.alt = t;
        im.style.cssText = "width:100%;border-radius:12px";
        $("#pi").appendChild(im);
    }
    else
        $("#pi").textContent = "Fotoğraf bulunamadı.";
    $("#sheet").classList.add("open");
    $("#close").onclick = closeSheet;
}

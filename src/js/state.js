/**
 * Durum ve örnek veri
 * Uygulamanın tüm değişken durumu (let) ve yerel modda görünen örnek ilanlar ile boş araçlar.
 */

// ===== Genel durum =====
// Uygulamanın tüm değişken durumu (let). Yeni bir durum değişkeni eklerken ilgili gruba ekle.

// --- Gezinti ve arayüz ---
let tab = "list";
let filter = "Hepsi";
let q = "";
let sort = "new";
let mode = "load";
let postMode = "load";
let shown = 20;
let lastSig = "";
let loaded = true;
let sheetPushed = false;
let deferredInstall = null;
let postImg = "";

// --- İlan, teklif ve kullanıcı verisi ---
let loads = [];
let trucks = [];
let offers = [];
let incoming = [];
let allO = [];
let chats = {};
let rates = [];
let events = [];
let carriers = {};
let appr = {};
let cdocs = {};
let names = {};
let seen = new Set();
let pods = {};
let reports = [];

// --- Kullanıcı tercihleri ---
let favs = [];
let alerts = [];
let blocked = [];
let calc = { km: 450, cons: 32, fuel: 95, toll: 1200, other: 500, back: false };
let role = "";

// --- Filtre, yakınımda ve karşılaştırma ---
let F = F0();
let myPos = null;
let myCity = "";
let nearOn = false;
let nearR = 0;
let cmp = [];

// --- Hesap ve oturum ---
let cloud = false;
let me = "";
let myName = "";
let db = null;
let admin = false;
let myCar = { lic: "", src: false, kb: false, ruh: false };
let prem = { until: 0, plan: "" };

// --- Çalışma anı ---
let unChat = null;
let lastP = "";
let pt = 0;
let tracked = new Set();
let deepId = 0;

// ===== Örnek veri =====
// Yerel modda ve ilk açılışta görünen örnek ilanlar ve boş araçlar. Bulut modunda veritabanından gelen veriyle değiştirilir.

const SEED_LOADS_1 = [
    { id: 1, from: "İstanbul", to: "Ankara", cargo: "Paletli gıda", ton: 22, veh: "Tır", price: 28500, date: "Yarın" },
    { id: 2, from: "İzmir", to: "Bursa", cargo: "Mobilya", ton: 6, veh: "Kamyon", price: 14200, date: "Bugün" },
    { id: 3, from: "Mersin", to: "Konya", cargo: "Seramik", ton: 18, veh: "Tır", price: 21800, date: "Cuma" },
    { id: 4, from: "Ankara", to: "Kayseri", cargo: "Koli – ev eşyası", ton: 2, veh: "Kamyonet", price: 7600, date: "Yarın" },
    { id: 5, from: "Samsun", to: "Trabzon", cargo: "Çay ambalajı", ton: 10, veh: "Kamyon", price: 12900, date: "Cumartesi" }
];
loads.push(...SEED_LOADS_1);

const SEED_TRUCKS_1 = [
    { id: "t1", verified: true, who: "Hasan Y.", from: "İzmir", to: "İstanbul", veh: "Tır", cap: 24, body: "Tenteli", date: "Yarın", rate: 4.9 },
    { id: "t2", who: "Ömer Nakliyat", from: "Ankara", to: "Antalya", veh: "Kamyon", cap: 10, body: "Kapalı kasa", date: "Bugün", rate: 4.6 },
    { id: "t3", verified: true, who: "Kemal T.", from: "Konya", to: "Mersin", veh: "Kamyonet", cap: 3, body: "Kapalı kasa", date: "Cuma", rate: 4.7 }
];
trucks.push(...SEED_TRUCKS_1);

const SEED_META = [
    { km: 450, owner: "Anadolu Gıda A.Ş.", rate: 4.8, pay: "30 gün vade", body: "Tenteli", note: "Yükleme rampadan, 2 saat içinde tamamlanır." },
    { km: 330, owner: "Ege Mobilya", rate: 4.5, pay: "Teslimde nakit", body: "Kapalı kasa", note: "Hassas ürün, bağlama kayışı gerekli." },
    { km: 520, owner: "Akdeniz Seramik", rate: 4.2, pay: "15 gün vade", body: "Tenteli", note: "Forklift ile yükleme, sevk irsaliyesi hazır." },
    { km: 320, owner: "Bireysel – Mehmet K.", rate: 4.9, pay: "Peşin", body: "Kapalı kasa", note: "3. kat, asansör yok, 2 kişi yardımcı var." },
    { km: 180, owner: "Karadeniz Çay", rate: 4.6, pay: "Teslimde nakit", body: "Kapalı kasa", note: "Nemden korunmalı." }
];

loads.forEach((l, i) => Object.assign(l, SEED_META[i]));

loads.push({ id: 6, from: "Gaziantep", to: "İstanbul", cargo: "Fıstık – çuval", ton: 24, veh: "Tır", price: 52000, date: "Pazartesi", km: 1130, owner: "Antep Kuruyemiş", rate: 4.7, pay: "7 gün vade", body: "Tenteli", note: "ADR gerekmez. Gümrük yok." }, { id: 7, from: "Bursa", to: "İzmir", cargo: "Otomotiv yedek parça", ton: 8, veh: "Kamyon", price: 15800, date: "Yarın", km: 330, owner: "Uludağ Oto Parça", rate: 4.4, pay: "30 gün vade", body: "Kapalı kasa", note: "Palet değişimi var." }, { id: 8, from: "Antalya", to: "Ankara", cargo: "Sera ürünü (domates)", ton: 20, veh: "Tır", price: 31000, date: "Bugün", km: 540, owner: "Sera Birlik", rate: 4.3, pay: "Peşin", body: "Frigorifik", note: "Isı +8°C sabit tutulmalı." }, { id: 9, from: "Kayseri", to: "Adana", cargo: "Beyaz eşya", ton: 3, veh: "Kamyonet", price: 9400, date: "Cuma", km: 350, owner: "Erciyes Elektrik", rate: 4.8, pay: "Teslimde nakit", body: "Kapalı kasa", note: "12 adet, kutulu." });

loads.push({ id: 10, from: "Mersin", to: "İstanbul", cargo: "40' konteyner – tekstil", ton: 26, veh: "Konteyner", price: 48000, date: "Bugün", km: 950, owner: "Liman Lojistik", rate: 4.6, pay: "15 gün vade", body: "Konteyner", note: "Liman çıkışlı, gate pass hazır." }, { id: 11, from: "Adana", to: "Ankara", cargo: "Akaryakıt", ton: 22, veh: "Tanker", price: 29500, date: "Yarın", km: 480, owner: "Çukurova Petrol", rate: 4.8, pay: "7 gün vade", body: "Tanker", note: "ADR belgesi zorunlu." }, { id: 12, from: "Kayseri", to: "Ankara", cargo: "Kum ve çakıl", ton: 16, veh: "Kırkayak", price: 13500, date: "Cuma", km: 320, owner: "Erciyes İnşaat", rate: 4.1, pay: "Teslimde nakit", body: "Damperli", note: "Şantiye girişi dar." }, { id: 13, from: "İzmir", to: "Antalya", cargo: "E-ticaret kolileri", ton: 1, veh: "Panelvan", price: 5200, date: "Bugün", km: 470, owner: "Hızlı Kargo", rate: 4.4, pay: "Peşin", body: "Kapalı kasa", note: "Yaklaşık 120 koli." }, { id: 14, from: "Samsun", to: "İstanbul", cargo: "İş makinesi (ekskavatör)", ton: 28, veh: "Lowbed", price: 52000, date: "Pazartesi", km: 740, owner: "Karadeniz Yapı", rate: 4.7, pay: "30 gün vade", body: "Lowbed", note: "Özel izin evrakı yük sahibinde." });

loads.push({ id: 15, from: "Ankara", to: "İstanbul", cargo: "Beyaz eşya", ton: 20, veh: "Tır", price: 27500, date: "Yarın", km: 450, owner: "Başkent Elektronik", rate: 4.6, pay: "15 gün vade", body: "Tenteli", note: "Rampadan yükleme." }, { id: 16, from: "Konya", to: "Mersin", cargo: "Un çuvalı", ton: 18, veh: "Tır", price: 19800, date: "Cuma", km: 330, owner: "Konya Un", rate: 4.5, pay: "Peşin", body: "Tenteli", note: "Çuval, palet yok." }, { id: 17, from: "Trabzon", to: "Samsun", cargo: "Fındık", ton: 9, veh: "Kamyon", price: 12400, date: "Bugün", km: 340, owner: "Karadeniz Fındık", rate: 4.7, pay: "Teslimde nakit", body: "Kapalı kasa", note: "Kuru yük, nemden korunmalı." });

[[1, [{ n: "Paletli gıda", q: 22, u: "palet" }, { n: "Koli su", q: 40, u: "koli" }]], [2, [{ n: "Koltuk takımı", q: 4, u: "adet" }, { n: "Yemek masası", q: 2, u: "adet" }]], [4, [{ n: "Ev eşyası kolisi", q: 35, u: "koli" }]]].forEach(([id, it]) => {
    const l = loads.find(x => x.id === id);
    if (l)
        l.items = it;
});

trucks.push({ id: "t4", verified: true, approved: true, who: "Yılmaz Ağır Nakliyat", from: "Samsun", to: "Mersin", veh: "Lowbed", cap: 30, body: "Lowbed", date: "Cuma", rate: 4.8 }, { id: "t5", who: "Selim K.", from: "Bursa", to: "İstanbul", veh: "Panelvan", cap: 1.5, body: "Kapalı kasa", date: "Bugün", rate: 4.5 }, { id: "t6", verified: true, who: "Doğu Tankercilik", from: "Mersin", to: "Gaziantep", veh: "Tanker", cap: 25, body: "Tanker", date: "Yarın", rate: 4.6 });

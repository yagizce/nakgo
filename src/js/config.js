/**
 * Sabitler ve mesafeler
 * Şehir merkezleri, araç tipleri, üyelik sabitleri ve tahmini mesafe. Çalışma anında değişen durum yoktur.
 */

// ===== Sabitler ve tablolar =====
// Şehirler, araç tipleri, fiyat ve süre sabitleri, mesafe tabloları. Burada çalışma anında değişen durum yoktur.

const B12 = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Konya", "Adana", "Gaziantep", "Kayseri", "Samsun", "Trabzon", "Mersin"];

const LL = { "Adana": [35.32, 37.0], "Adıyaman": [38.28, 37.76], "Afyonkarahisar": [30.54, 38.76], "Ağrı": [43.05, 39.72], "Aksaray": [34.03, 38.37], "Amasya": [35.83, 40.65], "Ankara": [32.86, 39.93], "Antalya": [30.7, 36.9], "Ardahan": [42.7, 41.11], "Artvin": [41.82, 41.18], "Aydın": [27.84, 37.85], "Balıkesir": [27.89, 39.65], "Bartın": [32.34, 41.64], "Batman": [41.13, 37.88], "Bayburt": [40.23, 40.26], "Bilecik": [29.98, 40.14], "Bingöl": [40.5, 38.88], "Bitlis": [42.11, 38.4], "Bolu": [31.61, 40.73], "Burdur": [30.29, 37.72], "Bursa": [29.06, 40.19], "Çanakkale": [26.41, 40.15], "Çankırı": [33.62, 40.6], "Çorum": [34.95, 40.55], "Denizli": [29.09, 37.78], "Diyarbakır": [40.24, 37.91], "Düzce": [31.16, 40.84], "Edirne": [26.56, 41.68], "Elazığ": [39.22, 38.68], "Erzincan": [39.49, 39.75], "Erzurum": [41.27, 39.9], "Eskişehir": [30.52, 39.78], "Gaziantep": [37.38, 37.07], "Giresun": [38.39, 40.91], "Gümüşhane": [39.48, 40.46], "Hakkari": [43.74, 37.58], "Hatay": [36.35, 36.4], "Iğdır": [44.04, 39.92], "Isparta": [30.55, 37.76], "İstanbul": [28.98, 41.01], "İzmir": [27.14, 38.42], "Kahramanmaraş": [36.94, 37.58], "Karabük": [32.63, 41.2], "Karaman": [33.22, 37.18], "Kars": [43.1, 40.6], "Kastamonu": [33.78, 41.38], "Kayseri": [35.49, 38.73], "Kırıkkale": [33.52, 39.85], "Kırklareli": [27.23, 41.74], "Kırşehir": [34.17, 39.15], "Kilis": [37.12, 36.72], "Kocaeli": [29.94, 40.77], "Konya": [32.48, 37.87], "Kütahya": [29.98, 39.42], "Malatya": [38.31, 38.35], "Manisa": [27.43, 38.61], "Mardin": [40.74, 37.31], "Mersin": [34.64, 36.81], "Muğla": [28.36, 37.22], "Muş": [41.49, 38.74], "Nevşehir": [34.71, 38.62], "Niğde": [34.68, 37.97], "Ordu": [37.88, 40.98], "Osmaniye": [36.25, 37.07], "Rize": [40.52, 41.02], "Sakarya": [30.4, 40.76], "Samsun": [36.33, 41.29], "Siirt": [41.94, 37.93], "Sinop": [35.15, 42.03], "Sivas": [37.02, 39.75], "Şanlıurfa": [38.79, 37.16], "Şırnak": [42.46, 37.52], "Tekirdağ": [27.51, 40.98], "Tokat": [36.55, 40.31], "Trabzon": [39.72, 41.0], "Tunceli": [39.55, 39.11], "Uşak": [29.41, 38.68], "Van": [43.38, 38.49], "Yalova": [29.27, 40.65], "Yozgat": [34.81, 39.82], "Zonguldak": [31.8, 41.46] };

const cities = Object.keys(LL).sort((a, b) => a.localeCompare(b, "tr"));

const vehicles = ["Tır", "Kırkayak", "Kamyon", "Kamyonet", "Panelvan", "Tanker", "Lowbed", "Konteyner"];

const bodies = ["Tenteli", "Kapalı kasa", "Açık kasa", "Frigorifik", "Damperli", "Tanker", "Lowbed", "Konteyner"];

const CONS = { Tır: 32, Kırkayak: 30, Kamyon: 22, Kamyonet: 9, Panelvan: 8, Tanker: 35, Lowbed: 42, Konteyner: 34 };

const STT = { wait: "Yanıt bekleniyor", ok: "Kabul edildi", counter: "Görüşme bekleniyor", no: "Reddedildi" };

const FI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>';

const D = [[450, 480, 155, 700, 660, 940, 1130, 790, 740, 1100, 950], [580, 380, 540, 260, 490, 680, 320, 410, 780, 480], [330, 470, 580, 920, 1100, 830, 980, 1350, 850], [620, 520, 850, 1050, 700, 700, 1050, 800], [320, 550, 850, 640, 850, 1250, 480], [340, 640, 330, 700, 1050, 330], [330, 350, 760, 1100, 70], [460, 850, 1000, 340], [500, 720, 420], [340, 810], [1130]];

const SL = [["M1 6h13v10H1zM14 10h4l3 3v3h-7", "Yük bul, araç bul", "Yük sahipleri ilan verir, taşıyıcılar doğrudan görüşür. Aracın boş kalmasın, yükün beklemesin."], ["M3 17l6-6 4 4 8-8M15 7h6v6", "Yolunu gör, giderini planla", "Gerçek yol haritasında çıkış ve varışı gör, mazot giderini hesapla."], ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4", "Önce güven", "Belgeli ve onaylı taşıyıcı rozetleri, yükleme onayı ve karşılıklı puanlama."]];

const PLANS = [{ id: "m", name: "Aylık", price: 299, days: 30 }, { id: "y", name: "Yıllık", price: 3099, days: 365 }];

const TTL = { load: 14, truck: 7, offer: 3 };

const SUPPORT_MAIL = "destek@example.com";

const FAQ = [["Premium üyelik nedir?", "Premium üyeler ilan sahiplerini ve taşıyıcıları arayabilir ve uygulama içinden mesajlaşabilir."], ["Rozetler ne anlama gelir?", "Belgeli: taşıyıcı belgelerini kendisi beyan etti. Onaylı: belgeleri yönetici tarafından kontrol edildi."], ["Yükleme nasıl onaylanır?", "Taşıyıcı İşlerim bölümünde Yükledim der; yük sahibi yüklemeyi onaylar. Teslim fotoğrafı adımı yoktur."], ["Şüpheli bir ilan görürsem ne yapmalıyım?", "İlan detayındaki Şikayet et düğmesini kullan. Gerekirse kullanıcıyı engelleyebilirsin."], ["Verilerim nerede tutuluyor?", "Bu test sürümünde veriler cihazında veya ortak test veritabanında tutulur."]];

/* Öne çıkan ilan ve boş araç ilanı: sabit fiyat listesi, saate göre değişmez. Ürün kuralları docs/product.md içinde. */
const FEAT = { prices: { l: { 3: 19, 6: 32, 12: 61, 24: 99, 72: 267 }, t: { 3: 19, 6: 32, 12: 61, 24: 99, 72: 267 } } };

const FDUR = [[3, "3 saat"], [6, "6 saat"], [12, "12 saat"], [24, "24 saat"], [72, "3 gün"]];




const VB = '<span class="vb">✓ Belgeli</span>';

const VA = '<span class="vb va">✓ Onaylı</span>';

// ===== Mesafe ve harita =====
// Kuş uçuşu ve tablo mesafesi, en yakın il, tahmini şehir mesafeleri.

function dist(a, b) {
    if (a === b)
        return 0;
    const i = B12.indexOf(a), j = B12.indexOf(b);
    if (i >= 0 && j >= 0) {
        const x = Math.min(i, j), y = Math.max(i, j);
        return D[x][y - x - 1];
    }
    const p = LL[a], q = LL[b];
    if (!p || !q)
        return 0;
    const R = 6371, rd = Math.PI / 180, h = Math.sin((q[1] - p[1]) * rd / 2) ** 2 + Math.cos(p[1] * rd) * Math.cos(q[1] * rd) * Math.sin((q[0] - p[0]) * rd / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 / 5) * 5;
}

const hav = (p, q) => {
    const R = 6371, rd = Math.PI / 180, h = Math.sin((q[1] - p[1]) * rd / 2) ** 2 + Math.cos(p[1] * rd) * Math.cos(q[1] * rd) * Math.sin((q[0] - p[0]) * rd / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

function nearestCity(p) {
    let b = "", m = 9e9;
    for (const c in LL) {
        const d = hav(p, LL[c]);
        if (d < m) {
            m = d;
            b = c;
        }
    }
    return b;
}

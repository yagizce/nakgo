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



const FI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>';

const D = [[450, 480, 155, 700, 660, 940, 1130, 790, 740, 1100, 950], [580, 380, 540, 260, 490, 680, 320, 410, 780, 480], [330, 470, 580, 920, 1100, 830, 980, 1350, 850], [620, 520, 850, 1050, 700, 700, 1050, 800], [320, 550, 850, 640, 850, 1250, 480], [340, 640, 330, 700, 1050, 330], [330, 350, 760, 1100, 70], [460, 850, 1000, 340], [500, 720, 420], [340, 810], [1130]];

// İlk açılış tanıtımı: [ekran görüntüsü, başlık, metin, görüntü açıklaması]. Görüntüler icons/onboarding içinde.
const SL = [["list", "Yük bul, araç bul", "Yük sahipleri ilan verir, taşıyıcılar boş aracını duyurur. Aracın boş kalmasın, yükün beklemesin.", "İlanlar ekranı: rota arama ve Mersin–Ankara yük ilanı"], ["calc", "Giderini önceden planla", "Mesafeyi ve tüketimi gir; mazot ve yol giderini yola çıkmadan gör.", "Mazot ve Gider Hesaplama ekranı: tahmini toplam gider"], ["detail", "İlan sahibine doğrudan ulaş", "İlanlara giriş yapmadan göz at. Aramak ve mesaj göndermek için ücretsiz hesap aç.", "İlan detayı: taşıma bilgileri ile Ara ve Mesaj gönder düğmeleri"]];

const PLANS = [{ id: "m", name: "Aylık", price: 299, days: 30 }, { id: "y", name: "Yıllık", price: 3099, days: 365 }];

const TTL = { load: 14, truck: 7, offer: 3 };

const SUPPORT_MAIL = "destek@nakgolojistik.com";

const FAQ = [["NakGo'yu kullanmak ücretli mi?", "İlanları görmek, kayıt olmak ve ilan vermek şu an ücretsizdir."], ["İlanları görmek için kayıt olmam gerekir mi?", "Hayır. Açık ilanları herkes görebilir. İlan sahibiyle iletişime geçmek ve ilan vermek için ücretsiz hesap gerekir."], ["İlan sahibiyle nasıl iletişime geçerim?", "Giriş yaptıktan sonra ilan detayındaki Mesaj gönder düğmesiyle uygulama içinden yazabilirsin."], ["İlanımı nasıl verir ve yönetirim?", "İlan ver sekmesinden yük veya boş araç ilanı oluştur. İlanlarını Profil'deki İlanlarım bölümünden düzenleyebilir veya kapatabilirsin."], ["Mazot ve Gider Hesaplama ne işe yarar?", "Mesafe, tüketim ve litre fiyatını girerek yolun yaklaşık giderini hesaplar. Sonuç tahminidir."], ["Şüpheli bir ilan görürsem ne yapmalıyım?", "İlan numarasıyla birlikte destek adresimize yaz; ilanı inceleriz."], ["Verilerim nerede tutuluyor?", "Hesap, ilan ve mesaj bilgilerin NakGo sunucularında saklanır. Telefon numaran ilanlarda herkese açık gösterilmez."]];

/* Öne çıkan ilan ve boş araç ilanı: sabit fiyat listesi, saate göre değişmez. Ürün kuralları docs/product.md içinde. */
const FEAT = { prices: { l: { 3: 19, 6: 32, 12: 61, 24: 99, 72: 267 }, t: { 3: 19, 6: 32, 12: 61, 24: 99, 72: 267 } } };

const FDUR = [[3, "3 saat"], [6, "6 saat"], [12, "12 saat"], [24, "24 saat"], [72, "3 gün"]];






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

// İl ve ilçe listesi: 81 il, 973 ilçe; kaynak turkey-neighbourhoods 4.0.3 (MIT). İlçe seçimi isteğe bağlıdır.
const DISTRICTS = {
"Adana":["Aladağ","Ceyhan","Çukurova","Feke","İmamoğlu","Karaisalı","Karataş","Kozan","Pozantı","Saimbeyli","Sarıçam","Seyhan","Tufanbeyli","Yumurtalık","Yüreğir"],
"Adıyaman":["Besni","Çelikhan","Gerger","Gölbaşı","Kahta","Merkez","Samsat","Sincik","Tut"],
"Afyonkarahisar":["Başmakçı","Bayat","Bolvadin","Çay","Çobanlar","Dazkırı","Dinar","Emirdağ","Evciler","Hocalar","İhsaniye","İscehisar","Kızılören","Merkez","Sandıklı","Sinanpaşa","Sultandağı","Şuhut"],
"Ağrı":["Diyadin","Doğubayazıt","Eleşkirt","Hamur","Merkez","Patnos","Taşlıçay","Tutak"],
"Aksaray":["Ağaçören","Eskil","Gülağaç","Güzelyurt","Merkez","Ortaköy","Sarıyahşi","Sultanhanı"],
"Amasya":["Göynücek","Gümüşhacıköy","Hamamözü","Merkez","Merzifon","Suluova","Taşova"],
"Ankara":["Akyurt","Altındağ","Ayaş","Bala","Beypazarı","Çamlıdere","Çankaya","Çubuk","Elmadağ","Etimesgut","Evren","Gölbaşı","Güdül","Haymana","Kahramankazan","Kalecik","Keçiören","Kızılcahamam","Mamak","Nallıhan","Polatlı","Pursaklar","Sincan","Şereflikoçhisar","Yenimahalle"],
"Antalya":["Akseki","Aksu","Alanya","Demre","Döşemealtı","Elmalı","Finike","Gazipaşa","Gündoğmuş","İbradı","Kaş","Kemer","Kepez","Konyaaltı","Korkuteli","Kumluca","Manavgat","Muratpaşa","Serik"],
"Ardahan":["Çıldır","Damal","Göle","Hanak","Merkez","Posof"],
"Artvin":["Ardanuç","Arhavi","Borçka","Hopa","Kemalpaşa","Merkez","Murgul","Şavşat","Yusufeli"],
"Aydın":["Bozdoğan","Buharkent","Çine","Didim","Efeler","Germencik","İncirliova","Karacasu","Karpuzlu","Koçarlı","Köşk","Kuşadası","Kuyucak","Nazilli","Söke","Sultanhisar","Yenipazar"],
"Balıkesir":["Altıeylül","Ayvalık","Balya","Bandırma","Bigadiç","Burhaniye","Dursunbey","Edremit","Erdek","Gömeç","Gönen","Havran","İvrindi","Karesi","Kepsut","Manyas","Marmara","Savaştepe","Sındırgı","Susurluk"],
"Bartın":["Amasra","Kurucaşile","Merkez","Ulus"],
"Batman":["Beşiri","Gercüş","Hasankeyf","Kozluk","Merkez","Sason"],
"Bayburt":["Aydıntepe","Demirözü","Merkez"],
"Bilecik":["Bozüyük","Gölpazarı","İnhisar","Merkez","Osmaneli","Pazaryeri","Söğüt","Yenipazar"],
"Bingöl":["Adaklı","Genç","Karlıova","Kiğı","Merkez","Solhan","Yayladere","Yedisu"],
"Bitlis":["Adilcevaz","Ahlat","Güroymak","Hizan","Merkez","Mutki","Tatvan"],
"Bolu":["Dörtdivan","Gerede","Göynük","Kıbrıscık","Mengen","Merkez","Mudurnu","Seben","Yeniçağa"],
"Burdur":["Ağlasun","Altınyayla","Bucak","Çavdır","Çeltikçi","Gölhisar","Karamanlı","Kemer","Merkez","Tefenni","Yeşilova"],
"Bursa":["Büyükorhan","Gemlik","Gürsu","Harmancık","İnegöl","İznik","Karacabey","Keles","Kestel","Mudanya","Mustafakemalpaşa","Nilüfer","Orhaneli","Orhangazi","Osmangazi","Yenişehir","Yıldırım"],
"Çanakkale":["Ayvacık","Bayramiç","Biga","Bozcaada","Çan","Eceabat","Ezine","Gelibolu","Gökçeada","Lapseki","Merkez","Yenice"],
"Çankırı":["Atkaracalar","Bayramören","Çerkeş","Eldivan","Ilgaz","Kızılırmak","Korgun","Kurşunlu","Merkez","Orta","Şabanözü","Yapraklı"],
"Çorum":["Alaca","Bayat","Boğazkale","Dodurga","İskilip","Kargı","Laçin","Mecitözü","Merkez","Oğuzlar","Ortaköy","Osmancık","Sungurlu","Uğurludağ"],
"Denizli":["Acıpayam","Babadağ","Baklan","Bekilli","Beyağaç","Bozkurt","Buldan","Çal","Çameli","Çardak","Çivril","Güney","Honaz","Kale","Merkezefendi","Pamukkale","Sarayköy","Serinhisar","Tavas"],
"Diyarbakır":["Bağlar","Bismil","Çermik","Çınar","Çüngüş","Dicle","Eğil","Ergani","Hani","Hazro","Kayapınar","Kocaköy","Kulp","Lice","Silvan","Sur","Yenişehir"],
"Düzce":["Akçakoca","Cumayeri","Çilimli","Gölyaka","Gümüşova","Kaynaşlı","Merkez","Yığılca"],
"Edirne":["Enez","Havsa","İpsala","Keşan","Lalapaşa","Meriç","Merkez","Süloğlu","Uzunköprü"],
"Elazığ":["Ağın","Alacakaya","Arıcak","Baskil","Karakoçan","Keban","Kovancılar","Maden","Merkez","Palu","Sivrice"],
"Erzincan":["Çayırlı","İliç","Kemah","Kemaliye","Merkez","Otlukbeli","Refahiye","Tercan","Üzümlü"],
"Erzurum":["Aşkale","Aziziye","Çat","Hınıs","Horasan","İspir","Karaçoban","Karayazı","Köprüköy","Narman","Oltu","Olur","Palandöken","Pasinler","Pazaryolu","Şenkaya","Tekman","Tortum","Uzundere","Yakutiye"],
"Eskişehir":["Alpu","Beylikova","Çifteler","Günyüzü","Han","İnönü","Mahmudiye","Mihalgazi","Mihalıççık","Odunpazarı","Sarıcakaya","Seyitgazi","Sivrihisar","Tepebaşı"],
"Gaziantep":["Araban","İslahiye","Karkamış","Nizip","Nurdağı","Oğuzeli","Şahinbey","Şehitkamil","Yavuzeli"],
"Giresun":["Alucra","Bulancak","Çamoluk","Çanakçı","Dereli","Doğankent","Espiye","Eynesil","Görele","Güce","Keşap","Merkez","Piraziz","Şebinkarahisar","Tirebolu","Yağlıdere"],
"Gümüşhane":["Kelkit","Köse","Kürtün","Merkez","Şiran","Torul"],
"Hakkari":["Çukurca","Derecik","Merkez","Şemdinli","Yüksekova"],
"Hatay":["Altınözü","Antakya","Arsuz","Belen","Defne","Dörtyol","Erzin","Hassa","İskenderun","Kırıkhan","Kumlu","Payas","Reyhanlı","Samandağ","Yayladağı"],
"Iğdır":["Aralık","Karakoyunlu","Merkez","Tuzluca"],
"Isparta":["Aksu","Atabey","Eğirdir","Gelendost","Gönen","Keçiborlu","Merkez","Senirkent","Sütçüler","Şarkikaraağaç","Uluborlu","Yalvaç","Yenişarbademli"],
"İstanbul":["Adalar","Arnavutköy","Ataşehir","Avcılar","Bağcılar","Bahçelievler","Bakırköy","Başakşehir","Bayrampaşa","Beşiktaş","Beykoz","Beylikdüzü","Beyoğlu","Büyükçekmece","Çatalca","Çekmeköy","Esenler","Esenyurt","Eyüpsultan","Fatih","Gaziosmanpaşa","Güngören","Kadıköy","Kağıthane","Kartal","Küçükçekmece","Maltepe","Pendik","Sancaktepe","Sarıyer","Silivri","Sultanbeyli","Sultangazi","Şile","Şişli","Tuzla","Ümraniye","Üsküdar","Zeytinburnu"],
"İzmir":["Aliağa","Balçova","Bayındır","Bayraklı","Bergama","Beydağ","Bornova","Buca","Çeşme","Çiğli","Dikili","Foça","Gaziemir","Güzelbahçe","Karabağlar","Karaburun","Karşıyaka","Kemalpaşa","Kınık","Kiraz","Konak","Menderes","Menemen","Narlıdere","Ödemiş","Seferihisar","Selçuk","Tire","Torbalı","Urla"],
"Kahramanmaraş":["Afşin","Andırın","Çağlayancerit","Dulkadiroğlu","Ekinözü","Elbistan","Göksun","Nurhak","Onikişubat","Pazarcık","Türkoğlu"],
"Karabük":["Eflani","Eskipazar","Merkez","Ovacık","Safranbolu","Yenice"],
"Karaman":["Ayrancı","Başyayla","Ermenek","Kazımkarabekir","Merkez","Sarıveliler"],
"Kars":["Akyaka","Arpaçay","Digor","Kağızman","Merkez","Sarıkamış","Selim","Susuz"],
"Kastamonu":["Abana","Ağlı","Araç","Azdavay","Bozkurt","Cide","Çatalzeytin","Daday","Devrekani","Doğanyurt","Hanönü","İhsangazi","İnebolu","Küre","Merkez","Pınarbaşı","Seydiler","Şenpazar","Taşköprü","Tosya"],
"Kayseri":["Akkışla","Bünyan","Develi","Felahiye","Hacılar","İncesu","Kocasinan","Melikgazi","Özvatan","Pınarbaşı","Sarıoğlan","Sarız","Talas","Tomarza","Yahyalı","Yeşilhisar"],
"Kırıkkale":["Bahşılı","Balışeyh","Çelebi","Delice","Karakeçili","Keskin","Merkez","Sulakyurt","Yahşihan"],
"Kırklareli":["Babaeski","Demirköy","Kofçaz","Lüleburgaz","Merkez","Pehlivanköy","Pınarhisar","Vize"],
"Kırşehir":["Akçakent","Akpınar","Boztepe","Çiçekdağı","Kaman","Merkez","Mucur"],
"Kilis":["Elbeyli","Merkez","Musabeyli","Polateli"],
"Kocaeli":["Başiskele","Çayırova","Darıca","Derince","Dilovası","Gebze","Gölcük","İzmit","Kandıra","Karamürsel","Kartepe","Körfez"],
"Konya":["Ahırlı","Akören","Akşehir","Altınekin","Beyşehir","Bozkır","Cihanbeyli","Çeltik","Çumra","Derbent","Derebucak","Doğanhisar","Emirgazi","Ereğli","Güneysınır","Hadim","Halkapınar","Hüyük","Ilgın","Kadınhanı","Karapınar","Karatay","Kulu","Meram","Sarayönü","Selçuklu","Seydişehir","Taşkent","Tuzlukçu","Yalıhüyük","Yunak"],
"Kütahya":["Altıntaş","Aslanapa","Çavdarhisar","Domaniç","Dumlupınar","Emet","Gediz","Hisarcık","Merkez","Pazarlar","Simav","Şaphane","Tavşanlı"],
"Malatya":["Akçadağ","Arapgir","Arguvan","Battalgazi","Darende","Doğanşehir","Doğanyol","Hekimhan","Kale","Kuluncak","Pütürge","Yazıhan","Yeşilyurt"],
"Manisa":["Ahmetli","Akhisar","Alaşehir","Demirci","Gölmarmara","Gördes","Kırkağaç","Köprübaşı","Kula","Salihli","Sarıgöl","Saruhanlı","Selendi","Soma","Şehzadeler","Turgutlu","Yunusemre"],
"Mardin":["Artuklu","Dargeçit","Derik","Kızıltepe","Mazıdağı","Midyat","Nusaybin","Ömerli","Savur","Yeşilli"],
"Mersin":["Akdeniz","Anamur","Aydıncık","Bozyazı","Çamlıyayla","Erdemli","Gülnar","Mezitli","Mut","Silifke","Tarsus","Toroslar","Yenişehir"],
"Muğla":["Bodrum","Dalaman","Datça","Fethiye","Kavaklıdere","Köyceğiz","Marmaris","Menteşe","Milas","Ortaca","Seydikemer","Ula","Yatağan"],
"Muş":["Bulanık","Hasköy","Korkut","Malazgirt","Merkez","Varto"],
"Nevşehir":["Acıgöl","Avanos","Derinkuyu","Gülşehir","Hacıbektaş","Kozaklı","Merkez","Ürgüp"],
"Niğde":["Altunhisar","Bor","Çamardı","Çiftlik","Merkez","Ulukışla"],
"Ordu":["Akkuş","Altınordu","Aybastı","Çamaş","Çatalpınar","Çaybaşı","Fatsa","Gölköy","Gülyalı","Gürgentepe","İkizce","Kabadüz","Kabataş","Korgan","Kumru","Mesudiye","Perşembe","Ulubey","Ünye"],
"Osmaniye":["Bahçe","Düziçi","Hasanbeyli","Kadirli","Merkez","Sumbas","Toprakkale"],
"Rize":["Ardeşen","Çamlıhemşin","Çayeli","Derepazarı","Fındıklı","Güneysu","Hemşin","İkizdere","İyidere","Kalkandere","Merkez","Pazar"],
"Sakarya":["Adapazarı","Akyazı","Arifiye","Erenler","Ferizli","Geyve","Hendek","Karapürçek","Karasu","Kaynarca","Kocaali","Pamukova","Sapanca","Serdivan","Söğütlü","Taraklı"],
"Samsun":["19 Mayıs","Alaçam","Asarcık","Atakum","Ayvacık","Bafra","Canik","Çarşamba","Havza","İlkadım","Kavak","Ladik","Salıpazarı","Tekkeköy","Terme","Vezirköprü","Yakakent"],
"Siirt":["Baykan","Eruh","Kurtalan","Merkez","Pervari","Şirvan","Tillo"],
"Sinop":["Ayancık","Boyabat","Dikmen","Durağan","Erfelek","Gerze","Merkez","Saraydüzü","Türkeli"],
"Sivas":["Akıncılar","Altınyayla","Divriği","Doğanşar","Gemerek","Gölova","Gürün","Hafik","İmranlı","Kangal","Koyulhisar","Merkez","Suşehri","Şarkışla","Ulaş","Yıldızeli","Zara"],
"Şanlıurfa":["Akçakale","Birecik","Bozova","Ceylanpınar","Eyyübiye","Halfeti","Haliliye","Harran","Hilvan","Karaköprü","Siverek","Suruç","Viranşehir"],
"Şırnak":["Beytüşşebap","Cizre","Güçlükonak","İdil","Merkez","Silopi","Uludere"],
"Tekirdağ":["Çerkezköy","Çorlu","Ergene","Hayrabolu","Kapaklı","Malkara","Marmaraereğlisi","Muratlı","Saray","Süleymanpaşa","Şarköy"],
"Tokat":["Almus","Artova","Başçiftlik","Erbaa","Merkez","Niksar","Pazar","Reşadiye","Sulusaray","Turhal","Yeşilyurt","Zile"],
"Trabzon":["Akçaabat","Araklı","Arsin","Beşikdüzü","Çarşıbaşı","Çaykara","Dernekpazarı","Düzköy","Hayrat","Köprübaşı","Maçka","Of","Ortahisar","Sürmene","Şalpazarı","Tonya","Vakfıkebir","Yomra"],
"Tunceli":["Çemişgezek","Hozat","Mazgirt","Merkez","Nazımiye","Ovacık","Pertek","Pülümür"],
"Uşak":["Banaz","Eşme","Karahallı","Merkez","Sivaslı","Ulubey"],
"Van":["Bahçesaray","Başkale","Çaldıran","Çatak","Edremit","Erciş","Gevaş","Gürpınar","İpekyolu","Muradiye","Özalp","Saray","Tuşba"],
"Yalova":["Altınova","Armutlu","Çınarcık","Çiftlikköy","Merkez","Termal"],
"Yozgat":["Akdağmadeni","Aydıncık","Boğazlıyan","Çandır","Çayıralan","Çekerek","Kadışehri","Merkez","Saraykent","Sarıkaya","Sorgun","Şefaatli","Yenifakılı","Yerköy"],
"Zonguldak":["Alaplı","Çaycuma","Devrek","Ereğli","Gökçebey","Kilimli","Kozlu","Merkez"]
};

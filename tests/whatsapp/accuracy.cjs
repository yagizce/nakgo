'use strict';
// Synthetic, labeled holdout corpus. No private messages or contact identities.
const fs=require('node:fs'),path=require('node:path');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
const cases=[
 ['MARAŞ ANTEP AÇIK TIR SINIRSIZ PROFİL MALZEMESİ HEMEN YÜKLER',1,{kind:'load',from:'Kahramanmaraş',to:'Gaziantep',weight:null}],
 ['TUZLA YÜKLEME ERZURUM+VAN KAPALI TIR 0-15 TON',1,{kind:'load',from:'İstanbul',to:'Erzurum',weight:15}],
 ['DERİNCE YÜKLEME MALATYA 3 YER TIR 0-22 TON ARAÇ 2011 VE ÜSTÜ MODEL OLMALI',1,{kind:'load',from:'Kocaeli',to:'Malatya',weight:22}],
 ['GAZİPAŞA KAPALI TIR\nKORKUTELİ+SERİK KAPALI TIR\nDENİZLİ KAPALI TIR',3,{kind:null,from:null,to:null,weight:null}],
 ['İzmir Ankara 24 ton sac yük var bugün',1,{kind:'load',from:'İzmir',to:'Ankara',weight:24}],
 ['🚛 Bursa Konya boş araç 20 ton kapalı tır',1,{kind:'truck',from:'Bursa',to:'Konya',weight:20}],
 ['İST ANK YÜKLEME TIR 18 TON DEMİR',1,{kind:'load',from:'İstanbul',to:'Ankara',weight:18}],
 ['Adana Mersin yükleme açık tır 12,5 ton demir',1,{kind:'load',from:'Adana',to:'Mersin',weight:12.5}],
 ['Ankara İzmir 24000 kg sac yük var',1,{kind:'load',from:'Ankara',to:'İzmir',weight:24}],
 ['Urfa Erzrum yükleme kapalı tır 22 ton',1,{kind:'load',from:'Şanlıurfa',to:'Erzurum',weight:22}],
 ['İzmir Ankara yük var 20 ton\nBursa Konya yük var 10 ton\nÖrnek Lojistik\n0500 000 00 01',2,{kind:'load',from:'İzmir',to:'Ankara',weight:20}],
 ['İzmir Ankara kapalı tır',1,{kind:null,from:'İzmir',to:'Ankara',weight:null}],
 ['Gazipaşa kapalı tır',1,{kind:null,from:null,to:null,weight:null}],
 ['Bugün boşum, Kocaeli Ankara',1,{kind:'truck',from:'Kocaeli',to:'Ankara',weight:null}],
 ["Ankara'ya İzmir'den 18 ton sac yük var",1,{kind:'load',from:'İzmir',to:'Ankara',weight:18}],
 ['İzmir yükleme\nAnkara teslim 24 ton sac',1,{kind:'load',from:'İzmir',to:'Ankara',weight:24}],
 ['Kayseri İstanbul boş araç 13.60 tenteli',1,{kind:'truck',from:'Kayseri',to:'İstanbul',weight:null}],
 ['Gebze Bursa yükleme 0-20 ton açık tır',1,{kind:'load',from:'Kocaeli',to:'Bursa',weight:20}],
 ['Manisa Denizli yük var 22 ton palet\nUygun araç arasın',1,{kind:'load',from:'Manisa',to:'Denizli',weight:22}],
 ['İZMİR → ANKARA YÜK VAR 15 TON DEMİR',1,{kind:'load',from:'İzmir',to:'Ankara',weight:15}],
 ['İzmr Ankara yükleme tır 18 ton',1,{kind:'load',from:null,to:'Ankara',weight:18}],
 ['Çorlu Tekirdağ İstanbul yükleme 8 ton',1,{kind:'load',from:'Tekirdağ',to:'İstanbul',weight:8}],
 ['Antalya Isparta boş tır 10 ton',1,{kind:'truck',from:'Antalya',to:'Isparta',weight:10}],
 ['Yarın yükleme var araç lazım',1,{kind:'load',from:null,to:null,weight:null}]
];
const totals={count:0,kind:0,from:0,to:0,weight:0},failures=[];
for(const [index,[text,count,expected]] of cases.entries()){
 const drafts=parseListings(text),f=drafts[0].fields,actual={kind:f.kind,from:f.from.city,to:f.destinations[0]?.city||null,weight:f.weightMax};
 if(drafts.length===count)totals.count++;else failures.push({case:index+1,field:'count',expected:count,actual:drafts.length});
 for(const field of Object.keys(expected)){if(actual[field]===expected[field])totals[field]++;else failures.push({case:index+1,field,expected:expected[field],actual:actual[field]});}
}
const report={corpus:'24 synthetic realistic Turkish messages; first listing fields, exact match; not real-world statistical accuracy',samples:cases.length,correct:totals,percent:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Math.round(v/cases.length*1000)/10])),failures};
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

/** Migration geçmişi ad biçimleri (R1–R3): Production'da 23.11.2026'da salt okunur ölçülen 32 satır (17 yalın ad,
 * 15 "<14 hane>_<ad>.sql", 8'inde addaki zaman damgası farklı) sabit veri olarak kullanılır. Canlı bağlantı yok;
 * veritabanı gerekmez. Eşleştirme anahtarı sürümdür; ad yalnız iki biçimde normalize edilir, gerisi kapalı. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const MM=require('../../tools/backup/migration-match.cjs');
const RM=require('../../tools/backup/restore-meta.cjs');
const TS=require('../../tools/backup/toolset-hash.cjs');
const {PROD_MIGRATION_NAMES,PROD_APPLIED}=require('./prod-fixture.cjs');

const root=path.resolve(__dirname,'../..');
const OWN=new Set();
const tmp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'nakgo-mn-'));OWN.add(d);return d;};
process.on('exit',()=>{for(const d of OWN)try{fs.rmSync(d,{recursive:true,force:true});}catch{}});

const LIST=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>/^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f=>({version:f.slice(0,14),file:f}));
const PROD=()=>PROD_MIGRATION_NAMES.map(([version,name])=>({version,name}));
const match=(history,aliases=[])=>MM.matchHistory(history,LIST,{aliases});
const withRow=(i,row)=>{const h=PROD();h[i]={...h[i],...row};return h;};
const idx=v=>PROD_MIGRATION_NAMES.findIndex(([x])=>x===v);
/** Ölçülen 8 zaman damgası farkı: sürüm → addaki zaman damgası. */
const TS_MISMATCH={
  '20261115075953':'20261115010000','20261115181517':'20261115180000','20261115181526':'20261115190000','20261115181530':'20261115200000',
  '20261115181551':'20261115210000','20261115181600':'20261115220000','20261115182624':'20261115190000','20261115184145':'20261115230000'};

test('Production geçmişi: 32 satırın tamamı sürümle eşleşir; 17 yalın, 15 normalize, 8 zaman damgası farkı ayrıca raporlanır',()=>{
  assert.equal(PROD_MIGRATION_NAMES.length,32);
  assert.ok(LIST.length>=32,'repoda en az 32 migration');
  const m=match(PROD());
  assert.equal(m.ok,true,JSON.stringify({u:m.unknown,n:m.nameMismatch,d:m.duplicate,b:m.malformedName,a:m.ambiguous,g:m.gaps}));
  assert.equal(m.applied.length,32);
  // Uygulanmış dosyalar repodaki ilk 32 dosyadır (sıra korunur), son uygulanan Production'daki son sürüm.
  assert.deepEqual(m.appliedFiles.map(x=>x.file),LIST.slice(0,32).map(x=>x.file));
  assert.equal(m.last,PROD_APPLIED);
  assert.deepEqual(m.pending,LIST.slice(32).map(x=>x.file));
  assert.equal(m.gaps.length,0);
  // Dağılım: 17 yalın ad (tam), 15 dosya adı biçiminde (normalize), adsız yok, takma ad yok.
  assert.equal(m.normalized.length,15);
  assert.equal(m.applied.length-m.normalized.length-m.nameless,17);
  assert.equal(m.nameless,0);assert.equal(m.aliases,0);
  assert.ok(m.applied.every(a=>a.via==='exact'),'hepsi tam sürüm eşleşmesi');
  // 8 zaman damgası farkı: sessiz değil, sürüm, addaki damga ve dosya ile ayrı listede.
  assert.deepEqual(Object.fromEntries(m.timestampMismatch.map(t=>[t.version,t.name_timestamp])),TS_MISMATCH);
  for(const t of m.timestampMismatch)assert.equal(t.file.slice(0,14),t.version,'dosya sürüme göre seçildi, addaki damgaya göre değil');
  // Normalize edilenlerin 7'si dosya adıyla birebir aynı (yalnız biçim farkı).
  const sameTs=m.normalized.filter(v=>!(v in TS_MISMATCH));assert.equal(sameTs.length,7);
  for(const v of sameTs)assert.equal(PROD_MIGRATION_NAMES[idx(v)][1],LIST.find(x=>x.version===v).file);
});

test('historyStatus: Production geçmişi kabul; normalize sayısı ve zaman damgası farkı raporda, ret listeleri boş',()=>{
  const st=RM.historyStatus(PROD(),LIST.map(x=>({...x,sql:''})),{aliases:[]});
  assert.equal(st.ok,true);assert.equal(st.applied,32);assert.deepEqual(st.unknown,[]);assert.deepEqual(st.gaps,[]);
  assert.equal(st.normalized,15);
  assert.deepEqual([...st.timestamp_mismatch].sort(),Object.keys(TS_MISMATCH).sort());
  // Ret listeleri historyStatus'ta unknown'a girer (sessiz ret yok).
  const bad=RM.historyStatus(withRow(idx('20261115075953'),{name:'20261115010000_admin_live.SQL'}),LIST.map(x=>({...x,sql:''})),{aliases:[]});
  assert.equal(bad.ok,false);assert.deepEqual(bad.unknown,['20261115075953']);
  const amb=RM.historyStatus(withRow(idx('20261115075953'),{name:'20261115181517_admin_live.sql'}),LIST.map(x=>({...x,sql:''})),{aliases:[]});
  assert.equal(amb.ok,false);assert.deepEqual(amb.unknown,['20261115075953']);
});

test('sıra bağımsız: karışık sıradaki geçmiş aynı sonucu verir',()=>{
  const a=match(PROD());const h=PROD();
  for(let i=h.length-1;i>0;i--){const j=(i*7+3)%(i+1);[h[i],h[j]]=[h[j],h[i]];}
  const b=match(h);
  assert.equal(b.ok,true);
  assert.deepEqual(b.appliedFiles,a.appliedFiles);assert.deepEqual(b.normalized.sort(),a.normalized.sort());
  assert.deepEqual(b.timestampMismatch.map(t=>t.version).sort(),a.timestampMismatch.map(t=>t.version).sort());
});

test('yanlış ad (slug): normalize sonrası birebir değilse ret',()=>{
  // Dosya adı biçiminde yanlış ad kısmı.
  let m=match(withRow(idx('20261115075953'),{name:'20261115010000_admin_lives.sql'}));
  assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,['20261115075953']);
  // Yalın biçimde yanlış ad.
  m=match(withRow(idx('20261014000000'),{name:'profile'}));assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,['20261014000000']);
  // Başka bir dosyanın adı (sürüm doğru, ad başka migration'ın).
  m=match(withRow(idx('20261014000000'),{name:'listings'}));assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,['20261014000000']);
  // Zaman damgalı ama .sql'siz: yalın ad sayılır, ad kısmı tutmaz → ret.
  m=match(withRow(idx('20261111040000'),{name:'20261111040000_listing_districts_expiry'}));assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,['20261111040000']);
});

test('yanlış sürüm ve bilinmeyen migration: ret (ada göre tahmin yok)',()=>{
  // Sürüm repoda yok ama ad doğru dosyayı gösteriyor: yine bilinmeyen (eşleştirme anahtarı sürüm).
  let m=match(withRow(idx('20261115075953'),{version:'20261115075954'}));
  assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20261115075954']);
  // Addaki zaman damgası bir dosyanın sürümü olsa da sürüm tutmuyorsa bilinmeyen.
  m=match(withRow(idx('20261111040000'),{version:'20261111040001'}));assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20261111040001']);
  // Tamamen bilinmeyen satır (fazla kayıt).
  m=match([...PROD(),{version:'20991231000000',name:'yok'}]);assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20991231000000']);
  m=match([...PROD(),{version:'20991231000000',name:'20991231000000_yok.sql'}]);assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20991231000000']);
});

test('eksik ve fazla kayıt: aradaki eksik satır boşluk, repoda olmayan satır bilinmeyen',()=>{
  // Ortadaki bir satır yok → son uygulanandan eski bekleyen dosya (boşluk) → ret.
  const h=PROD().filter(r=>r.version!=='20261112020000');
  let m=match(h);assert.equal(m.ok,false);assert.deepEqual(m.gaps,['20261112020000_data_retention.sql']);
  // Zaman damgası farklı satırlardan biri eksik → yine boşluk.
  m=match(PROD().filter(r=>r.version!=='20261115181526'));assert.equal(m.ok,false);assert.deepEqual(m.gaps,['20261115181526_listing_quota.sql']);
  // Son satır eksik: boşluk değil, o dosya bekleyen sayılır (kapsamın bilinen sınırı; uygulanmış sayı 31).
  m=match(PROD().slice(0,31));assert.equal(m.ok,true);assert.equal(m.applied.length,31);assert.equal(m.pending[0],'20261115184145_close_legacy_features.sql');
  // Boş geçmiş: eşleşir ama uygulanmış yok (offline-sign bunu ayrıca reddeder).
  m=match([]);assert.equal(m.ok,true);assert.equal(m.applied.length,0);
});

test('yinelenen sürüm ve belirsiz eşleşme: ret',()=>{
  // Aynı sürüm iki kez (biri yalın, biri dosya adı biçiminde).
  let m=match([...PROD(),{version:'20261014000000',name:'20261014000000_profiles.sql'}]);
  assert.equal(m.ok,false);assert.deepEqual(m.duplicate,['20261014000000']);
  // Addaki zaman damgası BAŞKA bir repo dosyasının sürümü: ad ve sürüm iki ayrı dosyayı gösterir → belirsiz.
  m=match(withRow(idx('20261115075953'),{name:'20261115181517_admin_live.sql'}));
  assert.equal(m.ok,false);assert.deepEqual(m.ambiguous,['20261115075953']);assert.equal(m.timestampMismatch.length,7,'belirsiz satır uyarıya düşmez, reddedilir');
  // Addaki damga dosyanın kendi sürümü değil, ad da o başka dosyanın adı: ad uyuşmazlığı (yine ret).
  m=match(withRow(idx('20261115075953'),{name:'20261115181517_redaction_free_text.sql'}));
  assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,['20261115075953']);
  // Takma ad bir sürümü zaten tam eşleşen dosyaya ikinci kez bağlayamaz.
  m=match([...PROD(),{version:'20261115075999',name:'admin_live'}],[{production_version:'20261115075999',file:'20261115075953_admin_live.sql'}]);
  assert.equal(m.ok,false);assert.deepEqual(m.duplicate,['20261115075999']);
});

test('bozuk ad biçimleri: tahmin yok, ret (malformedName)',()=>{
  const v='20261115075953',i=idx(v);
  const bad=['admin_live.sql','20261115010000_admin_live.SQL','20261115010000_admin_live.sql.sql','2026111501000_admin_live.sql',
    '202611150100000_admin_live.sql','20261115010000_.sql',' 20261115010000_admin_live.sql','20261115010000_admin_live.sql ',
    '../20261115010000_admin_live.sql','20261115010000/admin_live.sql','20261115010000_admin-live.sql','20261115010000_Admin_live.sql',
    'Admin_live','admin live','admin_live\n','adın','20261115010000_admin_live.sql\u0000'];
  for(const name of bad){
    const m=match(withRow(i,{name}));
    assert.equal(m.ok,false,JSON.stringify(name));assert.deepEqual(m.malformedName,[v],JSON.stringify(name));
    assert.equal(m.normalized.includes(v),false);
  }
  // Metin olmayan ad değerleri de ret.
  for(const name of [42,true,{},['admin_live'],0]){
    const m=match(withRow(i,{name}));assert.equal(m.ok,false,JSON.stringify(name));assert.deepEqual(m.malformedName,[v],JSON.stringify(name));
  }
  // parseName sınırları.
  assert.deepEqual(MM.parseName('profiles'),{form:'slug',slug:'profiles'});
  assert.deepEqual(MM.parseName('20261115010000_admin_live.sql'),{form:'file',slug:'admin_live',ts:'20261115010000'});
  for(const n of ['','a.sql','A',null,undefined,'20261115010000_a.SQL'])assert.equal(MM.parseName(n),null,JSON.stringify(n));
});

test('boş ad: yalnız tam sürüm eşleşmesinde adsız sayılır; takma adla ret (mevcut davranış korunur)',()=>{
  const v='20261014000000';
  for(const name of ['',null,undefined]){
    const m=match(withRow(idx(v),{name}));
    assert.equal(m.ok,true,JSON.stringify(name));assert.equal(m.nameless,1);assert.equal(m.normalized.length,15);
  }
  const m=match([...PROD(),{version:'20261117000001',name:''}],[{production_version:'20261117000001',file:LIST[32].file}]);
  assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20261117000001']);
});

test('takma ad: yalnız açık liste; dosya adı biçimi takma adla da normalize edilir, damga farkı raporlanır, belirsizlik ret',()=>{
  // Repodaki takma ad dosyası bugün boş.
  assert.deepEqual(MM.loadAliases(),[]);
  const file=LIST[32].file,fv=file.slice(0,14),slug=MM.nameOfFile(file),pv='20261199000000';
  const base=PROD();
  // Takma adsız: bilinmeyen.
  let m=match([...base,{version:pv,name:slug}]);assert.equal(m.ok,false);assert.deepEqual(m.unknown,[pv]);
  // Takma adla yalın ad: kabul, damga farkı yok.
  const al=[{production_version:pv,file}];
  m=match([...base,{version:pv,name:slug}],al);assert.equal(m.ok,true);assert.equal(m.aliases,1);assert.equal(m.timestampMismatch.length,8);
  // Takma adla dosya adı biçimi, addaki damga dosyanın sürümü: kabul, normalize, damga farkı yok.
  m=match([...base,{version:pv,name:fv+'_'+slug+'.sql'}],al);
  assert.equal(m.ok,true);assert.equal(m.normalized.length,16);assert.equal(m.timestampMismatch.length,8);
  // Takma adla gelen satırda yeni damga farkı: izin listesinde yoksa ret; sürüm + slug + ad birlikte listedeyse kabul ve raporlanır.
  const odd='20261199123456';
  m=match([...base,{version:pv,name:odd+'_'+slug+'.sql'}],al);assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[pv]);
  m=MM.matchHistory([...base,{version:pv,name:odd+'_'+slug+'.sql'}],LIST,{aliases:al,nameExceptions:[...MM.loadNameExceptions(),{version:pv,slug,production_name:odd+'_'+slug+'.sql'}]});
  assert.equal(m.ok,true);assert.ok(m.timestampMismatch.some(t=>t.version===pv&&t.name_timestamp===odd&&t.file===file));
  // Addaki damga başka bir repo dosyasının sürümü: belirsiz.
  m=match([...base,{version:pv,name:LIST[0].version+'_'+slug+'.sql'}],al);assert.equal(m.ok,false);assert.deepEqual(m.ambiguous,[pv]);
  // Takma adda ad yanlış ya da bozuk: ret.
  assert.equal(match([...base,{version:pv,name:'x'}],al).ok,false);
  assert.deepEqual(match([...base,{version:pv,name:slug+'.sql'}],al).malformedName,[pv]);
  // Takma ad repoda olmayan dosyaya: bilinmeyen.
  m=match([...base,{version:pv,name:slug}],[{production_version:pv,file:'20991231000000_yok.sql'}]);assert.equal(m.ok,false);assert.deepEqual(m.unknown,[pv]);
});

test('bütünlük: eşleştirme betiği ve takma ad dosyası araç paketi özetine girer (değişiklik özeti değiştirir)',()=>{
  const repo=tmp(),mods=tmp();
  for(const d of ['tools/backup','supabase/migrations','ops/backup'])fs.mkdirSync(path.join(repo,d),{recursive:true});
  fs.copyFileSync(path.join(root,'tools/backup/migration-match.cjs'),path.join(repo,'tools/backup/migration-match.cjs'));
  fs.copyFileSync(path.join(root,'ops/backup/migration-aliases.json'),path.join(repo,'ops/backup/migration-aliases.json'));
  fs.writeFileSync(path.join(repo,'supabase/migrations/20260101000000_a.sql'),'select 1;');
  fs.mkdirSync(path.join(mods,'pg'));fs.writeFileSync(path.join(mods,'pg','index.js'),'x');
  const opt={repoRoot:repo,nodeModules:mods,bins:{age:process.execPath,'age-keygen':process.execPath,tar:process.execPath}};
  const t1=TS.computeToolset(opt).sha256;
  const mm=path.join(repo,'tools/backup/migration-match.cjs');const orig=fs.readFileSync(mm,'utf8');
  // Kontrolü gevşeten tek karakterlik değişiklik bile özeti değiştirir (imza makinesi farkı görür).
  fs.writeFileSync(mm,orig.replace('&&!ambiguous.length',''));assert.notEqual(TS.computeToolset(opt).sha256,t1,'eşleştirme betiği değişti');
  fs.writeFileSync(mm,orig);assert.equal(TS.computeToolset(opt).sha256,t1);
  const al=path.join(repo,'ops/backup/migration-aliases.json');
  fs.writeFileSync(al,JSON.stringify({version:1,aliases:[{production_version:'20260101000001',file:'20260101000000_a.sql'}]}));
  assert.notEqual(TS.computeToolset(opt).sha256,t1,'takma ad eklendi');
});

/* ---------- zaman damgası izin listesi ---------- */
const PROD_TS_EXCEPTIONS=()=>PROD_MIGRATION_NAMES.filter(([v,n])=>/^\d{14}_/.test(n)&&n.slice(0,14)!==v).map(([version,production_name])=>({version,slug:production_name.slice(15,-4),production_name}));

test('izin listesi: repodaki dosya, Production ölçümündeki 8 damga farkıyla birebir aynı (sürüm + slug + ad)',()=>{
  const ex=MM.loadNameExceptions();
  assert.equal(ex.length,8);
  assert.deepEqual(ex,PROD_TS_EXCEPTIONS());
  for(const e of ex){const f=LIST.find(x=>x.version===e.version);assert.ok(f,e.version);assert.equal(MM.nameOfFile(f.file),e.slug);}
  // Bütün 32 satır yalnız bu listeyle kabul edilir; liste boşken 8 satır ret, 24 satır (17 yalın + 7 aynı damga) kabul.
  const none=MM.matchHistory(PROD(),LIST,{aliases:[],nameExceptions:[]});
  assert.equal(none.ok,false);assert.deepEqual([...none.timestampUnapproved].sort(),Object.keys(TS_MISMATCH).sort());
  assert.equal(none.applied.length,24);assert.equal(none.normalized.length,7);assert.equal(none.timestampMismatch.length,0);
});

test('yeni zaman damgası farkı: izin listesinde yoksa ret (yalın satır, aynı damgalı satır, bekleyen migration)',()=>{
  // Yalın addan dosya adı biçimine, damgası farklı.
  let m=match(withRow(idx('20261014000000'),{name:'20261014000001_profiles.sql'}));
  assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,['20261014000000']);assert.equal(m.timestampMismatch.length,8);
  // Damgası sürümle aynı olan 7 satırdan biri değişirse.
  m=match(withRow(idx('20261112020000'),{name:'20261112020059_data_retention.sql'}));
  assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,['20261112020000']);
  // Production'a sonradan uygulanmış bir bekleyen migration, kendi damgasıyla (apply_migration).
  const next=LIST[32];
  m=match([...PROD(),{version:next.version,name:'20261117999999_'+MM.nameOfFile(next.file)+'.sql'}]);
  assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[next.version]);
  // Aynı satır damgasız ya da sürümle aynı damgayla gelirse kabul (fark yok).
  assert.equal(match([...PROD(),{version:next.version,name:MM.nameOfFile(next.file)}]).ok,true);
  assert.equal(match([...PROD(),{version:next.version,name:next.file}]).ok,true);
  // historyStatus: ret listesinde (sessiz değil).
  const st=RM.historyStatus(withRow(idx('20261014000000'),{name:'20261014000001_profiles.sql'}),LIST.map(x=>({...x,sql:''})),{aliases:[]});
  assert.equal(st.ok,false);assert.deepEqual(st.unknown,['20261014000000']);
});

test('bilinen 8 satır değişirse ret: farklı damga, farklı slug, farklı sürüm, izin listesinde farklı slug ya da ad',()=>{
  const v='20261115075953',i=idx(v);
  // Production adında damga başka (listede değil).
  let m=match(withRow(i,{name:'20261115010001_admin_live.sql'}));assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  // Slug değişti (dosya adıyla da uyuşmuyor).
  m=match(withRow(i,{name:'20261115010000_admin_lives.sql'}));assert.equal(m.ok,false);assert.deepEqual(m.nameMismatch,[v]);
  // Sürüm değişti: listedeki ad aynı olsa da sürüm repoda yok.
  m=match(withRow(i,{version:'20261115075954'}));assert.equal(m.ok,false);assert.deepEqual(m.unknown,['20261115075954']);
  // İzin listesinde slug ya da ad farklıysa satır kabul edilmez (üçü birlikte).
  const ex=MM.loadNameExceptions();
  const withEx=f=>MM.matchHistory(PROD(),LIST,{aliases:[],nameExceptions:ex.map(e=>e.version===v?f(e):e)});
  m=withEx(e=>({...e,slug:'listing_quota',production_name:'20261115010000_listing_quota.sql'}));assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  m=withEx(e=>({...e,production_name:'20261115010001_admin_live.sql'}));assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  m=withEx(e=>({...e,version:'20261115075954'}));assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  // Yükleyiciyi atlayan (bellekten verilen) tutarsız satır: ad aynı ama slug başka dosyanınki → ret (slug ayrıca denetlenir).
  m=withEx(e=>({...e,slug:'listing_quota'}));assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  // Liste satırı başka bir sürüme taşınırsa o sürümün kendi satırı da kabul edilmez.
  m=MM.matchHistory(PROD(),LIST,{aliases:[],nameExceptions:ex.filter(e=>e.version!==v)});assert.equal(m.ok,false);assert.deepEqual(m.timestampUnapproved,[v]);
  // Bilinen satır yalın ada ya da aynı damgalı tam ada dönerse fark kalmaz, kabul (liste fazlası yeni farka izin vermez).
  m=match(withRow(i,{name:'admin_live'}));assert.equal(m.ok,true);assert.equal(m.timestampMismatch.length,7);
});

test('izin listesi dosyası: bozuk biçim reddedilir; alan yoksa liste boş (kapalı)',()=>{
  const d=tmp();const f=path.join(d,'a.json');
  const w=x=>{fs.writeFileSync(f,JSON.stringify({version:1,aliases:[],...x}));return f;};
  assert.deepEqual(MM.loadNameExceptions(w({})),[]);
  assert.deepEqual(MM.loadNameExceptions(path.join(d,'yok.json')),[]);
  const good={version:'20261115075953',slug:'admin_live',production_name:'20261115010000_admin_live.sql'};
  assert.deepEqual(MM.loadNameExceptions(w({timestamp_exceptions:[good]})),[good]);
  const bad=[
    ['liste değil',{}],['fazladan alan',[{...good,note:'x'}]],['eksik alan',[{version:good.version,slug:good.slug}]],
    ['sürüm biçimi',[{...good,version:'2026111507595'}]],['slug biçimi',[{...good,slug:'Admin_live'}]],
    ['ad slug ile uyuşmuyor',[{...good,production_name:'20261115010000_admin_lives.sql'}]],
    ['ad biçimi',[{...good,production_name:'20261115010000_admin_live.SQL'}]],['damga sürümle aynı (fark değil)',[{...good,production_name:'20261115075953_admin_live.sql'}]],
    ['yinelenen sürüm',[good,{...good,production_name:'20261115010001_admin_live.sql'}]],['metin olmayan',[{...good,version:20261115075953}]],['null satır',[null]]];
  for(const [label,v] of bad)assert.throws(()=>MM.loadNameExceptions(w({timestamp_exceptions:v})),/bozuk/,label);
  assert.throws(()=>MM.loadNameExceptions(w({version:2})),/bozuk/,'sürüm 2');
});

/* ---------- aşamalar arası sözleşme: tam kimlik ve küme kuralı ---------- */
test('eşleştirici kayda giden kimlikleri üretir; izin listesiyle birebir küme kuralı (ortak fonksiyon) run, offline-sign ve finalize için aynı',()=>{
  const LIST2=MM.loadNameExceptions();const SHA=MM.exceptionsSha256(LIST2);
  const m=MM.matchHistory(PROD(),LIST,{aliases:[],requireAllExceptions:true});
  assert.equal(m.ok,true);assert.deepEqual(m.exceptionsMissing,[]);
  assert.deepEqual(m.timestampExceptions,MM.canonicalExceptions(LIST2),'kayda giren kimlikler = izin listesi (kanonik sıra)');
  assert.equal(m.exceptionsSha256,SHA);
  assert.deepEqual(MM.exceptionSetProblems({entries:m.timestampExceptions,list:LIST2,sha256:m.exceptionsSha256}),[]);
  // requireAllExceptions: izin listesindeki satır geçmişte yoksa ya da artık fark değilse (yalın ada dönmüş) ret.
  let s=MM.matchHistory(withRow(idx('20261115075953'),{name:'admin_live'}),LIST,{aliases:[],requireAllExceptions:true});
  assert.equal(s.ok,false);assert.deepEqual(s.exceptionsMissing,['20261115075953']);
  s=MM.matchHistory(PROD().slice(0,31),LIST,{aliases:[],requireAllExceptions:true});
  assert.equal(s.ok,false);assert.deepEqual(s.exceptionsMissing,['20261115184145']);
  // Genel karşılaştırmada (requireAllExceptions kapalı) aynı geçmiş kabul (bekleyen sayılır).
  assert.equal(MM.matchHistory(PROD().slice(0,31),LIST,{aliases:[]}).ok,true);
  // historyStatus: yedek doğrulamasındaki katı kip ret listesinde gösterir.
  const st=RM.historyStatus(withRow(idx('20261115075953'),{name:'admin_live'}),LIST.map(x=>({...x,sql:''})),{aliases:[],requireAllExceptions:true});
  assert.equal(st.ok,false);assert.deepEqual(st.unknown,['20261115075953']);
  // exceptionSetProblems: her bozulma ayrı kodla; sayı aynı kalsa da yabancı satır yakalanır.
  const E=MM.canonicalExceptions(LIST2);const P=(entries,sha=SHA,list=LIST2)=>MM.exceptionSetProblems({entries,list,sha256:sha});
  const other={version:'20261112020000',slug:'data_retention',production_name:'20261112020059_data_retention.sql'};
  assert.deepEqual(P(E.slice(1)),['missing']);
  assert.deepEqual(P([...E,other]),['unknown']);
  assert.deepEqual(P([other,...E.slice(1)]).sort(),['missing','unknown']);
  assert.deepEqual(P(E.map((e,i)=>i?e:{...e,production_name:'20261115010001_admin_live.sql'})),['unknown']);
  assert.deepEqual(P([E[0],...E]),['duplicate']);
  assert.deepEqual(P(E.map((e,i)=>i?e:{...e,x:1})).sort(),['malformed','missing']);
  assert.deepEqual(P('x'),['malformed']);
  assert.deepEqual(P(E,'0'.repeat(64)),['hash']);
  assert.deepEqual(P(E,SHA,LIST2.slice(1)).sort(),['hash','unknown']);
  assert.deepEqual(P([],MM.exceptionsSha256([]),[]),[],'boş liste ve boş kullanım tutarlı');
  // Hash kanonik: sıra önemsiz, üç alanın her biri önemli, alan sınırları karışmaz.
  assert.equal(MM.exceptionsSha256([...LIST2].reverse()),SHA);
  for(const k of ['version','slug','production_name'])assert.notEqual(MM.exceptionsSha256(LIST2.map((e,i)=>i?e:{...e,[k]:e[k]+'0'})),SHA,k);
  assert.notEqual(MM.exceptionsSha256([{version:'1',slug:'a_b',production_name:'c'}]),MM.exceptionsSha256([{version:'1',slug:'a',production_name:'b_c'}]));
});

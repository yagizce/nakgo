/** Kasıtlı bozma (mutasyon) testi: şema kayma kontrolü, API sözleşme kontrolü ve sözleşme davranış testi
 * gerçekten bozulmayı yakalıyor mu? Önce bozulmamış hâlde üçü de temiz geçmeli (yanlış alarm yok).
 * Sonra her bozma geçici bir işlem içinde uygulanır, denetimler çalıştırılır ve işlem geri alınır.
 * Her bozmanın beklenen denetimlerce yakalanmaması hatadır. Motor db-lib.cjs ile seçilir; uzak veritabanına bağlanmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {root,openDb,finish,build,snapshot,diff}=require('./db-lib.cjs');
const {check}=require('./api-contract.cjs');
const expectedLines=fs.readFileSync(path.join(root,'supabase/schema/snapshot.txt'),'utf8').split('\n').filter(x=>x&&!x.startsWith('#'));
const fixture=fs.readFileSync(path.join(root,'supabase/tests/api-contract.sql'),'utf8');
const cloud=fs.readFileSync(path.join(root,'src/js/cloud.js'),'utf8');

// Bir fonksiyonu gövdesindeki metni değiştirerek yeniden tanımlar (imza aynı kalır, yetkiler korunur).
const rewrite=(sig,from,to)=>`do $m$ declare d text:=pg_get_functiondef('${sig}'::regprocedure); begin
 if position(${lit(from)} in d)=0 then raise exception 'mutation target not found'; end if; execute replace(d,${lit(from)},${lit(to)}); end $m$;`;
function lit(s){return "'"+s.replace(/'/g,"''")+"'";}
// Bir parametreyi yeniden adlandırır: fonksiyon düşürülüp aynı yetkilerle yeniden kurulur.
const renameParam=(sig,from,to,roles)=>`do $m$ declare d text:=pg_get_functiondef('${sig}'::regprocedure); begin
 execute 'drop function ${sig}'; execute replace(d,${lit(from)},${lit(to)});
 execute 'revoke all on function ${sig} from public'; execute 'grant execute on function ${sig} to ${roles}'; end $m$;`;

const S='schema',C='contract',F='fixture';
const db_mutations=[
  ['anon herkese açık ilan listesini çağıramaz',`revoke execute on function public.nakgo_public_listings(bigint) from anon;`,[S,C,F]],
  ['iç fonksiyon authenticated\'a açılır',`grant execute on function public.nakgo_storage_cleanup_pending(integer) to authenticated;`,[S,C]],
  ['yeni fonksiyon herkese açık eklenir',`create function public.nakgo_debug() returns int language sql as 'select 1';`,[S,C]],
  ['RPC parametresi yeniden adlandırılır',renameParam('public.nakgo_set_favorite(bigint,boolean)','p_listing_id','p_listing','authenticated'),[S,C]],
  ['RPC dönüş tipi değişir',`drop function public.nakgo_route_alerts_seen(); create function public.nakgo_route_alerts_seen() returns bigint language sql security definer set search_path='' as 'select 0::bigint'; grant execute on function public.nakgo_route_alerts_seen() to authenticated;`,[S,C,F]],
  ['RPC aşırı yüklenir (ikinci tanım)',`create function public.nakgo_set_favorite(p_listing_id bigint) returns jsonb language sql as 'select null::jsonb';`,[S,C]],
  ['JSON dönüş alanı yeniden adlandırılır',rewrite('public.nakgo_set_favorite(bigint,boolean)',"'saved',p_saved","'is_saved',p_saved"),[S,F]],
  ['istemcinin dayandığı hata kodu değişir',rewrite('public.nakgo_set_favorite(bigint,boolean)',"errcode='22023'","errcode='P0001'"),[S,F]],
  ['istemcinin dayandığı hata metni değişir',rewrite('public.nakgo_delete_my_account()',"'Owner account'","'Sahip hesap'"),[S,F]],
  ['iletişim telefonu tablodan okunabilir olur',`grant select(contact_phone) on public.listings to authenticated;`,[S,C,F]],
  ['anon ilan tablosunu okuyabilir',`grant select on public.listings to anon;`,[S,C,F]],
  ['istemcinin güncellediği kolonun yetkisi kalkar',`revoke update(status) on public.listings from authenticated;`,[S,C]],
  // INSERT yetkisi açılsa da insert politikası olmadığından RLS yine 42501 verir: davranış bozulmaz, yetki sızıntısını S ve C yakalar.
  ['favori tablosuna doğrudan yazma yetkisi açılır',`grant insert on public.listing_favorites to authenticated;`,[S,C]],
  ['favori tablosuna doğrudan yazma tamamen açılır',`grant insert on public.listing_favorites to authenticated; create policy mutation_fav on public.listing_favorites for insert to authenticated with check (true);`,[S,C,F]],
  ['RLS kapatılır',`alter table public.route_alerts disable row level security;`,[S,C]],
  // Migration'a bağlı (#125) yetkiler: dosya depoda yokken bile veritabanında beliren fonksiyon birebir doğrulanır.
  ['#125 fonksiyonu yanlış imzayla belirir',`create function public.nakgo_legal_action(p_action text) returns jsonb language sql as 'select null::jsonb';
    revoke all on function public.nakgo_legal_action(text) from public; grant execute on function public.nakgo_legal_action(text) to authenticated;`,[S,C]],
  ['#125 fonksiyonu anon\'a açık belirir',`create function public.nakgo_legal_page(p_section text,p_offset integer default 0,p_query jsonb default '{}') returns jsonb language sql as 'select null::jsonb';
    revoke all on function public.nakgo_legal_page(text,integer,jsonb) from public; grant execute on function public.nakgo_legal_page(text,integer,jsonb) to anon,authenticated;`,[S,C]],
  ['okuma politikası silinir',`drop policy listings_read on public.listings;`,[S,F]],
  ['istemcinin okuduğu kolon silinir',`alter table public.listings drop column contact_consent cascade;`,[S,C,F]],
  ['yalnız şema değişir (indeks)',`create index mutation_note on public.listings(note);`,[S]],
];
const client_mutations=[
  ['istemci yeni kolon okur',['listingColumns=\'id,','listingColumns=\'contact_phone,id,']],
  ['istemci RPC adını değiştirir',["rpc('nakgo_set_favorite'","rpc('nakgo_set_favourite'"]],
  ['istemci sözleşmede olmayan argüman gönderir',['p_saved:saved}','p_saved:saved,p_note:null}']],
  ['istemci zorunlu argümanı göndermez',['p_kind:kind,p_target:target,','p_target:target,']],
];

async function detectors(db){
  const found=[];
  // Snapshot ve sözleşme okumaları işlemi bozmasın diye her biri kendi kayıt noktasında.
  await db.exec('savepoint s');
  try{const d=diff(expectedLines,await snapshot(db));if(d.missing.length||d.extra.length)found.push(S);}catch{found.push(S);}
  await db.exec('rollback to savepoint s');
  try{const r=await check({client:false,db});if(r.fails.length)found.push(C);}catch{found.push(C);}
  await db.exec('rollback to savepoint s');
  // Fixture kendi begin/rollback'ini içerir; hata verirse işlem kirlenir, bu yüzden en son çalışır.
  try{await db.exec(fixture);}catch{found.push(F);}
  await db.exec('rollback');
  return found;
}

(async()=>{
  const db=await openDb();let bad=0,primary=null;const rows=[];
  try{
    await build(db);
    await db.exec('begin');
    const base=await detectors(db);
    const clean=(await check({client:true})).fails;
    console.log('Bozulmamış hâl: '+(base.length||clean.length?'YANLIŞ ALARM '+base.join(',')+' '+clean.join('; '):'üç denetim de temiz'));
    if(base.length||clean.length)bad++;
    for(const [name,sql,expect] of db_mutations){
      await db.exec('begin');
      try{await db.exec(sql);}catch(e){await db.exec('rollback');rows.push([name,'bozma uygulanamadı: '+e.message,'✗']);bad++;continue;}
      const got=await detectors(db);
      const miss=expect.filter(x=>!got.includes(x));
      if(miss.length)bad++;
      rows.push([name,'yakalayan: '+(got.join(', ')||'hiçbiri')+(miss.length?' — KAÇIRAN: '+miss.join(', '):''),miss.length?'✗':'✓']);
    }
    for(const [name,[from,to]] of client_mutations){
      if(!cloud.includes(from)){rows.push([name,'bozma hedefi bulunamadı','✗']);bad++;continue;}
      const r=await check({client:true,clientSource:cloud.replace(from,to)});
      if(!r.fails.length)bad++;
      rows.push([name,r.fails.length?'yakalayan: contract':'KAÇIRAN: contract',r.fails.length?'✓':'✗']);
    }
  }catch(e){primary=e;throw e;}finally{await finish(db,primary);}
  for(const [n,r,m] of rows)console.log(' '+m+' '+n+' → '+r);
  console.log('Kasıtlı bozma testi ('+db.engine+'): '+(db_mutations.length+client_mutations.length)+' bozma, '+(bad?bad+' sorun':'hepsi yakalandı'));
  if(bad)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

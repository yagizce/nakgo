/** İlan saklama işaretinin yasal korumayla eşitlenmesi (20261119040000_legal_hold_flag_sync.sql): migration'dan önce
 * kurulmuş kayma onarılır; #125 olmayan kurulum bozulmaz. Davranış testleri supabase/tests/legal-hold-flag-sync.sql'de.
 * Geçici yerel veritabanı (PGlite ya da yerel PostgreSQL); sentetik veri. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {openDb,build,migrations,finish}=require('../../tools/db-lib.cjs');

const FILE='20261119040000_legal_hold_flag_sync.sql',LEGAL='20261117000000_legal_archive.sql';
const U='00000000-0000-4000-8000-000000000001';
async function dbWith(filter){
  const db=await openDb();
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db,{list:migrations().filter(filter)});
  }catch(e){await finish(db,e);throw e;}
  return db;
}
const listing=async(db,note)=>Number((await db.query(`insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Deneme','bugün',$1,$2,'closed',now()-interval '20 days',now()-interval '20 days') returning id`,[note,U])).rows[0].id);

test('ilan saklama işareti eşitlemesi (migration)',async t=>{
  await t.test('migration öncesi oluşmuş kayma onarılır; sonra temizlik korunan ilanı karartmaz',async()=>{
    const all=migrations().map(m=>m.name);assert.ok(all.includes(FILE),FILE+' depoda');
    const after=all.slice(all.indexOf(FILE));
    const db=await dbWith(m=>!after.includes(m.name));
    let primary=null;
    try{
      await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[U]);
      await db.exec('set session_replication_role=replica');
      const drift=await listing(db,'Delil not'),ok=await listing(db,'Normal not');
      await db.exec('reset session_replication_role');
      // Eski kurallarla kayma: koruma doğrudan eklenir, eşitleme çağrılmaz; işaret yok.
      const rid=Number((await db.query(`insert into private.legal_records(policy,listing_id,user_id,reason,opened_by,snapshot,snapshot_sha256)
        values('dispute',$1,$2,'Kayma',$2,'{}',repeat('0',64)) returning id`,[drift,U])).rows[0].id);
      await db.query(`insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by) values($1,'listing',$2,'Kayma',$3)`,[rid,drift,U]);
      assert.equal((await db.query(`select count(*)::int n from private.listing_moderation where listing_id=$1 and hold`,[drift])).rows[0].n,0,'kayma kuruldu');
      // Migration (ve sonrakiler) uygulanır.
      for(const m of migrations().filter(m=>after.includes(m.name)))await db.exec(m.sql);
      assert.equal((await db.query(`select hold from private.listing_moderation where listing_id=$1`,[drift])).rows[0].hold,true,'onarım işareti açtı');
      assert.equal((await db.query(`select count(*)::int n from private.listing_moderation where listing_id=$1`,[ok])).rows[0].n,0,'korumasız ilana dokunulmadı');
      await db.query('select private.retention_run()');
      const r=(await db.query(`select id,note,redacted_at is not null red from public.listings where id=any($1) order by id`,[[drift,ok]])).rows;
      assert.deepEqual(r.map(x=>[x.note,x.red]),[['Delil not',false],['',true]],'korunan kalır, korumasız karartılır');
    }catch(e){primary=e;throw e;}
    finally{await finish(db,primary);}
  });
  await t.test('#125 yokken: migration kurulur, tetikleyici oluşmaz, işaret eskisi gibi değiştirilir',async()=>{
    const db=await dbWith(m=>m.name!==LEGAL);
    let primary=null;
    try{
      assert.equal((await db.query(`select to_regclass('private.legal_holds') is null x`)).rows[0].x,true);
      assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname in('listing_moderation_hold_guard','legal_holds_flag_sync')`)).rows[0].n,0);
      await db.query(`insert into auth.users(id,email_confirmed_at) values($1,now())`,[U]);
      await db.exec('set session_replication_role=replica');const id=await listing(db,'Not');await db.exec('reset session_replication_role');
      await db.query(`insert into private.listing_moderation(listing_id,hold) values($1,true)`,[id]);
      await db.query(`update private.listing_moderation set hold=false where listing_id=$1`,[id]);
      await db.query(`delete from private.listing_moderation where listing_id=$1`,[id]);
    }catch(e){primary=e;throw e;}
    finally{await finish(db,primary);}
  });
});

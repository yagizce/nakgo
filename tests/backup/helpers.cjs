/** B7 testleri için ortak yardımcılar. Motor db-lib ile seçilir: NAKGO_PG_HOST yoksa PGlite, varsa yerel PostgreSQL.
 * Hiçbir uzak sisteme bağlanmaz. Gerçek PostgreSQL'de rol adları çalışma başına benzersizdir ve test sonunda silinir. */
'use strict';
const crypto=require('node:crypto');
const {openDb,build,finish}=require('../../tools/db-lib.cjs');

const realPg=()=>Boolean(process.env.NAKGO_PG_HOST);
const uniqueRole=prefix=>prefix+'_'+process.pid+'_'+crypto.randomBytes(3).toString('hex');

/** Migration'lardan kurulmuş, service_role'ü olan bir test veritabanı açar. */
async function migratedDb(){
  const db=await openDb();
  try{
    await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;`);
    await build(db);
  }catch(e){await finish(db,e);throw e;}
  return db;
}

/** Gerçek PostgreSQL'de küme genelindeki test rollerini temizler (veritabanı finish ile zaten silinmiş olmalı). */
async function dropRoles(names){
  if(!realPg()||!names.length)return;
  const {Client}=require('pg');
  const c=new Client({host:process.env.NAKGO_PG_HOST,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:'postgres'});
  await c.connect();
  try{for(const n of names)await c.query('drop role if exists '+n);}finally{await c.end();}
}

/** Bir değişikliği işlem içinde uygular, fn'i çalıştırır, sonra geri alır (DDL ve ALTER ROLE dahil işlemseldir). */
async function withRollback(db,sql,fn){
  await db.exec('begin');
  try{await db.exec(sql);return await fn();}finally{await db.exec('rollback');}
}

module.exports={realPg,uniqueRole,migratedDb,dropRoles,withRollback,finish};

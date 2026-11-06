'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs');
(async()=>{const {db,q,admin,user}=await setup();try{
 const role=async id=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await role(user);const id=(await q("insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent) values('load','İstanbul','Ankara','Tır','Tenteli',20,'Sentetik','bugün','+905321234567',true) returning id"))[0].id;
 await role(admin);await assert.rejects(()=>q("select public.nakgo_close_listing($1,'closed')",[id]),e=>e.code==='42501');
 await role(user);await assert.rejects(()=>q("select public.nakgo_close_listing($1,'active')",[id]),e=>e.code==='22023');
 const result=(await q("select public.nakgo_close_listing($1,'closed') v",[id]))[0].v;assert.deepEqual(result,{id,status:'closed'});assert.equal((await q('select id from public.listings where id=$1',[id])).length,0);
 await assert.rejects(()=>q("select public.nakgo_close_listing($1,'archived')",[id]),e=>e.code==='42501');
 console.log('PASS owner-only close, minimal response, hidden closed row, invalid/duplicate action denial');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

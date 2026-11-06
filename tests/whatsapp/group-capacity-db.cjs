'use strict';
const assert=require('node:assert/strict'),setup=require('./capacity-fixture.cjs'),{parseListings}=require('../../server/whatsapp/review-parser.cjs');
(async()=>{
 const {db,q,admin,user}=await setup();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
 const role=async(name,id='')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+name);};
 const call=async(name,args=[])=>(await q('select public.nakgo_wa_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
 for(const [r,id] of [['anon',''],['authenticated',user]]){
  await role(r,id);await assert.rejects(()=>q('select public.nakgo_capacity_status()'));checks++;
  await assert.rejects(()=>q('select * from private.wa_publication_keys'));checks++;
  await assert.rejects(()=>q('select private.wa_change_core(1,0,\'publish\',null,null)'));checks++;
 }
 await role('service_role');const status=(await q('select public.nakgo_capacity_status() s'))[0].s;ok(status.warningBytes===350000000&&status.highBytes===400000000&&status.criticalBytes===450000000,'fixed quota thresholds');
 const text='İstanbul yükleme Ankara kapalı tır 20 ton palet bugün +90 532 123 45 67';
 const msg=i=>({messageId:'capacity-fixture-'+i,text,fromPhone:'+905300000000',timestamp:1793900000});
 await call('ingest',[JSON.stringify([msg(1),msg(2),msg(3)])]);
 await role('authenticated',admin);
 for(const i of [1,2])await call('permission',[msg(i).messageId,'+905321234567','Synthetic documented contact publication permission',new Date(Date.now()+86400000).toISOString(),true]);
 await role('service_role');const first=await call('claim'),second=await call('claim');ok(first.id!==second.id,'live leases exclude another consumer');
 await call('finish',[first.id,first.lease,JSON.stringify(parseListings(text))]);
 await call('finish',[second.id,second.lease,JSON.stringify(parseListings(text))]);
 await db.exec('reset role');
 ok((await q('select count(*)::int n from public.listings'))[0].n===1,'different message IDs with identical permitted content publish only once');
 ok((await q('select count(*)::int n from private.wa_drafts'))[0].n===2,'duplicate draft/source preserved');
 ok((await q("select count(*)::int n from private.wa_drafts where status='published'"))[0].n===1,'duplicate not marked published');
 ok((await q('select count(*)::int n from private.wa_publication_permissions'))[0].n===2,'both consent records retained');
 const original=(await q('select id,expires_at from public.listings'))[0];
 await role('service_role');await assert.rejects(()=>call('finish',[first.id,first.lease,JSON.stringify(parseListings(text))]),e=>e.code==='40001');checks++;
 const third=await call('claim');await call('finish',[third.id,third.lease,JSON.stringify(parseListings(text))]);await db.exec('reset role');
 ok((await q('select count(*)::int n from public.listings'))[0].n===1,'no permission means no publication');
 ok(String((await q('select expires_at from public.listings where id=$1',[original.id]))[0].expires_at)===String(original.expires_at),'duplicate does not refresh original expiry');
 // Privileged synthetic-clock fixture only; production guards are restored before assertions.
 await q("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 await db.exec('alter table public.listings disable trigger listing_lifecycle');
 try{await q("update public.listings set expires_at=now()-interval '1 second' where id=$1",[original.id]);}
 finally{await db.exec('alter table public.listings enable trigger listing_lifecycle');}
 await role('authenticated',user);ok((await q('select id from public.listings')).length===0,'expired listing hidden by server RLS');
 await role('authenticated',admin);await assert.rejects(()=>q('select id from private.wa_drafts'));checks++;
 // Admin cannot query private tables even when the interface is authorized.
 await db.exec('reset role');const d=(await q('select id,revision,fields from private.wa_drafts where source_id=$1',[second.id]))[0];
 await role('authenticated',admin);await call('change',[d.id,d.revision,'publish',JSON.stringify(d.fields),'Synthetic documented contact publication permission']);
 await db.exec('reset role');ok((await q('select count(*)::int n from public.listings'))[0].n===2,'expired previous publication does not block a new six-hour listing');
 console.log(checks+' group capacity safety PostgreSQL checks passed');await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});

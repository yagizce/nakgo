'use strict';
// Synthetic isolated database only. Never reads env credentials or calls Meta/Supabase.
const assert=require('node:assert/strict'),fs=require('node:fs');
const setup=require('../tests/whatsapp/capacity-fixture.cjs'),{processBatch}=require('../server/whatsapp/worker.cjs');
const reports=[];
async function scenario(groups){
 const n=groups*800,{db,q,admin}=await setup(),started=performance.now();
 const role=async(name,id='')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+name);};
 const rpc=async(name,args=[])=>(await q('select public.nakgo_wa_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args))[0].v;
 const tables=['public.listings','private.wa_sources','private.wa_drafts','private.wa_audit','private.wa_publication_permissions','private.admin_audit','private.wa_publication_keys'];
 const size=async()=>Number((await q('select sum(pg_total_relation_size(x))::bigint n from unnest($1::text[]) x',[tables]))[0].n);
 const baseline=await size(),permissions=[];let deliveries=0,accepted=0;
 await role('service_role');
 for(let start=0;start<n;start+=20){
  const messages=[];
  for(let i=start;i<Math.min(start+20,n);i++){
   const logical=i%10===9?i-1:i,phone='+90532'+String(logical).padStart(7,'0'),type=logical%20;
   const text=type===0?'İstanbul Ankara tır bugün +90 532 123 45 67 +90 533 123 45 67':type===1?'Selam arkadaşlar, güvenli yolculuklar.':`İstanbul yükleme Ankara kapalı tır 20 ton palet bugün ${phone}`;
   const m={messageId:`synthetic-${groups}-${i}`,text,fromPhone:'+905300000000',timestamp:1793900000};
   messages.push(m);if(i%5===0)messages.push(m);
   if(type>1&&i%20!==2)permissions.push({messageId:m.messageId,phone});
  }
  deliveries+=messages.length;accepted+=await rpc('ingest',[JSON.stringify(messages)]);
 }
 console.log(`Synthetic ${groups} groups: ${accepted} unique sources enqueued`);
 assert.equal(accepted,n);
 // Replay committed deliveries: ingress is idempotent across independent requests.
 assert.equal(await rpc('ingest',[JSON.stringify([{messageId:`synthetic-${groups}-0`,text:'retry',fromPhone:'+905300000000',timestamp:1793900000}])]),0);
 await role('authenticated',admin);
 for(let start=0;start<permissions.length;start+=100)await q("select public.nakgo_wa_permission(m->>'messageId',m->>'phone','Synthetic documented contact publication permission',now()+interval '1 day',true) from jsonb_array_elements($1::jsonb) m",[JSON.stringify(permissions.slice(start,start+100))]);
 console.log(`Synthetic ${groups} groups: ${permissions.length} documented permissions prepared`);
 await role('service_role');const failures=new Set(),lostResponses=new Set();let attempts=0,completed=0,failed=0,peakLeases=0;
 const store={
  claim:async()=>{const j=await rpc('claim');if(j)attempts++;return j;},
  complete:async(id,lease,drafts)=>{
   if(id%20===3&&!failures.has(id)){failures.add(id);throw Error('synthetic_precommit_failure');}
   await rpc('finish',[id,lease,JSON.stringify(drafts)]);
   if(id%97===0&&!lostResponses.has(id)){lostResponses.add(id);throw Error('synthetic_lost_commit_response');}
  },fail:(id,lease)=>rpc('fail',[id,lease])
 };
 const drain=()=>Promise.all(Array.from({length:4},async()=>{
  for(;;){const r=await processBatch(store,1);completed+=r.completed;failed+=r.failed;if(r.completed+r.failed===0)break;}
 }));
 await drain();assert.equal(await rpc('claim'),null,'backoff prevents immediate retry');
 await db.exec('reset role');const pending=Number((await q("select count(*) n from private.wa_sources where state='pending'"))[0].n);
 assert.ok(pending<=failures.size,'only injected failures may remain in backoff; some may naturally retry during the run');
 const pendingIds=(await q("select id from private.wa_sources where state='pending'")).map(r=>r.id);
 assert.ok(pendingIds.every(id=>failures.has(id)));
 // Advance ONLY the synthetic retry clock; no wall-time backoff claim is made.
 await q("update private.wa_sources set next_attempt=now()-interval '1 second' where state='pending'");
 await role('service_role');await drain();await db.exec('reset role');
 const counts=(await q("select (select count(*)::int from private.wa_sources where state='done') done,(select count(*)::int from private.wa_drafts) drafts,(select count(*)::int from public.listings) listings,(select count(*)::int from private.wa_publication_permissions) permissions,(select count(*)::int from private.wa_audit) audit"))[0];
 assert.equal(counts.done,n);assert.equal(counts.drafts,n);assert.equal(counts.listings,n*0.75);assert.equal(counts.permissions,permissions.length);assert.equal(counts.audit,counts.listings);
 assert.equal((await q('select count(*)::int n from (select private.wa_listing_key(l) from public.listings l group by 1 having count(*)>1) d'))[0].n,0);
 assert.equal((await q("select count(*)::int n from public.listings where expires_at-published_at<>interval '6 hours'"))[0].n,0);
 const allocated=await size(),perMessage=(allocated-baseline)/n;
 reports.push({groups,incoming_per_day:n,deliveries_with_20_percent_replays:deliveries,accepted,consumer_lanes:4,claims:attempts,precommit_retries:failures.size,lost_commit_responses:lostResponses.size,counts,duplicate_publications:0,backoff_verified_before_local_clock_advance:true,scope:'isolated single-connection PGlite; not real Cloudflare CPU or native multi-connection racing',elapsed_seconds:Number(((performance.now()-started)/1000).toFixed(2)),new_related_relation_bytes:allocated-baseline,bytes_per_incoming_message:perMessage,thirty_day_bytes_with_measured_DEV_baseline:Math.round(29544309+perMessage*n*30)});
 console.log(`Synthetic ${groups} groups: ${counts.done} done, ${counts.listings} publications, no duplicates/lost messages`);
 await db.close();
}
(async()=>{for(const groups of [10,20])await scenario(groups);if(process.env.NAKGO_CAPACITY_REPORT)fs.writeFileSync(process.env.NAKGO_CAPACITY_REPORT,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));})().catch(e=>{console.error({error:e.message,code:e.code||e.name});process.exitCode=1;});

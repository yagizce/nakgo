/** Şikâyet API'si ve il/ilçe kataloğunun kasıtlı bozma denetimi: migration, istemci ve katalog aracı bozulunca testler
 * yakalamalı.
 *   NODE_PATH=... [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=...] node tools/report-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118100000_listing_reports.sql',C='src/js/cloud.js',A='src/js/features/account.js',D='src/js/screens/details.js',T='tools/location-catalog.cjs';
const DB=['--test','--test-timeout=120000','tests/db/reports.test.cjs',...(process.env.NAKGO_POSTGREST_BIN?['tests/db/reports-http.test.cjs']:[])];
const M=[
  [F," if l.owner_id=p_actor then raise exception 'Own listing' using errcode='42501'; end if;\n",""],
  [F," or not exists(select 1 from private.api_visible_listings v where v.id=l.id) then"," then"],
  [F,"if not found or l.redacted_at is not null or ","if not found or "],
  [F," perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,7301));\n",""],
  [F," if found then return jsonb_build_object('report',private.report_json(r),'created',false); end if;\n",""],
  [F,"and x.status in('open','reviewing')\n","\n"],
  [F,"(p_subject='account' and x.account_id=l.owner_id)","(p_subject='account' and x.listing_id=p_listing_id)"],
  [F,"interval '1 hour')>=10","interval '1 hour')>=11"],
  [F,"interval '24 hours')>=30","interval '24 hours')>=31"],
  [F,"or char_length(n)>200 then","then"],
  [F,"values(p_actor,p_subject,p_listing_id,l.owner_id,p_reason,n)","values(p_actor,p_subject,p_listing_id,null,p_reason,n)"],
  [F,"btrim(regexp_replace(coalesce(p_note,''),'[[:cntrl:]]+',' ','g'))","coalesce(p_note,'')"],
  [F," perform private.require_activity(actor);\n",""],
  [F," actor:=private.api_actor(true);\n begin result"," actor:=auth.uid();\n begin result"],
  [F,"grant execute on function api.report_create_v1(bigint,text,text,text) to authenticated;","grant execute on function api.report_create_v1(bigint,text,text,text) to anon,authenticated;"],
  [F,"revoke all on private.listing_reports from public,anon,authenticated;","grant select on private.listing_reports to authenticated;"],
  [F,"  where f='' or r.status=f order by","  where true order by"],
  [F," if r.revision<>p_revision then raise exception 'Moderation changed; refresh' using errcode='PT409'; end if;\n",""],
  [F,"using errcode='PT409'","using errcode='40001'"],
  [F," insert into private.admin_audit(actor_id,target,action,reason,revision) values(actor,'report:'||p_id,'report_'||p_status,reason_value,r.revision+1);\n",""],
  [F,"or char_length(reason_value) not between 3 and 500 then","then"],
  [F,"begin\n if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;\n if f not in","begin\n if f not in"],
  [F,"reporter_id uuid references auth.users(id) on delete set null,","reporter_id uuid references auth.users(id) on delete cascade,"],
  [C,"return via(async()=>(await v1('report_create_v1'","return (async()=>(await v1('report_create_v1'"],
  [C,"note.trim().length>200)throw Error('Invalid report');","false)throw Error('Invalid report');"],
  [A,"if (!Number.isSafeInteger(r?.report?.id) || typeof r.created !== \"boolean\") throw Error(\"Invalid report response\");\n",""],
  [A,"    if (btn.disabled) return;\n",""],
  [A,"        if (market) return sendReport(","        if (false) return sendReport("],
  [A,"kind === \"u\" ? \"account\" : \"listing\"","\"listing\""],
  [A,"        btn.disabled = false;\n",""],
  [D,"openReport(\"t\", t.id, t.remoteId)","openReport(\"t\", t.id, t.id)"],
  [T,"const code=String(i+1).padStart(2,'0')","const code=String(i).padStart(2,'0')"],
  [T,"'Tunceli','Şanlıurfa'","'Şanlıurfa','Tunceli'"],
];
const client=f=>[C,A,D,T].includes(f);
const run=f=>client(f)?(spawnSync(process.execPath,['tools/bundle.js']).status!==0||spawnSync(process.execPath,['tests/run.js'],{encoding:'utf8'}).status!==0)
  :(()=>{const r=spawnSync(process.execPath,DB,{encoding:'utf8',env:process.env});
    // Zaman aşımında (ör. 40001 → PostgREST'in sonsuz yeniden denemesi) test süreci biter ama PostgREST kalabilir.
    if(process.env.NAKGO_POSTGREST_BIN)spawnSync('pkill',['-f',process.env.NAKGO_POSTGREST_BIN]);
    return r.status!==0;})();
let escaped=0;
for(const [file,from,to] of M){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,70));
  fs.writeFileSync(file,src.replace(from,to));
  let caught;
  try{caught=run(file);}finally{fs.writeFileSync(file,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.replace(/\s+/g,' ').slice(0,80));
}
spawnSync(process.execPath,['tools/bundle.js']);
console.log(`kaçan: ${escaped} / ${M.length}`);
process.exitCode=escaped?1:0;

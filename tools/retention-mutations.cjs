/** Parçalı gece temizliğinin kasıtlı bozma denetimi: her kural tek tek bozulur ve tests/db/retention-batches.test.cjs'in
 * bunu yakaladığı doğrulanır. Dosya her denemeden sonra geri yazılır. Elle çalıştırılır (eşzamanlılık bozmaları gerçek
 * PostgreSQL ister):  NODE_PATH=... NAKGO_PG_HOST=... node tools/retention-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const F='supabase/migrations/20261118030000_b2_retention_batches.sql';
const MUTATIONS=[
  ["and not exists(select 1 from private.listing_moderation m where m.listing_id=x.id and (m.hold or (m.removed and m.updated_at>=now()-interval '1 year')))","and true"],
  [")<now()-interval '8 days'\n     or exists",")<now()-interval '6 days'\n     or exists"],
  ["where x.redacted_at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.listing_id=x.id and m.hold)","where x.redacted_at<now()-interval '1 year'"],
  ["where x.redacted_at<now()-interval '1 year'","where x.redacted_at<now()-interval '300 days'"],
  ["    where x.at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id=x.listing_id)\n    order by","    where x.at<now()-interval '1 year'\n    order by"],
  ["     and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=x.user_id)\n",""],
  ["if not pg_catalog.pg_try_advisory_xact_lock(7300) then return -1; end if;",""],
  ["if not pg_catalog.pg_try_advisory_lock(7301) then","if false then"],
  ["order by x.id limit p_limit for update skip locked);\n  get diagnostics n=row_count;\n  alter table","order by x.id limit p_limit for update);\n  get diagnostics n=row_count;\n  alter table"],
  ["     update private.retention_jobs set batches=batches+1,counts=counts||jsonb_build_object(step,coalesce((counts->>step)::bigint,0)+n) where id=job;","     null;"],
  [" for stale in select id from private.retention_jobs where status='running' order by id loop\n  perform private.retention_job_close(stale.id,'interrupted','önceki çalışma tamamlanmadan kesildi');\n end loop;",""],
  ["  insert into private.retention_runs(counts) values(j.counts||jsonb_build_object('batched_job',j.id,'status',p_status,'batches',j.batches));","  null;"],
  ["   exception when others then failure:=step||': '||sqlerrm;","   exception when others then failure:=null;"],
  ["revoke all on procedure private.retention_batches(integer,integer) from public,anon,authenticated;","grant execute on procedure private.retention_batches(integer,integer) to authenticated;"],
  ["revoke all on function private.retention_batch(text,integer),private.retention_job_close(bigint,text,text) from public,anon,authenticated;",""],
  ["if p_limit is null or p_limit<1 or p_limit>10000 then","if p_limit is null then"],
];
let escaped=0;
for(const [from,to] of MUTATIONS){
  const src=fs.readFileSync(F,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+from.slice(0,60));
  fs.writeFileSync(F,src.replace(from,to));
  let caught;
  try{caught=spawnSync(process.execPath,['--test','tests/db/retention-batches.test.cjs'],{encoding:'utf8',env:process.env}).status!==0;}
  finally{fs.writeFileSync(F,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+from.replace(/\s+/g,' ').slice(0,90));
}
console.log(`kaçan: ${escaped} / ${MUTATIONS.length}`);
process.exitCode=escaped?1:0;

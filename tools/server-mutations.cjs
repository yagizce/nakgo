/** B4 sunucu katmanının kasıtlı bozma denetimi: server/core, server/worker.mjs ve supabase/local/worker.sql bozulunca
 * tests/server ve tests/db/worker-role.test.cjs yakalamalı.
 *   [NAKGO_PG_HOST=... NAKGO_POSTGREST_BIN=... NAKGO_MINIFLARE=...] node tools/server-mutations.cjs   Çıkış: kaçan varsa 1. */
'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const M=[
  ['server/core/redact.mjs',"  [/(?<![\\d+])(?:\\+?90[\\s.-]?)?\\(?0?[2-5]\\d{2}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{2}[\\s.-]?\\d{2}(?!\\d)/g, '[telefon]'],\n",""],
  ['server/core/redact.mjs',"  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, '[e-posta]'],\n",""],
  ['server/core/redact.mjs',"  [/eyJ[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],\n",""],
  ['server/core/redact.mjs',"  [/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g, '[ip]'],\n",""],
  ['server/core/redact.mjs',"SECRET_KEY.test(key) || IP_KEY.test(key)","SECRET_KEY.test(key)"],
  ['server/core/redact.mjs',"const SECRET_KEY = /pass|secret|token|","const SECRET_KEY = /pass|secret|"],
  ['server/core/redact.mjs',"return {name: redactText(value.name || 'Error'), code:","return {name: redactText(value.message || 'Error'), code:"],
  ['server/core/redact.mjs',"if (depth >= MAX_DEPTH) return '[derin]';","if (depth >= 50) return '[derin]';"],
  ['server/core/log.mjs',"    if (LEVELS[lvl] < min) return;\n",""],
  ['server/core/log.mjs',"...redact({...base, ...(fields || {})})","...base, ...(fields || {})"],
  ['server/core/ratelimit.mjs',"return {ok: count <= rule.limit,","return {ok: count <= rule.limit + 1,"],
  ['server/core/ratelimit.mjs',"const t = now(), {count, reset} = await store.hit(ruleName + ':' + id,","const t = now(), {count, reset} = await store.hit(ruleName + ':' + subject,"],
  ['server/core/ratelimit.mjs',"    if (this.map.size >= this.maxKeys) this.evict(now);\n",""],
  ['server/core/app.mjs',"      if (!limit.ok) {","      if (false) {"],
  ['server/core/app.mjs',"Number(length) > maxBody)) return done(fail('payload_too_large'));","Number(length) > maxBody * 100)) return done(fail('payload_too_large'));"],
  ['server/core/app.mjs',"        if (body === null) return done(fail('payload_too_large'));\n",""],
  ['server/core/app.mjs',"route: route || 'bilinmeyen', status,","route: route || new URL(request.url).pathname + new URL(request.url).search, status,"],
  ['server/core/app.mjs',"      const key = e instanceof HttpError && ERRORS[e.key] ? e.key : 'internal_error';","      const key = e instanceof HttpError && ERRORS[e.key] ? e.key : 'internal_error'; if (!(e instanceof HttpError)) return done(new Response(String(e.message), {status: 500}));"],
  ['server/core/http.mjs',"  'Cache-Control': 'no-store',\n",""],
  ['server/core/db.mjs',"'Content-Profile': 'worker', 'Accept-Profile': 'worker',","'Content-Profile': 'api', 'Accept-Profile': 'api',"],
  ['server/core/db.mjs',"      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(fn)) throw Error('Geçersiz fonksiyon adı');\n",""],
  ['server/worker.mjs',"!Number.isInteger(hours) || hours < 1 || hours > 168","!Number.isFinite(hours)"],
  ['supabase/local/worker.sql',"alter role worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls","alter role worker nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls"],
  ['supabase/local/worker.sql',"revoke all on function worker.health(),worker.api_usage(integer) from public,anon,authenticated;","revoke all on function worker.health() from public,anon,authenticated;"],
  ['supabase/local/worker.sql',"grant usage on schema worker to worker;","grant usage on schema worker to worker; grant usage on schema private to worker;"],
  ['supabase/local/worker.sql',"grant execute on function worker.health(),worker.api_usage(integer) to worker;","grant execute on function worker.health(),worker.api_usage(integer) to worker; grant select on public.listings to worker;"],
  ['supabase/local/worker.sql',"grant execute on function worker.health(),worker.api_usage(integer) to worker;","grant execute on function worker.health(),worker.api_usage(integer) to worker; grant authenticated to worker;"],
  ['supabase/local/worker.sql'," if p_hours is null or p_hours<1 or p_hours>168 then"," if p_hours is null then"],
  ['supabase/local/worker.sql',"create or replace function worker.health() returns jsonb language sql stable security definer set search_path='' as $$","create or replace function worker.health() returns jsonb language sql stable security definer as $$"],
];
const run=()=>spawnSync(process.execPath,['--test',...fs.readdirSync('tests/server').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/server/'+f),'tests/db/worker-role.test.cjs'],{encoding:'utf8',env:process.env}).status!==0;
let escaped=0;
for(const [file,from,to] of M){
  const src=fs.readFileSync(file,'utf8');
  if(src.split(from).length!==2)throw Error('bozma noktası tekil değil: '+file+' '+from.slice(0,60));
  fs.writeFileSync(file,src.replace(from,to));
  let caught;try{caught=run();}finally{fs.writeFileSync(file,src);}
  if(!caught)escaped++;
  console.log((caught?'YAKALANDI ':'KAÇTI     ')+file.split('/').pop()+': '+from.replace(/\s+/g,' ').slice(0,80));
}
console.log(`kaçan: ${escaped} / ${M.length}`);
process.exitCode=escaped?1:0;

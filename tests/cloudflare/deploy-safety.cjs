'use strict';
// A normal source checkout must never silently enable destructive/scheduled DEV work.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../../cloudflare/wrangler.jsonc'),'utf8'));
assert.equal(config.name,'nakgo-app-dev');assert.equal(config.vars.NAKGO_ENV,'dev');
assert.equal(config.vars.SUPABASE_URL,'https://axkotffqrsddbrazhcwj.supabase.co');
assert.deepEqual(config.triggers.crons,[]);
assert.equal(config.vars.WHATSAPP_CRON_ENABLED,'false');assert.equal(config.vars.LISTING_RETENTION_ENABLED,'false');
assert.equal(config.vars.WHATSAPP_BATCH_SIZE,'1');
for(const name of ['SUPABASE_SERVICE_ROLE_KEY','WHATSAPP_WORKER_SECRET','META_APP_SECRET'])assert.ok(!(name in config.vars),'secret must stay outside source vars: '+name);
assert.match(config.vars.SUPABASE_PUBLISHABLE_KEY,/^sb_publishable_[A-Za-z0-9_-]+$/);
console.log('DEV deployment defaults: pinned project, no Cron/retention, batch one and no source secrets passed');

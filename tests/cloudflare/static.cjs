'use strict';
const assert=require('node:assert/strict');
const base=process.env.NAKGO_CF_URL||'http://127.0.0.1:8787/';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/$/);
(async()=>{
 const r=await fetch(base+'index.html',{redirect:'manual'});assert.equal(r.status,307);assert.equal(r.headers.get('location'),'/');
 for(const name of ['server/whatsapp/store.cjs','cloudflare/worker.mjs','.dev.vars','.env','api/unknown'])assert.equal((await fetch(base+name)).status,404,name);
 const sw=await fetch(base+'sw.js');assert.equal(sw.status,200);assert.match(sw.headers.get('cache-control'),/no-cache/);assert.equal(sw.headers.get('x-content-type-options'),'nosniff');
 const root=await fetch(base);assert.equal(root.status,200);assert.equal(root.headers.get('x-frame-options'),'SAMEORIGIN');
 console.log('Workers assets: canonical URL, private source/secret paths, API 404, SW cache and security headers passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),esbuild=require('../cloudflare/node_modules/esbuild');
for(const name of ['bundle.js','whatsapp-web-output.js'])execFileSync(process.execPath,[path.join(root,'tools',name)],{cwd:root,stdio:'inherit'});
const catalog=require('../server/whatsapp/catalog.cjs');
fs.writeFileSync(path.join(root,'public/_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
/sw.js
  Cache-Control: no-cache
  Content-Type: application/javascript; charset=utf-8
/manifest.webmanifest
  Content-Type: application/manifest+json
`);
esbuild.build({entryPoints:[path.join(root,'cloudflare/worker.mjs')],outfile:path.join(root,'cloudflare/dist/worker.mjs'),bundle:true,format:'esm',platform:'neutral',target:'es2022',plugins:[{
 name:'nakgo-cloudflare-compat',setup(build){
  build.onResolve({filter:/\/catalog\.cjs$/},()=>({path:'catalog',namespace:'nakgo-data'}));
  build.onLoad({filter:/.*/,namespace:'nakgo-data'},()=>({contents:'module.exports='+JSON.stringify(catalog),loader:'js'}));
  build.onResolve({filter:/^node:crypto$/},args=>args.namespace==='nakgo-crypto'?{path:args.path,external:true}:{path:args.path,namespace:'nakgo-crypto'});
  build.onLoad({filter:/.*/,namespace:'nakgo-crypto'},()=>({contents:"import * as crypto from 'node:crypto';module.exports=crypto;",loader:'js'}));
 }
}]}).catch(()=>{console.error('Cloudflare build failed');process.exitCode=1;});

#!/usr/bin/env node
/* PR kodunu çalıştırmadan bağımsız syntax/JSON/HTML ve varlık denetimi. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function inspect(root=path.resolve(__dirname,'../..')){
  const errors=[];let count=0;const check=(ok,name)=>{count++;if(!ok)errors.push(name);};
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>{
    const p=dir+'/'+e.name;if(e.isSymbolicLink()){check(false,'Symlink kabul edilmez: '+p);return [];}
    return e.isDirectory()?walk(p):[p];
  });
  for(const p of ['package.json','package-lock.json','manifest.webmanifest','vercel.json']){
    try{JSON.parse(read(p));check(true,p+' JSON');}catch{check(false,p+' geçerli JSON olmalı');}
  }
  const html=read('index.html');
  check(/^<!doctype html>/i.test(html.trim()),'HTML doctype');
  for(const tag of ['html','head','body']) check((html.match(new RegExp('<'+tag+'(?:\\s|>)','gi'))||[]).length===1&&(html.match(new RegExp('</'+tag+'>','gi'))||[]).length===1,'HTML '+tag+' kökü');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  // Dinamik şablon dizgilerindeki id değerleri aynı dosyada tekrar edebilir.
  const shell=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const shellIds=[...shell.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  check(new Set(shellIds).size===shellIds.length,'Statik kabukta benzersiz id');
  check(ids.length>5&&/<main\b/.test(html)&&/<nav\b/.test(html),'Boş olmayan ana içerik ve navigasyon');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  check(scripts.length>0,'Uygulama betiği mevcut');
  for(const [i,s] of scripts.entries()){try{new vm.Script(s[1]);check(true,'inline JS '+i);}catch(e){check(false,'Inline JS syntax: '+e.message);}}
  for(const p of [...walk('src/js'),...walk('tools'),'sw.js'].filter(p=>p.endsWith('.js'))){
    try{new vm.Script(read(p),{filename:p});check(true,p+' syntax');}catch(e){check(false,p+': '+e.message);}
  }
  const manifest=JSON.parse(read('manifest.webmanifest'));
  check(manifest.name==='NakGo'&&Array.isArray(manifest.icons)&&manifest.icons.length>=2,'PWA adı ve simgeleri');
  for(const icon of manifest.icons||[]){
    check(typeof icon.src==='string'&&!/^(?:\w+:|\/|\.\.)/.test(icon.src)&&fs.existsSync(path.join(root,icon.src)),'Manifest varlığı: '+icon.src);
  }
  check(!/\beval\s*\(|new Function\s*\(/.test(read('src/js/core.js')),'Çekirdekte dinamik kod yürütme yok');
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
  check(pkg.name===lock.name&&pkg.version===lock.version&&lock.lockfileVersion>=3,'Paket kilidi uyumlu');
  return {count,errors};
}
module.exports={inspect};
if(require.main===module){try{const r=inspect(process.argv[2]?path.resolve(process.argv[2]):undefined);r.errors.forEach(e=>console.error(e));console.log(`${r.count-r.errors.length}/${r.count} statik kontrol geçti`);process.exitCode=r.errors.length?1:0;}catch(e){console.error(e.message);process.exitCode=1;}}

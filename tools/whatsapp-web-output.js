/* Statik yayın allowlist'i; backend ve env dosyaları frontend çıktısına girmez. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'public');
// Yalnızca bu aracın ürettiği kök/public; dışarıya veya symlink'e silme yok.
if(path.resolve(output)!==path.join(root,'public')||(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink()))throw Error('Güvensiz çıktı yolu');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output);
for(const name of ['index.html','manifest.webmanifest','sw.js','icons'])fs.cpSync(path.join(root,name),path.join(output,name),{recursive:true});

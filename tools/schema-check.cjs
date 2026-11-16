/** Şema kayma kontrolü. Migration'ları boş bir veritabanına kurar ve şema özetini
 * supabase/schema/snapshot.txt ile karşılaştırır. Fark varsa çıkış kodu 1 ve farkın satırları.
 *   node tools/schema-check.cjs            karşılaştır
 *   node tools/schema-check.cjs --update   özeti yeniden yaz (migration değiştiğinde, PR'da gözden geçirilir)
 *   node tools/schema-check.cjs --print    özeti yazdır
 *   node tools/schema-check.cjs --compare <dosya>   başka bir özetle (ör. production'dan salt okunur alınmış) karşılaştır;
 *        supabase/schema/known-drift.txt içindeki satırlar beklenen fark sayılır.
 *   node tools/schema-check.cjs --fingerprint-sql   uzak veritabanında SALT OKUNUR çalıştırılacak özet sorgusunu yazdır
 *   node tools/schema-check.cjs --fingerprint       aynı özeti yerelde hesapla (iki çıktı satır satır aynı olmalı) */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,openDb,build,snapshot,diff,SNAPSHOT_SQL}=require('./db-lib.cjs');
const file=path.join(root,'supabase/schema/snapshot.txt');
const known=path.join(root,'supabase/schema/known-drift.txt');
const readLines=f=>fs.readFileSync(f,'utf8').split('\n').map(x=>x.replace(/\r$/,'')).filter(x=>x&&!x.startsWith('#'));
function report(title,d){
  for(const x of d.missing)console.log('  - beklenen ama yok: '+x);
  for(const x of d.extra)console.log('  + beklenmeyen: '+x);
  console.log(title+': '+(d.missing.length+d.extra.length)+' fark');
}
(async()=>{
  const args=process.argv.slice(2);
  if(args.includes('--fingerprint-sql')){
    const extra=(fs.existsSync(known)?readLines(known):[]).filter(x=>x.startsWith('+ ')).map(x=>"'"+x.slice(2).replace(/'/g,"''")+"'");
    console.log("select split_part(line,' ',1) k,count(*) n,md5(string_agg(line,chr(10) order by line collate \"C\")) h from ("+SNAPSHOT_SQL+") z"
      +(extra.length?" where line not in("+extra.join(',')+")":"")+" group by 1 order by 1;");
    return;
  }
  const db=await openDb();
  try{
    await build(db);
    const lines=await snapshot(db);
    if(args.includes('--print')){console.log(lines.join('\n'));return;}
    if(args.includes('--fingerprint')){
      const allowed=fs.existsSync(known)?readLines(known).map(x=>x.slice(2)):[];
      const by={};for(const l of lines)if(!allowed.includes(l))(by[l.split(' ')[0]]??=[]).push(l);
      for(const k of Object.keys(by).sort())console.log(k,by[k].length,crypto.createHash('md5').update(by[k].sort().join('\n')).digest('hex'));
      return;
    }
    if(args.includes('--update')){
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,'# Migration\'lardan kurulan şemanın özeti. tools/schema-check.cjs --update ile üretilir; elle düzenlenmez.\n'+lines.join('\n')+'\n');
      console.log('Şema özeti yazıldı: '+lines.length+' satır ('+db.engine+')');return;
    }
    const at=args.indexOf('--compare');
    if(at>=0){
      const other=readLines(path.resolve(args[at+1]));
      const allowed=new Set(fs.existsSync(known)?readLines(known):[]);
      const d=diff(lines,other);
      const unexpected={missing:d.missing.filter(x=>!allowed.has('- '+x)),extra:d.extra.filter(x=>!allowed.has('+ '+x))};
      report('Karşılaştırma ('+db.engine+' ↔ '+path.basename(args[at+1])+', bilinen fark: '+(d.missing.length+d.extra.length-unexpected.missing.length-unexpected.extra.length)+')',unexpected);
      if(unexpected.missing.length||unexpected.extra.length)process.exitCode=1;
      return;
    }
    const d=diff(readLines(file),lines);
    report('Şema kayma kontrolü ('+db.engine+', '+lines.length+' satır)',d);
    if(d.missing.length||d.extra.length){console.log('Migration bilerek değiştiyse: node tools/schema-check.cjs --update');process.exitCode=1;}
  }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

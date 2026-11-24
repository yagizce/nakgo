/** Araç paketi özeti (çevrim dışı imza makinesi): K9 kullanılmadan ÖNCE çalışan her kod, bağımlılık ve ikili dosya,
 * anahtar töreninde kâğıda yazılan güven çapasındaki (anchor.toolset_sha256) değerle aynı olmalıdır.
 *
 * Kapsam (sabit liste; yalnız ekleme PR ile):
 *   repo      tools/backup/*.cjs, tools/db-lib.cjs, tools/api-contract.cjs, supabase/migrations/*.sql,
 *             ops/backup/{scope,migration-aliases}.json, package.json, package-lock.json
 *             (ops/backup/config.json HARİÇ: çapanın hash'ini taşır; ayrıca çapa ile çapraz denetlenir)
 *   modules   node-pg'nin kurulu olduğu node_modules klasörünün tamamı
 *   pg        PostgreSQL sunucu kurulumu (bin, lib, share) ve istemci araçlarının klasörleri
 *   bin       node (process.execPath), age, age-keygen, tar
 * Her girdi: etiket/göreli yol, tür (f: dosya, l: sembolik bağ hedef metni) ve SHA-256. Sembolik bağlar İZLENMEZ
 * (hedef metni özetlenir); dosya dışı türler (soket, aygıt) reddedilir. Sıra: yol sırası. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SJ=require('./strict-json.cjs');
const H_TOOLSET='nakgo-toolset/v1';
const root=path.resolve(__dirname,'../..');

const REPO_GLOBS=[['tools/backup',/\.cjs$/],['supabase/migrations',/\.sql$/]];
const REPO_FILES=['tools/db-lib.cjs','tools/api-contract.cjs','ops/backup/scope.json','ops/backup/migration-aliases.json','package.json','package-lock.json'];

const fileSha=p=>{
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const h=crypto.createHash('sha256');const buf=Buffer.alloc(1<<20);let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex');}
  finally{fs.closeSync(fd);}
};
function entry(label,rel,abs){
  const st=fs.lstatSync(abs);
  // Sembolik bağ: hedef metni ve (dosyaya çözülüyorsa) hedefin içeriği; böylece bin/* bağlarının gerçek ikilisi de özetlenir.
  if(st.isSymbolicLink()){
    let target='-';try{const r=fs.realpathSync(abs);if(fs.statSync(r).isFile())target=fileSha(r);}catch{}
    return `${label}/${rel}\tl\t${crypto.createHash('sha256').update(fs.readlinkSync(abs)).digest('hex')}:${target}`;
  }
  if(st.isFile())return `${label}/${rel}\tf\t${fileSha(abs)}`;
  throw Object.assign(Error('araç paketinde beklenmeyen dosya türü'),{code:'toolset_type'});
}
/** Klasöre çözülen sembolik bağ İZLENİR ve içeriği aynı göreli yolla özetlenir (ör. lib -> ../real): yalnız bağ metni
 * özetlenirse arkadaki kod değiştirilebilirdi. Döngü (aynı gerçek klasöre ikinci kez) reddedilir. */
function walk(label,dir,out,rel='',seen=new Set([fs.realpathSync(dir)])){
  for(const e of fs.readdirSync(path.join(dir,rel),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const r=rel?rel+'/'+e.name:e.name;const abs=path.join(dir,r);
    if(e.isDirectory()){walk(label,dir,out,r,seen);continue;}
    if(e.isSymbolicLink()){
      let real=null;try{real=fs.realpathSync(abs);}catch{}
      if(real&&fs.statSync(real).isDirectory()){
        if(seen.has(real))throw Object.assign(Error('araç paketinde döngülü sembolik bağ'),{code:'toolset_type'});
        out.push(`${label}/${r}\td\t${crypto.createHash('sha256').update(fs.readlinkSync(abs)).digest('hex')}`);
        const sub=[];walk(label,real,sub,'',new Set([...seen,real]));
        for(const x of sub)out.push(x.replace(label+'/',label+'/'+r+'/'));
        continue;
      }
    }
    out.push(entry(label,r,abs));
  }
}
const which=b=>{for(const d of (process.env.PATH||'').split(':')){const p=path.join(d,b);try{fs.accessSync(p,fs.constants.X_OK);return p;}catch{}}return null;};

/** Dönüş: {sha256, entries}. pgDirs: sunucu kurulumu ve istemci araçları klasörleri; bins: {ad: yol}. */
function computeToolset({repoRoot=root,nodeModules=path.resolve(path.dirname(require.resolve('pg/package.json')),'..'),pgDirs=[],bins={}}={}){
  const out=[];
  for(const [d,re] of REPO_GLOBS)for(const f of fs.readdirSync(path.join(repoRoot,d)).filter(x=>re.test(x)).sort())out.push(entry('repo',d+'/'+f,path.join(repoRoot,d,f)));
  for(const f of REPO_FILES)if(fs.existsSync(path.join(repoRoot,f)))out.push(entry('repo',f,path.join(repoRoot,f)));
  walk('modules',nodeModules,out);
  pgDirs.forEach((d,i)=>walk('pg'+i,d,out));
  const b={node:process.execPath,age:which('age'),'age-keygen':which('age-keygen'),tar:which('tar'),...bins};
  for(const [k,p] of Object.entries(b).sort()){
    if(!p)throw Object.assign(Error('araç bulunamadı: '+k),{code:'toolset_missing'});
    out.push(entry('bin',k,fs.realpathSync(p)));
  }
  out.sort();
  return {sha256:SJ.sha256Hex(Buffer.from(H_TOOLSET+'\n'+out.join('\n')+'\n','utf8')),entries:out.length};
}

module.exports={computeToolset,H_TOOLSET,REPO_FILES,fileSha256:fileSha};

/** Güvenli dosya erişimi (elle yedek akışı: FileStore, offline-sign, finalize, dr-fetch). Yalnız Linux.
 *
 * Tehditler: yol kaçışı (.., mutlak yol), sembolik bağlantı (yolun ortasında ya da sonunda), hard link ile başka bir
 * dosyanın içeriğinin okunması/değiştirilmesi, FIFO/aygıt dosyası ile takılma, kontrol ile kullanım arasındaki yarış
 * (TOCTOU), boyut sınırı aşımı ve okuma sırasında değişen dosya.
 *
 * Yöntem:
 *   - Göreli yol katı biçimde denetlenir; kökten itibaren HER bileşen lstat ile denetlenir (sembolik bağlantı yok).
 *   - Son bileşen O_NOFOLLOW|O_NONBLOCK ile açılır; açılan tanıtıcının GERÇEK yolu /proc/self/fd/N üzerinden okunur ve
 *     beklenen yolla karşılaştırılır: açılıştan önce bir ara klasör bağlantıyla değiştirilse bile yakalanır.
 *   - fstat: normal dosya, nlink=1, boyut sınırı; okuma tek tanıtıcıdan, tam boyut; sonra yeniden fstat (boyut, inode,
 *     değişiklik zamanı aynı olmalı).
 *   - Yazım: aynı klasörde O_CREAT|O_EXCL|O_NOFOLLOW geçici dosya, tam yazım + fsync, link() ile hedefe (hedef varsa
 *     EEXIST → üzerine yazılmaz), geçici dosya silinir, klasör fsync. Yazım sonrası hedef yeniden doğrulanır.
 * /proc yoksa (Linux dışı) işlem reddedilir: güvence sağlanamıyorsa çalışılmaz. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {O_RDONLY,O_WRONLY,O_CREAT,O_EXCL,O_NOFOLLOW,O_NONBLOCK}=fs.constants;

const err=(code,msg)=>Object.assign(Error(msg),{code});
const REL_RE=/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function checkRel(rel){
  if(typeof rel!=='string'||rel.length>512||!REL_RE.test(rel))throw err('EPATH','geçersiz göreli yol');
  if(rel.split('/').some(p=>p==='.'||p==='..'||p.startsWith('..')))throw err('EPATH','geçersiz göreli yol');
}
function realRoot(root){
  const st=fs.lstatSync(root);
  if(st.isSymbolicLink()||!st.isDirectory())throw err('EROOT','kök klasör sembolik bağlantı ya da klasör değil');
  return fs.realpathSync(root);
}
/** Kökten hedefin klasörüne kadar her bileşen: var olmalı, klasör olmalı, bağlantı olmamalı. */
function checkDirs(base,rel){
  const parts=rel.split('/');let cur=base;
  for(const p of parts.slice(0,-1)){
    cur=path.join(cur,p);
    const st=fs.lstatSync(cur);
    if(st.isSymbolicLink())throw err('ESYMLINK','yolda sembolik bağlantı');
    if(!st.isDirectory())throw err('ENOTDIR','yolda klasör olmayan bileşen');
  }
  return path.join(base,rel);
}
function fdPath(fd){
  try{return fs.readlinkSync('/proc/self/fd/'+fd);}catch{throw err('ENOPROC','/proc/self/fd okunamıyor: bu platformda güvenli dosya erişimi sağlanamaz');}
}

/** Güvenli okuma. Dosya yoksa null (missingOk) ya da hata. */
function readFileSafe(root,rel,{maxBytes,missingOk=false}={}){
  checkRel(rel);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw err('ELIMIT','boyut sınırı gerekli');
  const base=realRoot(root);
  let abs;
  try{abs=checkDirs(base,rel);}catch(e){if(missingOk&&e.code==='ENOENT')return null;throw e;}
  let pre;
  try{pre=fs.lstatSync(abs);}catch(e){if(missingOk&&e.code==='ENOENT')return null;throw e;}
  if(pre.isSymbolicLink())throw err('ESYMLINK','dosya sembolik bağlantı');
  if(!pre.isFile())throw err('ETYPE','normal dosya değil');
  let fd;
  try{fd=fs.openSync(abs,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);}catch(e){if(e.code==='ELOOP')throw err('ESYMLINK','dosya sembolik bağlantı');throw e;}
  try{
    if(fdPath(fd)!==abs)throw err('ERACE','açılan dosya beklenen yolda değil (yarış ya da bağlantı)');
    const st=fs.fstatSync(fd,{bigint:true});
    if(!st.isFile())throw err('ETYPE','normal dosya değil');
    if(st.ino!==BigInt(pre.ino)||st.dev!==BigInt(pre.dev))throw err('ERACE','dosya denetim ile açılış arasında değişti');
    if(st.nlink!==1n)throw err('EHARDLINK','dosyanın birden fazla bağlantısı var');
    if(st.size>BigInt(maxBytes))throw err('ESIZE','dosya boyut sınırını aşıyor');
    const size=Number(st.size);const buf=Buffer.alloc(size);
    let off=0;while(off<size){const n=fs.readSync(fd,buf,off,size-off,off);if(n===0)break;off+=n;}
    if(off!==size)throw err('ERACE','dosya okunurken kısaldı');
    const after=fs.fstatSync(fd,{bigint:true});
    if(after.size!==st.size||after.mtimeNs!==st.mtimeNs||after.ctimeNs!==st.ctimeNs||after.ino!==st.ino)throw err('ERACE','dosya okunurken değişti');
    return buf;
  }finally{fs.closeSync(fd);}
}

/** Gerekli klasörleri güvenli oluşturur (var olanlar denetlenir). */
function ensureDirs(base,rel){
  const parts=rel.split('/');let cur=base;
  for(const p of parts.slice(0,-1)){
    cur=path.join(cur,p);
    try{fs.mkdirSync(cur,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    const st=fs.lstatSync(cur);
    if(st.isSymbolicLink()||!st.isDirectory())throw err('ESYMLINK','yolda sembolik bağlantı ya da klasör olmayan bileşen');
  }
}

/** Atomik ve üzerine yazmayan yazım. Dönüş {ok:true} ya da hedef varsa {ok:false,status:412}. */
function writeNewAtomic(root,rel,data,{tmpPrefix='.nakgo-tmp-'}={}){
  checkRel(rel);
  const base=realRoot(root);
  ensureDirs(base,rel);
  const abs=checkDirs(base,rel);const dir=path.dirname(abs);
  try{fs.lstatSync(abs);return {ok:false,status:412};}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=path.join(dir,tmpPrefix+crypto.randomBytes(8).toString('hex'));
  const buf=Buffer.from(data);
  let fd=null;
  try{
    fd=fs.openSync(tmp,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0o600);
    if(fdPath(fd)!==tmp)throw err('ERACE','geçici dosya beklenen yolda değil');
    for(let off=0;off<buf.length;)off+=fs.writeSync(fd,buf,off,buf.length-off);
    fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    try{fs.linkSync(tmp,abs);}catch(e){if(e.code==='EEXIST')return {ok:false,status:412};throw e;}
  }finally{if(fd!==null)fs.closeSync(fd);fs.rmSync(tmp,{force:true});}
  const dfd=fs.openSync(dir,O_RDONLY);try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
  // Yazım sonrası doğrulama: hedef bizim yazdığımız içerik, tek bağlantılı normal dosya.
  const back=readFileSafe(root,rel,{maxBytes:buf.length});
  if(!back.equals(buf))throw err('ERACE','yazılan dosya geri okunamadı');
  return {ok:true,status:200};
}

module.exports={readFileSafe,writeNewAtomic,checkRel,REL_RE};

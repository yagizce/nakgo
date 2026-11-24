/** Sinyal (SIGINT, SIGTERM) ile kesilen elle yedek için temizlik. Yalnız elle çalışan araçlar (bootstrap CLI)
 * installSignalHandlers() çağırır; kütüphane kullanımında yalnız kayıt tutulur, davranış değişmez.
 *
 * Sinyal geldiğinde sırayla:
 *   1. aborting() true olur: sonraki depo yazımları reddedilir (başarı/onay kaydı yazılamaz).
 *   2. İzlenen alt süreçler (pg_dump, pg_restore, age, tar) süreç grubu olarak SIGTERM, süre dolarsa SIGKILL ile
 *      sonlandırılır ve çıkışları beklenir (torunlar da gruba dahildir: run() alt süreci kendi grubunda başlatır).
 *   3. Kayıtlı temizlik görevleri kayıt sırasının TERSİNE çalışır (ör. kaynak S1 bağlantısı, şifresiz çalışma klasörü).
 *   4. Bu sürecin açtığı geçici geri yükleme veritabanları (nakgo_check_<pid>_*) yerel sunucudan düşürülür.
 *   5. Sonuç standart hataya yazılır; çıkış kodu 128+sinyal. Temizlik hataları yutulmaz: sinyal ile birlikte raporlanır.
 * İkinci sinyal temizliği yarıda kesmez (bildirilir). Toplam süre sınırlıdır; aşılırsa bitmeyen görevler raporlanır. */
'use strict';
const SIGNO={SIGINT:2,SIGTERM:15};
const tasks=new Map();let seq=0;
const children=new Set();const runs=new Set();
let aborting=null,installed=false;

/** Temizlik görevi kaydı. Dönüş: kaydı kaldıran fonksiyon. */
function register(name,fn){const id=++seq;tasks.set(id,{name,fn});return ()=>tasks.delete(id);}
/** Alt süreç başlatma seçeneği: işleyiciler kuruluysa alt süreç kendi grubunda başlar (torunlarıyla birlikte sonlandırılabilir).
 * Kurulu değilse (kütüphane, B7 CI) davranış eskisi gibi: aynı grup. */
const spawnOptions=()=>installed?{detached:true}:{};
/** Alt süreç izleme. */
function trackChild(child,{detached=false}={}){child.nakgoGroup=detached;children.add(child);child.once('exit',()=>children.delete(child));child.once('error',()=>children.delete(child));}
/** Süren iş (bootstrap'ın yedek akışı): sinyalde alt süreçler sonlandırıldıktan sonra akışın kendi temizliğini (finally)
 * bitirmesi beklenir; ardından kalan görevler ve geçici veritabanı taraması çalışır. Sinyalden sonra yeni alt süreç ve
 * geçici veritabanı açılmaz (dump.run, restore-verify), bu yüzden akış hızla sonlanır. */
function trackRun(p){const x=Promise.resolve(p).catch(()=>{});runs.add(x);x.then(()=>runs.delete(x));return p;}
const isAborting=()=>aborting!==null;
const abortSignal=()=>aborting;

const withTimeout=(p,ms,label)=>Promise.race([Promise.resolve(p),new Promise((_,rej)=>setTimeout(()=>rej(Error(label+': zaman aşımı')),ms).unref())]);
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
const target=c=>c.nakgoGroup?-c.pid:c.pid;
const groupAlive=c=>{try{process.kill(target(c),0);return true;}catch(e){return e.code==='EPERM';}};

async function killChildren(errors,{graceMs=5000}={}){
  const list=[...children];
  for(const c of list){try{process.kill(target(c),'SIGTERM');}catch(e){if(e.code!=='ESRCH')errors.push('alt süreç '+c.pid+' sonlandırılamadı: '+e.code);}}
  const until=Date.now()+graceMs;
  while(list.some(c=>groupAlive(c))&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
  for(const c of list)if(groupAlive(c)){try{process.kill(target(c),'SIGKILL');}catch(e){if(e.code!=='ESRCH')errors.push('alt süreç '+c.pid+' öldürülemedi: '+e.code);}}
  const hard=Date.now()+2000;
  while(list.some(c=>groupAlive(c))&&Date.now()<hard)await new Promise(r=>setTimeout(r,50));
  for(const c of list)if(groupAlive(c))errors.push('alt süreç grubu hâlâ çalışıyor: '+c.pid);
}

/** Bu sürecin açtığı geçici doğrulama veritabanları (db-lib openDb: nakgo_check_<pid>_<zaman>) yerel sunucudan düşürülür.
 * Ad önekinde bu sürecin pid'i vardır: başka süreçlerin veritabanlarına dokunulmaz. */
async function dropOwnCheckDbs(){
  const host=process.env.NAKGO_PG_HOST;
  if(!host)return 0;
  if(!(host.startsWith('/')||['localhost','127.0.0.1','::1'].includes(host)))throw Error('NAKGO_PG_HOST yerel değil; geçici veritabanı temizliği yapılmadı');
  const {Client}=require('pg');
  const c=new Client({host,port:Number(process.env.NAKGO_PG_PORT||5432),user:process.env.NAKGO_PG_USER||'postgres',password:process.env.NAKGO_PG_PASSWORD,database:'postgres'});
  c.on('error',()=>{});
  await c.connect();
  try{
    const prefix='nakgo_check_'+process.pid+'_';
    const own=r=>/^nakgo_check_\d+_\d+$/.test(r.datname);
    const list=async()=>(await c.query(`select datname from pg_database where left(datname,length($1))=$1`,[prefix])).rows.filter(own);
    const rows=await list();
    for(const r of rows)await c.query('drop database if exists "'+r.datname+'" with (force)');
    const left=(await list()).length;
    if(left)throw Error(left+' geçici veritabanı düşürülemedi');
    return rows.length;
  }finally{await c.end().catch(()=>{});}
}

async function cleanupAfterSignal(sig,{timeoutMs=60000}={}){
  const errors=[];const done=[];
  await withTimeout(killChildren(errors),timeoutMs,'alt süreçler').catch(e=>errors.push(e.message));
  await withTimeout(Promise.all([...runs]),timeoutMs,'yedek akışının sonlanması').catch(e=>errors.push(e.message));
  for(const [,t] of [...tasks.entries()].reverse()){
    try{await withTimeout(t.fn(),timeoutMs,t.name);done.push(t.name);}catch(e){errors.push(t.name+': '+(e&&e.message||e));}
  }
  try{const n=await withTimeout(dropOwnCheckDbs(),timeoutMs,'geçici veritabanları');if(n)done.push(n+' geçici veritabanı');}catch(e){errors.push('geçici veritabanları: '+e.message);}
  return {signal:sig,errors,done};
}

/** CLI için: SIGINT/SIGTERM işleyicisi. exit testlerde değiştirilebilir. */
function installSignalHandlers({exit=code=>process.exit(code),write=s=>process.stderr.write(s),timeoutMs=60000}={}){
  if(installed)return;installed=true;
  for(const sig of Object.keys(SIGNO)){
    process.on(sig,async()=>{
      if(aborting){write(`ikinci sinyal (${sig}): temizlik sürüyor, bekleyin\n`);return;}
      aborting=sig;
      write(`bootstrap sinyalle durduruluyor (${sig}): alt süreçler sonlandırılıyor, geçici veriler siliniyor\n`);
      let r;
      try{r=await cleanupAfterSignal(sig,{timeoutMs});}catch(e){r={signal:sig,errors:['temizlik: '+e.message],done:[]};}
      if(r.errors.length)write(`bootstrap sinyalle durduruldu (${sig}); TEMİZLİK HATALARI: ${r.errors.join('; ')}\n`);
      else write(`bootstrap sinyalle durduruldu (${sig}); temizlik tamam (${r.done.join(', ')||'kalan görev yok: iş akışı kendi temizliğini tamamladı'}). İmza isteği ya da kayıt yazılmadı.\n`);
      exit(128+SIGNO[sig]);
    });
  }
}

module.exports={register,trackChild,spawnOptions,trackRun,isAborting,abortSignal,installSignalHandlers,cleanupAfterSignal,dropOwnCheckDbs,alive,SIGNO};

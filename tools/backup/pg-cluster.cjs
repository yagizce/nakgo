/** Atılabilir, ağsız PostgreSQL kümesi: çevrim dışı doğrulama (L2 geri yükleme) ve referans derlemesi (uygulanmış
 * migration'ların gerçek sonucu) için.
 *
 *  - Yalnız Unix soketi (listen_addresses=''); soket klasörü 0700. TCP yok.
 *  - Yerel kimlik doğrulama "trust" yalnız soket için; soket klasörüne yalnız küme sahibi (ve root) erişebilir.
 *  - Küme yöneticisinin adı "postgres" DEĞİLDİR: yedekteki "postgres" rolü bu kümede süper kullanıcı olmaz.
 *  - extensions: { ad: {control, sql} } verilirse kurulum ağacı geçici klasöre kopyalanır ve eklenti dosyaları oraya
 *    yazılır (ör. pg_cron taklidi); asıl kuruluma dokunulmaz.
 *  - Root olarak çalışılıyorsa runAs (sistem kullanıcısı) zorunludur; PostgreSQL root ile çalışmaz.
 *  - stop() kümeyi durdurur ve geçici klasörü siler; sinyal temizliğine (abort.cjs) kayıtlıdır. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const ABORT=require('./abort.cjs');

const ADMIN='nakgo_cluster_admin';

function userIds(name){
  const line=fs.readFileSync('/etc/passwd','utf8').split('\n').find(l=>l.split(':')[0]===name);
  if(!line)throw Error('kullanıcı bulunamadı: '+name);
  const p=line.split(':');return {uid:Number(p[2]),gid:Number(p[3])};
}
/** Alt süreç (initdb, pg_ctl): sinyal işleyicileri kuruluysa kendi grubunda başlar ve izlenir; sinyalde grubuyla (postmaster
 * dahil) sonlandırılır (abort.cjs). Sinyalden sonra yeni süreç başlatılmaz; ancak "force" (temizlikteki pg_ctl stop) çalışır. */
function runTool(bin,args,{ids,env={},force=false}={}){
  return new Promise((resolve)=>{
    if(ABORT.isAborting()&&!force)return resolve({code:-1,out:'',err:'sinyal alındı: alt süreç başlatılmadı'});
    const o=force?{}:ABORT.spawnOptions();
    const p=spawn(bin,args,{env:{...process.env,...env,PGOPTIONS:''},stdio:['ignore','pipe','pipe'],...o,...(ids?{uid:ids.uid,gid:ids.gid}:{})});
    if(!force)ABORT.trackChild(p,{detached:!!o.detached});
    let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
    p.on('close',code=>resolve({code,out,err}));p.on('error',e=>resolve({code:-1,out,err:e.message}));
  });
}
function chownR(dir,ids){execFileSync('chown',['-R',ids.uid+':'+ids.gid,dir]);}

/** installDir: PostgreSQL sunucu kurulum kökü (bin/initdb, bin/pg_ctl, bin/postgres, share/, lib/). */
async function startCluster({installDir,workRoot=os.tmpdir(),extensions={},settings={},runAs=process.env.NAKGO_PG_RUN_AS}){
  if(!installDir)throw Error('PostgreSQL sunucu kurulumu (installDir) gerekli');
  const isRoot=typeof process.getuid==='function'&&process.getuid()===0;
  if(isRoot&&!runAs)throw Error('root olarak küme açılmaz: NAKGO_PG_RUN_AS ile bir sistem kullanıcısı verin');
  const ids=isRoot?userIds(runAs):null;
  const work=fs.mkdtempSync(path.join(workRoot,'nakgo-pgc-'));
  fs.chmodSync(work,0o700);
  let stopped=false,unreg=()=>{};
  let inst=installDir,bin=path.join(installDir,'bin');
  const cleanup=async()=>{
    if(stopped)return;stopped=true;
    const pidFile=path.join(work,'data','postmaster.pid');
    let pid=null;try{pid=Number(fs.readFileSync(pidFile,'utf8').split('\n')[0])||null;}catch{}
    const alive=p=>{try{process.kill(p,0);return true;}catch(e){return e.code==='EPERM';}};
    try{if(fs.existsSync(pidFile))await runTool(path.join(bin,'pg_ctl'),['-D',path.join(work,'data'),'-m','immediate','-w','stop'],{ids,force:true});}
    finally{
      // pg_ctl başarısız olsa da postmaster kalmamalı: kalırsa öldürülür; yine kalırsa hata (çağıran K9'a geçmez).
      if(pid&&alive(pid)){try{process.kill(pid,'SIGKILL');}catch{}const until=Date.now()+5000;while(alive(pid)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));}
      fs.rmSync(work,{recursive:true,force:true});unreg();
    }
    if(pid&&alive(pid))throw Error('küme süreci durdurulamadı');
    if(fs.existsSync(work))throw Error('küme klasörü silinemedi');
  };
  unreg=ABORT.register('geçici PostgreSQL kümesi',cleanup);
  try{
    if(Object.keys(extensions).length){
      inst=path.join(work,'install');
      fs.cpSync(installDir,inst,{recursive:true,verbatimSymlinks:true});
      const extDir=fs.existsSync(path.join(inst,'share','postgresql','extension'))?path.join(inst,'share','postgresql','extension'):path.join(inst,'share','extension');
      for(const [name,f] of Object.entries(extensions)){
        if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('geçersiz eklenti adı');
        fs.writeFileSync(path.join(extDir,name+'.control'),f.control);
        fs.writeFileSync(path.join(extDir,name+'--'+f.version+'.sql'),f.sql);
      }
      bin=path.join(inst,'bin');
    }
    const data=path.join(work,'data'),sock=path.join(work,'sock');
    fs.mkdirSync(sock,{mode:0o700});
    if(ids)chownR(work,ids);
    const init=await runTool(path.join(bin,'initdb'),['-D',data,'-U',ADMIN,'--auth-local=trust','--auth-host=reject','-E','UTF8','--locale=C','--no-sync'],{ids});
    if(init.code!==0)throw Error('initdb başarısız: '+init.err.split('\n').filter(Boolean).slice(-1)[0]);
    const opts=[`-c listen_addresses=''`,`-k ${sock}`,'-p 5432','-c fsync=off','-c full_page_writes=off',
      ...Object.entries(settings).map(([k,v])=>{if(!/^[a-z_]+$/.test(k)||/['\s]/.test(String(v).replace(/^'.*'$/,'x')))throw Error('geçersiz ayar');return `-c ${k}=${v}`;})].join(' ');
    const st=await runTool(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(work,'pg.log'),'-o',opts,'-w','-t','60','start'],{ids});
    if(stopped||ABORT.isAborting())throw Error('sinyal alındı: küme kapatıldı');
    if(st.code!==0)throw Error('küme başlatılamadı: '+(fs.existsSync(path.join(work,'pg.log'))?fs.readFileSync(path.join(work,'pg.log'),'utf8').split('\n').filter(Boolean).slice(-2).join(' | '):st.err));
    return {host:sock,port:5432,admin:ADMIN,installDir:inst,binDir:bin,work,stop:cleanup};
  }catch(e){await cleanup().catch(()=>{});throw e;}
}

/** Kümeye yönetici olarak bağlanan istemci (yalnız soket). */
async function adminClient(cluster,database='postgres'){
  const {Client}=require('pg');
  const c=new Client({host:cluster.host,port:cluster.port,user:cluster.admin,database});c.on('error',()=>{});
  await c.connect();return c;
}

module.exports={startCluster,adminClient,ADMIN};

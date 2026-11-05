#!/usr/bin/env node
/* Ana dal karşılaştırması: test/otomasyon zayıflatması ve silme fail eder. */
'use strict';
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'),crypto=require('node:crypto');
const TEST_COMMAND='node tools/bundle.js --check && node tools/dev.js lint && node tests/run.js';
const protectedFile = name => /^(tests\/|\.github\/)/.test(name) || ['tools/bundle.js','tools/dev.js','tools/project.js'].includes(name);
// Only this running guard's trusted checkout supplies approvals. Never read a
// candidate root, environment variable, CLI option, PR label or head manifest.
const eligibleReviewedFile=p=>typeof p==='string'&&!p.includes('\\')&&path.posix.normalize(p)===p&&((/^tests\//.test(p)&&!['tests/guard.js','tests/run.js','tests/requirements.txt','tests/gate/control.test.js','tests/gate/static.js','tests/gate/static_html.py'].includes(p))||p==='tools/project.js');
const digest=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function reviewedChange(ledger,file,before,after){
 if(!eligibleReviewedFile(file)||ledger?.version!==1||!Array.isArray(ledger.reviews))return false;
 return ledger.reviews.some(review=>/^[a-f0-9]{40}$/.test(review.source_base||'')&&/^[a-f0-9]{40}$/.test(review.source_head||'')&&review.files?.[file]?.before===digest(before)&&review.files[file].after===digest(after));
}
function trustedReviews(){
 const file=path.resolve(__dirname,'../.github/reviewed-controls.json');
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Invalid trusted control ledger');
 const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
 if(ledger.version!==1||!Array.isArray(ledger.reviews)||ledger.reviews.length>100)throw Error('Invalid trusted control ledger');
 return ledger;
}
function guard({root=path.resolve(__dirname,'..'),baseRef='origin/main',baseline}={}) {
  const reviews=trustedReviews();
  const errors=[], count={value:0}, check=(ok,message)=>{count.value++;if(!ok)errors.push(message);};
  const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
  const regular=p=>{try{return fs.lstatSync(path.join(root,p)).isFile()&&!fs.lstatSync(path.join(root,p)).isSymbolicLink();}catch{return false;}};
  for(const p of ['tests/run.js','tests/e2e.py','tests/requirements.txt','tests/guard.js','.github/workflows/quality-gate.yml','.github/workflows/auto-merge.yml']) check(regular(p)&&read(p).trim().length>0,'Eksik/boş kontrol dosyası: '+p);
  const pkg=JSON.parse(read('package.json'));
  check(pkg.scripts?.test===TEST_COMMAND,'Mevcut npm test komutu değiştirilemez');
  check(pkg.scripts?.['test:e2e']==='python tests/e2e.py','Mevcut E2E komutu değiştirilemez');
  const names=baseline?Object.keys(baseline):cp.execFileSync('git',['ls-tree','-r','--name-only',baseRef],{cwd:root,encoding:'utf8'}).trim().split('\n');
  for(const p of names.filter(protectedFile)) {
    if(!regular(p)){check(false,'Korunan dosya silinmiş veya symlink: '+p);continue;}
    const before=(baseline?baseline[p]:cp.execFileSync('git',['show',baseRef+':'+p],{cwd:root,encoding:'utf8'})).replace(/\r\n/g,'\n');
    check(read(p)===before||reviewedChange(reviews,p,before,read(p)),'Kontrol kodu main ile aynı olmalı; ayrı inceleme gerekir: '+p);
  }
  const gate=read('.github/workflows/quality-gate.yml');
  check(!/continue-on-error|paths-ignore:|\[skip ci\]|\|\|\s*true/.test(gate),'Quality gate atlanamaz');
  check(/pull_request:\s*\n\s+branches: \[main\]/.test(gate),'Quality gate main PR olayına bağlı olmalı');
  check(/timeout-minutes:/.test(gate),'Kalite job zaman sınırı olmalı');
  return {count:count.value,errors};
}
module.exports={guard,protectedFile,TEST_COMMAND,reviewedChange};
if(require.main===module){
  const args=process.argv.slice(2),get=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  try{const result=guard({root:path.resolve(get('--root',path.resolve(__dirname,'..'))),baseRef:get('--base-ref','origin/main')});
    for(const e of result.errors)console.error(e);
    console.log(`${result.count-result.errors.length}/${result.count} guard kontrolü geçti`);process.exitCode=result.errors.length?1:0;
  }catch(e){console.error('Guard çalışmadı: '+e.message);process.exitCode=1;}
}

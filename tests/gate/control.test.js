/* Guard ve auto-merge için olumlu/olumsuz durumlar; gerçek GitHub'a yazmaz. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {guard,TEST_COMMAND}=require('../guard.js');
const {REQUIRED_STEPS,eligiblePR,successfulGate,policyPath}=require('../../.github/scripts/policy.js');
const {decide,client}=require('../../.github/scripts/auto-merge.js');
const repo='owner/nakgo',head='a'.repeat(40),base='b'.repeat(40);
const fresh=()=>({number:7,state:'open',draft:false,merged:false,mergeable:true,mergeable_state:'clean',base:{ref:'main',sha:base,repo:{full_name:repo}},head:{ref:'codex/fix',sha:head,repo:{full_name:repo,fork:false}}});
const goodRun=()=>({id:21,display_title:'quality:7:'+head+':'+base,head_sha:head,run_attempt:1,event:'pull_request',status:'completed',conclusion:'success',pull_requests:[{number:7,head:{sha:head},base:{sha:base}}]});
const goodJobs=()=>[{name:'quality-gate',status:'completed',conclusion:'success',steps:REQUIRED_STEPS.map(name=>({name,status:'completed',conclusion:'success'}))}];
test('Yalnızca aynı repository codex/main hazır PR kabul edilir',()=>{
  assert.equal(eligiblePR(fresh(),repo,head),true);
  for(const mutate of [p=>p.draft=true,p=>p.state='closed',p=>p.head.ref='main',p=>p.head.ref='feature/x',p=>p.head.repo.full_name='fork/nakgo',p=>p.head.repo.fork=true,p=>p.base.ref='dev',p=>p.head.sha='c'.repeat(40),p=>p.mergeable=false,p=>p.mergeable_state='behind']){const p=fresh();mutate(p);assert.equal(eligiblePR(p,repo,head),false);}
});
test('Başarısız, atlanmış, iptal veya eski SHA kalite sonucu reddedilir',()=>{
  assert.equal(successfulGate(goodRun(),goodJobs(),head,7,base),true);
  for(const conclusion of ['failure','cancelled','skipped','neutral','timed_out',null]){const r=goodRun();r.conclusion=conclusion;assert.equal(successfulGate(r,goodJobs(),head,7,base),false);}
  const run=goodRun();run.head_sha='c'.repeat(40);assert.equal(successfulGate(run,goodJobs(),head,7,base),false);
  const jobs=goodJobs();jobs[0].steps[0].conclusion='skipped';assert.equal(successfulGate(goodRun(),jobs,head,7,base),false);
  assert.equal(successfulGate(goodRun(),[],head,7,base),false);
  assert.equal(successfulGate(goodRun(),goodJobs(),head,7,'d'.repeat(40)),false);
});
test('Kontrol dosyaları otomatik birleşme kapsamı dışında',()=>{
  for(const p of ['tests/run.js','tests/new.test.js','.github/workflows/fake.yml','.github/scripts/auto-merge.js','tools/bundle.js'])assert.equal(policyPath(p),true);
  assert.equal(policyPath('src/js/screens/listings.js'),false);assert.equal(policyPath('docs/product.md'),false);
});
function fixture(overrides={}){
  let reads=0;const calls=[];
  const api=async(method,url,body)=>{
    calls.push({method,url,body});
    if(method==='PUT')return {merged:true,sha:'merged'};
    if(url===`/repos/${repo}/pulls/7`){reads++;return reads>1&&overrides.fresh?overrides.fresh:(overrides.pr||fresh());}
    if(url.endsWith('/branches/main'))return {protected:overrides.protected??true,protection:{required_status_checks:{contexts:overrides.contexts||['quality-gate','verify']}},commit:{sha:base}};
    if(url.includes('/compare/'))return {merge_base_commit:{sha:base},behind_by:overrides.behind??0};
    if(url.includes('/pulls/7/files'))return overrides.files||[{filename:'src/js/core.js'}];
    if(url.endsWith('/workflows/quality-gate.yml'))return {id:10};
    if(url.endsWith('/workflows/checks.yml'))return {id:11};
    if(url.includes('/workflows/10/runs'))return {workflow_runs:overrides.runs||[goodRun()]};
    if(url.includes('/workflows/11/runs'))return {workflow_runs:[{...goodRun(),id:20,conclusion:overrides.legacy||'success'}]};
    if(url.includes('/jobs'))return {jobs:overrides.jobs||goodJobs()};
    if(url.includes('/check-runs'))return {check_runs:overrides.checks||[{status:'completed',conclusion:'success'}]};
    if(url.endsWith('/status'))return {total_count:0};
    throw Error('Unexpected test route '+url);
  };return {api,calls};
}
test('Olumlu birleşme son SHA ile squash yapar',async()=>{
  const f=fixture(),r=await decide(f.api,repo,7,head);assert.equal(r.merge,true);
  assert.deepEqual(f.calls.filter(c=>c.method==='PUT').map(c=>c.body),[{sha:head,merge_method:'squash'}]);
});
for(const [name,override] of Object.entries({
  'main korumasız':{protected:false},'zorunlu kontrol silindi':{contexts:['verify']},'main geride':{behind:1},'test değişti':{files:[{filename:'tests/run.js'}]},
  'test yeniden adlandırıldı':{files:[{filename:'docs/old.js',previous_filename:'tests/run.js'}]},
  'son çalışma başarısız':{runs:[{...goodRun(),id:22,conclusion:'failure'},goodRun()]},
  'kontrol devam ediyor':{checks:[{status:'in_progress',conclusion:null}]},
  'mevcut npm testi başarısız':{legacy:'failure'},
  'son anda commit geldi':{fresh:{...fresh(),head:{...fresh().head,sha:'c'.repeat(40)}}},
  'son anda draft oldu':{fresh:{...fresh(),draft:true}}
}))test('Auto-merge engeli: '+name,async()=>{const f=fixture(override);assert.equal((await decide(f.api,repo,7,head)).merge,false);assert.equal(f.calls.some(c=>c.method==='PUT'),false);});
test('GitHub API hata veya yönlendirmede güvenli durur',async()=>{
  const api=client('not-a-real-token',async(url,options)=>{assert.equal(options.redirect,'error');return {ok:false,status:403};});
  await assert.rejects(api('GET','/repos/owner/nakgo'),/403/);
});
test('Guard test silme, gevşetme ve script kaldırmayı yakalar',()=>{
  const tempRoot=path.join(root,'tests/shots');fs.mkdirSync(tempRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(tempRoot,'nakgo-guard-')),baseline={};
  const put=(p,s)=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),s);};
  const options={root:dir,baseline};
  try{
    for(const p of ['tests/run.js','tests/e2e.py','tests/requirements.txt','tests/guard.js','.github/workflows/quality-gate.yml','.github/workflows/auto-merge.yml'])put(p,fs.readFileSync(path.join(root,p)));
    put('package.json',JSON.stringify({scripts:{test:TEST_COMMAND,'test:e2e':'python tests/e2e.py'}}));
    for(const p of ['tests/run.js','tests/e2e.py','tests/requirements.txt','tests/guard.js','.github/workflows/quality-gate.yml','.github/workflows/auto-merge.yml'])baseline[p]=fs.readFileSync(path.join(dir,p),'utf8');
    assert.deepEqual(guard(options).errors,[]);
    put('tests/run.js','/* empty success */');assert.ok(guard(options).errors.some(e=>e.includes('tests/run.js')));
    fs.unlinkSync(path.join(dir,'tests/e2e.py'));assert.ok(guard(options).errors.some(e=>e.includes('tests/e2e.py')));
    put('package.json',JSON.stringify({scripts:{test:'echo pass'}}));assert.ok(guard(options).errors.some(e=>e.includes('npm test')));
  }finally{assert.ok(dir.startsWith(tempRoot+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});

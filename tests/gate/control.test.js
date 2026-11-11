/* CI ve auto-merge için olumlu/olumsuz durumlar; gerçek GitHub'a yazmaz. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {REQUIRED_STEPS,eligiblePR,successfulGate,policyPath}=require('../../.github/scripts/policy.js');
const {decide,client}=require('../../.github/scripts/auto-merge.js');
const repo='owner/nakgo',head='a'.repeat(40),base='b'.repeat(40);
const fresh=()=>({number:7,state:'open',draft:false,merged:false,mergeable:true,mergeable_state:'clean',base:{ref:'main',sha:base,repo:{full_name:repo}},head:{ref:'codex/fix',sha:head,repo:{full_name:repo,fork:false}}});
const goodRun=()=>({id:21,display_title:'quality:7:'+head+':'+base,head_sha:head,run_attempt:1,event:'pull_request',status:'completed',conclusion:'success',pull_requests:[{number:7,head:{sha:head},base:{sha:base}}]});
const goodJobs=()=>Object.entries(REQUIRED_STEPS).map(([name,steps])=>({
  name,status:'completed',conclusion:'success',
  steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))
}));
test('Yalnızca aynı repository codex/main hazır PR kabul edilir',()=>{
  assert.equal(eligiblePR(fresh(),repo,head),true);
  for(const mutate of [p=>p.draft=true,p=>p.state='closed',p=>p.head.ref='main',p=>p.head.ref='feature/x',p=>p.head.repo.full_name='fork/nakgo',p=>p.head.repo.fork=true,p=>p.base.ref='dev',p=>p.head.sha='c'.repeat(40),p=>p.mergeable=false,p=>p.mergeable_state='behind']){const p=fresh();mutate(p);assert.equal(eligiblePR(p,repo,head),false);}
});
test('Başarısız, atlanmış, iptal veya eski SHA kalite sonucu reddedilir',()=>{
  assert.equal(successfulGate(goodRun(),goodJobs(),head,7,base),true);
  for(const conclusion of ['failure','cancelled','skipped','neutral','timed_out',null]){const r=goodRun();r.conclusion=conclusion;assert.equal(successfulGate(r,goodJobs(),head,7,base),false);}
  const run=goodRun();run.head_sha='c'.repeat(40);assert.equal(successfulGate(run,goodJobs(),head,7,base),false);
  const jobs=goodJobs();jobs[0].steps[0].conclusion='skipped';assert.equal(successfulGate(goodRun(),jobs,head,7,base),false);
  assert.equal(successfulGate(goodRun(),goodJobs().filter(j=>j.name!=='baseline-regressions'),head,7,base),false);
  const misplaced=goodJobs();
  misplaced[0].steps.push(misplaced[2].steps.pop());
  assert.equal(successfulGate(goodRun(),misplaced,head,7,base),false);
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
test('Aday yürütmesi bağımsız kontrollerin ortamını veya dosyalarını devralamaz',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/quality-gate.yml'),'utf8').replace(/\r\n/g,'\n');
  const jobs=Object.fromEntries([...workflow.split('\njobs:\n')[1].matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)]
    .map(([,id,body])=>[id,body]));
  assert.match(jobs['candidate-tests'],/run: npm test/);
  assert.match(jobs['baseline-regressions'],/git restore --source="\$SOURCE_SHA" --worktree -- tests supabase\/tests/);
  assert.match(jobs['baseline-regressions'],/node tests\/run\.js --isolated/);
  assert.match(jobs['baseline-regressions'],/python -E -s tests\/e2e\.py/);
  const independent=jobs['quality-gate'];
  assert.match(independent,/needs: \[snapshot, candidate-tests, baseline-regressions\]/);
  assert.match(independent,/if: \$\{\{ always\(\) && needs\.snapshot\.result == 'success' \}\}/);
  assert.match(independent,/needs\.candidate-tests\.result/);
  assert.match(independent,/needs\.baseline-regressions\.result/);
  assert.match(independent,/baseline\/tests\/gate\/browser\.py --root candidate --base-sha "\$BASE_SHA"/);
  assert.doesNotMatch(independent,/npm test|npm run|npm ci|working-directory: candidate|GITHUB_ENV|GITHUB_PATH|\$CONTROLS/);
  const publisher = jobs.publish;
  assert.match(workflow,/^  pull_request_target:/m);
  assert.doesNotMatch(publisher,/^    uses:/m);
  assert.match(publisher,/ref: \$\{\{ github\.sha \}\}/);
  assert.match(publisher,/environment: nakgo-ci-publisher/);
  assert.match(publisher,/needs: \[snapshot, candidate-tests, baseline-regressions, quality-gate\]/);
  for (const name of ['snapshot', 'candidate-tests', 'baseline-regressions', 'quality-gate']) {
    assert.ok(publisher.includes(`needs.${name}.result == 'success'`));
    assert.doesNotMatch(jobs[name],/secrets\.|environment:|\bwrite\b/);
    if (name !== 'snapshot') assert.doesNotMatch(jobs[name],/^\s+outputs:/m);
  }
  assert.match(publisher,/CI_APP_KEY: \$\{\{ secrets\.NAKGO_CI_APP_KEY \}\}/);
  assert.match(publisher,/CI_SNAPSHOT: \$\{\{ toJSON\(needs\.snapshot\.outputs\) \}\}/);
  assert.match(publisher,/permissions:\n      contents: read\n      pull-requests: read/);
  assert.equal([...publisher.matchAll(/^      - /gm)].length,2);
  assert.equal([...publisher.matchAll(/^\s+ref:/gm)].length,1);
  assert.match(publisher,/persist-credentials: false/);
  assert.match(publisher,/run: node \.github\/scripts\/trusted-ci\.js publish/);
  assert.doesNotMatch(publisher,/outputs\.merge|\bnpm\b|candidate\/|\bwrite\b|secrets:\s+inherit/);
  assert.doesNotMatch(workflow,/actions\/(?:upload-artifact|download-artifact|cache)/);
  for(const [name,job] of Object.entries(jobs)) if(name!=='publish') assert.match(job,/runs-on: ubuntu-24\.04/);
  assert.match(publisher,/runs-on: ubuntu-24\.04/);
});

test('Test çalıştırıcısı kayıtsız ve doğrulamasız başarılı görünen modülleri reddeder',()=>{
  const tempRoot=path.join(root,'tests/shots');fs.mkdirSync(tempRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(tempRoot,'nakgo-runner-'));
  try {
    fs.mkdirSync(path.join(dir,'tests/unit'),{recursive:true});
    fs.copyFileSync(path.join(root,'tests/run.js'),path.join(dir,'tests/run.js'));
    fs.writeFileSync(path.join(dir,'index.html'),'<script></script>');
    const fixture=path.join(dir,'tests/unit/changed.test.js');
    for(const code of ['module.exports=()=>{}','module.exports=({test})=>test("fake",()=>[])']){
      fs.writeFileSync(fixture,code);
      const run=cp.spawnSync(process.execPath,['tests/run.js'],{cwd:dir,encoding:'utf8'});
      assert.equal(run.status,1);
      assert.match(run.stderr+run.stdout,/hiçbir test kaydetmedi|hiçbir kontrol çalıştırmadı/);
    }
    fs.writeFileSync(fixture,'module.exports=({test})=>test("real",()=>[[true,"checked"]])');
    assert.equal(cp.spawnSync(process.execPath,['tests/run.js'],{cwd:dir}).status,0);
  } finally {
    assert.equal(path.dirname(dir),tempRoot);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Aday testinin sahte başarısı main regresyonunun hatasını gizleyemez',()=>{
  const tempRoot=path.join(root,'tests/shots');fs.mkdirSync(tempRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(tempRoot,'nakgo-replay-'));
  const git=(...args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=message=>git('-c','user.name=Synthetic fixture','-c','user.email=fixture@invalid',
    '-c','commit.gpgsign=false','commit','-m',message);
  const run=()=>cp.spawnSync(process.execPath,['tests/check.cjs'],{cwd:dir,encoding:'utf8'});
  try {
    git('init');
    fs.mkdirSync(path.join(dir,'tests'));
    const write=(file,contents)=>fs.writeFileSync(path.join(dir,file),contents);
    write('app.cjs','module.exports = true');
    write('tests/check.cjs','require("node:assert/strict").equal(require("../app.cjs"), true)');
    git('add','--','app.cjs','tests/check.cjs');commit('Trusted regression');
    const base=git('rev-parse','HEAD');
    assert.equal(run().status,0);
    write('app.cjs','module.exports = false');
    write('tests/check.cjs','process.exit(0)');
    write('tests/new.cjs','process.exit(0)');
    git('add','--','app.cjs','tests');commit('Synthetic bypass');
    assert.equal(run().status,0);
    git('restore','--source='+base,'--worktree','--','tests');
    assert.equal(fs.existsSync(path.join(dir,'tests/new.cjs')),false);
    assert.equal(run().status,1);
    assert.match(run().stderr,/AssertionError/);
  } finally {
    assert.equal(path.dirname(dir),tempRoot);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

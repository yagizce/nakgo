/* workflow_run: PR kodu/artefaktı çalıştırılmaz; yalnızca main üzerindeki bu dosya. */
'use strict';
const fs=require('node:fs');
const {policyPath,eligiblePR,successfulGate}=require('./policy.js');
function client(token,request=fetch){
  return async(method,route,body)=>{
    const response=await request('https://api.github.com'+route,{
      method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'NakGo-quality-gate'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!response.ok)throw new Error('GitHub API '+response.status+' ('+method+' '+route.split('?')[0]+')');
    return response.json();
  };
}
async function list(api,route,key){
  const out=[];
  for(let page=1;page<=20;page++){
    const data=await api('GET',route+(route.includes('?')?'&':'?')+'per_page=100&page='+page),items=key?data[key]:data;
    if(!Array.isArray(items))throw Error('Beklenmeyen API sonucu');
    out.push(...items);if(items.length<100)return out;
  }
  throw Error('API sonucu sınırı aşıldı; otomatik birleşme durduruldu');
}
async function decide(api,repository,number,sha){
  const prefix='/repos/'+repository;
  const pr=await api('GET',prefix+'/pulls/'+number);
  if(!eligiblePR(pr,repository,sha))return {merge:false,reason:'Draft/fork/branch/SHA veya birleşebilirlik uygun değil'};
  const main=await api('GET',prefix+'/branches/main');
  const required=main.protection?.required_status_checks;
  if(!main.protected||!['quality-gate','verify'].every(name=>required?.contexts?.includes(name)))return {merge:false,reason:'Main zorunlu kontrol koruması etkin değil'};
  if(pr.base.sha!==main.commit.sha)return {merge:false,reason:'Main değişti; yeni kalite çalışması gerekiyor'};
  const compare=await api('GET',prefix+'/compare/'+main.commit.sha+'...'+sha);
  if(compare.merge_base_commit?.sha!==main.commit.sha||compare.behind_by!==0)return {merge:false,reason:'PR güncel main tabanına dayanmıyor'};
  const files=await list(api,prefix+'/pulls/'+number+'/files');
  if(files.some(f=>policyPath(f.filename)||f.previous_filename&&policyPath(f.previous_filename)))return {merge:false,reason:'Test/otomasyon değişikliği ayrı inceleme gerektirir'};
  const gateWorkflow=await api('GET',prefix+'/actions/workflows/quality-gate.yml');
  const runs=await list(api,prefix+'/actions/workflows/'+gateWorkflow.id+'/runs?event=pull_request&head_sha='+sha,'workflow_runs');
  const run=runs.filter(r=>r.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
  if(!run)return {merge:false,reason:'Son commit için kalite sonucu yok'};
  const jobs=await list(api,prefix+'/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs','jobs');
  if(!successfulGate(run,jobs,sha,number,main.commit.sha))return {merge:false,reason:'Kalite kontrolü başarısız, eksik veya atlanmış'};
  const legacyWorkflow=await api('GET',prefix+'/actions/workflows/checks.yml');
  const oldRuns=await list(api,prefix+'/actions/workflows/'+legacyWorkflow.id+'/runs?event=pull_request&head_sha='+sha,'workflow_runs');
  const oldRun=oldRuns.filter(r=>r.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
  if(!oldRun||oldRun.status!=='completed'||oldRun.conclusion!=='success')return {merge:false,reason:'Mevcut NakGo checks başarılı değil'};
  const checks=await list(api,prefix+'/commits/'+sha+'/check-runs','check_runs');
  if(!checks.length||checks.some(c=>c.status!=='completed'||c.conclusion!=='success'))return {merge:false,reason:'Bekleyen/başarısız/atlanmış kontrol var'};
  const status=await api('GET',prefix+'/commits/'+sha+'/status');
  if(status.total_count>0&&status.state!=='success')return {merge:false,reason:'Diğer zorunlu durumlar tamamlanmadı'};
  // Son kez canlı PR durumunu oku. PUT SHA koşulu sonradan gelen commit'i engeller;
  // main strict branch protection ise eşzamanlı taban değişikliğini GitHub engeller.
  const fresh=await api('GET',prefix+'/pulls/'+number);
  if(!eligiblePR(fresh,repository,sha)||fresh.base.sha!==main.commit.sha)return {merge:false,reason:'PR birleşmeden hemen önce değişti'};
  const result=await api('PUT',prefix+'/pulls/'+number+'/merge',{sha,merge_method:'squash'});
  if(!result.merged)throw Error('GitHub birleşmeyi reddetti');
  return {merge:true,reason:'Tüm zorunlu kontroller başarılı',sha:result.sha};
}
async function main(){
  const repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!token)throw Error('Repository veya token eksik');
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),run=event.workflow_run;
  if(!run||run.event!=='pull_request'||run.head_repository?.full_name!==repository||!/^codex\/.+/.test(run.head_branch||'')){
    console.log('Otomatik birleşme kapsamı dışında');return;
  }
  const api=client(token),owner=repository.split('/')[0];
  const prs=await list(api,'/repos/'+repository+'/pulls?state=open&base=main&head='+encodeURIComponent(owner+':'+run.head_branch));
  for(const pr of prs){const result=await decide(api,repository,pr.number,run.head_sha);console.log('PR #'+pr.number+': '+result.reason+(result.merge?' — squash birleşti':''));}
}
module.exports={client,list,decide};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});

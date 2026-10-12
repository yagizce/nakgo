/* Tek otomatik birleşme politikası; yalnızca güvenilir main kodundan çalıştırılır. */
'use strict';
const REQUIRED_STEPS = [
  'Guard and automation tests', 'Install locked packages', 'Existing npm test',
  'Static and security checks', 'Existing browser tests', 'Independent browser tests',
  'Runtime dependency audit', 'Mobile output', 'Workflow syntax checks'
];
const POLICY_PATHS = ['.github/', 'tests/', 'tools/bundle.js', 'tools/dev.js', 'tools/project.js'];
const policyPath = name => POLICY_PATHS.some(p => p.endsWith('/') ? name.startsWith(p) : name === p);
function eligiblePR(pr, repository, sha) {
  return !!pr && pr.state === 'open' && !pr.draft && !pr.merged &&
    pr.base?.ref === 'main' && pr.base.repo?.full_name === repository &&
    pr.head?.repo?.full_name === repository && !pr.head.repo.fork &&
    /^codex\/.+/.test(pr.head.ref) && pr.head.sha === sha &&
    pr.mergeable === true && pr.mergeable_state === 'clean';
}
function successfulGate(run, jobs, sha, prNumber, baseSha) {
  if (!run || run.event !== 'pull_request' || run.head_sha !== sha ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      run.display_title !== 'quality:'+prNumber+':'+sha+':'+baseSha) return false;
  if (!jobs.length || jobs.some(j => j.status !== 'completed' || j.conclusion !== 'success')) return false;
  const gate = jobs.find(j => j.name === 'quality-gate');
  return !!gate && REQUIRED_STEPS.every(name => gate.steps?.some(s => s.name === name && s.status === 'completed' && s.conclusion === 'success'));
}
module.exports = {REQUIRED_STEPS, POLICY_PATHS, policyPath, eligiblePR, successfulGate};

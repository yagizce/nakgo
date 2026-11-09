/* Tek otomatik birleşme politikası; yalnızca güvenilir main kodundan çalıştırılır. */
'use strict';
const REQUIRED_STEPS = {
  'candidate-tests': ['Install locked packages', 'Runtime dependency audit', 'Existing npm test',
    'Existing browser tests', 'Mobile output'],
  'baseline-regressions': ['Restore trusted test suite', 'Trusted unit tests',
    'Trusted browser regressions', 'Trusted RLS and Storage regressions'],
  'quality-gate': ['Require isolated test jobs', 'Trusted automation tests', 'Static and security checks',
    'Workflow syntax checks', 'Independent browser tests']
};
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
  return Object.entries(REQUIRED_STEPS).every(([jobName, steps]) => {
    const matches = jobs.filter(job => job.name === jobName);
    return matches.length === 1 && steps.every(name => matches[0].steps?.some(
      step => step.name === name && step.status === 'completed' && step.conclusion === 'success'));
  });
}
module.exports = {REQUIRED_STEPS, POLICY_PATHS, policyPath, eligiblePR, successfulGate};

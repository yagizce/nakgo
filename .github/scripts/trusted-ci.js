'use strict';
const fs = require('node:fs');
const {sign} = require('node:crypto');

const WORKFLOW = '.github/workflows/quality-gate.yml';
const BOOTSTRAP = 'refs/heads/codex/nakgo-trusted-ci';
const CHECK = 'nakgo/trusted-ci';
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function intent(env, event, publisher = false) {
  const repo = env.GITHUB_REPOSITORY;
  const source = env.GITHUB_SHA;
  const dispatch = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const ref = dispatch ? BOOTSTRAP : 'refs/heads/main';
  const number = Number(dispatch ? event.inputs?.pr : event.pull_request?.number);
  if (repo !== 'yagizce/nakgo' || env.GITHUB_REF !== ref || !sha(source) ||
      (publisher ? env.CI_CALLER_REF : env.GITHUB_WORKFLOW_REF) !== `${repo}/${WORKFLOW}@${ref}` ||
      (publisher ? env.CI_CALLER_SHA : env.GITHUB_WORKFLOW_SHA) !== source ||
      (!dispatch && env.GITHUB_EVENT_NAME !== 'pull_request_target') ||
      !Number.isSafeInteger(number) || number < 1) throw Error('Unexpected workflow or PR');
  return {repo, source, dispatch, number, eventPR: event.pull_request};
}

async function snapshot(api, request) {
  const {repo, source, dispatch, number, eventPR} = request;
  const root = `/repos/${repo}`;
  const pr = await api(`${root}/pulls/${number}`);
  const base = pr.base?.sha, head = pr.head?.sha, merge = pr.merge_commit_sha;
  if (pr.number !== number || pr.state !== 'open' || pr.merged || pr.base?.ref !== 'main' ||
      pr.base.repo?.full_name !== repo || !sha(base) || !sha(head) || !sha(merge) ||
      (dispatch ? head !== source || pr.head.repo?.full_name !== repo ||
        `refs/heads/${pr.head.ref}` !== BOOTSTRAP : base !== source ||
        base !== eventPR?.base?.sha || head !== eventPR?.head?.sha)) throw Error('PR snapshot changed');
  const main = await api(`${root}/git/ref/heads/main`);
  if (main.object?.sha !== base) throw Error('Main advanced since this snapshot');
  const commit = await api(`${root}/git/commits/${merge}`);
  if (commit.sha !== merge || commit.parents?.length !== 2 ||
      commit.parents[0].sha !== base || commit.parents[1].sha !== head) throw Error('Unexpected test merge commit');
  return {source, base, head, merge};
}

function publishable(actual, expected, results) {
  return ['source', 'base', 'head', 'merge'].every(key => sha(actual[key]) && actual[key] === expected[key]) &&
    results.length === 3 && results.every(result => result === 'success');
}

function github(token) {
  if (!token) throw Error('Missing GitHub credential');
  return async (route, body) => {
    const response = await fetch('https://api.github.com' + route, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw Error(`GitHub ${response.status} ${route}`);
    return response.json();
  };
}

async function appClient(env) {
  const {CI_APP_ID: id, CI_INSTALLATION_ID: installation, CI_APP_KEY: key} = env;
  if (!/^\d+$/.test(id ?? '') || !/^\d+$/.test(installation ?? '') || !key) throw Error('Missing CI App configuration');
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({alg: 'RS256', typ: 'JWT'})}.${encode({iat: now - 60, exp: now + 480, iss: id})}`;
  const signature = sign('RSA-SHA256', Buffer.from(jwt), key).toString('base64url');
  const {token} = await github(`${jwt}.${signature}`)(`/app/installations/${installation}/access_tokens`, {
    repositories: ['nakgo'], permissions: {checks: 'write'}
  });
  return github(token);
}

async function main(mode, env) {
  const request = intent(env, JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')), mode === 'publish');
  const current = await snapshot(github(env.GITHUB_TOKEN), request);
  if (mode === 'snapshot') {
    fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(current).map(([key, value]) => `${key}=${value}\n`).join(''));
    return;
  }
  const expected = JSON.parse(env.CI_SNAPSHOT ?? '{}');
  if (mode !== 'publish' || !publishable(current, expected, [env.CI_VERIFY, env.CI_REGRESSIONS, env.CI_GATE])) {
    throw Error('Required jobs failed, were skipped, or used a stale snapshot');
  }
  const app = await appClient(env);
  const result = await app(`/repos/${request.repo}/check-runs`, {
    name: CHECK, head_sha: current.merge, status: 'completed', conclusion: 'success',
    details_url: `https://github.com/${request.repo}/actions/runs/${env.GITHUB_RUN_ID}`,
    external_id: `${request.number}:${current.base}:${current.head}`
  });
  if (result.head_sha !== current.merge || String(result.app?.id) !== env.CI_APP_ID) throw Error('Unexpected check identity');
}

module.exports = {intent, snapshot, publishable};
if (require.main === module) main(process.argv[2], process.env).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

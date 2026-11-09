'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {intent, snapshot, publishable} = require('../../.github/scripts/trusted-ci.js');

const repo = 'yagizce/nakgo';
const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40);
const ref = 'refs/heads/main';
const env = {GITHUB_REPOSITORY: repo, GITHUB_REF: ref, GITHUB_SHA: base,
  GITHUB_WORKFLOW_SHA: base, GITHUB_EVENT_NAME: 'pull_request_target',
  GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/quality-gate.yml@${ref}`};
const pr = {number: 52, state: 'open', merged: false, merge_commit_sha: merge,
  base: {ref: 'main', sha: base, repo: {full_name: repo}}, head: {sha: head}};
const git = {sha: merge, parents: [{sha: base}, {sha: head}]};
const request = intent(env, {pull_request: pr});
const api = (pull = pr, commit = git, current = base) => async route => {
  if (route === `/repos/${repo}/pulls/52`) return pull;
  if (route === `/repos/${repo}/git/ref/heads/main`) return {object: {sha: current}};
  if (route === `/repos/${repo}/git/commits/${pull.merge_commit_sha}`) return commit;
  throw Error(`Unexpected test route ${route}`);
};

test('only the main workflow and its exact SHA may validate regular PRs', () => {
  for (const change of [
    {GITHUB_EVENT_NAME: 'pull_request'},
    {GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/imitator.yml@${ref}`},
    {GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/quality-gate.yml@refs/heads/attacker`},
    {GITHUB_WORKFLOW_SHA: head},
    {GITHUB_REPOSITORY: 'fork/nakgo'}
  ]) assert.throws(() => intent({...env, ...change}, {pull_request: pr}), /Unexpected workflow/);
  const publisher = {...env, CI_CALLER_REF: env.GITHUB_WORKFLOW_REF, CI_CALLER_SHA: base};
  assert.equal(intent(publisher, {pull_request: pr}, true).source, base);
  assert.throws(() => intent({...publisher, CI_CALLER_REF: publisher.CI_CALLER_REF.replace('quality-gate', 'imitator')},
    {pull_request: pr}, true), /Unexpected workflow/);
});

test('pins the current two-parent test merge commit and rejects stale/racing PR data', async () => {
  assert.deepEqual(await snapshot(api(), request), {source: base, base, head, merge});
  for (const changed of [{...pr, head: {sha: merge}}, {...pr, base: {...pr.base, sha: merge}}, {...pr, merged: true}]) {
    await assert.rejects(snapshot(api(changed), request), /PR snapshot changed/);
  }
  for (const changed of [{...git, sha: head}, {...git, parents: [{sha: base}, {sha: merge}]}]) {
    await assert.rejects(snapshot(api(pr, changed), request), /Unexpected test merge commit/);
  }
  await assert.rejects(snapshot(api(pr, git, head), request), /Main advanced/);
});

test('bootstrap dispatch is scoped to the exact protected source PR', async () => {
  const branch = 'codex/nakgo-trusted-ci', bootstrap = `refs/heads/${branch}`;
  const dispatch = {...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: bootstrap,
    GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/quality-gate.yml@${bootstrap}`,
    GITHUB_SHA: head, GITHUB_WORKFLOW_SHA: head};
  const input = {inputs: {pr: '52'}};
  const setup = intent(dispatch, input);
  assert.throws(() => intent({...dispatch, GITHUB_REF: ref}, input), /Unexpected workflow/);
  await assert.rejects(snapshot(api(), setup), /PR snapshot changed/);
  const maintenance = {...pr, head: {sha: head, ref: branch, repo: {full_name: repo}}};
  assert.equal((await snapshot(api(maintenance), setup)).source, head);
  await assert.rejects(snapshot(api({...maintenance, head: {...maintenance.head, sha: merge}}), setup), /PR snapshot changed/);
});

test('missing, skipped, failed and stale outcomes cannot publish success', async () => {
  const current = await snapshot(api(), request), ok = ['success', 'success', 'success'];
  assert.equal(publishable(current, current, ok), true);
  for (const outcome of ['failure', 'skipped', 'cancelled', 'neutral', undefined]) {
    for (let i = 0; i < ok.length; i++) assert.equal(publishable(current, current, ok.with(i, outcome)), false);
  }
  assert.equal(publishable(current, current, ok.slice(1)), false);
  for (const key of ['source', 'base', 'head', 'merge']) {
    assert.equal(publishable(current, {...current, [key]: 'd'.repeat(40)}, ok), false);
  }
});

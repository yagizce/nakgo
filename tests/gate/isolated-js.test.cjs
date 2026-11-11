'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {compartment, vm, authConfig, whatsapp} = require('./isolated-js.cjs');

test('candidate cannot terminate the runner or recover Node through test fixtures', () => {
  const realm = compartment({window: {stub() {}}});
  realm.start('let value = 4; function read(){return value;}');
  assert.equal(realm.evaluate('typeof process + ":" + typeof require + ":" + typeof fetch'), 'undefined:undefined:undefined');
  assert.throws(() => realm.evaluate('window.stub.constructor("return process")()'), /constructor/);
  assert.throws(() => realm.evaluate('globalThis.constructor.constructor("return process")()'), /constructor/);
  assert.throws(() => realm.evaluate('import("node:process")'), /import expression/);
  assert.equal(realm.evaluate('value = 5; read()'), 5);
  assert.equal(realm.evaluate('Date.now = () => 42; Date.now()'), 42);
  assert.notEqual(compartment({}).evaluate('Date.now()'), 42);
});

test('API and worker fixtures expose only simulated values', () => {
  const fixtures = vm.createContext({setTimeout});
  vm.runInContext('function attempt(){ return typeof process; } this.answer = attempt();', fixtures);
  assert.equal(fixtures.answer, 'undefined');
  assert.equal(fixtures.attempt(), 'undefined');
  assert.throws(() => vm.runInContext('setTimeout.constructor("return process")()', fixtures), /constructor/);
  const config = authConfig('export function read(){return [process.exit, Object.keys(process.env).length];}');
  assert.deepEqual(config.read(), [undefined, 0]);
  assert.throws(() => authConfig('import process from "node:process";'), /module shape/);
});

test('candidate Node modules cannot exit, load host modules or read arbitrary files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nakgo-isolated-endpoint-'));
  const server = path.join(root, 'server');
  const directory = path.join(server, 'whatsapp');
  const file = path.join(directory, 'webhook.cjs');
  try {
    fs.mkdirSync(server); fs.mkdirSync(directory);
    for (const [code, error] of [
      ['process.exit(0)', /exit/],
      ['require("node:process").exit(0)', /Unauthorized fixture import/],
      ['require("node:fs").readFileSync(".env", "utf8")', /Unauthorized fixture file/],
      ['require("./../../tests/run.js")', /Unauthorized fixture module/]
    ]) {
      fs.writeFileSync(file, code);
      assert.throws(() => whatsapp(root).load('webhook.cjs'), error);
    }
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const dir of [directory, server, root]) if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});

test('an early exit in the application cannot skip a failing trusted assertion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nakgo-isolated-test-'));
  const tests = path.join(root, 'tests');
  const unit = path.join(tests, 'unit');
  const gate = path.join(tests, 'gate');
  const bundle = path.join(root, 'index.html');
  const runner = path.join(tests, 'run.js');
  const fixture = path.join(unit, 'required.test.js');
  const isolation = path.join(gate, 'isolated-js.cjs');
  try {
    for (const directory of [tests, unit, gate]) fs.mkdirSync(directory);
    fs.copyFileSync(path.join(__dirname, '../run.js'), runner);
    fs.copyFileSync(path.join(__dirname, 'isolated-js.cjs'), isolation);
    fs.writeFileSync(bundle, '<script>if (typeof process !== "undefined") process.exit(0)</script>');
    fs.writeFileSync(fixture, 'module.exports=({run})=>run("required check",(_r,ok)=>ok(false,"sentinel failure"));');
    const result = spawnSync(process.execPath, [runner, '--isolated'], {encoding: 'utf8', timeout: 10000});
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /required check.*sentinel failure/);
    assert.match(result.stdout, /0\/1 kontrol geçti/);

    fs.writeFileSync(bundle, '<script>function stalled(){return new Promise(()=>{});}</script>');
    fs.writeFileSync(fixture, 'module.exports=({run})=>run("must finish",async r=>{await r("return stalled()");});');
    const stalled = spawnSync(process.execPath, [runner, '--isolated'], {encoding: 'utf8', timeout: 10000});
    assert.ifError(stalled.error);
    assert.equal(stalled.status, 1, stalled.stderr);
    assert.doesNotMatch(stalled.stdout, /kontrol geçti/);
  } finally {
    for (const file of [bundle, runner, fixture, isolation]) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const directory of [gate, unit, tests, root]) if (fs.existsSync(directory)) fs.rmdirSync(directory);
  }
});

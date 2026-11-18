// B4: aynı Worker kodu gerçek Workers çalışma ortamında (workerd, Miniflare). NAKGO_MINIFLARE (miniflare modülünün yolu)
// yoksa atlanır; depo bağımlılık eklemez. Veritabanlı akış tests/db/worker-role.test.cjs içinde.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Worker workerd içinde: rotalar, başlıklar, sınırlama, gövde sınırı, yapılandırılmamış veritabanı', async t => {
  if (!process.env.NAKGO_MINIFLARE) { t.skip('NAKGO_MINIFLARE gerekli'); return; }
  const {Miniflare} = await import(pathToFileURL(process.env.NAKGO_MINIFLARE).href);
  const mf = new Miniflare({modules: true, scriptPath: path.join(ROOT, 'server/worker.mjs'), modulesRoot: ROOT, compatibilityDate: '2026-01-01', bindings: {LOG_LEVEL: 'error'}});
  try {
    let r = await mf.dispatchFetch('http://w/health');
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), {ok: true});
    for (const [h, v] of [['cache-control', 'no-store'], ['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff']]) assert.equal(r.headers.get(h), v);
    assert.equal((await mf.dispatchFetch('http://w/yok')).status, 404);
    r = await mf.dispatchFetch('http://w/health', {method: 'POST', body: '{}'}); assert.equal(r.status, 405);
    r = await mf.dispatchFetch('http://w/health/db'); assert.equal(r.status, 503); assert.equal((await r.json()).error.key, 'not_configured');
    let last; for (let i = 0; i < 61; i++) last = await mf.dispatchFetch('http://w/health', {headers: {'cf-connecting-ip': '203.0.113.77'}});
    assert.equal(last.status, 429); assert.ok(Number(last.headers.get('retry-after')) >= 1);
    assert.equal((await mf.dispatchFetch('http://w/health', {headers: {'cf-connecting-ip': '203.0.113.78'}})).status, 200, 'başka istemci etkilenmez');
  } finally { await mf.dispose(); }
});

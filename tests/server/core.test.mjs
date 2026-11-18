// B4 sunucu çekirdeği: günlük ayıklama, yapılandırılmış günlük, istek sınırlama, istek işleyici, veritabanı istemcisi ve
// Worker giriş noktası. Yalnız Web API'leri kullanılır; Node 24'te çalışır (Workers'ta aynı kod: miniflare testi).
import test from 'node:test';
import assert from 'node:assert/strict';
import {redact, redactText} from '../../server/core/redact.mjs';
import {createLogger} from '../../server/core/log.mjs';
import {createLimiter, MemoryStore} from '../../server/core/ratelimit.mjs';
import {createApp} from '../../server/core/app.mjs';
import {createDb} from '../../server/core/db.mjs';
import {HttpError} from '../../server/core/http.mjs';
import {build, RULES} from '../../server/worker.mjs';

const lines = () => { const out = []; return {out, sink: l => out.push(l)}; };

test('ayıklama: telefon, e-posta, belirteç, anahtar ve IP günlüğe girmez', () => {
  for (const phone of ['05321234567', '+905321234567', '+90 532 123 45 67', '0532-123-45-67', '(0532) 123 45 67', '90 532 123 45 67', '0212 555 12 34', '5321234567'])
    assert.ok(!/\d{3}.?\d{2}.?\d{2}$/.test(redactText('ara ' + phone).replace('[telefon]', '')), phone);
  const t = redactText('mail a.b@x.com.tr tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdEFGH1234 Bearer abc.def-123 Basic dXNlcjpwYXNz sb_secret_abcdefgh1234 ' +
    'sb_publishable_abcdefgh1234 a'.repeat(1) + ' ' + 'f'.repeat(40) + ' ip 203.0.113.7 v6 2001:db8::1:2');
  for (const leak of ['a.b@x.com.tr', 'eyJhbGciOiJIUzI1NiJ9', 'abc.def-123', 'dXNlcjpwYXNz', 'sb_secret_abcdefgh1234', 'sb_publishable_abcdefgh1234', 'f'.repeat(40), '203.0.113.7', '2001:db8'])
    assert.ok(!t.includes(leak), leak + ' sızdı: ' + t);
  const r = redact({route: '/health', status: 200, phone: '05321234567', contact_phone: 'x', Authorization: 'Bearer x', password: 'p', apiKey: 'k', token: 't',
    'cf-connecting-ip': '1.2.3.4', ip: '1.2.3.4', email: 'a@b.co', nested: {deeper: {note: 'beni 0532 123 45 67 ara'}}, list: ['a@b.co'], cookie: 'c', session_id: 's'});
  assert.equal(r.route, '/health'); assert.equal(r.status, 200);
  for (const k of ['phone', 'contact_phone', 'Authorization', 'password', 'apiKey', 'token', 'cf-connecting-ip', 'ip', 'email', 'cookie', 'session_id']) assert.equal(r[k], '[gizli]', k);
  assert.equal(r.nested.deeper.note, 'beni [telefon] ara'); assert.deepEqual(r.list, ['[e-posta]']);
  // Hata nesnesinden ileti yazılmaz (satır içeriği taşıyabilir).
  const e = Object.assign(new Error('Failing row contains (05321234567)'), {code: '23514'});
  assert.deepEqual(redact({e}).e, {name: 'Error', code: '23514'});
  // Sınırlar: derinlik, uzunluk, anahtar sayısı.
  let deep = {}; const root = deep; for (let i = 0; i < 10; i++) deep = deep.x = {};
  assert.ok(JSON.stringify(redact(root)).includes('[derin]'));
  assert.ok(redactText('x'.repeat(10000)).length <= 501);
  assert.equal(Object.keys(redact(Object.fromEntries(Array.from({length: 100}, (_, i) => ['k' + i, i])))).length, 40);
  // Rakam dizisi olan ama telefon olmayan değerler (süre, durum, kimlik) bozulmaz.
  assert.equal(redactText('status 200 ms 12 id 42'), 'status 200 ms 12 id 42');
});

test('günlük: tek satır JSON, düzey süzme, alanlar ayıklanır, yazım hatası isteği düşürmez', () => {
  const {out, sink} = lines();
  const log = createLogger({sink, level: 'info', base: {service: 's'}, now: () => 'T'});
  log.debug('gizli', {a: 1}); log.info('request', {route: '/x', phone: '05321234567', note: 'tel 05321234567'}); log.child({id: 'r1'}).warn('w', {});
  assert.equal(out.length, 2);
  assert.deepEqual(JSON.parse(out[0]), {ts: 'T', level: 'info', event: 'request', service: 's', route: '/x', phone: '[gizli]', note: 'tel [telefon]'});
  assert.deepEqual(JSON.parse(out[1]), {ts: 'T', level: 'warn', event: 'w', service: 's', id: 'r1'});
  assert.ok(out.every(l => !l.includes('\n')));
  const bad = createLogger({sink: () => { throw Error('disk dolu'); }});
  assert.doesNotThrow(() => bad.error('x', {a: 1}));
  const circular = {}; circular.self = circular;
  assert.doesNotThrow(() => createLogger({sink}).info('c', {circular}));
});

test('istek sınırlama: kural, pencere, istemci ayrımı, ham kimlik tutulmaz, bellek sınırlı', async () => {
  let t = 1_000_000;
  const store = new MemoryStore({maxKeys: 50});
  const lim = createLimiter({rules: {a: {limit: 3, windowMs: 60_000}, b: {limit: 1, windowMs: 1000}}, store, now: () => t});
  const r = [];
  for (let i = 0; i < 4; i++) r.push((await lim.check('a', '203.0.113.7')).ok);
  assert.deepEqual(r, [true, true, true, false]);
  const blocked = await lim.check('a', '203.0.113.7');
  assert.equal(blocked.remaining, 0); assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  assert.ok((await lim.check('a', '198.51.100.1')).ok, 'başka istemci ayrı sayılır');
  assert.ok((await lim.check('b', '203.0.113.7')).ok, 'başka kural ayrı sayılır');
  t += 60_000; assert.ok((await lim.check('a', '203.0.113.7')).ok, 'yeni pencerede açılır');
  assert.ok([...store.map.keys()].every(k => !k.includes('203.0.113.7') && !k.includes('198.51')), 'IP bellekte ham durmaz');
  for (let i = 0; i < 500; i++) await lim.check('a', 'saldırgan-' + i);
  assert.ok(store.map.size <= 50, 'anahtar seli belleği şişiremez');
  await assert.rejects(lim.check('yok', 'x'));
  for (const rules of [{A: {limit: 1, windowMs: 1000}}, {a: {limit: 0, windowMs: 1000}}, {a: {limit: 1, windowMs: 10}}, {a: {limit: 1.5, windowMs: 1000}}])
    assert.throws(() => createLimiter({rules}));
});

test('istek işleyici: 404, 405, 413, 400, 429, bilinen ve beklenmeyen hata, başlıklar, günlükte sorgu/IP/telefon yok', async () => {
  const {out, sink} = lines();
  const routes = [
    {method: 'GET', path: '/ok', rule: 'r', handler: ({url}) => ({body: {q: url.searchParams.has('x')}})},
    {method: 'POST', path: '/post', rule: 'r', handler: () => ({status: 201, body: {}})},
    {method: 'GET', path: '/known', rule: 'r', handler: () => { throw new HttpError('not_configured'); }},
    {method: 'GET', path: '/boom', rule: 'r', handler: () => { throw Object.assign(new Error('Failing row contains (05321234567, a@b.co)'), {code: '23514'}); }},
    {method: 'GET', path: '/limited', rule: 'tight', handler: () => ({body: {}})},
  ];
  const app = createApp({routes, limiter: createLimiter({rules: {r: {limit: 100, windowMs: 60_000}, tight: {limit: 2, windowMs: 60_000}}}), log: createLogger({sink})});
  const req = (path, init = {}) => app(new Request('http://x' + path, {headers: {'cf-connecting-ip': '203.0.113.9'}, ...init}));
  let r = await req('/ok?x=05321234567&token=gizli');
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), {q: true});
  for (const [h, v] of [['cache-control', 'no-store'], ['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY']]) assert.equal(r.headers.get(h), v);
  assert.match(r.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal((await req('/yok')).status, 404);
  assert.equal((await req('/ok/../ok')).status, 200, 'URL normalleşir');
  assert.equal((await req('/' + 'a'.repeat(200))).status, 404);
  r = await req('/ok', {method: 'POST', body: '{}'}); assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'GET');
  assert.equal((await req('/ok', {method: 'HEAD'})).status, 200, 'HEAD = GET');
  assert.equal((await req('/post', {method: 'POST', body: 'x'.repeat(17 * 1024)})).status, 413);
  assert.equal((await app(new Request('http://x/post', {method: 'POST', headers: {'content-length': 'abc'}, body: 'x'}))).status, 413);
  // Başlık büyük gövde bildiriyorsa gövde okunmadan reddedilir.
  assert.equal((await app(new Request('http://x/post', {method: 'POST', headers: {'content-length': '20000'}, body: 'x'}))).status, 413);
  r = await req('/known'); assert.equal(r.status, 503); assert.equal((await r.json()).error.key, 'not_configured');
  r = await req('/boom'); assert.equal(r.status, 500);
  const body = await r.text(); assert.ok(!body.includes('0532') && !body.includes('Failing') && body.includes('internal_error'));
  assert.equal((await req('/limited')).status, 200); assert.equal((await req('/limited')).status, 200);
  r = await req('/limited'); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) >= 1);
  const all = out.join('\n');
  for (const leak of ['05321234567', 'token=', '203.0.113.9', 'a@b.co', 'Failing row', '?x='])
    assert.ok(!all.includes(leak), leak + ' günlüğe sızdı');
  const reqLines = out.map(l => JSON.parse(l)).filter(l => l.event === 'request');
  assert.ok(reqLines.every(l => typeof l.ms === 'number' && l.id && l.status));
  assert.ok(reqLines.some(l => l.route === '/boom' && l.error === '23514' && l.status === 500));
  assert.ok(reqLines.some(l => l.route === 'bilinmeyen' && l.status === 404), 'bilinmeyen yol ham yazılmaz');
  assert.ok(out.map(l => JSON.parse(l)).some(l => l.event === 'rate_limited' && l.rule === 'tight'));
  assert.throws(() => createApp({routes: [{method: 'PUT', path: '/x', rule: 'r', handler() {}}], limiter: {}, log: createLogger({sink})}));
});

test('veritabanı istemcisi: yalnız worker şeması, belirteç, zaman aşımı, ileti sızdırmaz', async () => {
  assert.equal(createDb({}).configured, false);
  await assert.rejects(createDb({}).rpc('health'), e => e.key === 'not_configured');
  const seen = [];
  const db = createDb({url: 'http://pg.local', token: 'x'.repeat(40), fetcher: async (u, init) => { seen.push([u, init]); return new Response(JSON.stringify({ok: 1}), {status: 200}); }});
  assert.deepEqual(await db.rpc('health', {a: 1}), {ok: 1});
  assert.equal(seen[0][0], 'http://pg.local/rpc/health');
  assert.equal(seen[0][1].headers['Content-Profile'], 'worker'); assert.equal(seen[0][1].headers['Accept-Profile'], 'worker');
  assert.equal(seen[0][1].headers.Authorization, 'Bearer ' + 'x'.repeat(40));
  await assert.rejects(db.rpc('Health;drop'));
  const failing = createDb({url: 'http://pg.local', token: 'x'.repeat(40), fetcher: async () => new Response(JSON.stringify({code: '42501', message: 'permission denied for table listings 05321234567'}), {status: 403})});
  await assert.rejects(failing.rpc('health'), e => e.code === '42501' && !String(e.message).includes('0532'));
  const down = createDb({url: 'http://pg.local', token: 'x'.repeat(40), fetcher: async () => { throw TypeError('fetch failed'); }});
  await assert.rejects(down.rpc('health'), e => e.key === 'upstream_unavailable');
  const slow = createDb({url: 'http://pg.local', token: 'x'.repeat(40), timeoutMs: 50, fetcher: (u, {signal}) => new Promise((_, no) => signal.addEventListener('abort', () => no(signal.reason)))});
  await assert.rejects(slow.rpc('health'), e => e.key === 'upstream_unavailable');
});

test('Worker girişi: rotalar, yapılandırılmamış veritabanı, parametre denetimi', async () => {
  const {out, sink} = lines();
  const app = build({}, {sink});
  assert.deepEqual(await (await app(new Request('http://w/health'))).json(), {ok: true});
  const r = await app(new Request('http://w/health/db')); assert.equal(r.status, 503); assert.equal((await r.json()).error.key, 'not_configured');
  for (const h of ['0', '169', 'abc', '1.5']) assert.equal((await app(new Request('http://w/usage/v1?hours=' + h))).status, 400, h);
  assert.ok(Object.values(RULES).every(x => x.limit >= 1));
  const usage = build({WORKER_DB_URL: 'http://pg.local', WORKER_DB_TOKEN: 'y'.repeat(40)}, {sink, fetcher: async (u, init) =>
    new Response(JSON.stringify(u.endsWith('/api_usage') ? [{hours: JSON.parse(init.body).p_hours}] : {}), {status: 200})});
  assert.deepEqual(await (await usage(new Request('http://w/usage/v1?hours=6'))).json(), {ok: true, usage: [{hours: 6}]});
  assert.ok(out.every(l => !l.includes('y'.repeat(40))), 'belirteç günlüğe girmez');
});

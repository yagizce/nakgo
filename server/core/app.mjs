// Çalışma ortamından bağımsız istek işleyici: (Request) => Response. Cloudflare Workers, Vercel ve Node 24'te aynı kod.
// Sıra: istek kimliği → yol/yöntem denetimi → gövde boyutu → istek sınırı → işleyici → yapılandırılmış günlük.
// İşleyici yalnız kendi rotasının bağlamını görür; ortam değişkenleri ve sırlar işleyiciye değil modüllere verilir.
import {fail, json, HttpError, ERRORS} from './http.mjs';

const clientSubject = request =>
  request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'bilinmiyor';

async function readLimited(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export function createApp({routes, limiter, log, maxBody = 16 * 1024, deps = {}}) {
  const table = new Map();
  for (const r of routes) {
    if (!/^\/[a-z0-9/_-]*$/.test(r.path) || !['GET', 'POST'].includes(r.method) || typeof r.handler !== 'function' || typeof r.rule !== 'string')
      throw Error('Geçersiz rota tanımı');
    const methods = table.get(r.path) || new Map();
    methods.set(r.method, r);
    table.set(r.path, methods);
  }
  return async function handle(request) {
    const id = crypto.randomUUID(), started = Date.now();
    let status = 500, route = null, errorCode = null;
    const done = response => {
      status = response.status;
      response.headers.set('X-Request-Id', id);
      log.info('request', {id, method: request.method, route: route || 'bilinmeyen', status, ms: Date.now() - started, ...(errorCode ? {error: errorCode} : {})});
      return response;
    };
    try {
      const url = new URL(request.url);
      // Sorgu metni, gövde ve başlıklar günlüğe girmez; yalnız tanımlı rota adı yazılır.
      const methods = url.pathname.length <= 128 ? table.get(url.pathname) : null;
      if (!methods) return done(fail('not_found'));
      const r = methods.get(request.method === 'HEAD' ? 'GET' : request.method);
      if (!r) return done(fail('method_not_allowed', {Allow: [...methods.keys()].join(', ')}));
      route = r.path;
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d{1,9}$/.test(length) || Number(length) > maxBody)) return done(fail('payload_too_large'));
      if (r.method === 'GET' && length !== null && Number(length) > 0) return done(fail('bad_request'));
      // Gövde başlığa güvenilmeden, sınırla okunur (başlıksız ya da yanlış başlıklı büyük gövde de reddedilir).
      let body = '';
      if (r.method === 'POST') {
        body = await readLimited(request, maxBody);
        if (body === null) return done(fail('payload_too_large'));
      }
      const limit = await limiter.check(r.rule, clientSubject(request));
      if (!limit.ok) {
        errorCode = 'rate_limited';
        log.warn('rate_limited', {id, route, rule: r.rule});
        return done(fail('rate_limited', {'Retry-After': String(limit.retryAfter)}));
      }
      const out = await r.handler({request, url, body, id, log: log.child({id, route}), ...deps});
      if (out instanceof Response) return done(out);
      return done(json(out.status || 200, out.body ?? {}, out.headers || {}));
    } catch (e) {
      const key = e instanceof HttpError && ERRORS[e.key] ? e.key : 'internal_error';
      errorCode = e && e.code ? String(e.code) : key;
      log.error('handler_error', {id, route: route || 'bilinmeyen', error: e});
      return done(fail(key));
    }
  };
}

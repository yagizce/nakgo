// NakGo sunucu katmanı giriş noktası (B4 iskeleti). Cloudflare Workers biçimi: export default {fetch}.
// Yalnız yerelde (Miniflare/workerd) ve testlerde çalışır; hiçbir yere yayımlanmaz. Vercel'den taşınma son aşamada.
//
// Ortam (Workers değişkenleri/sırları):
//   WORKER_DB_URL   PostgREST adresi (yerelde test PostgREST'i)
//   WORKER_DB_TOKEN `worker` rolünün belirteci (sır). service_role KULLANILMAZ.
//   LOG_LEVEL       debug | info | warn | error (varsayılan info)
import {createApp} from './core/app.mjs';
import {createLimiter} from './core/ratelimit.mjs';
import {createLogger} from './core/log.mjs';
import {createDb} from './core/db.mjs';

// Rota başına sınırlar (istemci başına, dakikalık). Değerler iskelet içindir; üretim değerleri ölçümle belirlenecek.
export const RULES = {
  health: {limit: 60, windowMs: 60_000},
  health_db: {limit: 10, windowMs: 60_000},
  usage: {limit: 10, windowMs: 60_000},
};

export const ROUTES = [
  {method: 'GET', path: '/health', rule: 'health', handler: () => ({body: {ok: true}})},
  // Veritabanı erişimi yalnız worker şemasındaki fonksiyonlarla.
  {method: 'GET', path: '/health/db', rule: 'health_db', handler: async ({db}) => ({body: {ok: true, db: await db.rpc('health')}})},
  // v1 kullanım özeti (kişisel veri yok): son 1–168 saat.
  {method: 'GET', path: '/usage/v1', rule: 'usage', handler: async ({db, url}) => {
    const hours = Number(url.searchParams.get('hours') || 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) return {status: 400, body: {error: {key: 'bad_request', message: 'Geçersiz istek'}}};
    return {body: {ok: true, usage: await db.rpc('api_usage', {p_hours: hours})}};
  }},
];

export function build(env = {}, {sink, fetcher, store} = {}) {
  const log = createLogger({level: env.LOG_LEVEL || 'info', base: {service: 'nakgo-worker'}, ...(sink ? {sink} : {})});
  const db = createDb({url: env.WORKER_DB_URL, token: env.WORKER_DB_TOKEN, ...(fetcher ? {fetcher} : {})});
  return createApp({routes: ROUTES, limiter: createLimiter({rules: RULES, ...(store ? {store} : {})}), log, deps: {db}});
}

let app = null;
export default {
  async fetch(request, env) {
    app ??= build(env);
    return app(request);
  },
};

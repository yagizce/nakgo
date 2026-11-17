// B7-A4: yedek izleme Worker'ı. DAĞITILMADI. Dağıtım B7-B/C'de ayrı onayla yapılır (bkz. docs/backup/runbooks/alarms.md).
//
// Bağlamalar (wrangler.example.toml):
//   BACKUP_BUCKET   yedek kovası, YALNIZ OKUMA (R2 bağlaması; Worker hiçbir şey yazmaz ya da silmez)
//   TRUSTED_K1      {"key_id":"PEM"} — K1 açık anahtarı (gizli değil)
//   GITHUB_REPO     "sahip/depo";  GITHUB_TOKEN yalnız actions:read yetkili, ince taneli belirteç (gizli)
//   NOTIFY_WEBHOOK  uyarıların gönderileceği adres (gizli). WhatsApp kullanılmaz.
//   HEARTBEAT_URL   ölü adam anahtarı: her çalışmada çağrılır; Worker durursa harici servis alarm verir (gizli)
//   DELETION_ENABLED "true" | "false"
// Zamanlama: saatte bir (cron "17 * * * *").
import { assess, verifySigned, shouldNotify, isDigestTime } from './core.mjs';

const pad = n => String(n).padStart(2, '0');
const dayPrefix = d => `manifests/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/`;

async function listAll(bucket, prefix, limit = 2000) {
  const out = []; let cursor;
  do {
    const r = await bucket.list({ prefix, cursor, limit: 1000 });
    out.push(...r.objects); cursor = r.truncated ? r.cursor : undefined;
  } while (cursor && out.length < limit);
  return out;
}
async function readJson(bucket, key) { const o = await bucket.get(key); return o ? JSON.parse(await o.text()) : null; }

export async function collect(env, now, fetchImpl = fetch) {
  const trusted = JSON.parse(env.TRUSTED_K1 || '{}');
  const manifests = [];
  for (const d of [now, new Date(now.getTime() - 86400000)]) {
    for (const o of await listAll(env.BACKUP_BUCKET, dayPrefix(d))) {
      const doc = await readJson(env.BACKUP_BUCKET, o.key).catch(() => null);
      manifests.push({ doc: doc || {}, sigOk: doc ? (await verifySigned('nakgo-backup-manifest/v1', doc, trusted)).ok : false });
    }
  }
  const cps = (await listAll(env.BACKUP_BUCKET, 'audit/checkpoints/', 100000)).map(o => o.key).filter(k => /\/\d{12}\.json$/.test(k)).sort().reverse().slice(0, 60);
  const headers = [];
  for (const k of cps) {
    const doc = await readJson(env.BACKUP_BUCKET, k).catch(() => null);
    headers.push({ doc: doc || {}, sigOk: doc ? (await verifySigned('nakgo-legal-checkpoint/v1', doc, trusted)).ok : false });
  }
  const db = await env.BACKUP_BUCKET.list({ prefix: 'db/', limit: 1 });
  const oldestDb = db.objects[0] ? new Date(db.objects[0].uploaded).toISOString() : null;
  let workflow = null;
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/backup.yml/runs?per_page=1`,
      { headers: { authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'nakgo-backup-monitor' } });
    if (r.ok) { const j = await r.json(); const w = j.workflow_runs && j.workflow_runs[0]; if (w) workflow = { status: w.status, conclusion: w.conclusion, created_at: w.created_at, updated_at: w.updated_at }; }
  } catch { workflow = null; }
  return { now, manifests, headers, workflow, oldestDb, deletionEnabled: env.DELETION_ENABLED === 'true' };
}

export async function run(env, now, fetchImpl = fetch) {
  let result;
  try { result = assess(await collect(env, now, fetchImpl)); }
  catch (e) { result = { level: 'critical', alerts: [{ level: 'critical', code: 'monitor_error', message: 'izleme verisi okunamadı' }], last_verified: null }; }
  const sent = { notify: false, heartbeat: false };
  if (shouldNotify(result, now) && env.NOTIFY_WEBHOOK) {
    const r = await fetchImpl(env.NOTIFY_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: 'nakgo-backup', kind: isDigestTime(now) && result.level === 'ok' ? 'weekly_digest' : 'alert', at: now.toISOString(), ...result }) }).catch(() => null);
    sent.notify = Boolean(r && r.ok);
  }
  // Kalp atışı yalnız izleme gerçekten çalışıp karar üretebildiyse gönderilir.
  if (env.HEARTBEAT_URL && !result.alerts.some(a => a.code === 'monitor_error')) {
    const r = await fetchImpl(env.HEARTBEAT_URL, { method: 'GET' }).catch(() => null);
    sent.heartbeat = Boolean(r && r.ok);
  }
  return { result, sent };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env, new Date(event.scheduledTime))); },
  async fetch() { return new Response('nakgo-backup-monitor', { status: 200 }); },
};

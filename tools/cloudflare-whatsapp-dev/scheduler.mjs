// DEV-only external timer. No public route, database credential or payload logging.
// Pin to the accepted immutable DEV deployment; never accept a caller-provided URL.
export const DEV_ORIGIN = 'https://nakgo-dy3bdukkb-yagizces-projects.vercel.app';
const DEV_DB = 'https://axkotffqrsddbrazhcwj.supabase.co';
export async function tick(env, fetchImpl = fetch) {
  if (env.NAKGO_ENV !== 'dev') throw new Error('dev_environment_required');
  if (env.SCHEDULER_ENABLED === 'false') return { skipped: true };
  if (env.SCHEDULER_ENABLED !== 'true') throw new Error('explicit_enable_required');
  if (typeof env.WHATSAPP_WORKER_SECRET !== 'string' || env.WHATSAPP_WORKER_SECRET.length < 32)
    throw new Error('worker_secret_required');
  try {
    // Fail closed on Vercel protection, redirects, HTML, disabled auth or wrong DB.
    const config = await fetchImpl(DEV_ORIGIN + '/api/auth/config', {
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!config.ok || !(config.headers.get('content-type') || '').includes('application/json'))
      throw new Error();
    const publicConfig = await config.json();
    if (publicConfig.enabled !== true || publicConfig.url !== DEV_DB) throw new Error();
    const response = await fetchImpl(DEV_ORIGIN + '/api/whatsapp/worker', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
      headers: { Authorization: 'Bearer ' + env.WHATSAPP_WORKER_SECRET, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!Number.isInteger(result.completed) || !Number.isInteger(result.failed) ||
        result.completed < 0 || result.failed < 0 || result.completed + result.failed > 5 || result.failed > 0)
      throw new Error();
    return { completed: result.completed, failed: result.failed };
  } catch {
    // Do not leak headers, upstream error bodies, phone numbers or request details.
    throw new Error('dev_worker_check_failed');
  }
}
export default {
  async scheduled(_controller, env) { await tick(env); }
};

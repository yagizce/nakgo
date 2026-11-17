// B7-A4: yedek izleme kararları. Saf fonksiyonlar; Cloudflare Worker'da ve Node testlerinde aynı kod çalışır.
// İmza doğrulaması WebCrypto Ed25519 ile yapılır; biçim tools/backup/crypto.cjs ile birebir aynıdır.
//
// Eşikler (B7 kararı): son DOĞRULANMIŞ yedekten bu yana 13 saat → uyarı, 19 saat → kritik. RPO 24 saat bir hedeftir,
// garanti değildir. Kontrol noktası 19 saattir ilerlemiyorsa kritik. Açık olay her saat kritik; 7 günü aşınca
// "yükseltildi" olarak işaretlenir. Silme açıkken en eski döküm 16 günü aşarsa uyarı (silme çalışmıyor).
// Veri yoksa ya da imza doğrulanamıyorsa kritik: belirsizlik "iyi" sayılmaz.

export const THRESHOLDS = Object.freeze({ warnHours: 13, critHours: 19, checkpointCritHours: 19, runStuckHours: 2, noRunWarnHours: 13, deletionLagDays: 16, eventEscalateDays: 7 });
const H = 3600000, D = 86400000;

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function pemToDer(pem) { return b64(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); }

/** trusted: {key_id: PEM}. Dönüş {ok, reason}. */
export async function verifySigned(namespace, doc, trusted) {
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'belge yok' };
  if (doc.sig_alg !== 'ed25519' || doc.namespace !== namespace) return { ok: false, reason: 'alan adı ya da algoritma' };
  const pem = trusted && Object.prototype.hasOwnProperty.call(trusted, doc.key_id) ? trusted[doc.key_id] : null;
  if (!pem) return { ok: false, reason: 'bilinmeyen anahtar' };
  const der = pemToDer(pem);
  if (hex(await crypto.subtle.digest('SHA-256', der)).slice(0, 16) !== doc.key_id) return { ok: false, reason: 'anahtar kimliği' };
  try {
    const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(namespace + '\n' + canonical({ ...doc, signature: undefined }));
    return (await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(doc.signature), data)) ? { ok: true } : { ok: false, reason: 'imza geçersiz' };
  } catch { return { ok: false, reason: 'imza doğrulanamadı' }; }
}

/**
 * input = {
 *   now: Date,
 *   manifests: [{doc, sigOk}]          son günlerin manifestleri
 *   headers:   [{doc, sigOk}]          en yeniden geriye kontrol noktası başlıkları (en az 1)
 *   workflow:  {status, conclusion, created_at, updated_at} | null    son yedek iş akışı çalışması
 *   oldestDb:  ISO tarih | null         en eski döküm nesnesi
 *   deletionEnabled: boolean
 *   journal:   {unresolved} | null       sonucu 1 saattir yazılmamış silme niyeti sayısı
 * }
 */
export function assess(input) {
  const { now } = input, alerts = [];
  const add = (level, code, message) => alerts.push({ level, code, message });
  const hoursSince = iso => (now.getTime() - Date.parse(iso)) / H;

  const bad = (input.manifests || []).filter(m => !m.sigOk);
  if (bad.length) add('critical', 'manifest_signature', `${bad.length} manifest imzası doğrulanamadı`);
  const verified = (input.manifests || []).filter(m => m.sigOk && m.doc.verified === true).map(m => m.doc.created_at).sort();
  const last = verified[verified.length - 1];
  if (!last) add('critical', 'no_verified_backup', 'doğrulanmış yedek bulunamadı');
  else {
    const h = hoursSince(last);
    if (h >= THRESHOLDS.critHours) add('critical', 'backup_age', `son doğrulanmış yedek ${h.toFixed(1)} saat önce`);
    else if (h >= THRESHOLDS.warnHours) add('warning', 'backup_age', `son doğrulanmış yedek ${h.toFixed(1)} saat önce`);
  }

  const headers = input.headers || [];
  if (!headers.length) add('critical', 'no_checkpoint', 'kontrol noktası bulunamadı');
  else if (headers.some(h => !h.sigOk)) add('critical', 'checkpoint_signature', 'kontrol noktası imzası doğrulanamadı');
  else {
    const head = headers[0].doc;
    for (let i = 0; i + 1 < headers.length; i++) if (headers[i].doc.seq !== headers[i + 1].doc.seq + 1) { add('critical', 'checkpoint_gap', 'kontrol noktası sırası kesintili'); break; }
    const h = hoursSince(head.created_at);
    if (h >= THRESHOLDS.checkpointCritHours) add('critical', 'checkpoint_age', `kontrol noktası ${h.toFixed(1)} saattir ilerlemiyor`);
    if (head.events && head.events.open > 0) {
      let since = head.created_at;
      for (const x of headers) { if (x.doc.events && x.doc.events.open > 0) since = x.doc.created_at; else break; }
      const days = (now.getTime() - Date.parse(since)) / D;
      add('critical', days >= THRESHOLDS.eventEscalateDays ? 'event_escalated' : 'event_open',
        `${head.events.open} açık olay; en az ${days.toFixed(1)} gündür. İnsan incelemesi ve K2 serbest bırakma gerekir; o zamana kadar yedek silinmez.`);
    }
    if (head.single_use_guaranteed !== true) add('info', 'single_use_unverified', 'tek kullanımlılık depo davranışı kanıtlanana kadar garanti edilmiyor (K3)');
    if (head.observed === false) add('warning', 'legal_not_observed', 'son kontrol noktasında yasal durum gözlenemedi');
  }

  const w = input.workflow;
  if (!w) add('warning', 'workflow_unknown', 'yedek iş akışı durumu okunamadı');
  else {
    if (w.status === 'completed' && w.conclusion !== 'success') add('warning', 'workflow_failed', `son çalışma: ${w.conclusion}`);
    if (w.status !== 'completed' && hoursSince(w.created_at) >= THRESHOLDS.runStuckHours) add('warning', 'workflow_stuck', `çalışma ${hoursSince(w.created_at).toFixed(1)} saattir bitmedi`);
    if (hoursSince(w.created_at) >= THRESHOLDS.noRunWarnHours) add('warning', 'workflow_silent', `${hoursSince(w.created_at).toFixed(1)} saattir çalışma başlamadı`);
  }

  if (input.oldestDb) {
    const days = (now.getTime() - Date.parse(input.oldestDb)) / D;
    if (input.deletionEnabled && days >= THRESHOLDS.deletionLagDays) add('warning', 'deletion_lag', `en eski döküm ${days.toFixed(1)} gün; silme çalışmıyor olabilir`);
    else if (!input.deletionEnabled) add('info', 'deletion_disabled', `silme kapalı (D1); en eski döküm ${days.toFixed(1)} gün`);
  }

  // Silme niyeti yazılmış ama 1 saattir sonucu yok: silme gerçekleşmiş olabilir ve kanıtı eksik. Kritik.
  if (input.journal && input.journal.unresolved > 0) add('critical', 'deletion_result_missing', `${input.journal.unresolved} silme niyetinin sonuç kaydı yok; otomatik silme durdu, insan incelemesi gerekir`);
  if (input.journal === null) add('warning', 'journal_unknown', 'silme günlüğü okunamadı');

  const level = alerts.some(a => a.level === 'critical') ? 'critical' : alerts.some(a => a.level === 'warning') ? 'warning' : 'ok';
  return { level, alerts, last_verified: last || null };
}

/** Haftalık özet: pazartesi 09:00 İstanbul (06:00 UTC) saatinde çalışan tetiklemede. */
export const isDigestTime = now => now.getUTCDay() === 1 && now.getUTCHours() === 6;

/** Bildirim gerekir mi: uyarı/kritik her zaman; yalnız bilgi varsa yalnız haftalık özette. */
export const shouldNotify = (result, now) => result.level !== 'ok' || isDigestTime(now);

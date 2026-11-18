// Yapılandırılmış günlük: her kayıt tek satır JSON. Bütün alanlar redact'tan geçer; sorgu metni, gövde ve başlıklar hiç
// yazılmaz (çağıran yalnız rota adı, durum, süre ve hata kodu verir). Günlük yazımı asla isteği düşürmez.
import {redact, redactText} from './redact.mjs';

const LEVELS = {debug: 10, info: 20, warn: 30, error: 40};

export function createLogger({sink = line => console.log(line), level = 'info', base = {}, now = () => new Date().toISOString()} = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, event, fields) => {
    if (LEVELS[lvl] < min) return;
    try {
      sink(JSON.stringify({ts: now(), level: lvl, event: redactText(event).slice(0, 64), ...redact({...base, ...(fields || {})})}));
    } catch { /* günlük hatası isteği etkilemez */ }
  };
  const logger = {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: fields => createLogger({sink, level, base: {...base, ...fields}, now}),
  };
  return logger;
}

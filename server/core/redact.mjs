// Günlüğe giden her değerden kişisel ve gizli veri ayıklanır. Yalnız Web API'leri; Workers, Vercel ve Node'da aynı çalışır.
// Anahtar adı hassassa değer hiç yazılmaz; metin içinde telefon, e-posta, JWT, Bearer/Basic, Supabase/gizli anahtar ve uzun
// onaltılık değerler maskelenir. Derinlik, anahtar sayısı ve metin uzunluğu sınırlıdır (günlük şişirme saldırısına karşı).

const SECRET_KEY = /pass|secret|token|authori[sz]ation|cookie|api[_-]?key|jwt|phone|telefon|e-?mail|signature|session|credential|private[_-]?key/i;
const IP_KEY = /^(ip|client[_-]?ip|remote[_-]?addr|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip)$/i;
const RULES = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [gizli]'],
  [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
  [/\b(sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9]{16,}|[A-Fa-f0-9]{32,})\b/g, '[gizli]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-posta]'],
  // Türkiye cep ve sabit hatları: +90 / 90 / 0 önekli ya da öneksiz, boşluk/tire/nokta/parantez ile ayrılmış.
  [/(?<![\d+])(?:\+?90[\s.-]?)?\(?0?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g, '[telefon]'],
  // IPv4 ve IPv6 adresleri (istemci adresi günlüğe girmez).
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, '[ip]'],
  [/\b[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4})*::(?:[A-Fa-f0-9]{1,4}(?::[A-Fa-f0-9]{1,4})*)?\b/g, '[ip]'],
];
const MAX_TEXT = 500, MAX_KEYS = 40, MAX_DEPTH = 4, MAX_ITEMS = 20;

export function redactText(value) {
  let text = String(value);
  if (text.length > MAX_TEXT * 4) text = text.slice(0, MAX_TEXT * 4);
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

export function redact(value, depth = 0) {
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (depth >= MAX_DEPTH) return '[derin]';
  // Hata nesnesinden yalnız ad ve kod: ileti satır içeriği (telefon vb.) taşıyabilir.
  if (value instanceof Error) return {name: redactText(value.name || 'Error'), code: value.code === undefined ? null : redactText(value.code)};
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(v => redact(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value).slice(0, MAX_KEYS)) {
    const k = redactText(key).slice(0, 64);
    out[k] = SECRET_KEY.test(key) || IP_KEY.test(key) ? '[gizli]' : redact(v, depth + 1);
  }
  return out;
}

// İstek sınırlama: kural başına sabit pencere (ör. dakikada 60). İstemci kimliği (IP) bellekte bile ham tutulmaz:
// örnek başına rastgele anahtarla HMAC-SHA-256 özeti alınır ve kalıcı yazılmaz. Depo değiştirilebilir: yerelde ve tek
// örnekte MemoryStore; çok örnekli üretimde Durable Object ya da Cloudflare sınırlama bağlamı aynı arayüzle takılır.

export class MemoryStore {
  constructor({maxKeys = 10000} = {}) { this.maxKeys = maxKeys; this.map = new Map(); }
  // Penceredeki sayaç bir artar ve yeni değer döner.
  async hit(key, windowMs, now) {
    const start = Math.floor(now / windowMs) * windowMs, entry = this.map.get(key);
    if (entry && entry.start === start) { entry.count++; return {count: entry.count, reset: start + windowMs}; }
    this.map.delete(key);
    if (this.map.size >= this.maxKeys) this.evict(now);
    this.map.set(key, {start, windowMs, count: 1});
    return {count: 1, reset: start + windowMs};
  }
  // Önce süresi dolanlar, yetmezse en eskiler atılır (bellek sınırlı kalır; saldırgan anahtar seli belleği şişiremez).
  evict(now) {
    for (const [k, e] of this.map) if (e.start + e.windowMs <= now) this.map.delete(k);
    for (const k of this.map.keys()) { if (this.map.size < this.maxKeys) break; this.map.delete(k); }
  }
}

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export function createLimiter({rules, store = new MemoryStore(), now = () => Date.now()}) {
  for (const [name, r] of Object.entries(rules))
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !Number.isSafeInteger(r.limit) || r.limit < 1 || !Number.isSafeInteger(r.windowMs) || r.windowMs < 1000)
      throw Error('Geçersiz sınırlama kuralı: ' + name);
  let keyPromise = null;
  const key = () => keyPromise ??= crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return {
    async check(ruleName, subject) {
      const rule = rules[ruleName];
      if (!rule) throw Error('Bilinmeyen sınırlama kuralı');
      const id = hex(await crypto.subtle.sign('HMAC', await key(), enc.encode(String(subject ?? 'bilinmiyor')))).slice(0, 32);
      const t = now(), {count, reset} = await store.hit(ruleName + ':' + id, rule.windowMs, t);
      return {ok: count <= rule.limit, limit: rule.limit, remaining: Math.max(0, rule.limit - count), retryAfter: Math.max(1, Math.ceil((reset - t) / 1000))};
    },
  };
}

// JSON yanıtları ve sabit hata gövdeleri. Hata gövdesi yalnız makine anahtarı ve sabit metin taşır; iç ayrıntı (yığın,
// SQL, veritabanı iletisi) istemciye gitmez. Bütün yanıtlar önbelleğe alınmaz ve tarayıcıda çalıştırılamaz.

const SECURITY = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export const ERRORS = {
  bad_request: [400, 'Geçersiz istek'],
  not_found: [404, 'Bulunamadı'],
  method_not_allowed: [405, 'Yöntem desteklenmiyor'],
  payload_too_large: [413, 'İstek gövdesi çok büyük'],
  rate_limited: [429, 'Çok fazla istek; biraz sonra tekrar dene'],
  internal_error: [500, 'Beklenmeyen sunucu hatası'],
  not_configured: [503, 'Hizmet yapılandırılmamış'],
  upstream_unavailable: [503, 'Bağlı hizmete ulaşılamıyor'],
};

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {status, headers: {...SECURITY, ...headers}});
}

export function fail(key, headers = {}) {
  const [status, message] = ERRORS[key] || ERRORS.internal_error;
  return json(status, {error: {key: ERRORS[key] ? key : 'internal_error', message}}, headers);
}

// İşleyicilerin fırlattığı bilinen hata: anahtar ERRORS'ta olmalı, yoksa internal_error.
export class HttpError extends Error {
  constructor(key) { super(key); this.name = 'HttpError'; this.key = key; this.code = key; }
}

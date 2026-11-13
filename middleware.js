/* Admin sitesi yalnız Cloudflare Access'ten geçen isteklere açılır.
 * Cloudflare'i atlayıp doğrudan Vercel'e gelen istekte Access belgesi (JWT) olmaz ve 403 döner.
 * Diğer alan adları (nakgo.vercel.app vb.) hiç etkilenmez. */
const ADMIN_HOST = 'admin.nakgolojistik.com';
const TEAM = 'https://old-fog-1f24.cloudflareaccess.com';
const AUD = 'fe6fcb2367a28ab23a3a7e8d0eadf365432ac808ffcb15620a1c1f1f68399778';
// Vercel sertifikası yenilenirken bu yol Access'ten muaftır (Bypass uygulaması).
const OPEN_PREFIX = '/.well-known/acme-challenge/';

let cache = { keys: null, at: 0 };

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const json = s => JSON.parse(new TextDecoder().decode(b64url(s)));

async function teamKeys(fetcher, force) {
    if (!force && cache.keys && Date.now() - cache.at < 3600e3) return cache.keys;
    const res = await fetcher(TEAM + '/cdn-cgi/access/certs');
    if (!res.ok) throw new Error('certs ' + res.status);
    const keys = (await res.json()).keys;
    if (!Array.isArray(keys) || !keys.length) throw new Error('certs empty');
    cache = { keys, at: Date.now() };
    return keys;
}

// Access belgesini doğrular: RS256 imza, yayımlayan ekip, bu uygulamanın AUD etiketi ve süre.
export async function verifyAccessToken(token, { fetcher = fetch, now = Date.now() / 1000 } = {}) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return false;
    let head, body;
    try { head = json(parts[0]); body = json(parts[1]); } catch { return false; }
    if (head.alg !== 'RS256' || !head.kid) return false;
    const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
    if (body.iss !== TEAM || !aud.includes(AUD)) return false;
    if (typeof body.exp !== 'number' || body.exp <= now) return false;
    if (typeof body.nbf === 'number' && body.nbf > now + 60) return false;
    let jwk = (await teamKeys(fetcher)).find(k => k.kid === head.kid);
    // Cloudflare anahtarları döndürünce yeni kid gelebilir: bir kez taze liste al.
    if (!jwk) jwk = (await teamKeys(fetcher, true)).find(k => k.kid === head.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
}

function accessToken(request) {
    const header = request.headers.get('cf-access-jwt-assertion');
    if (header) return header;
    const cookie = request.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    return m ? m[1] : '';
}

const deny = () => new Response('Erişim yok', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request, _context, opts) {
    const url = new URL(request.url);
    const host = (request.headers.get('host') || url.host).toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (host !== ADMIN_HOST) return pass();
    if (url.pathname.startsWith(OPEN_PREFIX)) return pass();
    try {
        return (await verifyAccessToken(accessToken(request), opts)) ? pass() : deny();
    } catch {
        return deny();
    }
}

export function _resetKeyCache() { cache = { keys: null, at: 0 }; }

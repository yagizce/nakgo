// Sunucunun veritabanı erişimi: yalnız `worker` şemasındaki fonksiyonlar, PostgREST RPC ile ve `worker` rolünün belirteciyle.
// service_role ya da tablo erişimi yok. Zaman aşımı zorunlu; veritabanı iletisi istemciye ve günlüğe taşınmaz (yalnız kod).
import {HttpError} from './http.mjs';

export function createDb({url, token, fetcher = (...a) => fetch(...a), timeoutMs = 5000} = {}) {
  const configured = typeof url === 'string' && /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(url) && typeof token === 'string' && token.length >= 20;
  return {
    configured,
    async rpc(fn, args = {}) {
      if (!configured) throw new HttpError('not_configured');
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(fn)) throw Error('Geçersiz fonksiyon adı');
      let res;
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        res = await fetcher(url.replace(/\/$/, '') + '/rpc/' + fn, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Accept: 'application/json', 'Content-Profile': 'worker', 'Accept-Profile': 'worker', Authorization: 'Bearer ' + token},
          body: JSON.stringify(args),
          signal: abort.signal,
        });
      } catch { throw new HttpError('upstream_unavailable'); }
      finally { clearTimeout(timer); }
      if (!res.ok) {
        // Gövde okunur ama yalnız PostgREST/PostgreSQL kodu alınır.
        let code = 'http_' + res.status;
        try { const b = await res.json(); if (b && typeof b.code === 'string' && /^[A-Z0-9]{5}$|^PGRST\d{3}$/.test(b.code)) code = b.code; } catch {}
        throw Object.assign(new HttpError(res.status >= 500 ? 'upstream_unavailable' : 'internal_error'), {code});
      }
      return res.json();
    },
  };
}

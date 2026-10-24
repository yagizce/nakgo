// Public browser configuration only. Development Auth cannot activate in Production.
export function publicAuthConfig(env) {
    if (env.VERCEL_ENV === 'production' || env.NAKGO_AUTH_ENABLED !== 'true') return {enabled:false};
    const url = env.SUPABASE_URL || '', publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) ||
        !/^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(publishableKey)) return null;
    return {enabled:true,url,publishableKey,marketplaceEnabled:true};
}

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET','HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        res.statusCode = 405;
        return res.end(JSON.stringify({error:'Method not allowed'}));
    }
    const config = publicAuthConfig(process.env);
    res.statusCode = config ? 200 : 503;
    res.end(req.method === 'HEAD' ? '' : JSON.stringify(config || {enabled:false}));
}

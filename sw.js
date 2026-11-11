/* NakGo: yalnızca uygulama kabuğu önbelleğe alınır; kişisel veri/harita istekleri alınmaz. */
const V = "nakgo-v51-dev-sync";
const ASSETS = ["./", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/brand-logo.png", "icons/header-logo.png"];
const index = new URL("index.html",self.registration.scope);
const root = new URL(self.registration.scope);
async function installOfflineShell() {
    const cache=await caches.open(V);
    const cacheAsset=async path=>{
        const url=new URL(path,self.registration.scope);
        const res=await fetch(url,{credentials:'omit',cache:'no-store',redirect:'error'});
        const policy=res.headers.get('Cache-Control')||'';
        const vary=res.headers.get('Vary')||'';
        if(res.ok && !res.redirected && res.headers.get('X-NakGo-Offline-Asset')==='1'
            && !/(?:^|,)\s*(?:private|no-cache|no-store)\b/i.test(policy)
            && !vary.split(',').some(value=>['cookie','authorization','*'].includes(value.trim().toLowerCase()))) {
            await cache.put(url.href,res);
            return;
        }
        throw Error('Offline asset is not cacheable');
    };
    // A failed installation leaves the active worker and its cache in place.
    await cacheAsset("./");
    await Promise.allSettled(ASSETS.filter(path=>path!=="./").map(cacheAsset));
    await self.skipWaiting();
}
self.addEventListener("install", e => { e.waitUntil(installOfflineShell()); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("nakgo-")&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e => {
    const r=e.request, u=new URL(r.url);
    if(r.method!=="GET"||u.origin!==location.origin) return;
    const asset=u.pathname===index.pathname||ASSETS.some(p=>new URL(p,self.registration.scope).pathname===u.pathname);
    if(!asset) return;
    const key=u.pathname===index.pathname?root.href:new URL(u.pathname,u.origin).href;
    e.respondWith(fetch(r,{cache:r.mode==='navigate'||u.pathname===index.pathname?'no-cache':'default'}).catch(async()=>{
        const cache=await caches.open(V);
        return (await cache.match(key))||Response.error();
    }));
});

/* NakGo: yalnızca uygulama kabuğu önbelleğe alınır; kişisel veri/harita istekleri alınmaz. */
const V = "nakgo-v35-account-favorites";
const ASSETS = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/brand-logo.png", "icons/header-logo.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("nakgo-")&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e => {
    const r=e.request, u=new URL(r.url);
    if(r.method!=="GET"||u.origin!==location.origin) return;
    const asset=ASSETS.map(p=>new URL(p,self.registration.scope).pathname).includes(u.pathname);
    if(!asset) return;
    const key=new URL(u.pathname,u.origin).href;
    e.respondWith(fetch(r).then(res=>{
        if(res.ok && !res.redirected) { const copy=res.clone(); e.waitUntil(caches.open(V).then(c=>c.put(key,copy)).catch(()=>{})); }
        return res;
    }).catch(async()=> (await caches.match(key)) || (r.mode==="navigate" ? await caches.match("index.html") : null) || Response.error()));
});

"""Local Chromium/WebKit checks; synthetic account data, no external services."""
import json
import socket
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# A small previous-shell fixture remains reproducible after committing the fix.
legacy = {
    'index.html': b"<!doctype html><html><body>Old shell<script>window.mode='truck';navigator.serviceWorker.register('sw.js');</script></body></html>",
    'sw.js': b"""const V='nakgo-v46-listing-lifecycle';
self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(['./','index.html'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>caches.match('index.html')));});""",
}

class Handler(SimpleHTTPRequestHandler):
    old = False
    offline = False

    def log_message(self, *args):
        pass

    def end_headers(self):
        static_asset = self.path in ('/', '/manifest.webmanifest') or (self.path.startswith('/icons/') and '?' not in self.path)
        if not self.old and static_asset:
            self.send_header('X-NakGo-Offline-Asset', '1')
            self.send_header('Cache-Control', 'public, max-age=0')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.offline:
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if self.path == '/?go=mine':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Set-Cookie', 'synthetic_cache_probe=1; HttpOnly; Path=/')
            self.end_headers()
            self.wfile.write(b'<p>synthetic private shell</p>')
            return
        name = 'index.html' if self.path.split('?')[0] == '/' else self.path.split('?')[0].lstrip('/')
        if self.old and name in legacy:
            data = legacy[name]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html' if name.endswith('.html') else 'application/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def copyfile(self, source, output):
        try:
            super().copyfile(source, output)
        except ConnectionError:
            pass  # Closing a browser can cancel pending shell asset downloads.

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

try:
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser = engine.launch()
            results = []
            for standalone in [False, True]:
                context = browser.new_context(viewport={'width': 390, 'height': 844})
                context.route('**/*', lambda route: route.fulfill(json={'enabled': False})
                              if route.request.url.endswith('/api/auth/config') else
                              route.continue_() if route.request.url.startswith(url) else route.abort())
                context.add_init_script("localStorage.setItem('yy-onb','1');localStorage.setItem('yy-role','owner');"
                                        + f"Object.defineProperty(navigator,'standalone',{{value:{json.dumps(standalone)}}});")
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(url)
                page.wait_for_function("document.querySelector('#main').dataset.screen==='list'")
                check(page.evaluate("tab==='list'&&mode==='load'"), f'{engine.name}/{standalone}: default Loads')
                # Identical verified account snapshot and filters in isolated browser/PWA stores.
                count = page.evaluate("""async()=>{
                    nakgoMarket.sync({marketplace:true,user:{id:'synthetic-account'},profile:null});
                    const now=Date.now();let revision=0;
                    const row=id=>({id,kind:'load',owner_id:'synthetic-owner',from_city:'İstanbul',to_city:'Ankara',
                        vehicle:'Tır',body:'Tenteli',cargo:'Synthetic',amount:10,status:'active',
                        published_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString()});
                    nakgoAuth.snapshot=()=>({user:{id:'synthetic-account'},profile:{}});
                    nakgoAuth.listFavorites=async()=>[];
                    nakgoAuth.listListings=async options=>options?.own?[]:[row(91),row(92),
                        {...row(93),expires_at:new Date(now-1).toISOString()},
                        {...row(94),published_at:new Date(now+3600000).toISOString()},
                        ...(window.syntheticNewListing?[row(95)]:[])];
                    nakgoDocuments.refreshPublic=()=>{};
                    F=F0();F.from='İstanbul';q='Synthetic';await nakgoMarket.refresh();
                    window.refreshCalls=0;const original=nakgoMarket.refresh;
                    nakgoMarket.refresh=(...args)=>{window.refreshCalls++;return original(...args);};
                    return loads.filter(x=>visibleListing(x)).length;
                }""")
                check(count == 2, 'expired and future publications excluded in each environment')
                check('2 ilan' in page.locator('.listing-count').inner_text(), 'visible counter matches filtered cards')
                results.append(count)
                page.evaluate("window.syntheticNewListing=true;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
                page.wait_for_function('window.refreshCalls===1&&loads.filter(x=>visibleListing(x)).length===3')
                check(page.evaluate("F.from==='İstanbul'&&q==='Synthetic'"), 'BFCache refresh preserves filters')
                check('3 ilan' in page.locator('.listing-count').inner_text(), 'resumed counter includes newly available publication')
                page.evaluate("window.dispatchEvent(new Event('online'))")
                page.wait_for_function('window.refreshCalls===2')
                check(not errors, f'{engine.name}: no browser errors {errors}')
                context.close()
            check(results[0] == results[1], f'{engine.name}: browser/PWA account counts match')
            # Actual service worker update and offline shell (independent of mocked account data).
            Handler.old = True
            context = browser.new_context()
            context.add_init_script("localStorage.setItem('yy-onb','1');localStorage.setItem('yy-role','owner');")
            page = context.new_page()
            page.goto(url)
            page.wait_for_function('navigator.serviceWorker.controller!==null')
            check(page.evaluate("mode==='truck'"), 'old shell reproduced before update')
            Handler.old = False
            page.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();}')
            page.wait_for_function("async()=>JSON.stringify(await caches.keys()).includes('nakgo-v49-static-offline')")
            page.wait_for_function("async()=>!(await caches.keys()).includes('nakgo-v46-listing-lifecycle')")
            page.reload()
            check(page.evaluate("mode==='load'"), 'updated shell opens Loads')
            # The original navigation may receive a cookie-setting response.
            # This must never be used to populate the offline shell.
            check(page.evaluate("""async()=>{
              const url=new URL('./?go=mine',location.href);
              const res=await fetch(url);
              return (await res.text()).includes('synthetic private shell') && res.headers.get('Set-Cookie')===null;
            }"""), 'browser filters Set-Cookie from fetch responses')
            check(any(cookie['name'] == 'synthetic_cache_probe' for cookie in context.cookies()), 'online response still sets its cookie')
            Handler.offline = True
            page.reload()
            check(page.evaluate("mode==='load'&&tab==='list'"), 'offline updated shell also opens Loads')
            context.close()
            Handler.offline = False
            browser.close()
            print(f'{engine.name}: browser/PWA opening, counts, resume, SW upgrade and offline passed')
finally:
    server.shutdown()
    server.server_close()
print(f'{checks} local browser checks passed; WebKit is not physical iOS Safari acceptance')

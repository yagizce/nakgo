"""CSP kabulü: vercel.json'daki Content-Security-Policy ile uygulama gerçek Chromium'da çalışır,
hiçbir satır içi betik engellenmez; içeriği değiştirilmiş satır içi betik ise engellenir.
Çalıştır: python3 -I tests/csp_browser.py"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "vercel.json"), encoding="utf-8") as f:
    CSP = next(h["value"] for rule in json.load(f)["headers"] for h in rule["headers"] if h["key"] == "Content-Security-Policy")
with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
    PAGE = f.read()
TAMPERED = PAGE.replace('<script id="admin-boot">', '<script id="admin-boot">window.tampered=1;', 1).replace('<body', '<div id="evil-style" style="width:123px"></div><body', 1)

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()
    def do_GET(self):
        if self.path.startswith("/tampered.html"):
            body = TAMPERED.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
fails = []
def check(ok, label):
    print(("✓ " if ok else "✗ ") + label)
    if not ok: fails.append(label)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="tr-TR")
    ctx.add_init_script("localStorage.setItem('yy-onb','1');window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+(e.blockedURI||'inline')))")
    # Dış kaynaklar (yazı tipi, harita) testte gerekmez; ağ hatası CSP ihlali sayılmaz.
    ctx.route("https://**/*", lambda r: r.abort())
    pg = ctx.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/index.html"); pg.wait_for_timeout(2500)
    check(pg.evaluate("document.querySelectorAll('nav button').length") >= 4, "uygulama CSP altında açılır ve alt menü çizilir")
    # Uygulamanın başlıca ekranları ve sayfaları: ne betik ne stil engellenmeli.
    for js in ("tab='me';setNav();render()", "tab='own';setNav();render()", "tab='post';setNav();render()", "document.querySelector('#post-next')&&document.querySelector('#post-next').click()",
               "tab='list';setNav();render();openLoad(1)", "closeSheet();mode='truck';render()", "mode='load';render();document.querySelector('#fb').click()", "closeSheet()",
               "typeof openStats==='function'&&openStats(loads[0].id)", "closeSheet()"):
        pg.evaluate(js); pg.wait_for_timeout(300)
    blocks = [v for v in pg.evaluate("window.__csp") if v.startswith(("script-src", "style-src"))]
    check(not blocks, "satır içi betik ve stiller engellenmez " + str(blocks[:3]))
    check(not errors, "JS hatası yok " + str(errors[:2]))
    pg.goto(BASE + "/tampered.html"); pg.wait_for_timeout(800)
    check(pg.evaluate("window.tampered") is None and any(v.startswith("script-src") for v in pg.evaluate("window.__csp")), "içeriği değiştirilmiş satır içi betik engellenir")
    check(pg.evaluate("document.querySelector('#evil-style').getBoundingClientRect().width") != 123, "sayfaya sızan style özniteliği uygulanmaz")
    b.close()
srv.shutdown()
print(("CSP kabulü geçti" if not fails else f"{len(fails)} CSP kontrolü başarısız"))
sys.exit(1 if fails else 0)

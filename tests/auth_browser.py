"""Auth UI + pinned real SDK against mocked Supabase HTTP. No real email/password.
Run: python tests/auth_browser.py. Existing test and CI files are unchanged.
"""
import base64, functools, hashlib, http.server, json, os, pathlib, socketserver, threading, time, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js'
SDK_HASH = 'BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R'
SDK = pathlib.Path(os.environ['NAKGO_AUTH_SDK_FILE']).read_bytes() if os.environ.get('NAKGO_AUTH_SDK_FILE') else urllib.request.urlopen(SDK_URL, timeout=30).read()
assert base64.b64encode(hashlib.sha384(SDK).digest()).decode() == SDK_HASH

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = socketserver.TCPServer(('127.0.0.1',0), functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE = os.environ.get('NAKGO_AUTH_TEST_URL') or f'http://127.0.0.1:{server.server_address[1]}/'
USER = {'id':'00000000-0000-4000-8000-000000000001','email':'test@example.test','aud':'authenticated','role':'authenticated','user_metadata':{'display_name':'Test Account','account_type':'carrier'}}
enc = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
token = enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':USER['id'],'exp':int(time.time())+3600,'role':'authenticated'})+'.mock'
SESSION = {'access_token':token,'refresh_token':'mock-refresh','expires_in':3600,'token_type':'bearer','user':USER}
errors=[]

with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('NAKGO_BROWSER_CHANNEL') or None)
    for width in [360,390,430]:
        for theme in ['light','dark']:
            ctx=browser.new_context(viewport={'width':width,'height':844},service_workers='block')
            ctx.add_init_script(f"localStorage.setItem('yy-onb','1');localStorage.setItem('yy-theme','{theme}');sessionStorage.setItem('ng-splash','1');")
            ctx.route('**/api/auth/config',lambda r:r.fulfill(json={'enabled':True,'url':'https://abcdefghijklmnopqrst.supabase.co','publishableKey':'sb_publishable_abcdefghijklmnopqrst'}))
            ctx.route(SDK_URL,lambda r:r.fulfill(body=SDK,content_type='text/javascript',headers={'access-control-allow-origin':'*'}))
            counts={'login':0,'signup':0,'recover':0,'password':0,'logout':0}
            profile=[None]
            def api(route):
                req=route.request;url=req.url;body=req.post_data_json if req.post_data else {}
                if req.method=='OPTIONS':
                    return route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'})
                headers={'access-control-allow-origin':'*'}
                data={};status=200
                if '/token?' in url:
                    if 'grant_type=password' in url:
                        counts['login']+=1
                        if body.get('password')=='wrong-password':
                            return route.fulfill(status=400,json={'code':'invalid_credentials','error_code':'invalid_credentials','msg':'Invalid login credentials'},headers=headers)
                    data=SESSION
                elif '/signup' in url:
                    counts['signup']+=1; data=USER
                elif '/recover' in url: counts['recover']+=1
                elif '/logout' in url: counts['logout']+=1
                elif '/user' in url:
                    if req.method=='PUT':counts['password']+=1
                    data=USER
                elif '/rest/v1/profiles' in url:
                    if req.method=='POST':profile[0]=body;data=body
                    elif req.method=='PATCH':profile[0].update(body);data=None
                    else:data=profile[0]
                else: raise AssertionError('Unexpected SDK request: '+url)
                route.fulfill(status=status,json=data,headers=headers)
            ctx.route('https://abcdefghijklmnopqrst.supabase.co/**',api)
            page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(BASE);page.locator('nav [data-t="me"]').click()
            page.locator('[data-auth-open="signup"]').click()
            page.locator('#account-name').fill('<script>Test</script>')
            page.locator('#account-email').fill('test@example.test')
            page.locator('#account-password').fill('test-password-123')
            page.locator('#account-repeat').fill('different-password')
            page.locator('#account-submit').click()
            expect(page.locator('#account-feedback')).to_contain_text('aynı olmalı')
            assert counts['signup']==0
            page.locator('#account-repeat').fill('test-password-123')
            page.locator('#account-submit').dblclick()
            expect(page.locator('#account-feedback')).to_contain_text('doğrulama e-postası')
            assert counts['signup']==1
            page.locator('#close').click()
            page.locator('[data-auth-open="signin"]').click()
            page.locator('#account-email').fill('test@example.test');page.locator('#account-password').fill('wrong-password')
            page.locator('#account-submit').click();expect(page.locator('#account-feedback')).to_contain_text('doğru değil')
            page.locator('#account-password').fill('test-password-123');page.locator('#account-submit').click()
            expect(page.locator('#account-signout')).to_be_visible()
            assert page.evaluate('cloud === false && me === ""')
            assert not page.evaluate('localStorage.getItem("yy2").includes("mock-refresh")')
            page.reload();page.locator('nav [data-t="me"]').click();expect(page.locator('#account-signout')).to_be_visible()
            page.locator('[data-auth-open="profile"]').click();page.locator('#account-name').fill('<img src=x onerror=alert(1)>')
            page.locator('#account-submit').click();expect(page.locator('#account-signout')).to_be_visible()
            assert page.locator('.profile-info img').count()==0
            page.locator('#account-signout').click();expect(page.locator('[data-auth-open="signin"]')).to_be_visible()
            page.locator('[data-auth-open="signin"]').click();page.locator('#account-forgot').click()
            page.locator('#account-email').fill('test@example.test');page.locator('#account-submit').click()
            expect(page.locator('#account-feedback')).to_contain_text('kayıtlıysa')
            assert counts['recover']==1
            page.goto(BASE+'?code=mock-recovery-code')
            expect(page.locator('#account-repeat')).to_be_visible()
            page.locator('#account-password').fill('new-test-password-123');page.locator('#account-repeat').fill('new-test-password-123')
            page.locator('#account-submit').click()
            page.locator('nav [data-t="me"]').click();expect(page.locator('[data-auth-open="signin"]')).to_be_visible()
            assert counts['password']==1 and counts['logout']==2
            assert not page.evaluate('location.search.includes("code=")')
            page.locator('[data-auth-open="signin"]').click()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            shots=ROOT/'tests'/'shots';shots.mkdir(exist_ok=True)
            page.screenshot(path=str(shots/f'auth-{theme}-{width}.png'))
            page.keyboard.press('Escape');expect(page.locator('#sheet')).not_to_have_class('open')
            print(f'PASS auth {width}px {theme}: signup, validation, errors, login, persistence, XSS, logout, PKCE recovery, reset, demo isolation')
            ctx.close()
    browser.close()
server.shutdown()
assert not errors, errors
print('PASS: 6 Auth browser scenarios; no real messages sent')

"""Google OAuth using the pinned real SDK and mock provider/HTTP responses.
No real Google account, credentials, email or external messages are used.
Run with the same Playwright setup as tests/auth_browser.py.
"""
import base64, functools, hashlib, http.server, json, os, pathlib, socketserver, threading, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT=pathlib.Path(__file__).resolve().parents[1]
SDK_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js'
SDK=pathlib.Path(os.environ['NAKGO_AUTH_SDK_FILE']).read_bytes() if os.environ.get('NAKGO_AUTH_SDK_FILE') else urllib.request.urlopen(SDK_URL,timeout=30).read()
assert base64.b64encode(hashlib.sha384(SDK).digest()).decode()=='BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=os.environ.get('NAKGO_AUTH_TEST_URL') or f'http://127.0.0.1:{server.server_address[1]}/'
USER={'id':'00000000-0000-4000-8000-000000000002','email':'google@example.test','aud':'authenticated','role':'authenticated','user_metadata':{'full_name':'Google Test'}}
enc=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
token=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':USER['id'],'exp':int(time.time())+3600,'role':'authenticated'})+'.mock'
SESSION={'access_token':token,'refresh_token':'mock-google-refresh','expires_in':3600,'token_type':'bearer','user':USER}
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('NAKGO_BROWSER_CHANNEL') or None)
    for width in [360,390,430]:
        for theme in ['light','dark']:
            ctx=browser.new_context(viewport={'width':width,'height':844},service_workers='block',reduced_motion='reduce')
            ctx.add_init_script(f"localStorage.setItem('yy-onb','1');localStorage.setItem('yy-theme','{theme}');sessionStorage.setItem('ng-splash','1');")
            ctx.route('**/api/auth/config',lambda r:r.fulfill(json={'enabled':True,'url':'https://abcdefghijklmnopqrst.supabase.co','publishableKey':'sb_publishable_abcdefghijklmnopqrst'}))
            ctx.route(SDK_URL,lambda r:r.fulfill(body=SDK,content_type='text/javascript',headers={'access-control-allow-origin':'*'}))
            state={'mode':'cancel','authorizes':0,'exchanges':0,'challenge':None,'profile':None}
            def api(route):
                req=route.request;url=req.url;headers={'access-control-allow-origin':'*'}
                body=req.post_data_json if req.post_data else {}
                if req.method=='OPTIONS':
                    return route.fulfill(status=204,headers={**headers,'access-control-allow-headers':'*','access-control-allow-methods':'*'})
                if '/authorize?' in url:
                    q=urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                    assert q['provider']==['google'] and q['redirect_to']==[BASE]
                    assert q['code_challenge_method']==['s256'] and q['code_challenge'][0]
                    assert 'client_secret' not in q and 'access_type' not in q
                    state['challenge']=q['code_challenge'][0];state['authorizes']+=1
                    target=BASE+('?error=access_denied&error_description=mock-provider-detail' if state['mode']=='cancel' else '?code=mock-google-code')
                    return route.fulfill(status=302,headers={'location':target})
                if '/token?' in url:
                    assert 'grant_type=pkce' in url and body['auth_code']=='mock-google-code'
                    verifier=body['code_verifier']
                    assert base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')==state['challenge']
                    state['exchanges']+=1;data=SESSION
                elif '/user' in url:data=USER
                elif '/logout' in url:data={}
                elif '/rest/v1/profiles' in url:
                    if req.method=='POST':state['profile']=body
                    data=state['profile']
                else:raise AssertionError('Unexpected request: '+url)
                route.fulfill(json=data,headers=headers)
            ctx.route('https://abcdefghijklmnopqrst.supabase.co/**',api)
            page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(BASE);page.locator('nav [data-t="me"]').click();page.locator('[data-auth-open="signin"]').click()
            expect(page.locator('#account-google')).to_be_enabled()
            expect(page.get_by_role('button',name='Apple ile devam et')).to_be_disabled()
            shots=ROOT/'tests'/'shots';shots.mkdir(exist_ok=True)
            page.screenshot(path=str(shots/f'auth-google-signin-{theme}-{width}.png'))
            page.locator('#account-google').click()
            expect(page.locator('.profile-info').filter(has_text='NakGo hesabı')).to_contain_text('Google ile giriş tamamlanmadı')
            expect(page.locator('[data-auth-open="signin"]')).to_be_visible()
            assert state['authorizes']==1 and state['exchanges']==0
            assert not page.evaluate('nakgoAuth.snapshot().user')
            assert 'error' not in page.url and 'mock-provider-detail' not in page.locator('body').inner_text()
            state['mode']='success'
            page.locator('[data-auth-open="signin"]').click()
            # The second event must be ignored before navigation starts.
            page.locator('#account-google').evaluate('(b)=>{b.click();b.click();}')
            expect(page.locator('#account-signout')).to_be_visible()
            expect(page.locator('.profile-info').filter(has_text='NakGo hesabı')).to_contain_text('Google Test')
            assert state['authorizes']==2 and state['exchanges']==1
            assert state['profile']['account_type'] is None
            assert page.evaluate('cloud === false && me === ""')
            assert not page.evaluate('localStorage.getItem("yy2").includes("mock-google-refresh")')
            assert 'code=' not in page.url
            assert page.evaluate('sessionStorage.getItem("ng-google-return")') is None
            page.reload();page.locator('nav [data-t="me"]').click();expect(page.locator('#account-signout')).to_be_visible()
            page.locator('#account-signout').click();expect(page.locator('[data-auth-open="signin"]')).to_be_visible()
            page.locator('[data-auth-open="signup"]').click();expect(page.locator('#account-google')).to_be_enabled()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(shots/f'auth-google-{theme}-{width}.png'))
            print(f'PASS Google {width}px {theme}: cancel/retry, real SDK PKCE, double click, profile, persistence, logout, demo isolation')
            ctx.close()
    browser.close()
server.shutdown()
assert not errors,errors
print('PASS: 6 Google OAuth browser scenarios; real provider/account login still requires user verification')

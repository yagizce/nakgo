"""Bağımsız davranış sözleşmesi. CI main kopyasını PR uygulamasına karşı çalıştırır."""
import argparse, functools, http.server, json, os, threading, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

args=argparse.ArgumentParser();args.add_argument('--root',default=str(Path(__file__).resolve().parents[2]));options=args.parse_args()
ROOT=Path(options.root).resolve()
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/index.html'
PAYLOADS=['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<svg onload=alert(1)>','"><script>alert(1)</script>','javascript:alert(1)']

class BrowserGate(unittest.TestCase):
    checks=0
    @classmethod
    def setUpClass(cls):
        cls.driver=sync_playwright().start()
        cls.browser=cls.driver.chromium.launch(channel=os.environ.get('NAKGO_BROWSER_CHANNEL') or None)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.driver.stop()
    def setUp(self):self.contexts=[];self.errors=[];self.dialogs=[]
    def tearDown(self):
        for ctx in self.contexts:ctx.close()
        self.verify(not self.errors,'Uncaught exception yok: '+str(self.errors))
        self.verify(not self.dialogs,'Script/dialog çalışmadı: '+str(self.dialogs))
    def verify(self,condition,message):
        BrowserGate.checks+=1;self.assertTrue(condition,message)
    def page(self,width=390,height=844,storage=None,onboarded=True,fragment=''):
        ctx=self.browser.new_context(viewport={'width':width,'height':height},locale='tr-TR',service_workers='block',reduced_motion='reduce')
        self.contexts.append(ctx)
        ctx.route('https://tile.openstreetmap.org/**',lambda r:r.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'))
        setup="sessionStorage.setItem('ng-splash','1');"
        if onboarded:setup+="localStorage.setItem('yy-onb','1');"
        if storage is not None:setup+="if(!sessionStorage.getItem('fixture')){localStorage.setItem('yy2',"+json.dumps(storage)+");sessionStorage.setItem('fixture','1');}"
        ctx.add_init_script(setup)
        p=ctx.new_page();p.on('pageerror',lambda e:self.errors.append(str(e)))
        def dialog(d):self.dialogs.append(d.message);d.dismiss()
        p.on('dialog',dialog);p.goto(URL+fragment,wait_until='domcontentloaded');p.wait_for_selector('nav')
        return p
    def nav(self,p,name):p.click('nav [data-t="'+name+'"]')
    def form(self,p,truck=False):
        self.nav(p,'post');p.click('[data-pm="'+('truck' if truck else 'load')+'"]')
        if p.is_visible('#post-prev'):
            while p.is_visible('#post-prev'):p.click('#post-prev')
        p.select_option('#f','İstanbul');p.select_option('#t','Ankara');p.click('#post-next')
    def visible_box(self,p,selector):
        r=p.locator(selector).bounding_box();v=p.viewport_size
        return bool(r and r['x']>=-1 and r['y']>=-1 and r['x']+r['width']<=v['width']+1 and r['y']+r['height']<=v['height']+1)
    def double_click_same_button(self,p,selector):
        # Aynı düğmede kuyruğa alınmış iki click; detached düğme de tekrar çağrılır.
        p.locator(selector).evaluate('e=>{e.click();e.click()}')

    def test_mobile_navigation_and_sheets(self):
        for width,height in [(390,844),(393,852)]:
            p=self.page(width,height)
            for theme in ['light','dark']:
                p.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
                for screen in ['list','post','mine','me']:
                    self.nav(p,screen)
                    self.verify(p.inner_text('#main').strip(),'Ana içerik dolu '+screen)
                    self.verify(self.visible_box(p,'nav'),'Navigasyon görünür '+screen)
                    self.verify(p.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#main").scrollWidth<=document.querySelector("#main").clientWidth+1'),'Yatay taşma yok '+screen)
                    self.verify(p.get_attribute('nav [data-t="'+screen+'"]','aria-current')=='page','Gezinti durumu doğru')
                self.nav(p,'list');p.click('[data-md=truck]')
                self.verify(p.locator('.load[data-tid]').count()>0,'Araç listesi dolu')
                p.locator('.load[data-tid]').first.click()
                self.verify(self.visible_box(p,'#sheetBody'),'Araç sheet ekran içinde')
                self.verify(self.visible_box(p,'#call') and p.is_enabled('#call'),'Ara tıklanabilir')
                self.verify(self.visible_box(p,'#mg') and p.is_enabled('#mg'),'Mesaj tıklanabilir')
                p.click('#close');p.click('[data-md=load]');p.locator('.load[data-id]').first.click()
                self.verify(self.visible_box(p,'#sheetBody'),'Yük sheet ekran içinde');p.click('#close')

    def test_onboarding_and_role(self):
        for role,mode in [('r-c','load'),('r-o','truck')]:
            p=self.page(onboarded=False);p.wait_for_selector('#onb');p.click('#ob-skip');p.click('#'+role)
            self.verify(not p.is_visible('#onb'),'Onboarding kapanır')
            self.verify(p.evaluate('(mode)=>document.querySelector("[data-md="+mode+"]").classList.contains("on")',mode),'Rol doğru listeyi açar')
            p.reload();self.verify(not p.is_visible('#onb'),'Rol refresh sonrası korunur')

    def test_publish_load_once_and_refresh(self):
        p=self.page();self.form(p);p.fill('#c','Bağımsız yük');p.fill('#w','0.5');p.click('#post-next');p.fill('#n','Kalıcı not')
        self.double_click_same_button(p,'#go')
        self.verify(p.evaluate("loads.filter(l=>l.mine&&l.cargo==='Bağımsız yük').length===1"),'Hızlı iki click tek yük ilanı oluşturur')
        p.reload()
        self.verify(p.evaluate("loads.some(l=>l.mine&&l.cargo==='Bağımsız yük'&&l.ton===.5&&l.note==='Kalıcı not')"),'Yük refresh sonrası korunur')

    def test_publish_truck_once_and_refresh(self):
        p=self.page();self.form(p,True);p.fill('#w','18.5');p.click('#post-next')
        self.double_click_same_button(p,'#go')
        self.verify(p.evaluate("trucks.filter(t=>t.mine&&t.cap===18.5).length===1"),'Hızlı iki click tek araç ilanı oluşturur')
        p.reload();self.verify(p.evaluate("trucks.some(t=>t.mine&&t.cap===18.5)"),'Araç refresh sonrası korunur')

    def test_required_invalid_and_long_inputs(self):
        p=self.page();self.form(p)
        before=p.evaluate('loads.length');p.fill('#c','');p.click('#post-next')
        self.verify(p.is_visible('#c') and p.evaluate('loads.length')==before,'Boş yük cinsi kayıt oluşturmaz')
        p.fill('#c','Test')
        for amount in ['0','-1','1e308']:
            p.fill('#w',amount);p.click('#post-next')
            self.verify(p.is_visible('#w') and p.evaluate('loads.length')==before,'Geçersiz tonaj '+amount)
        p.fill('#w','2');p.fill('#c','X'*5000);p.click('#post-next');p.fill('#n','N'*5000);p.click('#go')
        self.verify(p.evaluate('loads[0].cargo.length<=120&&loads[0].note.length<=1000'),'Aşırı uzun metin sınırlandırılır')
        self.verify(p.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Uzun metin ekranı taşırmaz')

    def test_filters_and_empty_results(self):
        p=self.page();initial=p.locator('.load[data-id]').count()
        p.select_option('[data-route=from]','İstanbul')
        self.verify(p.locator('.load[data-id]').count()<initial and p.locator('.load[data-id]').count()>0,'Şehir filtresi daraltır')
        p.click('#fb');p.click('[data-g=veh][data-v="Tır"]');p.click('#fs')
        self.verify(p.locator('[data-x=veh]').count()==1,'Araç filtresi etiketlenir')
        p.fill('#q','hiçbir-yük-bulunmayacak-93813')
        self.verify(p.locator('.load[data-id]').count()==0 and p.is_visible('#rs'),'Boş sonuç açıkça gösterilir')
        p.click('#rs');self.verify(p.locator('.load[data-id]').count()==initial,'Filtre sıfırlanır')

    def test_request_once_accept_reject_and_expiry(self):
        p=self.page();p.evaluate("prem={until:Date.now()+864e5,plan:'test'};save()")
        p.locator('.load[data-id="1"]').click();p.click('#mg');p.fill('#mi','Taşıma için görüşelim')
        self.double_click_same_button(p,'#ms')
        self.verify(p.evaluate('offers.filter(o=>o.loadId===1).length===1'),'Hızlı mesajla çift talep oluşmaz')
        p.click('#close');self.nav(p,'mine');p.wait_for_function("offers[0].status==='ok'")
        self.verify('Kabul' in p.inner_text('#main'),'Demo kabul görünür')
        p.evaluate("offers.push({...loads.find(l=>l.id===2),status:'no',loadId:2});offers.push({...loads.find(l=>l.id===3),status:'wait',loadId:3,ots:Date.now()-31*864e5});save();render()")
        self.verify('Reddedildi' in p.inner_text('#main'),'Red durumu görünür')
        self.verify('Süresi doldu' in p.inner_text('#main'),'Geçen talep görünür')
        # Mevcut host bağlantısının gelen talep ekranı, deterministik kayıtla sınanır.
        p.evaluate("incoming=[{...loads[0],status:'wait',loadId:1,bidder:'carrier',ownerUid:'owner',ots:Date.now(),stage:0},{...loads[1],status:'wait',loadId:2,bidder:'other',ownerUid:'owner',ots:Date.now(),stage:0}];render()")
        self.double_click_same_button(p,'[data-ia="0"]')
        self.verify(p.evaluate("incoming[0].status==='ok'"),'Gelen talep kabul edilir')
        p.click('[data-ir="1"]');self.verify(p.evaluate("incoming[1].status==='no'"),'Gelen talep reddedilir')
        p.reload();self.verify(p.evaluate("offers.some(o=>o.status==='no')&&offers.some(o=>o.status==='ok')"),'İş durumları refresh sonrası korunur')

    def test_storage_faults_and_drafts(self):
        for raw in ['{broken','{}','null','[]',json.dumps({'loads':[],'trucks':[],'offers':None,'myCar':None,'calc':'old'}),json.dumps({'version':999,'loads':[],'offers':[],'trucks':[]})]:
            p=self.page(storage=raw);self.verify(p.inner_text('#main').strip(),'Bozuk/eski storage açılır '+raw[:30]);self.nav(p,'me');self.verify(p.inner_text('#main').strip(),'Profil güvenli default ile açılır')
        p=self.page();self.form(p);p.fill('#c','Taslak kalmalı');p.fill('#w','7');p.click('#post-next');p.fill('#n','Not kalmalı')
        before=p.evaluate('loads.length')
        p.evaluate("()=>{window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}}")
        p.click('#go');self.verify(p.is_visible('#go') and p.evaluate('loads.length')==before,'Depo doluysa sahte ilan oluşmaz')
        p.evaluate('()=>{Storage.prototype.setItem=window.__storageSet}');p.reload();self.nav(p,'post')
        self.verify(p.input_value('#c')=='Taslak kalmalı' and p.input_value('#n')=='Not kalmalı','Başarısız kayıtta taslak veri kaybı yok')

    def test_deep_link_and_pwa_assets(self):
        p=self.page(fragment='#l=1');p.wait_for_selector('#sheet.open')
        self.verify('Yük ilanı' in p.inner_text('#sheetBody'),'Mevcut yük deep-link açılır')
        response=p.request.get(URL.replace('index.html','manifest.webmanifest'));self.verify(response.ok,'Manifest erişilebilir')
        manifest=response.json();self.verify(manifest.get('name')=='NakGo','Manifest parse edilir')
        for icon in manifest['icons']:self.verify(p.request.get(URL.replace('index.html',icon['src'])).ok,'Icon erişilebilir '+icon['src'])
        for name in ['sw.js','index.html','icons/brand-logo.png']:self.verify(p.request.get(URL.replace('index.html',name)).ok,'Temel dosya 404 değil '+name)

    def test_security_user_text_is_inert(self):
        for payload in PAYLOADS:
            p=self.page();self.form(p);p.fill('#c',payload);p.fill('#w','2');p.click('#post-next');p.fill('#n',payload);p.click('#go')
            self.verify(payload in p.inner_text('#main'),'Yük türü düz metin '+payload)
            own=p.evaluate('loads[0].id');p.locator('[data-id="'+str(own)+'"]').click()
            self.verify(payload==p.inner_text('.detail-note'),'İlan notu düz metin');p.click('#close')
            # Profil kaydını mevcut kayıt API'si ile kur; gerçek ekranı render et.
            p.evaluate('(value)=>setCar({displayName:value,about:value})',payload);self.nav(p,'me')
            self.verify(payload in p.inner_text('#main'),'Profil adı/tanıtım düz metin')
            p.evaluate('(value)=>{prem={until:Date.now()+864e5,plan:"test"};save();openChat("security",value)}',payload)
            p.fill('#mi',payload);p.click('#ms');self.verify(payload in p.inner_text('#msgs'),'Mesaj düz metin')
            p.click('#close');p.reload()
            self.verify(p.evaluate("!document.querySelector('a[href^=\"javascript:\"]')"),'Metin çalıştırılabilir URL olmuyor')
            self.verify(not self.dialogs,'Script/event handler çalışmıyor')

if __name__=='__main__':
    try:
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(BrowserGate)
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        print(f'{BrowserGate.checks} bağımsız browser kontrolü; {result.testsRun} senaryo; başarısız={len(result.failures)+len(result.errors)}',flush=True)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:server.shutdown();server.server_close()

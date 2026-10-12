"""Denetimde bulunan hatalar: gerçek form, yenileme, depolama hatası ve kontrast."""
import json, os

def run_reliability(browser, url, check, errors, root):
    def page(storage=None):
        ctx=browser.new_context(viewport={"width":390,"height":844},locale="tr-TR",service_workers="block",reduced_motion="reduce")
        ctx.route("https://tile.openstreetmap.org/**",lambda r:r.fulfill(content_type="image/svg+xml",body='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'))
        setup="localStorage.setItem('yy-onb','1');sessionStorage.setItem('ng-splash','1');"
        if storage is not None:
            setup+="if(!sessionStorage.getItem('recovery-fixture')){localStorage.setItem('yy2',"+json.dumps(storage)+");sessionStorage.setItem('recovery-fixture','1')}"
        ctx.add_init_script(setup)
        p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.goto(url,wait_until='domcontentloaded');p.wait_for_selector('nav')
        return p
    def form(p,cargo):
        p.click('nav [data-t=post]');p.click('[data-pm=load]');p.click('#post-next');p.fill('#c',cargo);p.click('#post-next')
    p=page()
    p.click('[data-md=truck]')
    payload='<img src="missing-test-image" onerror="window.__unsafe=1">'
    form(p,payload);p.fill('#n','<svg onload="window.__unsafe=2">');p.click('#go')
    check('yeni yük boş araç sekmesinden yük listesine döner',p.evaluate("tab==='list'&&mode==='load'&&loads[0].mine"))
    check('gerçek formdan HTML kodu çalışmaz',p.evaluate("!window.__unsafe") and payload in p.inner_text('#main'))
    own=p.evaluate('loads[0].id');p.locator('[data-id="'+str(own)+'"]').click()
    check('not detayda metindir',p.evaluate("!window.__unsafe") and '<svg onload=' in p.inner_text('.detail-note'))
    p.click('#close');p.reload();p.wait_for_selector('[data-id="'+str(own)+'"]')
    check('yenilemeden sonra da saklanan HTML çalışmaz',p.evaluate("!window.__unsafe") and payload in p.inner_text('#main'))
    check('yeni ilanın zamanı ve takvim tarihi kalıcıdır',p.evaluate("loads.find(l=>l.mine).ts>0&&validDay(loads.find(l=>l.mine).date)"))
    check('30 gün sonra kullanıcı ilanı bugün sayılmaz ve kapanır',p.evaluate("(()=>{const now=Date.now;Date.now=()=>now()+30*864e5;try{const l=loads.find(l=>l.mine);return expired(l,'load')&&dateLabel(l)!=='Bugün'}finally{Date.now=now}})()"))
    p.fill('#q','" autofocus onfocus="window.__unsafe=3');check('arama öznitelikleri güvenli',p.evaluate('!window.__unsafe'));p.fill('#q','')
    p.click('nav [data-t=me]');p.fill('#myph','05551234567');p.click('#phs2');p.click('nav [data-t=list]');p.locator('[data-id="'+str(own)+'"]').click();p.click('#call');p.click('#buy')
    p.locator('[data-id="'+str(own)+'"]').click();p.click('#call')
    check('telefon sonradan eklendiğinde eski ilana yansır','0555 123 45 67' in p.inner_text('#sheetBody'));p.click('#close')
    form(p,'Depolama hata denemesi');p.fill('#n','Bu taslak korunmalı')
    p.evaluate("()=>{window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}}")
    p.click('#go')
    check('dolu depolamada başarı mesajı çıkmaz ve form açık kalır',p.is_visible('#go') and 'Kaydedilemedi' in p.inner_text('#toast'))
    check('kaydedilmeyen ilan bellekte yayınlanmış sayılmaz',p.evaluate("!loads.some(l=>l.cargo==='Depolama hata denemesi')"))
    p.evaluate('()=>{Storage.prototype.setItem=window.__setItem}');p.reload();p.click('nav [data-t=post]')
    check('başarısız yayından sonra taslak yenilemede korunur',p.input_value('#c')=='Depolama hata denemesi' and p.input_value('#n')=='Bu taslak korunmalı')
    p.click('#go');check('depolama düzeldikten sonra aynı taslak yayınlanır',p.evaluate("loads.some(l=>l.cargo==='Depolama hata denemesi')&&tab==='list'"))
    p.click('nav [data-t=me]');p.locator('summary').filter(has_text='Taşıyıcı belgeleri ve güven').click()
    with p.expect_file_chooser() as chooser:p.click('[data-dp=src]')
    chooser.value.set_files(os.path.join(root,'assets','brand','logo.png'))
    p.wait_for_function("!!cdocs['local/src']&&myCar.docs.src")
    p.reload();p.click('nav [data-t=me]')
    check('belge fotoğrafı yenilemeden sonra gerçekten bulunur',p.evaluate("imageDataOK(cdocs['local/src'])&&myCar.docs.src"))
    p.evaluate("viewDoc('local','src')");p.wait_for_selector('#pi img');check('saklanan belge açılır',p.locator('#pi img').count()==1);p.click('#close')
    p.click('nav [data-t=list]');p.evaluate("loads.find(l=>l.id===1).closed=true;openLoad(1)")
    check('kapalı ilan detayında iki yeni iletişim işlemi de kapalı',p.is_disabled('#call') and p.is_disabled('#mg') and 'Bu ilan kapalı' in p.inner_text('#sheetBody'));p.click('#close')
    p.evaluate("openLoad(2)");p.click('#mg');p.fill('#mi','Gönderilmemesi gereken mesaj');p.evaluate("loads.find(l=>l.id===2).closed=true")
    p.click('#ms');check('mesaj gönderilirken ilan durumu yeniden kontrol edilir',p.input_value('#mi')=='Gönderilmemesi gereken mesaj' and p.evaluate("!offers.some(o=>o.id===2)"));p.click('#close')
    p.evaluate("loads.find(l=>l.id===3).ts=Date.now()-30*864e5;q='İstanbul';render()")
    count=p.locator('.listing-count>span').first.inner_text().split()[0];p.click('#fb')
    check('arama ve kapalı ilanlarla filtre sayacı listeye eşit',p.inner_text('#fs').startswith(count+' '));p.click('#fs');p.fill('#q','')
    p.evaluate("loads=[{id:91,from:'İstanbul',to:'Ankara',cargo:'Uzak',ton:2,veh:'Tır',date:'Bugün',km:450},{id:92,from:'Mersin',to:'Adana',cargo:'Yakın',ton:2,veh:'Tır',date:'Bugün'}];sort='km';render()")
    check('yeni ilanın hesaplanan mesafesi sıralamada kullanılır',p.locator('.load[data-id]').first.get_attribute('data-id')=='92')
    p.context.close()
    for raw in ['{}','null','{invalid','[]',json.dumps({'loads':[],'offers':None,'trucks':[],'calc':'bad','chats':[]})]:
        p=page(raw);check('eksik/bozuk kayıt açılışı: '+raw[:35],p.evaluate("Array.isArray(offers)&&Number.isFinite(calc.km)") and p.is_visible('#route-heading'))
        check('orijinal bozuk kayıt kurtarma kopyasında durur',p.evaluate("Object.keys(localStorage).some(k=>k.startsWith('yy2-recovery-'))"));p.context.close()
    from forms import run_forms
    run_forms(page,check)
    # Metin kontrastı geçişin her renk durağına karşı hesaplanır.
    contrast="""e=>{const rgb=s=>(s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);let parent=e;while(parent&&!getComputedStyle(parent).backgroundImage.includes('gradient'))parent=parent.parentElement;const stops=(getComputedStyle(parent).backgroundImage.match(/rgba?\\([^)]+\\)/g)||[]).map(rgb),fg=lum(rgb(getComputedStyle(e).color));return Math.min(...stops.map(c=>{const bg=lum(c);return(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)}))}"""
    for theme in ['light','dark']:
        p=page();p.evaluate("document.documentElement.dataset.theme='"+theme+"'");p.click('nav [data-t=me]');p.click('#profile-fuel')
        values=[el.evaluate(contrast) for el in p.locator('.fuel-result span,.fuel-result strong,.fuel-result b,.fuel-result p').all()]
        check(theme+' mazot sonucu tüm metinler en az 4.5:1',bool(values) and min(values)>=4.5)
        p.screenshot(path=os.path.join(root,'tests','shots','reliability-fuel-'+theme+'.png'));p.click('#cx');p.click('nav [data-t=list]');p.locator('.load[data-id]').first.click();p.click('[data-map-expand]')
        check(theme+' harita dönüş düğmesi en az 4.5:1',p.locator('#map-back').evaluate(contrast)>=4.5)
        p.screenshot(path=os.path.join(root,'tests','shots','reliability-map-'+theme+'.png'));p.context.close()

"""Synthetic admin UI acceptance; SQL authorization is covered by admin-db-check.cjs."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.getenv('NAKGO_BROWSER_CHANNEL') or None)
    for width in [390,1280]:
        page=browser.new_page(viewport={'width':width,'height':844})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.add_init_script("localStorage.setItem('yy-onb','1')")
        page.goto((ROOT/'index.html').as_uri())
        page.wait_for_timeout(2800)
        page.evaluate("""() => {
          window.adminTestAccount='first';window.adminCalls=[];window.adminFail=false;
          window.adminRows=[{id:'00000000-0000-4000-8000-000000000003',display_name:'<img src=x onerror=alert(1)>',city:'İzmir',account_type:'carrier',created_at:'2026-10-26T00:00:00Z',revision:0,suspended:false}];
          window.adminListings=[{id:7,owner_label:'Test Owner',kind:'load',from_city:'İzmir',to_city:'Manisa',status:'active',removed:false,revision:0}];
          nakgoMarket.active=()=>true;nakgoMarket.token=()=>window.adminTestAccount;
          nakgoAuth.adminPage=async(section)=>section==='overview'?{users:2,listings:3,documents:1,jobs:1}:section==='users'?window.adminRows:section==='listings'?window.adminListings:[];
          nakgoAuth.adminModerate=async(...args)=>{window.adminCalls.push(args);await new Promise(r=>setTimeout(r,150));if(window.adminFail)throw {code:'40001'};if(args[0]==='user'){window.adminRows[0].suspended=args[2]==='suspend';window.adminRows[0].revision++;}else{window.adminListings[0].removed=args[2]==='remove';window.adminListings[0].revision++;}return {changed:true};};
          return openAdminPanel();
        }""")
        page.get_by_role('button',name='Kullanıcılar',exact=True).click()
        expect(page.get_by_text('<img src=x onerror=alert(1)>',exact=True)).to_be_visible()
        assert page.locator('#sheetBody img').count()==0
        page.get_by_role('button',name='Faaliyetleri askıya al',exact=True).click()
        page.locator('#admin-reason').fill('Test gerekçesi')
        page.locator('#admin-submit').dblclick()
        expect(page.get_by_role('button',name='Askıyı kaldır',exact=True)).to_be_visible()
        assert page.evaluate('adminCalls.length')==1
        assert page.evaluate('adminCalls[0][4]')==0
        page.evaluate('window.adminFail=true')
        page.get_by_role('button',name='Askıyı kaldır',exact=True).click()
        page.locator('#admin-reason').fill('Tekrar kontrol edildi')
        page.locator('#admin-submit').click()
        expect(page.get_by_role('alert')).to_contain_text('başka bir yönetici')
        expect(page.locator('#admin-reload')).to_be_visible()
        page.locator('#admin-reload').click()
        expect(page.get_by_role('button',name='Askıyı kaldır',exact=True)).to_be_visible()
        page.locator('[data-admin-section="listings"]').click()
        page.evaluate('window.adminFail=false')
        page.get_by_role('button',name='İlanı yayından kaldır',exact=True).click()
        page.locator('#admin-reason').fill('İlan incelemesi')
        page.locator('#admin-submit').click()
        expect(page.get_by_role('button',name='Kaldırma engelini aç',exact=True)).to_be_visible()
        page.get_by_role('button',name='Kaldırma engelini aç',exact=True).click()
        expect(page.get_by_text('İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.',exact=True)).to_be_visible()
        page.locator('#admin-reason').fill('İnceleme tamamlandı')
        page.locator('#admin-submit').click()
        expect(page.get_by_role('button',name='İlanı yayından kaldır',exact=True)).to_be_visible()
        assert page.evaluate('adminCalls[3][4]')==1
        page.evaluate('window.adminListings=[]')
        page.locator('#admin-refresh').click()
        expect(page.get_by_text('Kayıt bulunamadı.',exact=True)).to_be_visible()
        assert page.evaluate("document.querySelector('#sheetBody').scrollWidth <= document.querySelector('#sheetBody').clientWidth+1")
        if width==390:page.screenshot(path='/tmp/nakgo-admin-panel.png')
        page.evaluate("nakgoAuth.adminPage=async()=>{throw Error('Denied')};openAdminPanel()")
        expect(page.get_by_role('alert')).to_contain_text('Yetkini')
        assert page.locator('[data-admin-action]').count()==0
        assert not errors,errors
        page.close()
    browser.close()
print('Admin UI passed at 390px and 1280px: escaped content, double-submit, stale conflict, refresh, empty/denied states and overflow.')

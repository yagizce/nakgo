"""Local-only listing acceptance. No remote account, Supabase, or real message."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    browser=p.chromium.launch(timeout=15000)
    for width in [390,1280]:
        page=browser.new_page(viewport={'width':width,'height':844})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("localStorage.setItem('yy-onb','1')")
        page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded')
        page.wait_for_timeout(2800)
        page.click('nav [data-t=post]');page.click('[data-pm=load]')
        page.click('#post-next');page.fill('#c','Sentetik kabul yükü');page.fill('#w','12')
        page.fill('#d','istediğim zaman');page.click('#post-next')
        page.click('#go');expect(page.locator('#toast')).to_contain_text('telefon')
        page.fill('#post-phone','0532 123 45 67');page.click('#go')
        expect(page.locator('#toast')).to_contain_text('izin')
        page.check('#post-consent');page.click('#go')
        expect(page.locator('#main')).to_contain_text('Sentetik kabul yükü')
        item_id=page.evaluate("loads.find(x=>x.cargo==='Sentetik kabul yükü').id")
        page.reload();page.wait_for_timeout(300)
        page.locator('[data-id="'+str(item_id)+'"]').click()
        expect(page.locator('#call')).to_be_visible();expect(page.locator('#wa')).to_be_visible()
        assert page.locator('#mg,#cp2,#pf').count()==0
        assert page.evaluate("typeof nakgoMessages==='undefined'&&typeof openCompare==='undefined'")
        page.click('#close')
        page.evaluate("id=>{const x=loads.find(x=>x.id===id);x.owner='Private name';x.expiresAt=Date.now()+1200;render();openLoad(id)}",item_id)
        assert 'Private name' not in page.locator('#sheetBody').inner_text()
        page.wait_for_timeout(1600)
        assert page.locator('#sheet.open').count()==0
        assert page.locator('[data-id="'+str(item_id)+'"]').count()==0
        page.click('nav [data-t=me]')
        assert page.locator('#profile-messages').count()==0
        assert not errors,errors
        page.close()
    browser.close()
print('Local listing phone/consent, refresh, expiry and removed identity/UI passed')

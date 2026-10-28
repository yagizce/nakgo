"""Local mocked UI; PostgreSQL authorization tested separately."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    print('Launching browser',flush=True)
    browser=p.chromium.launch(timeout=15000)
    print('Browser ready',flush=True)
    for width in [390,1280]:
      for theme in ['light','dark']:
        page=browser.new_page(viewport={'width':width,'height':844})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("localStorage.setItem('yy-onb','1')")
        print(width,theme,'opening page',flush=True)
        page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded');page.wait_for_timeout(2800)
        print('Opening mocked admin',flush=True)
        page.evaluate("""theme=>{
          document.documentElement.dataset.theme=theme;
          window.waAccount='one';window.waCalls=[];window.waFail=false;
          nakgoMarket.active=()=>true;nakgoMarket.token=()=>waAccount;
          nakgoAuth.adminPage=async()=>({users:1,listings:0,documents:0,jobs:0});
          window.fixture={id:1,revision:0,status:'draft',confidence:0.4,issues:['kind_unknown'],fields:{kind:null,from:{city:'İstanbul',district:'Tuzla'},destinations:[{city:'Van',district:null}],vehicle:'Tır',body:'Kapalı kasa',weightMin:0,weightMax:15,cargo:'Profil',description:'<img src=x onerror=alert(1)>',items:[]},source:{text:'<img src=x onerror=alert(1)>',receivedAt:'2026-10-28T00:00:00Z'},similar:[2],audit:[]};
          nakgoAuth.whatsappRPC=async(name,args)=>{
            if(waFail)throw {code:'40001'};
            if(name==='page')return {drafts:[{...fixture,similar_count:1}],pending:0,failed:0};
            if(name==='detail')return structuredClone(fixture);
            if(name==='change'){waCalls.push(args);await new Promise(r=>setTimeout(r,100));fixture.fields=args.p_fields;fixture.revision++;fixture.status=args.p_action==='publish'?'published':args.p_action==='withdraw'?'withdrawn':'draft';return {};}
          };
          return openAdminPanel();
        }""",theme)
        page.get_by_role('button',name='WhatsApp ilanları',exact=True).click()
        page.get_by_role('button',name='İncele / düzenle').click()
        expect(page.locator('.wa-source').first).to_have_text('<img src=x onerror=alert(1)>')
        assert page.locator('#sheetBody img').count()==0
        page.locator('#wa-kind').select_option('load')
        page.locator('#wa-amount').fill('15');page.locator('#wa-timing').fill('yarın sabah')
        page.locator('#wa-contactPhone').fill('+905000000001')
        page.locator('[data-wa-action="save"]').dblclick()
        expect(page.locator('#wa-contactPhone')).to_have_value('+905000000001')
        assert page.evaluate('waCalls.length')==1
        assert page.evaluate('waCalls[0].p_fields.from.district')=='Tuzla'
        page.locator('[data-wa-action="publish"]').click()
        expect(page.locator('#wa-error')).to_contain_text('kutuyu')
        assert page.evaluate('waCalls.length')==1
        page.locator('#wa-basis').fill('Sentetik izin kaydı doğrulandı')
        page.locator('#wa-reviewed').check();page.locator('[data-wa-action="publish"]').click()
        expect(page.locator('[data-wa-action="save"]')).to_be_disabled()
        assert page.evaluate('waCalls[1].p_revision')==1
        page.locator('[data-wa-action="withdraw"]').click()
        expect(page.locator('[data-wa-action="save"]')).to_be_enabled()
        assert page.evaluate("document.querySelector('#sheetBody').scrollWidth <= document.querySelector('#sheetBody').clientWidth+1")
        (ROOT/'work').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'work'/f'whatsapp-{width}-{theme}.png'))
        page.evaluate('waFail=true');page.locator('[data-wa-action="save"]').click()
        expect(page.get_by_role('alert')).to_contain_text('Kayıt değişmiş')
        page.evaluate("() => { waFail=false;nakgoAuth.whatsappRPC=()=>new Promise(r=>window.waResolve=r); }")
        print('Testing stale response',flush=True)
        page.locator('#wa-reload').click();page.evaluate("waAccount='two';waResolve(fixture)")
        assert page.locator('#wa-form').count()==0
        assert not errors,errors
        page.close()
    browser.close()
print('WhatsApp panel: 390/1280 light/dark, escaped source, edits, publish consent, duplicate clicks, conflict, account switch passed.')

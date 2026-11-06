"""Local UI acceptance. All RPC responses are synthetic; no network service writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width in [390,1280]:
  page=browser.new_page(viewport={'width':width,'height':844})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("localStorage.setItem('yy-onb','1')")
  page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded')
  page.wait_for_timeout(1800)
  page.evaluate("""async()=>{
   window.account='one';window.calls=[];
   nakgoMarket.active=()=>true;nakgoMarket.token=()=>account;
   nakgoAuth.dataCapabilities=async()=>['listing_archive','archive_contact','privacy_cases'];
   nakgoAuth.adminPage=async()=>({users:1,listings:0,documents:0,jobs:0});
   nakgoAuth.archiveList=async(...args)=>{calls.push(args);return [{id:7,kind:'load',from_city:'<img src=x onerror=alert(1)>',to_city:'Ankara',published_at:new Date(Date.now()-7*3600000).toISOString(),expires_at:new Date(Date.now()-3600000).toISOString(),archive_until:new Date(Date.now()+191*3600000).toISOString(),review_status:'none',review_revision:0}];};
   nakgoAuth.archiveDetail=async()=>({id:7,contact_phone:'+905321234567',cargo:'<script>bad</script>',note:'Synthetic note'});
   nakgoAuth.archiveAction=async(action,args)=>{calls.push({action,args});};
   nakgoAuth.privacyRPC=async()=>[];nakgoAuth.maintenanceStatus=async()=>[{task:'purge',failures:1}];
   await openAdminPanel();
  }""")
  page.get_by_role('button',name='İlan Arşivi',exact=True).click()
  expect(page.locator('#archive-kind')).to_be_visible()
  assert page.locator('#sheetBody img').count()==0
  page.locator('#archive-kind').select_option('load')
  page.locator('#archive-source').select_option('whatsapp')
  page.locator('#archive-review').select_option('open')
  page.locator('#archive-search button').click()
  assert page.evaluate('calls.at(-1)[2].source')=='whatsapp'
  page.get_by_role('button',name='Şikâyet incelemesi',exact=True).click()
  page.locator('#archive-reference').fill('Synthetic evidence reference')
  page.locator('#archive-state').select_option('reviewing')
  page.locator('#archive-action .btn').click()
  expect(page.locator('#archive-search')).to_be_visible()
  assert page.evaluate("calls.some(c=>c.action==='review'&&c.args.p_revision===0)")
  page.get_by_role('button',name='İletişim ve detay',exact=True).click()
  expect(page.locator('#sheetBody')).to_contain_text('+905321234567')
  assert page.locator('#sheetBody script').count()==0
  page.locator('#archive-back').click()
  page.get_by_role('button',name='Süreli hukuki koruma',exact=True).click()
  page.locator('#archive-reference').fill('Synthetic limited hold reference')
  page.locator('#archive-until').fill('2027-01-01T12:00')
  page.locator('#archive-action .btn').click()
  expect(page.locator('#archive-search')).to_be_visible()
  assert page.evaluate("calls.some(c=>c.action==='hold'&&c.args.p_until)")
  assert page.evaluate("document.querySelector('#sheetBody').scrollWidth<=document.querySelector('#sheetBody').clientWidth+1")
  page.get_by_role('button',name='Veri Güvenliği ve KVKK',exact=True).click()
  expect(page.get_by_role('alert')).to_contain_text('Otomatik veri temizliğinde hata')
  expect(page.locator('#sheetBody')).to_contain_text('Açık başvuru yok.')
  page.evaluate("async()=>{nakgoAuth.dataCapabilities=async()=>[];await openAdminPanel();}")
  assert page.get_by_role('button',name='İlan Arşivi',exact=True).count()==0
  assert page.get_by_role('button',name='Veri Güvenliği ve KVKK',exact=True).count()==0
  assert not errors,errors
  page.close()
 browser.close()
print('PASS archive mobile/desktop filters, XSS escaping, review revision, hold form, detail and scoped tabs')

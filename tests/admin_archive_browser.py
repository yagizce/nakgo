"""Genel bakışta son 24 saatlik ilan listesi; Arşiv ve saklama sayfası ve yasal saklama akışı.
Sunucu yanıtları sahte; süre ve temizlik kuralları supabase/tests/recent-archive.sql içinde doğrulanır."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = """()=>{
 window.calls=[];window.moderated=[];
 nakgoMarket.active=()=>true;nakgoMarket.token=()=>'admin';
 nakgoAuth.adminModerate=async(...a)=>{window.moderated.push(a);};
 const A=(id,extra={})=>({id,kind:'load',from_city:'İzmir',to_city:'Manisa',vehicle:'Tır',body:'Tenteli',status:'closed',created_at:'2026-11-01T08:00:00Z',expires_at:'2026-11-01T14:00:00Z',updated_at:'2026-11-01T10:00:00Z',
  redacted_at:'2026-11-09T21:00:00Z',purge_at:'2027-11-09T21:00:00Z',removed:false,hold:false,hold_reason:'',revision:2,decisions:0,total:2,...extra});
 nakgoAuth.adminPage=async(section,offset,search,filter,query)=>{window.calls.push({section,filter,query});
  if(section==='overview')return {users:3,listing_states:{all:5}};
  if(section==='listings')return [{id:41,kind:'load',from_city:'Bursa',to_city:'İzmir',vehicle:'Tır',status:'active',state:'active',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3e6).toISOString(),revision:0,total:1}];
  if(section==='archive')return [A(31),A(32,{hold:true,hold_reason:'Savcılık talebi'})];
  if(section==='retention')return {archived:2,purge_30:0,held:1,pending_cleanup:3,removed_held:1,accounts_pending_purge:0,access_logs:12,oldest_log:'2026-11-01T08:00:00Z',runs:[{ran_at:'2026-11-12T00:00:00Z',counts:{listings_redacted:2,listings_deleted:0}}]};
  if(section==='history')return [];
  return [];};
 return openAdminPanel();}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("localStorage.setItem('yy-onb','1')")
        page.goto((ROOT / 'index.html').as_uri())
        page.wait_for_timeout(1500)
        page.evaluate("document.body.classList.add('admin-host')")
        page.evaluate(MOCK)
        # Genel bakış: yalnız son 24 saat istenir (görüntüleme filtresi).
        expect(page.locator('.adm-list h2')).to_contain_text('son 24 saat')
        last = page.evaluate("window.calls.filter(c=>c.section==='listings').at(-1)")
        assert last['query'] == {'recent': '24h'}, last
        expect(page.locator('#admin-count')).to_contain_text('24 saati geçen')

        # Arşiv: saklama kuralları, son çalışma, kişisel bilgi yok.
        page.locator('[data-admin-section="archive"]').click()
        expect(page.locator('.adm-card').first).to_contain_text('8 gün sonra')
        expect(page.locator('.adm-card').first).to_contain_text('1 yıl sonra')
        expect(page.locator('.adm-card').first).to_contain_text('2 temizlendi')
        assert page.evaluate("window.calls.some(c=>c.section==='retention')")
        expect(page.locator('.adm-row', has_text='#32')).to_contain_text('Silinmez')
        page.locator('[data-admin-filter="hold"]').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='archive').at(-1).filter") == 'hold'
        # Yasal saklama: gerekçe zorunlu, doğru işlem gider.
        page.locator('.adm-row', has_text='#31').first.click()
        expect(page.locator('.adm-detail')).to_contain_text('otomatik silinir')
        page.locator('.adm-detail [data-admin-do="hold"]').click()
        page.locator('#admin-reason').fill('Resmî yazı')
        page.locator('#admin-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.moderated.at(-1)') == ['listing', '31', 'hold', 'Resmî yazı', 2]
        page.locator('.adm-row', has_text='#32').first.click()
        expect(page.locator('.adm-detail')).to_contain_text('Savcılık talebi')
        expect(page.locator('.adm-detail [data-admin-do="release"]')).to_have_text('Yasal saklamayı kaldır')
        # Telefon: yatay taşma yok.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('openAdminPanel()')
        page.wait_for_timeout(300)
        page.locator('[data-admin-section="archive"]').click()
        page.wait_for_timeout(300)
        assert not page.evaluate("document.querySelector('#sheetBody').scrollWidth>document.querySelector('#sheetBody').clientWidth")
        assert not errors, errors
        browser.close()
    print('Admin archive passed: 24-hour recent view request, retention rules and runs, archive filters, legal hold and phone layout.')


if __name__ == '__main__':
    main()

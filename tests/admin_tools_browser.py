"""Yönetici paneli araçları: birleşik filtreler, toplu kaldırma, ilan geçmişi, sahibine gitme,
istatistik aralıkları ve Türkiye saati. Sunucu yanıtları sahte; yetki ve sayılar SQL testlerinde doğrulanır."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = """()=>{
 const iso=t=>new Date(t).toISOString(),now=Date.parse('2026-11-12T09:00:00Z');
 const L=(id,state,extra={})=>({id,kind:'load',from_city:'İzmir',to_city:'Manisa',vehicle:'Tır',body:'Tenteli',owner_id:'00000000-0000-0000-0000-00000000000'+(id%9),owner_name:'Sahip '+id,owner_label:'Etiket',
  status:state==='active'?'active':'closed',created_at:'2026-11-11T22:30:00Z',updated_at:'2026-11-11T22:30:00Z',expires_at:'2026-11-12T04:30:00Z',removed:state==='removed',revision:3,state,total:3,...extra});
 window.calls=[];window.moderated=[];
 nakgoMarket.active=()=>true;nakgoMarket.token=()=>'admin';
 nakgoAuth.adminModerate=async(kind,id,action,reason,rev)=>{window.moderated.push([kind,id,action,reason,rev]);if(id==='12'){const e=Error('x');e.code='40001';throw e;}};
 nakgoAuth.adminPage=async(section,offset,search,filter,query)=>{window.calls.push({section,offset,search,filter,query});
  if(section==='overview')return {users:5,listing_states:{all:3,active:2,removed:1},totals:{listings:40,loads:30,trucks:10,users:9},periods:{month:{listings:4,users:2}}};
  if(section==='listings')return [L(11,'active'),L(12,'active'),L(13,'removed')];
  if(section==='users')return [{id:'u1',display_name:'Sahip 11',listings:1,revision:0}];
  if(section==='history')return [{at:'2026-11-11T22:40:00Z',kind:'admin',action:'remove',actor:'Yönetici',reason:'Sahte ilan'},{at:'2026-11-11T22:35:00Z',kind:'user',action:'listing_update',detail:'status:active>closed',actor:'Sahip 11'},{at:'2026-11-11T22:30:00Z',kind:'user',action:'listing_create',actor:'Sahip 11'}];
  if(section==='stats'){const n=Math.round((Date.parse(query.to)-Date.parse(query.from))/864e5)+1;return Array.from({length:n},(_,i)=>({day:new Date(Date.parse(query.to)-i*864e5).toISOString().slice(0,10),listings:i===1?0:i+1,loads:i===1?0:i,trucks:i===1?0:1,users:i%2}));}
  if(section==='insights')return {listings:6,cities:[{name:'İzmir',count:4},{name:'Bursa',count:2}],vehicles:[{name:'Tır',count:5}],avg_hours:4.5,ended:3};
  return [];};
 return openAdminPanel();}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # Cihaz saati New York: ekrandaki saatler yine Türkiye saatine göre olmalı.
        page = browser.new_page(viewport={'width': 1440, 'height': 900}, timezone_id='America/New_York', locale='tr-TR')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("localStorage.setItem('yy-onb','1');document.addEventListener('DOMContentLoaded',()=>document.body.classList.add('admin-host'))")
        page.goto((ROOT / 'index.html').as_uri())
        page.wait_for_timeout(1500)
        page.evaluate("document.body.classList.add('admin-host')")
        page.evaluate(MOCK)
        page.locator('[data-admin-section="listings"]').click()
        expect(page.locator('#admin-count')).to_have_text('3 sonuç')
        assert page.locator('.adm-kpis').count() == 0, 'İlanlar sayfasında üst kartlar olmamalı'
        # 22:30Z = 12 Kas 01:30 Türkiye saati (New York'ta hâlâ 11 Kas).
        expect(page.locator('.adm-row').first).to_contain_text('12 Kas 01:30')

        # Birleşik filtreler tek istekte sunucuya gider; temizle hepsini sıfırlar.
        page.locator('select[name=from_city]').select_option('İzmir')
        page.locator('select[name=to_city]').select_option('Manisa')
        page.locator('select[name=vehicle]').select_option('Tır')
        page.locator('select[name=body]').select_option('Tenteli')
        page.locator('select[name=kind]').select_option('load')
        page.locator('select[name=state]').select_option('active')
        page.locator('input[name=from]').fill('2026-11-01')
        page.locator('input[name=to]').fill('2026-11-12')
        page.locator('input[name=id]').fill('#11')
        page.locator('input[name=owner]').fill('Sahip')
        page.get_by_role('button', name='Uygula').click()
        page.wait_for_timeout(200)
        last = page.evaluate("window.calls.filter(c=>c.section==='listings').at(-1)")
        assert last['query'] == {'from_city': 'İzmir', 'to_city': 'Manisa', 'vehicle': 'Tır', 'body': 'Tenteli', 'kind': 'load', 'state': 'active', 'from': '2026-11-01', 'to': '2026-11-12', 'id': '11', 'owner': 'Sahip'}, last
        expect(page.locator('#admin-count')).to_contain_text('filtreli')
        page.locator('input[name=from]').fill('2026-11-12')
        page.locator('input[name=to]').fill('2026-11-01')
        page.get_by_role('button', name='Uygula').click()
        expect(page.locator('#admin-filter-error')).to_contain_text('Başlangıç')
        page.get_by_role('button', name='Filtreleri temizle').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='listings').at(-1).query") == {}
        page.locator('[data-admin-state="removed"]').click()
        page.locator('[data-admin-kind="truck"]').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='listings').at(-1).query") == {'state': 'removed', 'kind': 'truck'}
        page.get_by_role('button', name='Filtreleri temizle').click()
        page.wait_for_timeout(200)

        # Ayrıntı: ilan geçmişi IP içermez, kaldırma gerekçesi görünür.
        page.locator('.adm-row').first.click()
        expect(page.locator('.adm-history')).to_contain_text('Durumu değiştirdi: Yayında → Kapalı')
        expect(page.locator('.adm-history')).to_contain_text('Gerekçe: Sahte ilan')
        expect(page.locator('.adm-history')).to_contain_text('İlanı oluşturdu')
        assert page.evaluate("window.calls.some(c=>c.section==='history'&&c.query.id==='11')")

        # Toplu kaldırma: kaldırılmış ilan seçilemez, tek gerekçe, sırayla, hata ayrı raporlanır.
        assert page.locator('[data-admin-check="2"]').count() == 0
        page.locator('#admin-check-all').check()
        expect(page.locator('.adm-bulk')).to_contain_text('2 ilan seçildi')
        page.locator('#admin-bulk').click()
        page.locator('#admin-bulk-reason').fill('ab')
        page.locator('#admin-bulk-submit').click()
        assert page.evaluate("!document.querySelector('#admin-bulk-reason').checkValidity()")
        assert page.evaluate('window.moderated.length') == 0
        page.locator('#admin-bulk-reason').fill('Mükerrer ilan')
        page.locator('#admin-bulk-submit').dblclick()
        expect(page.get_by_text('Toplu kaldırma bitti')).to_be_visible()
        assert page.evaluate('window.moderated') == [['listing', '11', 'remove', 'Mükerrer ilan', 3], ['listing', '12', 'remove', 'Mükerrer ilan', 3]]
        expect(page.locator('.adm-bulk-list')).to_contain_text('İlan #12')
        page.locator('#admin-reload').click()

        # İlan sahibine git: kullanıcılar tek kişiyle açılır.
        page.locator('.adm-row').first.click()
        page.get_by_role('button', name='İlan sahibine git').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.at(-1)")['section'] == 'users'
        assert page.evaluate("window.calls.at(-1).query.user") == '00000000-0000-0000-0000-000000000002'
        expect(page.locator('.adm-filter-note')).to_be_visible()

        # İstatistikler: gerçek kullanıcı sayısı, aralıklar, boş günler, sayfalı tablo.
        page.locator('[data-admin-section="stats"]').click()
        expect(page.locator('.adm-kpi').nth(3)).to_contain_text('Toplam kullanıcı')
        expect(page.locator('.adm-kpi').nth(3)).to_contain_text('5')
        page.locator('[data-admin-range="7"]').click()
        page.wait_for_timeout(200)
        q = page.evaluate("window.calls.filter(c=>c.section==='stats').at(-1).query")
        from datetime import date
        assert (date.fromisoformat(q['to']) - date.fromisoformat(q['from'])).days == 6, q
        assert page.locator('.adm-chart').first.locator('[data-admin-tip]').count() == 7
        assert page.evaluate("window.calls.filter(c=>c.section==='insights').at(-1).query.from") == q['from']
        page.locator('[data-admin-tip="5"]').hover()
        expect(page.locator('#admin-tip')).to_contain_text('0 ilan')
        expect(page.locator('.adm-rank').first).to_contain_text('İzmir')
        expect(page.locator('.adm-big')).to_contain_text('4,5 saat')
        page.locator('[data-admin-range="90"]').click()
        page.wait_for_timeout(200)
        assert page.locator('.adm-days .adm-row').count() == 14
        expect(page.locator('.adm-days .adm-thead')).to_contain_text('Boş araç ilanı')
        page.locator('#admin-days-next').click()
        assert page.locator('.adm-days .adm-row').count() == 14
        page.locator('input[name=from]').fill('2025-01-01')
        page.get_by_role('button', name='Göster').click()
        expect(page.locator('#admin-range-error')).to_contain_text('366')
        page.locator('input[name=from]').fill('2026-10-01')
        page.locator('input[name=to]').fill('2026-10-10')
        page.get_by_role('button', name='Göster').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='stats').at(-1).query") == {'from': '2026-10-01', 'to': '2026-10-10'}
        assert page.locator('.adm-chart').first.locator('[data-admin-tip]').count() == 10

        # Telefon: yatay taşma yok.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('[data-admin-section="listings"]').click()
        page.wait_for_timeout(300)
        assert not page.evaluate("document.querySelector('#sheetBody').scrollWidth>document.querySelector('#sheetBody').clientWidth")
        assert not errors, errors
        browser.close()
    print('Admin tools passed: combined filters, Istanbul time, history, bulk removal, owner link, stats ranges and paging.')


if __name__ == '__main__':
    main()

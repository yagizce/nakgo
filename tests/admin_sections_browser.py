"""Yönetim paneli bölüm yapısı: menü (yalnız arka ucu olan bölümler), Genel Bakış uyarıları, Şikâyet Yönetimi kararları,
Limit ihlalleri, Sistem Sağlığı ve telefon/masaüstü görünümü. Sunucu yanıtları sahte; yetki ve veriler
tests/db/admin-health.test.cjs ve tests/db/reports.test.cjs içinde gerçek PostgreSQL'de doğrulanır."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = """()=>{
 window.calls=[];window.reportSets=[];window.healthFail=false;window.reportConflict=false;
 window.health={server_time:'2026-11-18T09:00:00Z',db_size:52428800,api:{v1_enabled:true,calls_24h:12,top:[{fn:'listings_v1',calls:9}]},
  retention:{last_run:'2026-11-16T00:00:00Z',counts:{listings_redacted:3,listings_deleted:1},stale:true},
  jobs:[{name:'nakgo-retention',schedule:'0 0 * * *',active:true,last_status:'failed',last_start:'2026-11-17T00:00:00Z'},{name:'nakgo-daily-stats',schedule:'30 21 * * *',active:true,last_status:'succeeded',last_start:'2026-11-17T21:30:00Z'}],
  security:{events_24h:2,events_7d:5},reports:{open:3,reviewing:1},held:1};
 window.reports=[{id:5,subject:'listing',listing_id:41,reason:'fraud',note:'<img src=x onerror=alert(1)> Kapora istedi',status:'open',revision:0,created_at:'2026-11-18T08:00:00Z',
   reporter_id:'00000000-0000-4000-8000-000000000011',reporter_label:'Ayşe',account_id:'00000000-0000-4000-8000-000000000012',account_label:'Mehmet',kind:'load',from_city:'İzmir',to_city:'Manisa',listing_status:'active',open_on_listing:2},
  {id:4,subject:'account',listing_id:39,reason:'fake',note:'',status:'resolved',revision:2,created_at:'2026-11-17T08:00:00Z',reporter_label:'Ali',account_id:null,account_label:'Silinmiş',kind:null,open_on_listing:0}];
 window.events=[{id:9,at:'2026-11-18T07:00:00Z',kind:'contact_limit_hour',user_id:'00000000-0000-4000-8000-000000000013',display_name:'Çok Arayan'}];
 nakgoMarket.active=()=>true;nakgoMarket.token=()=>'admin';
 nakgoAuth.adminPage=async(section,offset,search,filter,query)=>{window.calls.push({section,offset,filter,query});
  if(section==='overview')return {users:7,listings:4,listings_today:2,listings_removed:1,accounts_suspended:1};
  if(section==='health'){if(window.healthFail)throw Error('offline');return window.health;}
  if(section==='security')return filter?window.events.filter(e=>e.kind===filter):window.events;
  if(section==='users')return [];
  if(section==='listings')return [{id:7,owner_label:'Test',kind:'load',from_city:'İzmir',to_city:'Manisa',status:'active',state:'active',removed:false,revision:3}];
  return [];};
 window.moderated=[];nakgoAuth.adminModerate=async(...a)=>{window.moderated.push(a);const e=Error('Moderation changed; refresh');e.code='PT409';throw e;};
 nakgoAuth.adminReports=async(status,offset)=>{window.calls.push({section:'reports',filter:status,offset});return status?window.reports.filter(r=>r.status===status):window.reports;};
 nakgoAuth.adminReportSet=async(...a)=>{window.reportSets.push(a);await new Promise(r=>setTimeout(r,150));
  if(window.reportConflict){const e=Error('x');e.code='PT409';throw e;}const r=window.reports.find(x=>x.id===a[0]);r.status=a[1];r.revision++;return {revision:r.revision,changed:true};};
 return openAdminPanel();}"""


def overflow(page):
    return page.evaluate("document.querySelector('#sheetBody').scrollWidth>document.querySelector('#sheetBody').clientWidth+1")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: errors.append('dialog: ' + d.message))
        page.add_init_script("localStorage.setItem('yy-onb','1')")
        page.goto((ROOT / 'index.html').as_uri())
        page.wait_for_timeout(1500)
        page.evaluate("document.body.classList.add('admin-host')")
        page.evaluate(MOCK)

        # Menü: altı bölüm; arka ucu olmayan WhatsApp ve Yasal Kayıtlar yok.
        nav = page.locator('.adm-nav')
        for label in ['Genel Bakış', 'İlan Yönetimi', 'İlan Arşivi', 'Şikâyet Yönetimi', 'Güvenlik ve Denetim', 'Sistem Sağlığı', 'Limit ihlalleri', 'Yönetici işlemleri', 'Kullanıcılar']:
            expect(nav).to_contain_text(label)
        assert 'WhatsApp' not in nav.inner_text() and 'Yasal' not in nav.inner_text()

        # Genel Bakış: uyarılar sunucu sayılarından; sayfa başlığı ve açıklama.
        expect(page.locator('.adm-head h1')).to_have_text('Genel Bakış')
        attn = page.locator('.adm-attn-list')
        expect(attn).to_contain_text('3 açık, 1 incelenen şikâyet')
        expect(attn).to_contain_text('2 telefon görüntüleme sınırı ihlali')
        expect(attn).to_contain_text('26 saatten uzun')
        expect(attn).to_contain_text('Başarısız zamanlanmış görev')
        expect(attn).to_contain_text('1 hesap askıda')
        assert page.locator('.adm-period').count() == 0, 'otomatik dönem özeti kaldırıldı'
        assert page.locator('.adm-kpis').count() == 0, 'Genel Bakış üst kartları kaldırıldı'

        # Sağlık bilgisi alınamazsa uyarılar "sorun yok" gibi görünmez.
        page.evaluate("window.healthFail=true")
        page.locator('#admin-refresh').click()
        expect(attn).to_contain_text('Sistem durumu alınamadı')
        page.evaluate("window.healthFail=false")
        page.locator('#admin-refresh').click()

        # Uyarıdan Şikâyetlere: açık süzgeciyle.
        page.get_by_role('button', name='Şikâyetlere git').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='reports').at(-1).filter") == 'open'
        expect(page.locator('.adm-head h1')).to_have_text('Şikâyet Yönetimi')
        page.locator('[data-admin-filter=""]').click()
        page.wait_for_timeout(200)
        page.locator('.adm-row', has_text='Şikâyet #5').first.click()
        detail = page.locator('.adm-detail')
        expect(detail).to_contain_text('Dolandırıcılık şüphesi')
        expect(page.get_by_text('<img src=x onerror=alert(1)> Kapora istedi', exact=True)).to_be_visible()
        assert page.locator('#sheetBody img').count() == 0
        # Karar: gerekçe zorunlu, çift tıklama tek istek, revision gider.
        detail.get_by_role('button', name='Çözüldü olarak kapat').click()
        page.locator('#admin-submit').click()
        assert page.evaluate('window.reportSets.length') == 0, 'gerekçesiz gönderilmez'
        page.locator('#admin-reason').fill('Kapora talebi doğrulandı')
        page.locator('#admin-submit').dblclick()
        page.wait_for_timeout(500)
        assert page.evaluate('window.reportSets') == [[5, 'resolved', 'Kapora talebi doğrulandı', 0]], page.evaluate('window.reportSets')
        page.locator('.adm-row', has_text='Şikâyet #5').first.click()
        expect(detail).to_contain_text('Çözüldü')
        expect(detail.get_by_role('button', name='Yeniden aç')).to_be_visible()
        # Eşzamanlı karar: güncel durumu yükle.
        page.evaluate('window.reportConflict=true')
        detail.get_by_role('button', name='Yeniden aç').click()
        page.locator('#admin-reason').fill('Yeniden inceleme')
        page.locator('#admin-submit').click()
        expect(page.get_by_role('alert')).to_contain_text('başka bir yönetici')
        page.locator('#admin-reload').click()
        page.evaluate('window.reportConflict=false')
        # Silinmiş ilanın şikâyeti: kayıt korunur, ilan düğmesi yok.
        page.locator('.adm-row', has_text='Şikâyet #4').first.click()
        expect(detail).to_contain_text('artık veritabanında yok')
        assert detail.locator('[data-admin-live-open]').count() == 0

        # Limit ihlalleri: süzgeç ve hesaba gitme.
        page.locator('[data-admin-section="security"]').click()
        expect(page.locator('.adm-row', has_text='Çok Arayan')).to_contain_text('60 dakika sınırı aşıldı')
        page.locator('[data-admin-filter="contact_limit_day"]').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.filter(c=>c.section==='security').at(-1).filter") == 'contact_limit_day'
        expect(page.get_by_text('Kayıt bulunamadı.', exact=True)).to_be_visible()
        page.locator('[data-admin-filter=""]').click()
        page.wait_for_timeout(200)
        page.locator('.adm-row', has_text='Çok Arayan').first.click()
        page.locator('.adm-detail').get_by_role('button', name='Hesaba git').click()
        page.wait_for_timeout(200)
        assert page.evaluate("window.calls.at(-1)") ['section'] == 'users'
        assert page.evaluate("window.calls.at(-1).query.user") == '00000000-0000-4000-8000-000000000013'

        # Sistem Sağlığı: gerçek değerler; yedek durumu üretilmez.
        page.locator('[data-admin-section="health"]').click()
        main_area = page.locator('.adm-page')
        expect(main_area).to_contain_text('50 MB')
        expect(main_area).to_contain_text('listings_v1')
        expect(main_area).to_contain_text('Son çalışma 26 saatten eski')
        expect(page.locator('.adm-t-jobs .adm-row', has_text='nakgo-retention')).to_contain_text('Başarısız')
        expect(main_area).to_contain_text('bu panelde izlenmiyor')
        text = main_area.inner_text()
        assert 'Yedek başarılı' not in text and 'yedeklendi' not in text
        page.evaluate("window.health={...window.health,jobs:null,retention:null}")
        page.locator('#admin-refresh').click()
        expect(main_area).to_contain_text('pg_cron) bu veritabanında kurulu değil')
        expect(main_area).to_contain_text('hiç çalışmadı')
        page.evaluate("window.healthFail=true")
        page.locator('#admin-refresh').click()
        expect(page.get_by_role('alert')).to_contain_text('Yönetici paneli açılamadı')
        page.evaluate("window.healthFail=false")

        # Yönetici işlemi çakışması (HTTP 409): işlem tekrar gönderilmez, güncel durumu yükle istenir.
        page.evaluate('openAdminPanel()')
        page.wait_for_timeout(300)
        page.locator('[data-admin-section="listings"]').click()
        page.get_by_role('button', name='İlanı yayından kaldır', exact=True).first.click()
        page.locator('#admin-reason').fill('Eşzamanlı deneme')
        page.locator('#admin-submit').dblclick()
        expect(page.get_by_role('alert')).to_contain_text('başka bir yönetici')
        expect(page.get_by_role('alert')).to_contain_text('güncel durumu yükle')
        page.wait_for_timeout(300)
        assert page.evaluate('window.moderated') == [['listing', '7', 'remove', 'Eşzamanlı deneme', 3]], page.evaluate('window.moderated')
        page.locator('#admin-reload').click()
        page.wait_for_timeout(200)

        # Telefon: her bölümde yatay taşma yok, menü kaydırılabilir, sekmeler görünür.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('openAdminPanel()')
        page.wait_for_timeout(300)
        for key in ['overview', 'listings', 'archive', 'reports', 'security', 'moderation', 'users', 'health', 'stats']:
            page.locator('[data-admin-section="%s"]' % key).click()
            page.wait_for_timeout(250)
            assert not overflow(page), key + ' telefonda taşıyor'
            expect(page.locator('.adm-head h1')).to_be_visible()
        expect(page.locator('[data-admin-tab="live"]')).to_be_visible()

        # Yetkisiz: veri ve işlem düğmesi yok.
        page.evaluate("nakgoAuth.adminPage=async()=>{throw Error('Denied')};openAdminPanel()")
        expect(page.get_by_role('alert')).to_contain_text('Yetkini')
        assert page.locator('[data-admin-do],[data-admin-action],.adm-nav').count() == 0
        assert not errors, errors
        browser.close()
    print('Admin sections passed: navigation, overview alerts, report decisions, limit violations, system health, phone layout and denied state.')


if __name__ == '__main__':
    main()

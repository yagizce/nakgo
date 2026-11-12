"""Yönetici atama, kalıcı engel ve hesap silme arayüzü; uygulamada kullanıcının kendi hesabını silmesi.
Sunucu yanıtları sahte; yetki kuralları supabase/tests/accounts-admins.sql içinde doğrulanır."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = """()=>{
 const U=(id,name,extra={})=>({id,display_name:name,account_type:'carrier',city:'İzmir',created_at:'2026-11-01T09:00:00Z',listings:1,revision:4,suspended:false,protected:false,owner:false,is_self:false,banned:false,deleted_at:null,verified:true,...extra});
 window.users=[U('00000000-0000-4000-8000-000000000001','Ben',{protected:true,owner:true,is_self:true}),U('00000000-0000-4000-8000-000000000002','Ekip',{protected:true}),
  U('00000000-0000-4000-8000-000000000003','Normal'),U('00000000-0000-4000-8000-000000000004','Engelli Kişi',{banned:true,suspended:true}),U('00000000-0000-4000-8000-000000000005','Silinmiş hesap',{deleted_at:'2026-11-10T09:00:00Z',banned:true,suspended:true})];
 window.moderated=[];
 nakgoMarket.active=()=>true;nakgoMarket.token=()=>'admin';
 nakgoAuth.adminModerate=async(...a)=>{window.moderated.push(a);};
 nakgoAuth.adminPage=async(section)=>section==='overview'?{users:4,admins:2,accounts_banned:1,accounts_deleted:1}:section==='users'?window.users:[];
 return openAdminPanel();}"""


def detail(page, name):
    page.locator('.adm-row', has_text=name).first.click()
    expect(page.locator('.adm-detail h3')).to_contain_text(name)


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
        page.locator('[data-admin-section="users"]').click()
        for chip in ['Engelli', 'Yöneticiler', 'Silinen']:
            expect(page.locator('.adm-chips')).to_contain_text(chip)

        # Kendi hesabı ve ana yönetici: hiçbir işlem düğmesi yok.
        detail(page, 'Ben')
        assert page.locator('.adm-detail [data-admin-do],.adm-detail [data-admin-action]').count() == 0
        expect(page.locator('.adm-detail')).to_contain_text('Bu senin hesabın')
        # Diğer yönetici: yalnız yöneticiliği alma.
        detail(page, 'Ekip')
        assert page.locator('.adm-detail [data-admin-do]').count() == 1
        expect(page.locator('.adm-detail [data-admin-do="revoke_admin"]')).to_have_text('Yöneticiliği al')
        # Silinmiş hesap: işlem yok, tam silinme tarihi yazılı.
        detail(page, 'Silinmiş hesap')
        assert page.locator('.adm-detail [data-admin-do],.adm-detail [data-admin-action]').count() == 0
        expect(page.locator('.adm-detail')).to_contain_text('tamamen silinir')
        # Engelli: engel kaldırılabilir, askı/yönetici yap düğmesi yok.
        detail(page, 'Engelli Kişi')
        assert page.locator('.adm-detail [data-admin-action]').count() == 0
        assert page.locator('.adm-detail [data-admin-do="grant_admin"]').count() == 0
        page.locator('.adm-detail [data-admin-do="unban"]').click()
        page.locator('#admin-reason').fill('İtiraz kabul edildi')
        page.locator('#admin-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.moderated.at(-1)') == ['user', '00000000-0000-4000-8000-000000000004', 'unban', 'İtiraz kabul edildi', 4]

        # Normal kullanıcı: engelle, yönetici yap, sil (SİL yazmadan gönderilmez).
        detail(page, 'Normal')
        page.locator('.adm-detail [data-admin-do="ban"]').click()
        expect(page.locator('.adm-summary').last).to_contain_text('giriş kapanır')
        page.locator('#admin-reason').fill('Sahte ilanlar')
        page.locator('#admin-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.moderated.at(-1)')[2] == 'ban'
        detail(page, 'Normal')
        page.locator('.adm-detail [data-admin-do="grant_admin"]').click()
        expect(page.locator('.adm-summary').last).to_contain_text('tüm yetkileri')
        page.locator('#admin-reason').fill('Ekibe katıldı')
        page.locator('#admin-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.moderated.at(-1)')[2] == 'grant_admin'
        detail(page, 'Normal')
        page.locator('.adm-detail [data-admin-do="delete"]').click()
        expect(page.locator('.adm-summary').last).to_contain_text('1 yıl saklanır')
        page.locator('#admin-reason').fill('Kullanıcı talebi')
        page.locator('#admin-confirm-word').fill('evet')
        page.locator('#admin-submit').click()
        expect(page.locator('#admin-action-error')).to_contain_text('SİL')
        count = page.evaluate('window.moderated.length')
        page.locator('#admin-confirm-word').fill('sil')
        page.locator('#admin-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.moderated.length') == count + 1 and page.evaluate('window.moderated.at(-1)')[2] == 'delete'

        # Uygulama: kullanıcı kendi hesabını siler; SİL yazmadan istek gitmez.
        page.evaluate("""()=>{closeSheet();window.deleted=0;nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:'u',email:'a@b.c'},profile:{display_name:'Ali'},recovery:false});
          nakgoAuth.deleteMyAccount=async()=>{window.deleted++;};openDeleteAccount();}""")
        expect(page.locator('#sheetBody')).to_contain_text('1 yıl saklanır')
        page.locator('#account-delete-word').fill('tamam')
        page.locator('#account-delete-submit').click()
        expect(page.locator('#account-delete-feedback')).to_contain_text('SİL')
        assert page.evaluate('window.deleted') == 0
        page.locator('#account-delete-word').fill('SİL')
        page.locator('#account-delete-submit').click()
        page.wait_for_timeout(200)
        assert page.evaluate('window.deleted') == 1
        assert not errors, errors
        browser.close()
    print('Admin accounts passed: protected owner/self, admin roles, ban/unban, deletion confirmation and self-service account deletion.')


if __name__ == '__main__':
    main()

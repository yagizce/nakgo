/**
 * Yönetici paneli
 * Ortak erişimi her istekte sunucu tarafından doğrulanır.
 */
let adminPanelGeneration=0;
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const generation=++adminPanelGeneration,account=nakgoMarket.token(), body=$('#sheetBody');
    let section='overview',offset=0,search='',request=0;
    const titles={overview:'Genel bakış',users:'Kullanıcılar',listings:'İlanlar',audit:'Belge işlem geçmişi',moderation:'Yönetim işlem geçmişi'};
    const valid=()=>generation===adminPanelGeneration&&account===nakgoMarket.token()&&body.dataset.k==='admin';
    const date=value=>new Date(value).toLocaleString('tr-TR');
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        body.innerHTML='<div class="detail-top"><b>NakGo · Yönetici paneli</b><button class="chip" id="admin-close">Kapat ×</button></div><div class="load">'+
            (authorized?'<div role="group" aria-label="Yönetim bölümleri" class="admin-tabs">'+Object.entries(titles).map(([key,label])=>'<button class="chip '+(section===key?'on':'')+'" data-admin-section="'+key+'" aria-pressed="'+(section===key)+'">'+label+'</button>').join('')+'</div>':'')+content+'</div>';
        $('#admin-close').onclick=closeSheet;
        body.querySelectorAll('[data-admin-section]').forEach(button=>button.onclick=()=>{section=button.dataset.adminSection;offset=0;search='';load();});
    }
    async function load(){
        const ticket=++request;frame('<p role="status">Yönetici erişimi kontrol ediliyor…</p>');
        try{
            const data=await nakgoAuth.adminPage(section,offset,search);
            if(!valid()||ticket!==request)return;
            if(section==='overview'){
                frame('<h2>Genel bakış</h2><div class="stat profile-stats">'+[['users','Kullanıcı'],['listings','Aktif ilan'],['documents','Bekleyen belge'],['jobs','Devam eden iş']].map(([key,label])=>'<div><b>'+esc(String(data[key]))+'</b><span>'+label+'</span></div>').join('')+'</div><button class="chip" id="admin-documents">Belge incelemelerine git</button><p>Belge incelemek için ayrıca inceleyici yetkisi gerekir. Ortaklar kendi hesaplarıyla giriş yapar.</p><button class="chip" id="admin-refresh">Yenile</button>',true);
                $('#admin-documents').onclick=()=>{closeSheet();tab='me';setNav();render();nakgoDocuments.refresh();};
                $('#admin-refresh').onclick=load;return;
            }
            const rows=data.slice(0,20),more=data.length>20;
            const searchForm=['users','listings'].includes(section)?'<form id="admin-search"><label for="admin-term">Ad veya güzergâh ara</label><input id="admin-term" maxlength="100" value="'+esc(search)+'"><button class="chip" type="submit">Ara</button></form>':'';
            const cards=rows.map((row,index)=>{
                const actionButton=section==='users'?(row.protected?'<p>Yönetici hesabı · Korumalı</p>':'<p>'+esc(row.suspended?'Faaliyetleri askıda':'Aktif hesap')+'</p><button class="chip" data-admin-action="'+index+'">'+(row.suspended?'Askıyı kaldır':'Faaliyetleri askıya al')+'</button>'):'<button class="chip" data-admin-action="'+index+'">'+(row.removed?'Kaldırma engelini aç':'İlanı yayından kaldır')+'</button>';
                const reason=row.reason?'<p>Gerekçe: '+esc(row.reason)+'</p>':'';
                if(section==='users')return '<article class="load"><b>'+esc(row.display_name||'İsimsiz hesap')+'</b><p>'+esc(row.city||'')+' · '+esc(row.account_type==='carrier'?'Taşıyıcı':row.account_type==='owner'?'Yük sahibi':'Belirtilmemiş')+'</p><small>'+esc(date(row.created_at))+'</small>'+reason+actionButton+'</article>';
                if(section==='listings')return '<article class="load"><b>#'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</b><p>'+esc(row.owner_label)+' · '+esc(row.kind==='load'?'Yük':'Araç')+'</p><small>'+esc(({active:'Aktif',closed:'Kapalı',archived:'Arşiv'})[row.status]||row.status)+'</small>'+reason+actionButton+'</article>';
                if(section==='moderation')return '<article class="load"><b>'+esc(({suspend:'Faaliyetler askıya alındı',resume:'Askı kaldırıldı',remove:'İlan kaldırıldı',restore:'İlan engeli açıldı'})[row.action]||row.action)+'</b><p>'+esc(row.reason)+'</p><small>'+esc(row.actor_label)+' · '+esc(date(row.created_at))+'</small><p>Hedef: '+esc(row.target)+'</p></article>';
                return '<article class="load"><b>Başvuru #'+esc(String(row.application_id))+' · '+esc(({submit:'Gönderildi',withdraw:'Geri çekildi',approved:'Onaylandı',rejected:'Düzeltme istendi'})[row.action]||row.action)+'</b><p>'+esc(row.note||'')+'</p><small>'+esc(date(row.created_at))+' · İşlemi yapan: '+esc(row.actor_id)+'</small></article>';
            }).join('');
            frame('<h2>'+titles[section]+'</h2>'+searchForm+(cards||'<p>Kayıt bulunamadı.</p>')+'<div class="admin-tabs"><button class="chip" id="admin-prev" '+(offset===0?'disabled':'')+'>Önceki</button><span>Sayfa '+(offset/20+1)+'</span><button class="chip" id="admin-next" '+(!more?'disabled':'')+'>Sonraki</button><button class="chip" id="admin-refresh">Yenile</button></div>',true);
            body.querySelectorAll('[data-admin-action]').forEach(button=>button.onclick=()=>confirmAction(rows[Number(button.dataset.adminAction)]));
            $('#admin-prev').onclick=()=>{offset=Math.max(0,offset-20);load();};$('#admin-next').onclick=()=>{offset+=20;load();};$('#admin-refresh').onclick=load;
            if($('#admin-search'))$('#admin-search').onsubmit=event=>{event.preventDefault();search=$('#admin-term').value.trim();offset=0;load();};
        }catch(error){if(valid()&&ticket===request){frame('<p role="alert">Yönetici paneli açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="admin-retry">Tekrar dene</button>');$('#admin-retry').onclick=load;}}
    }
    function confirmAction(row){
        if(!valid())return;
        ++request;
        const kind=section==='users'?'user':'listing',action=kind==='user'?(row.suspended?'resume':'suspend'):(row.removed?'restore':'remove');
        const label=({suspend:'Faaliyetleri askıya al',resume:'Askıyı kaldır',remove:'İlanı yayından kaldır',restore:'Kaldırma engelini aç'})[action];
        const explanation=({suspend:'Yeni ilan, mesaj, belge ve taşıma talebi işlemleri durdurulur. Hesaba giriş ve mevcut işlerin teslim adımları devam eder. Mevcut ilanlar otomatik kaldırılmaz.',resume:'Hesabın yeni işlem yapmasına yeniden izin verilir.',remove:'İlan yayından kalkar ve sahibi yeniden yayımlayamaz. Mevcut iş ve görüşme geçmişi korunur.',restore:'İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.'})[action];
        frame('<h2>'+label+'</h2><b>'+esc(row.display_name||row.owner_label||'')+'</b><p>'+explanation+'</p><form id="admin-confirm"><label for="admin-reason">İşlem gerekçesi (zorunlu)</label><textarea id="admin-reason" minlength="3" maxlength="500" required></textarea><p id="admin-action-error" role="alert"></p><button class="btn" id="admin-submit" type="submit">'+label+'</button><button class="chip" id="admin-cancel" type="button">Vazgeç</button></form>');
        $('#admin-cancel').onclick=load;
        let sending=false;
        $('#admin-confirm').onsubmit=async event=>{
            event.preventDefault();if(sending||!valid())return;
            const reason=$('#admin-reason').value.trim();if(reason.length<3){$('#admin-action-error').textContent='En az 3 karakterlik bir gerekçe yaz.';return;}
            sending=true;$('#admin-submit').disabled=true;$('#admin-cancel').disabled=true;
            try{await nakgoAuth.adminModerate(kind,String(row.id),action,reason,Number(row.revision));if(valid())await load();}
            catch(error){if(!valid())return;
                frame('<p role="alert">'+(error?.code==='40001'?'Bu kayıt başka bir yönetici tarafından değiştirildi. Güncel durumu yükle.':'İşlem sonucu doğrulanamadı. Yeniden işlem yapmadan önce güncel durumu yükle.')+'</p><button class="chip" id="admin-reload">Güncel durumu yükle</button>');
                $('#admin-reload').onclick=load;
            }
        };
    }
    await load();
}

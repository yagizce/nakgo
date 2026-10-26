/**
 * Yönetici paneli
 * Ortak erişimi her istekte sunucu tarafından doğrulanır.
 */
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const account=nakgoMarket.token(), body=$('#sheetBody');
    let section='overview',offset=0,search='',request=0;
    const titles={overview:'Genel bakış',users:'Kullanıcılar',listings:'İlanlar',audit:'Belge işlem geçmişi'};
    const valid=()=>account===nakgoMarket.token()&&body.dataset.k==='admin';
    const date=value=>new Date(value).toLocaleString('tr-TR');
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        body.innerHTML='<div class="detail-top"><b>NakGo · Yönetici paneli</b><button class="chip" id="admin-close">Kapat ×</button></div><div class="load">'+
            (authorized?'<nav aria-label="Yönetim bölümleri" class="admin-tabs">'+Object.entries(titles).map(([key,label])=>'<button class="chip '+(section===key?'on':'')+'" data-admin-section="'+key+'" aria-pressed="'+(section===key)+'">'+label+'</button>').join('')+'</nav>':'')+content+'</div>';
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
            const searchForm=section!=='audit'?'<form id="admin-search"><label for="admin-term">Ad veya güzergâh ara</label><input id="admin-term" maxlength="100" value="'+esc(search)+'"><button class="chip" type="submit">Ara</button></form>':'';
            const cards=rows.map(row=>{
                if(section==='users')return '<article class="load"><b>'+esc(row.display_name||'İsimsiz hesap')+'</b><p>'+esc(row.city||'')+' · '+esc(row.account_type==='carrier'?'Taşıyıcı':row.account_type==='owner'?'Yük sahibi':'Belirtilmemiş')+'</p><small>'+esc(date(row.created_at))+'</small></article>';
                if(section==='listings')return '<article class="load"><b>#'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</b><p>'+esc(row.owner_label)+' · '+esc(row.kind==='load'?'Yük':'Araç')+'</p><small>'+esc(({active:'Aktif',closed:'Kapalı',archived:'Arşiv'})[row.status]||row.status)+'</small></article>';
                return '<article class="load"><b>Başvuru #'+esc(String(row.application_id))+' · '+esc(({submit:'Gönderildi',withdraw:'Geri çekildi',approved:'Onaylandı',rejected:'Düzeltme istendi'})[row.action]||row.action)+'</b><p>'+esc(row.note||'')+'</p><small>'+esc(date(row.created_at))+' · İşlemi yapan: '+esc(row.actor_id)+'</small></article>';
            }).join('');
            frame('<h2>'+titles[section]+'</h2>'+searchForm+(cards||'<p>Kayıt bulunamadı.</p>')+'<div class="admin-tabs"><button class="chip" id="admin-prev" '+(offset===0?'disabled':'')+'>Önceki</button><span>Sayfa '+(offset/20+1)+'</span><button class="chip" id="admin-next" '+(!more?'disabled':'')+'>Sonraki</button><button class="chip" id="admin-refresh">Yenile</button></div>',true);
            $('#admin-prev').onclick=()=>{offset=Math.max(0,offset-20);load();};$('#admin-next').onclick=()=>{offset+=20;load();};$('#admin-refresh').onclick=load;
            if($('#admin-search'))$('#admin-search').onsubmit=event=>{event.preventDefault();search=$('#admin-term').value.trim();offset=0;load();};
        }catch(error){if(valid()&&ticket===request){frame('<p role="alert">Yönetici paneli açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="admin-retry">Tekrar dene</button>');$('#admin-retry').onclick=load;}}
    }
    await load();
}

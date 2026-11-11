/**
 * Yönetici paneli
 * Ortak erişimi her istekte sunucu tarafından doğrulanır.
 */
const nakgoAdminAccess=(()=>{
    let generation=0,account='',ready=false,busy=false,authorized=false;
    const isAdmin=()=>nakgoMarket.active()&&ready&&authorized&&account===nakgoMarket.token();
    function reset(){generation++;account='';ready=busy=authorized=false;}
    async function refresh(){
        if(!nakgoMarket.active()||busy)return;
        const current=nakgoMarket.token(),ticket=++generation;busy=true;authorized=false;
        try{const role=await nakgoAuth.adminRole();if(ticket!==generation||current!==nakgoMarket.token())return;account=current;authorized=role===true;ready=true;}
        catch(error){if(ticket===generation&&current===nakgoMarket.token()){account=current;authorized=false;ready=true;}}
        finally{if(ticket===generation&&current===nakgoMarket.token()){busy=false;if(tab==='me')render();}}
    }
    function ensure(){if(nakgoMarket.active()&&!busy&&(!ready||account!==nakgoMarket.token()))refresh();}
    return {isAdmin,reset,refresh,ensure};
})();
let adminPanelGeneration=0;
async function openAdminPanel() {
    if(!nakgoMarket.active())return;
    const generation=++adminPanelGeneration,account=nakgoMarket.token(), body=$('#sheetBody');
    let section='overview',offset=0,search='',request=0,capabilities=[],archiveBefore=null,archiveHistory=[],archiveFilters={};
    const titles={overview:'Genel bakış',archive:'İlan Arşivi',privacy:'Veri Güvenliği ve KVKK',whatsapp:'WhatsApp ilanları',users:'Kullanıcılar',listings:'İlanlar',moderation:'Yönetim işlem geçmişi'};
    const valid=()=>generation===adminPanelGeneration&&account===nakgoMarket.token()&&body.dataset.k==='admin';
    const date=value=>new Date(value).toLocaleString('tr-TR');
    body.dataset.k='admin';$('#sheet').classList.add('open');
    function frame(content,authorized=false){
        if(!valid())return;
        body.innerHTML='<div class="detail-top"><b>NakGo · Yönetici paneli</b><button class="chip" id="admin-close">Kapat ×</button></div><div class="load">'+
            (authorized?'<div role="group" aria-label="Yönetim bölümleri" class="admin-tabs">'+Object.entries(titles).filter(([key])=>(key!=='archive'||capabilities.includes('listing_archive'))&&(!['privacy','users'].includes(key)||capabilities.includes('privacy_cases'))).map(([key,label])=>'<button class="chip '+(section===key?'on':'')+'" data-admin-section="'+key+'" aria-pressed="'+(section===key)+'">'+label+'</button>').join('')+'</div>':'')+content+'</div>';
        $('#admin-close').onclick=closeSheet;
        body.querySelectorAll('[data-admin-section]').forEach(button=>button.onclick=()=>{section=button.dataset.adminSection;offset=0;search='';archiveBefore=null;archiveHistory=[];load();});
    }
    async function load(){
        const ticket=++request;frame('<p role="status">Yönetici erişimi kontrol ediliyor…</p>');
        try{
            if(section==='privacy'){
                const [rows,maintenance]=await Promise.all([nakgoAuth.privacyRPC('queue'),nakgoAuth.maintenanceStatus()]);
                if(!valid()||ticket!==request)return;
                const labels={access:'Veriye erişim',correction:'Düzeltme',deletion:'Hesap ve veri silme',objection:'İtiraz'};
                const warning=maintenance.some(s=>s.failures>0)?'<p role="alert">Otomatik veri temizliğinde hata var. Son başarılı işlem ve yeniden deneme durumu incelenmeli.</p>':'';
                frame('<h2>Veri Güvenliği ve KVKK</h2>'+warning+'<p>Açık başvurular son yanıt tarihine göre sıralanır. Bu ekran ilan arşivinden ayrıdır.</p>'+rows.map(row=>'<article class="load"><b>Başvuru #'+esc(String(row.id))+' · '+esc(labels[row.kind]||row.kind)+'</b><p>'+esc(row.status==='reviewing'?'İnceleniyor':'Bekliyor')+'</p><p>Son yanıt: '+esc(date(row.due_at))+'</p><button class="chip" data-privacy-resolve="'+esc(String(row.id))+'">İncele / sonuçlandır</button></article>').join('')+(!rows.length?'<p>Açık başvuru yok.</p>':''),true);
                body.querySelectorAll('[data-privacy-resolve]').forEach(button=>button.onclick=()=>{
                    const formTicket=++request,row=rows.find(r=>Number(r.id)===Number(button.dataset.privacyResolve));if(!row)return;
                    frame('<h2>Başvuru #'+esc(String(row.id))+'</h2><p>Silme başvurusu tamamlanırken sunucu gerçek silmeyi ve ilişkileri denetler. Korunan veya bilinmeyen ilişkiler varsa sonuç başarılı sayılmaz.</p><form id="privacy-resolve"><label for="privacy-result">Sonuç / yanıt referansı</label><textarea id="privacy-result" minlength="10" maxlength="500" required></textarea><label for="privacy-state">Durum</label><select id="privacy-state"><option value="reviewing">İnceleniyor</option><option value="completed">Tamamla</option><option value="rejected">Gerekçeli yanıt / ret</option></select><p id="privacy-error" role="alert"></p><button class="btn">Kaydet</button><button type="button" class="chip" id="privacy-back">Geri</button></form>');
                    $('#privacy-back').onclick=load;let saving=false;
                    $('#privacy-resolve').onsubmit=async e=>{e.preventDefault();if(saving||!valid()||formTicket!==request)return;saving=true;
                        try{const result=await nakgoAuth.privacyRPC('resolve',{p_id:row.id,p_revision:row.revision,p_status:$('#privacy-state').value,p_result:$('#privacy-result').value.trim()});if(!valid()||formTicket!==request)return;if(result.requires_review){$('#privacy-error').textContent='Silme yapılmadı. Bağlı kayıtlar için ayrı inceleme gerekiyor.';}else load();}
                        catch{if(valid()&&formTicket===request)$('#privacy-error').textContent='İşlem doğrulanamadı. Silme anahtarı kapalı, yetki eksik veya kayıt değişmiş olabilir.';}finally{saving=false;}
                    };
                });
                return;
            }
            if(section==='archive'){
                const rows=await nakgoAuth.archiveList(search,archiveBefore,archiveFilters);
                if(!valid()||ticket!==request)return;
                const cards=rows.map(row=>'<article class="load"><b>#'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</b><p>'+esc(row.kind==='load'?'Yük':'Boş araç')+'</p><small>Yayın '+esc(date(row.published_at))+' · Bitiş '+esc(date(row.expires_at))+' · Arşiv sonu '+esc(date(row.archive_until))+'</small><p>Kalan arşiv süresi: '+esc(String(Math.max(0,Math.ceil((new Date(row.archive_until)-Date.now())/3600000))))+' saat</p>'+(capabilities.includes('archive_contact')?'<button class="chip" data-archive-detail="'+esc(String(row.id))+'">İlan detayı</button>':'')+'<button class="chip" data-archive-review="'+esc(String(row.id))+'">Şikâyet incelemesi</button>'+(capabilities.includes('privacy_cases')?'<button class="chip" data-archive-hold="'+esc(String(row.id))+'">Süreli hukuki koruma</button>':'')+'</article>').join('');
                const options=(values,current)=>values.map(([v,label])=>'<option value="'+v+'" '+(current===v?'selected':'')+'>'+label+'</option>').join('');
                const filters='<label for="archive-review">Şikâyet durumu</label><select id="archive-review">'+options([['','Tümü'],['none','Şikâyet kaydı yok'],['open','Açık'],['reviewing','İnceleniyor'],['closed','Kapalı']],archiveFilters.review||'')+'</select><label for="archive-kind">İlan türü</label><select id="archive-kind">'+options([['','Tümü'],['load','Yük'],['truck','Boş araç']],archiveFilters.kind||'')+'</select><label for="archive-source">Kaynak</label><select id="archive-source">'+options([['','Tümü'],['manual','Manuel'],['whatsapp','WhatsApp']],archiveFilters.source||'')+'</select><label for="archive-from">Yayın başlangıcı</label><input id="archive-from" type="datetime-local" value="'+esc(archiveFilters.fromLocal||'')+'"><label for="archive-to">Yayın bitişi (hariç)</label><input id="archive-to" type="datetime-local" value="'+esc(archiveFilters.toLocal||'')+'">';
                frame('<h2>İlan Arşivi</h2><form id="archive-search"><label for="archive-term">İlan numarası veya güzergâh</label><input id="archive-term" maxlength="100" value="'+esc(search)+'">'+filters+'<button class="chip">Ara</button></form>'+(cards||'<p>İlan bulunamadı.</p>')+'<div class="admin-tabs"><button class="chip" id="archive-prev" '+(!archiveHistory.length?'disabled':'')+'>Önceki</button><button class="chip" id="archive-next" '+(rows.length<50?'disabled':'')+'>Sonraki</button></div>',true);
                $('#archive-search').onsubmit=e=>{e.preventDefault();search=$('#archive-term').value.trim();const fromLocal=$('#archive-from').value,toLocal=$('#archive-to').value;archiveFilters={review:$('#archive-review').value,kind:$('#archive-kind').value,source:$('#archive-source').value,fromLocal,toLocal,from:fromLocal?new Date(fromLocal).toISOString():null,to:toLocal?new Date(toLocal).toISOString():null};archiveBefore=null;archiveHistory=[];load();};
                function actionForm(id,action){
                    const formTicket=++request,row=rows.find(r=>Number(r.id)===id);if(!row)return;
                    frame('<h2>'+esc(action==='hold'?'Süreli hukuki koruma':'Şikâyet incelemesi')+' · #'+esc(String(id))+'</h2><form id="archive-action"><p>Telefon veya mesaj kopyası yerine kısıtlı kanıt kaydının referansını yaz.</p><label for="archive-reference">Gerekçe / kanıt referansı</label><textarea id="archive-reference" minlength="10" maxlength="500" required></textarea>'+(action==='hold'?'<label for="archive-until">Koruma bitişi</label><input id="archive-until" type="datetime-local" required>':'<label for="archive-state">İnceleme durumu</label><select id="archive-state">'+options([['open','Açık'],['reviewing','İnceleniyor'],['closed','Kapalı']],row.review_status)+'</select>')+'<p id="archive-action-error" role="alert"></p><button class="btn">Kaydet</button><button type="button" class="chip" id="archive-cancel">Vazgeç</button></form>');
                    $('#archive-cancel').onclick=load;let saving=false;
                    $('#archive-action').onsubmit=async e=>{e.preventDefault();if(saving||!valid()||formTicket!==request)return;saving=true;
                        try{const args={p_id:id,p_reference:$('#archive-reference').value.trim()};if(action==='hold')args.p_until=new Date($('#archive-until').value).toISOString();else{args.p_status=$('#archive-state').value;args.p_revision=row.review_revision;}
                            await nakgoAuth.archiveAction(action,args);if(valid()&&formTicket===request)load();
                        }catch{if(valid()&&formTicket===request)$('#archive-action-error').textContent='İşlem doğrulanamadı. Yetki, tarih ve güncel kayıt durumunu kontrol et.';}finally{saving=false;}
                    };
                }
                body.querySelectorAll('[data-archive-review]').forEach(b=>b.onclick=()=>actionForm(Number(b.dataset.archiveReview),'review'));
                body.querySelectorAll('[data-archive-hold]').forEach(b=>b.onclick=()=>actionForm(Number(b.dataset.archiveHold),'hold'));
                $('#archive-prev').onclick=()=>{archiveBefore=archiveHistory.pop()??null;load();};
                $('#archive-next').onclick=()=>{archiveHistory.push(archiveBefore);archiveBefore=rows[rows.length-1].id;load();};
                body.querySelectorAll('[data-archive-detail]').forEach(button=>button.onclick=async()=>{
                    const detailTicket=++request;
                    frame('<p role="status">Yetkili detay yükleniyor…</p>');
                    try{
                        const detail=await nakgoAuth.archiveDetail(Number(button.dataset.archiveDetail));
                        if(!valid()||detailTicket!==request)return;
                        frame('<h2>Arşiv #'+esc(String(detail.id))+'</h2><p>Bu erişim denetim kaydına alındı.</p><p>'+esc(detail.cargo||'')+'</p><p>'+esc(detail.note||'')+'</p><button class="chip" id="archive-back">Arşive dön</button>',true);
                        $('#archive-back').onclick=load;
                    }catch{if(valid()&&detailTicket===request){frame('<p role="alert">Arşiv detayı açılamadı. Yetki veya saklama süresi değişmiş olabilir.</p><button class="chip" id="archive-back">Arşive dön</button>',true);$('#archive-back').onclick=load;}}
                });
                return;
            }
            if(section==='whatsapp'){await whatsappPage(ticket);return;}
            const data=await nakgoAuth.adminPage(section,offset,search);
            if(!valid()||ticket!==request)return;
            if(section==='overview'){
                frame('<h2>Genel bakış</h2><div class="stat profile-stats">'+[['users','Kullanıcı'],['listings','Aktif ilan']].map(([key,label])=>'<div><b>'+esc(String(data[key]))+'</b><span>'+label+'</span></div>').join('')+'</div><button class="chip" id="admin-refresh">Yenile</button>',true);
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
    const waStatus=value=>({draft:'Taslak',published:'Yayında',rejected:'Reddedildi',withdrawn:'Yayından kaldırıldı',purged:'Saklama süresi doldu'})[value]||value;
    const waIssue=value=>({kind_unknown:'İlan türü belirsiz',route_incomplete:'Güzergâh eksik',origin_missing:'Yükleme noktası eksik',route_order_review:'Güzergâh yönünü doğrula',location_alias_review:'Kısaltılmış yer adını doğrula',weight_review:'Tonajı tamamla veya doğrula',vehicle_review:'Araç ve kasa tipini doğrula',cargo_missing:'Yük cinsi eksik',timing_missing:'Yükleme zamanı eksik',conditions_review:'Özel şartlar incelenmeli',vehicle_count_review:'Birden çok araç talebi incelenmeli',timing_ambiguous:'Birden çok yükleme zamanı var',truck_calendar_review:'Boş araç için kesin takvim tarihi eksik',contact_review:'İletişim bilgisi eksik veya belirsiz',message_overflow_review:'Mesajda 30’dan fazla bölüm var; tüm kaynağı incele'})[value]||'Manuel inceleme gerekiyor';
    async function whatsappPage(ticket){
        const data=await nakgoAuth.whatsappRPC('page',{p_offset:offset});
        if(!valid()||ticket!==request)return;
        const rows=data.drafts.slice(0,20);
        frame('<h2>WhatsApp ilanları</h2><button class="chip" id="wa-permission">Mesaj için yayın izni kaydet / geri al</button><p>Bekleyen mesaj: '+esc(String(data.pending))+' · İşleme hatası: '+esc(String(data.failed))+'</p><button class="chip" id="wa-retry">Hatalı mesajları tekrar sıraya al</button>'+rows.map(r=>'<article class="load"><b>#'+esc(String(r.id))+' · '+esc(r.fields.from?.city||'Yükleme belirsiz')+' → '+esc(r.fields.destinations?.map(p=>p.city||'?').join(' + ')||'Teslimat belirsiz')+'</b><p>'+esc(waStatus(r.status))+' · Güven '+esc(String(Math.round(r.confidence*100)))+'%</p><p>'+esc(String(r.issues.length))+' inceleme işareti · '+esc(String(r.similar_count))+' benzer aday</p><button class="chip" data-wa-open="'+r.id+'">İncele / düzenle</button></article>').join('')+'<div class="admin-tabs"><button class="chip" id="wa-prev" '+(offset===0?'disabled':'')+'>Önceki</button><button class="chip" id="wa-next" '+(data.drafts.length<=20?'disabled':'')+'>Sonraki</button><button class="chip" id="wa-refresh">Yenile</button></div>',true);
        body.querySelectorAll('[data-wa-open]').forEach(b=>b.onclick=()=>whatsappDetail(Number(b.dataset.waOpen)));
        $('#wa-permission').onclick=permissionForm;
        $('#wa-prev').onclick=()=>{offset=Math.max(0,offset-20);load();};$('#wa-next').onclick=()=>{offset+=20;load();};$('#wa-refresh').onclick=load;
        $('#wa-retry').onclick=async()=>{try{await nakgoAuth.whatsappRPC('retry');if(valid())load();}catch{if(valid())frame('<p role="alert">Tekrar sıraya alma doğrulanamadı. Paneli yeniden aç.</p>');}};
    }
    function permissionForm(){
        const formTicket=++request;
        frame('<h2>Mesaja özel yayın izni</h2><p>İzin belirli kaynak mesaj kimliğini ve mesaj içindeki telefonu kapsar. İleten kişinin telefonu veya mesajdaki izin sözü yeterli değildir. Otomatik yayın için izin en az altı saat daha geçerli olmalı; eksik ve belirsiz adaylar yayımlanmaz.</p><form id="wa-permission-form"><label for="permission-message">Meta kaynak mesaj kimliği</label><input id="permission-message" maxlength="256" required><label for="permission-phone">İzin kapsamındaki telefon</label><input id="permission-phone" type="tel" maxlength="32" required><label for="permission-basis">İzin kanıtı / hukuki dayanak referansı</label><textarea id="permission-basis" minlength="10" maxlength="1000" required></textarea><label for="permission-until">İzin bitişi (en fazla 30 gün)</label><input id="permission-until" type="datetime-local" required><label><input id="permission-active" type="checkbox" checked> İzin geçerli (geri almak için kaldır)</label><p id="permission-error" role="alert"></p><button class="btn" type="submit">Kaydet</button><button class="chip" type="button" id="permission-back">Vazgeç</button></form>');
        $('#permission-back').onclick=load;let saving=false;
        $('#wa-permission-form').onsubmit=async event=>{
            event.preventDefault();if(saving||!valid()||formTicket!==request)return;
            const phone=normalizeListingPhone($('#permission-phone').value),until=new Date($('#permission-until').value);
            if(!phone||!Number.isFinite(until.getTime())){$('#permission-error').textContent='Telefon ve izin bitişini kontrol et.';return;}
            saving=true;
            try{await nakgoAuth.whatsappRPC('permission',{p_message_id:$('#permission-message').value.trim(),p_phone:phone,p_basis:$('#permission-basis').value.trim(),p_until:until.toISOString(),p_active:$('#permission-active').checked});if(valid()&&formTicket===request)load();}
            catch{if(valid()&&formTicket===request)$('#permission-error').textContent='İzin kaydı doğrulanamadı. Yetki, tarih ve dayanak alanlarını kontrol et.';}
            finally{saving=false;}
        };
    }
    async function whatsappDetail(id){
        const ticket=++request;frame('<p role="status">Taslak yükleniyor…</p>');
        try{
            const d=await nakgoAuth.whatsappRPC('detail',{p_id:id});if(!valid()||ticket!==request)return;
            const f=d.fields;
            const fields=[['kind','İlan türü'],['from','Yükleme ili | ilçesi'],['destinations','Teslimat ili | ilçesi — her nokta ayrı satır'],['vehicle','Araç tipi'],['body','Kasa tipi'],['weightMin','En az tonaj'],['weightMax','En çok tonaj'],['amount','Yayımlanacak kesin tonaj / araç kapasitesi'],['cargo','Yük cinsi'],['timing','Yükleme metni'],['availableOn','Boş araç günü (YYYY-MM-DD)'],['availableUntil','Boş araç bitiş günü'],['availableTime','Boş araç saati'],['vehicleCount','Araç adedi'],['conditions','Özel şartlar'],['company','Firma / kişi (özel)'],['contactPhone','İzinle yayımlanacak iletişim telefonu'],['description','Ayrıştırılan açıklama (özel)'],['publicNote','Yayımlanacak açıklama: tüm duraklar ve gerekli şartlar'],['items','Yük kalemleri — her satır: ad | miktar | birim']];
            const formatPoint=p=>[p?.city,p?.district].filter(Boolean).join(' | ');
            const fieldValue=key=>key==='from'?formatPoint(f.from):key==='destinations'?(f.destinations||[]).map(formatPoint).join('\n'):key==='items'?(f.items||[]).map(x=>[x.n,x.q,x.u].join(' | ')).join('\n'):String(f[key]??'');
            const numbers=['weightMin','weightMax','amount','vehicleCount'];
            frame('<h2>WhatsApp taslağı #'+esc(String(id))+'</h2><p>'+esc(waStatus(d.status))+' · Güven '+esc(String(Math.round(d.confidence*100)))+'% — yayın izni değildir.</p><div class="wa-review"><section><h3>Değişmez kaynak mesaj</h3><p>Mesaj kimliği: '+esc(d.source.messageId||'')+'</p><pre class="wa-source">'+esc(d.source.text||'Kaynak saklama süresi dolmuş.')+'</pre><small>Alındı: '+esc(date(d.source.receivedAt))+'</small><p>Benzer adaylar: '+esc(d.similar.join(', ')||'Yok')+'</p></section><form id="wa-form"><h3>Düzenlenebilir ilan</h3><p class="wa-uncertain">İnceleme işaretleri: '+esc(d.issues.map(waIssue).join(' · ')||'Yok')+'</p>'+fields.map(([key,label])=>'<label class="'+(!f[key]?'wa-uncertain':'')+'" for="wa-'+key+'">'+label+'</label>'+(key==='kind'?'<select id="wa-kind"><option value="">Belirsiz</option><option value="load" '+(f.kind==='load'?'selected':'')+'>Yük</option><option value="truck" '+(f.kind==='truck'?'selected':'')+'>Boş araç</option></select>':'<textarea id="wa-'+key+'" maxlength="6000">'+esc(fieldValue(key))+'</textarea>')).join('')+'<label for="wa-basis">Yayın izni / hukuki dayanak kaydı (zorunlu)</label><textarea id="wa-basis" maxlength="1000">'+esc(d.legal_basis||'')+'</textarea><label><input type="checkbox" id="wa-reviewed"> Yayımlanacak alanları, kişisel veri iznini, tüm teslimat noktalarını ve şartları kontrol ettim.</label><p>İletişim telefonu izinle yayımlanır; Ara ve WhatsApp bağlantılarında kullanılır. Firma, kişi adı ve kaynak metin yayımlanmaz. İlan altı saat aktiftir.</p><p id="wa-error" role="alert"></p><div class="admin-tabs">'+[['save','Taslak kaydet'],['publish',d.status==='published'?'Değişiklikleri onayla ve yayımla':'Onayla ve yayımla'],['reject','Reddet'],['withdraw','Yayından kaldır']].map(([a,l])=>'<button type="button" class="chip" data-wa-action="'+a+'" '+(a==='save'&&d.status==='published'?'disabled':'')+'>'+l+'</button>').join('')+'<button type="button" class="chip" id="wa-back">Listeye dön</button></div></form></div><details><summary>İşlem geçmişi (son 50)</summary>'+d.audit.map(a=>'<article><b>'+esc(a.action)+' · '+esc(date(a.created_at))+'</b><p>İşlemi yapan: '+esc(a.actor||'Silinmiş hesap')+'</p><pre class="wa-source">'+esc(JSON.stringify({eski:a.before_value,yeni:a.after_value},null,2))+'</pre></article>').join('')+'</details>');
            $('#wa-back').onclick=load;let sending=false;
            body.querySelectorAll('[data-wa-action]').forEach(b=>b.onclick=async()=>{
                if(sending||!valid())return;const action=b.dataset.waAction,next={};
                try{
                    for(const [key] of fields){const value=$('#wa-'+key).value.trim();const point=s=>{const [city,district]=s.split('|').map(x=>x.trim());return {city:city||null,district:district||null};};next[key]=key==='from'?point(value):key==='destinations'?value.split('\n').filter(Boolean).map(point):key==='items'?value.split('\n').filter(Boolean).map(s=>{const [n,q,u]=s.split('|').map(x=>x.trim());return {n,q:Number(q),u};}):numbers.includes(key)?(value===''?null:Number(value)):(value||null);}
                    if(action==='publish'&&!$('#wa-reviewed').checked)throw Error('Yayın alanlarını ve izin kaydını kontrol edip kutuyu işaretle.');
                }catch(e){$('#wa-error').textContent=e.message||'Alan biçimini kontrol et.';return;}
                next.imageData=f.imageData||null;const basis=$('#wa-basis').value.trim();sending=true;body.querySelectorAll('button').forEach(button=>button.disabled=true);
                try{await nakgoAuth.whatsappRPC('change',{p_id:id,p_revision:d.revision,p_action:action,p_fields:next,p_basis:basis});if(valid())await whatsappDetail(id);}
                catch(e){if(!valid())return;frame('<p role="alert">'+esc(e.code==='40001'?'Kayıt değişmiş. Güncel kaydı yükle.':'İşlem doğrulanamadı. Zorunlu alanları ve yayın izin kaydını kontrol etmek için güncel kaydı yükle.')+'</p><button class="chip" id="wa-reload">Güncel kaydı yükle</button>');$('#wa-reload').onclick=()=>whatsappDetail(id);}
            });
        }catch{if(valid()&&ticket===request){frame('<p role="alert">Taslak açılamadı. Yetkini ve bağlantını kontrol et.</p><button class="chip" id="wa-back">Listeye dön</button>');$('#wa-back').onclick=load;}}
    }
    function confirmAction(row){
        if(!valid())return;
        ++request;
        const kind=section==='users'?'user':'listing',action=kind==='user'?(row.suspended?'resume':'suspend'):(row.removed?'restore':'remove');
        const label=({suspend:'Faaliyetleri askıya al',resume:'Askıyı kaldır',remove:'İlanı yayından kaldır',restore:'Kaldırma engelini aç'})[action];
        const explanation=({suspend:'Yeni ilan ve mesaj işlemleri durdurulur. Hesaba giriş devam eder. Mevcut ilanlar otomatik kaldırılmaz.',resume:'Hesabın yeni işlem yapmasına yeniden izin verilir.',remove:'İlan yayından kalkar ve sahibi yeniden yayımlayamaz. Mevcut iş ve görüşme geçmişi korunur.',restore:'İlan kapalı duruma alınır. Sahibi tarihini kontrol ederek yeniden yayımlayabilir.'})[action];
        const target=kind==='listing'?'<p id="admin-target">İlan #'+esc(String(row.id))+' · '+esc(row.from_city)+' → '+esc(row.to_city)+'</p>':'';
        frame('<h2>'+label+'</h2><b>'+esc(row.display_name||row.owner_label||'')+'</b>'+target+'<p>'+explanation+'</p><form id="admin-confirm"><label for="admin-reason">İşlem gerekçesi (zorunlu)</label><textarea id="admin-reason" minlength="3" maxlength="500" required></textarea><p id="admin-action-error" role="alert"></p><button class="btn" id="admin-submit" type="submit">'+label+'</button><button class="chip" id="admin-cancel" type="button">Vazgeç</button></form>');
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
    try{capabilities=await nakgoAuth.dataCapabilities();if(!Array.isArray(capabilities))capabilities=[];}catch{capabilities=[];}
    if(valid())await load();
}

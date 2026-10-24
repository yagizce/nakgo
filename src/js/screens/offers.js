/**
 * İşlerim
 * Tutar içermeyen talepler ve iki aşamalı yükleme takibi.
 */
function renderOffers(m){
    if(nakgoMarket.active())return renderRemoteJobs(m);
    m.innerHTML=screenHeading("İşlerim","Taşıma taleplerini takip et. Yüklediğini bildir, onayı burada gör.")+demoNotice()+incHTML()+(offers.length?offers.map(o=>`<article class="load job-card">${routeTitle(o)}<div class="meta"><span>${esc(o.cargo)} · ${esc(o.ton)} ton</span><span class="st ${o.status==='ok'?'ok':o.status==='no'?'no':''}">${offerExp(o)?'Süresi doldu':STT[o.status]}</span></div><div class="job-actions">${o.status==='counter'?`<button class="chip on" data-ca="${esc(o.id)}">Talebi sürdür</button>`:''}${['wait','counter'].includes(o.status)?`<button class="chip" data-c="${esc(o.id)}">Geri çek</button>`:''}</div>${o.status==='ok'?stageUI(o)+retHTML(o):''}</article>`).join(''):'<div class="empty">Henüz taşıma talebin yok. İlan detayından yük sahibiyle görüşebilirsin.</div>');
    m.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>withdrawOffer(b.dataset.c));
    m.querySelectorAll('[data-ca]').forEach(b=>b.onclick=()=>oup(offers.find(x=>x.id===+b.dataset.ca),{status:'wait'}));
    m.querySelectorAll('[data-ia]').forEach(b=>b.onclick=()=>{if(oup(incoming[+b.dataset.ia],{status:'ok'}))toast('Taşıma talebi kabul edildi');});
    m.querySelectorAll('[data-ir]').forEach(b=>b.onclick=()=>oup(incoming[+b.dataset.ir],{status:'no'}));
    m.querySelectorAll('[data-rl]').forEach(b=>b.onclick=()=>openLoad(+b.dataset.rl));
    m.querySelectorAll('[data-sg]').forEach(b=>b.onclick=()=>setStage(offers.find(o=>o.id===+b.dataset.sg.split('|')[0]),1));
    m.querySelectorAll('[data-ic]').forEach(b=>b.onclick=()=>setStage(incoming[+b.dataset.ic],3));
    m.querySelectorAll('[data-bp]').forEach(b=>b.onclick=()=>{const o=incoming[+b.dataset.bp];openProfile({uid:o.bidder,name:nm(o.bidder),lv:lvU(o.bidder)});});
    m.querySelectorAll('[data-bu]').forEach(b=>b.onclick=()=>blockUser(incoming[+b.dataset.bu].bidder));
    m.querySelectorAll('[data-rt]').forEach(b=>b.onclick=()=>openRate(offers.find(o=>o.id===+b.dataset.rt),'carrier'));
    m.querySelectorAll('[data-ir2]').forEach(b=>b.onclick=()=>openRate(incoming[+b.dataset.ir2],'owner'));
}

function renderRemoteJobs(m) {
    const s=nakgoJobs.state(),uid=nakgoAuth.snapshot().user?.id;
    const labels={wait:'Yanıt bekleniyor',ok:'Kabul edildi',no:'Reddedildi',withdrawn:'Geri çekildi'};
    const button=(r,action,label)=>`<button class="chip" data-job="${r.id}" data-job-action="${action}">${label}</button>`;
    const card=r=>{
        const l=r.listing_snapshot||{},owner=r.owner_id===uid,expired=r.status==='wait'&&Date.parse(r.expires_at)<=Date.now();
        let actions='';
        if(r.status==='wait'&&!expired)actions=owner?button(r,'accept','Kabul et')+button(r,'reject','Reddet'):button(r,'withdraw','Geri çek');
        if(r.status==='wait'&&expired&&!owner)actions=button(r,'withdraw','Geri çek');
        if(r.status==='ok'&&r.stage===0&&!owner)actions=button(r,'loaded','Yükledim');
        if(r.status==='ok'&&r.stage===1&&owner)actions=button(r,'confirm','Yüklemeyi onayla');
        return `<article class="load job-card">${routeTitle(l)}<div class="meta"><span>${esc(l.cargo)} · ${esc(l.ton)} ton</span><span class="st ${r.status==='ok'?'ok':r.status==='no'?'no':''}">${expired?'Süresi doldu':labels[r.status]||''}</span></div><p>${owner?'Taşıyıcı: '+esc(r.carrier_label):'Yük sahibi: '+esc(l.owner)}</p>${r.status==='ok'?stepper(r):''}${r.status==='ok'&&r.stage===1?'<p class="hint">Yük sahibinin onayı bekleniyor</p>':''}${r.stage===3?'<p class="st ok">Yükleme onaylandı</p>':''}<div class="job-actions">${actions}</div></article>`;
    };
    const incomingJobs=s.rows.filter(r=>r.owner_id===uid),outgoingJobs=s.rows.filter(r=>r.carrier_id===uid);
    m.innerHTML=screenHeading('İşlerim','Taşıma taleplerini takip et. Yüklediğini bildir, onayı burada gör.')+
        '<div class="chips"><button class="chip" id="jobs-refresh" '+(s.busy?'disabled':'')+'>İşleri yenile</button></div>'+
        (s.error?'<p role="alert">'+esc(s.error)+'</p>':'')+
        (s.busy&&!s.ready?'<p role="status">İşler yükleniyor…</p>':'')+
        (incomingJobs.length?'<h2 class="jobs-heading">Gelen taşıma talepleri</h2>'+incomingJobs.map(card).join(''):'')+
        (outgoingJobs.length?'<h2 class="jobs-heading">Taşıma taleplerim</h2>'+outgoingJobs.map(card).join(''):'')+
        (s.ready&&!s.rows.length?'<div class="empty">Henüz taşıma talebin yok. Yük ilanının detayından talep gönderebilirsin.</div>':'')+
        (s.more?'<button class="chip" id="jobs-more" '+(s.busy?'disabled':'')+'>Daha fazla iş yükle</button>':'');
    $('#jobs-refresh').onclick=()=>nakgoJobs.refresh();
    if(s.more)$('#jobs-more').onclick=()=>nakgoJobs.refresh(true);
    m.querySelectorAll('[data-job-action]').forEach(b=>b.onclick=async()=>{
        if(b.disabled)return;b.disabled=true;const account=nakgoMarket.token();
        try {const row=await nakgoJobs.transition(+b.dataset.job,b.dataset.jobAction);if(!row){b.disabled=false;return;}if(tab==='mine')render();toast('İş durumu kaydedildi');}
        catch(e){if(account===nakgoMarket.token()){b.disabled=false;toast('İşlem kaydedilemedi. İşleri yenileyip tekrar dene.');}}
    });
    if(!s.ready&&!s.busy&&!s.error)nakgoJobs.refresh();
}

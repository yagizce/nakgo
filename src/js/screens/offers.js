/**
 * İşlerim
 * Tutar içermeyen talepler ve iki aşamalı yükleme takibi.
 */
function renderOffers(m){
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

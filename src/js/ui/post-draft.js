/**
 * İlan taslağı ve adımları
 * Mevcut yayınlama işlevlerini ve kimliklerini koruyarak formu gruplar.
 */
let postStep = 0, postDrafts = null, postDraftSaved = true;
function getPostDrafts() {
    if (postDrafts) return postDrafts;
    if(nakgoMarket.active())return postDrafts={};
    try { const d=JSON.parse(localStorage.getItem("ng-post-drafts") || "{}"); postDrafts=isRecord(d)?d:{}; }
    catch (e) { postDrafts={}; }
    return postDrafts;
}
function persistPostDrafts() {
    if(nakgoMarket.active()){const status=$("#main .draft-state");if(status)status.textContent="Taslak bu oturumda tutuluyor";return true;}
    const previouslySaved = postDraftSaved;
    try { localStorage.setItem("ng-post-drafts", JSON.stringify(getPostDrafts())); postDraftSaved=true; }
    catch (e) {
        postDraftSaved=false;
        if (previouslySaved) toast("Taslak kaydedilemedi. Sayfayı kapatmadan depolama alanını kontrol et.");
    }
    const status = $("#main .draft-state");
    if (status) {
        status.textContent = postDraftSaved ? "Taslak kaydedildi" : "Taslak kaydedilemedi";
        status.dataset.saved = String(postDraftSaved);
    }
    return postDraftSaved;
}
function capturePostDraft() {
    if (tab !== "post" || !document.querySelectorAll) return;
    const fields = {};
    document.querySelectorAll('#main input[id], #main select[id], #main textarea[id]').forEach(e => fields[e.id] = e.value);
    const items = [...document.querySelectorAll('#its .itrow')].map(e => ({n:e.querySelector('[data-in]').value,q:e.querySelector('[data-iq]').value,u:e.querySelector('[data-iu]').value}));
    const drafts = getPostDrafts(); drafts[postMode] = {fields, items, image: postImg, step: postStep};
    return persistPostDrafts();
}
function clearPostDraft(kind=postMode) {
    const drafts=getPostDrafts(); delete drafts[kind];
    return persistPostDrafts();
}
function initPostWizard(m) {
    // Sahte DOM testi yerine gerçek DOM'da uygulanır.
    if (!m.insertAdjacentHTML) return;
    const savedDraft=getPostDrafts()[postMode], draft=isRecord(savedDraft)?savedDraft:null;
    postStep=draft ? Math.max(0,Math.min(2,+draft.step||0)) : 0;
    if (draft) {
        for(const id of ['f','t','v','w','bd','d','c','b','n']) { const value=isRecord(draft.fields)?draft.fields[id]:undefined; const e=m.querySelector('#'+id); if(e&&typeof value==='string'&&(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===value)))e.value=id==='d' && e.type==='date' && postDateOK(value) ? dateFields(value).date : value; }
        if(postMode==='load') {
            for(const item of (Array.isArray(draft.items)?draft.items:[]).filter(isRecord).slice(0,6)) { $('#addit').onclick(); const e=$('#its').lastElementChild; e.querySelector('[data-in]').value=typeof item.n==='string'?item.n:''; e.querySelector('[data-iq]').value=typeof item.q==='string'||Number.isFinite(item.q)?item.q:''; if(ITEM_UNITS.includes(item.u))e.querySelector('[data-iu]').value=item.u; }
            if(imgOk(draft.image)){postImg=draft.image;$('#phs').innerHTML=`<img class="th" src="${postImg}" alt="Taslak yük fotoğrafı">`;}
        }
    }
    const start1=postMode==='load'?$('#c').previousElementSibling:$('#v').closest('.row');
    const start2=postMode==='load'?$('#n').previousElementSibling:$('#d').previousElementSibling;
    const nodes=[...m.children].filter(e=>!e.classList.contains('seg'));
    const groups=[0,1,2].map(i=>{const s=document.createElement('section');s.className='form-section';s.dataset.step=i; m.appendChild(s);return s;});
    let step=0;for(const e of nodes){if(e===start1)step=1;if(e===start2)step=2;groups[step].appendChild(e);}
    m.insertAdjacentHTML('afterbegin',screenHeading('İlan oluştur',draft?'Taslağına devam ediyorsun.':'Güzergâhı seç, bilgileri ekle ve yayınla.')+demoNotice()+`<ol class="form-steps"><li>1 · Güzergâh</li><li>2 · ${postMode==='load'?'Yük ve taşıma':'Araç'}</li><li>3 · ${postMode==='load'?'Not ve ekler':'Müsaitlik'}</li></ol>`);
    m.insertAdjacentHTML('beforeend','<div class="form-dock"><button class="chip" id="post-prev">Geri</button><span class="draft-state" role="status">Taslak kaydediliyor…</span><button class="btn" id="post-next">Devam →</button></div>');
    m.querySelector('.form-dock').appendChild($('#go'));
    const show=()=>{groups.forEach((e,i)=>e.hidden=i!==postStep);m.querySelectorAll('.form-steps li').forEach((e,i)=>e.setAttribute('aria-current',i===postStep?'step':'false'));$('#post-prev').hidden=postStep===0;$('#post-next').hidden=postStep===2;$('#go').hidden=postStep!==2;m.scrollTop=0;capturePostDraft();};
    $('#post-prev').onclick=()=>{postStep--;show();};
    $('#post-next').onclick=()=>{
        const error=postError(postValues(),postMode==='truck',postStep);
        if(error)return toast(error);
        postStep++;show();
    };
    m.oninput=capturePostDraft;m.onchange=capturePostDraft;
    m.querySelectorAll('input[id],select[id],textarea[id]').forEach(e=>{const label=e.previousElementSibling;if(label&&label.tagName==='LABEL')label.htmlFor=e.id;});
    show();
}

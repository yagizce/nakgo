/**
 * İlan taslağı ve adımları
 * Mevcut yayınlama işlevlerini ve kimliklerini koruyarak formu gruplar.
 */
let postStep = 0;
function getPostDrafts() {
    try { return JSON.parse(localStorage.getItem("ng-post-drafts") || "{}"); } catch (e) { return {}; }
}
function capturePostDraft() {
    if (tab !== "post" || !document.querySelectorAll) return;
    const fields = {};
    document.querySelectorAll('#main input[id], #main select[id], #main textarea[id]').forEach(e => fields[e.id] = e.value);
    const items = [...document.querySelectorAll('#its .itrow')].map(e => ({n:e.querySelector('[data-in]').value,q:e.querySelector('[data-iq]').value,u:e.querySelector('[data-iu]').value}));
    const drafts = getPostDrafts(); drafts[postMode] = {fields, items, image: postImg, step: postStep};
    try { localStorage.setItem("ng-post-drafts", JSON.stringify(drafts)); } catch (e) { toast("Taslak için cihazda yer kalmadı"); }
}
function clearPostDraft() {
    const drafts=getPostDrafts(); delete drafts[postMode];
    try { localStorage.setItem("ng-post-drafts",JSON.stringify(drafts)); } catch(e) { }
}
function initPostWizard(m) {
    // Sahte DOM testi yerine gerçek DOM'da uygulanır.
    if (!m.insertAdjacentHTML) return;
    const draft=getPostDrafts()[postMode];
    postStep=draft ? Math.max(0,Math.min(2,+draft.step||0)) : 0;
    if (draft) {
        for(const [id,value] of Object.entries(draft.fields||{})) { const e=m.querySelector('#'+id); if(e)e.value=value; }
        if(postMode==='load') {
            for(const item of (draft.items||[]).slice(0,6)) { $('#addit').onclick(); const e=$('#its').lastElementChild; e.querySelector('[data-in]').value=item.n; e.querySelector('[data-iq]').value=item.q; e.querySelector('[data-iu]').value=item.u; }
            if(imgOk(draft.image)){postImg=draft.image;$('#phs').innerHTML=`<img class="th" src="${postImg}" alt="Taslak yük fotoğrafı">`;}
        }
    }
    const start1=postMode==='load'?$('#c').previousElementSibling:$('#v').closest('.row');
    const start2=postMode==='load'?$('#n').previousElementSibling:$('#d').previousElementSibling;
    const nodes=[...m.children].filter(e=>!e.classList.contains('seg'));
    const groups=[0,1,2].map(i=>{const s=document.createElement('section');s.className='form-section';s.dataset.step=i; m.appendChild(s);return s;});
    let step=0;for(const e of nodes){if(e===start1)step=1;if(e===start2)step=2;groups[step].appendChild(e);}
    m.insertAdjacentHTML('afterbegin',screenHeading('İlan oluştur',draft?'Kaydedilmiş taslağına devam ediyorsun.':'Güzergâhı seç, bilgileri ekle ve yayınla.')+demoNotice()+`<ol class="form-steps"><li>1 · Güzergâh</li><li>2 · ${postMode==='load'?'Yük ve taşıma':'Araç'}</li><li>3 · ${postMode==='load'?'Not ve ekler':'Müsaitlik'}</li></ol>`);
    m.insertAdjacentHTML('beforeend','<div class="form-dock"><button class="chip" id="post-prev">Geri</button><span class="draft-state" role="status">Taslak cihazında korunur</span><button class="btn" id="post-next">Devam →</button></div>');
    m.querySelector('.form-dock').appendChild($('#go'));
    const show=()=>{groups.forEach((e,i)=>e.hidden=i!==postStep);m.querySelectorAll('.form-steps li').forEach((e,i)=>e.setAttribute('aria-current',i===postStep?'step':'false'));$('#post-prev').hidden=postStep===0;$('#post-next').hidden=postStep===2;$('#go').hidden=postStep!==2;m.scrollTop=0;capturePostDraft();};
    $('#post-prev').onclick=()=>{postStep--;show();};
    $('#post-next').onclick=()=>{
        if(postStep===0&&$('#f').value===$('#t').value)return toast('Çıkış ve varış şehri farklı olmalı');
        if(postStep===1&&(!(+$('#w').value>0)||(postMode==='load'&&!$('#c').value.trim())))return toast('Yük bilgilerini ve pozitif tonajı gir');
        postStep++;show();
    };
    m.oninput=capturePostDraft;m.onchange=capturePostDraft;
    m.querySelectorAll('input[id],select[id],textarea[id]').forEach(e=>{const label=e.previousElementSibling;if(label&&label.tagName==='LABEL')label.htmlFor=e.id;});
    show();
}

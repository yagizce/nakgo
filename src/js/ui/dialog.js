/**
 * Pencere ve gezinti
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function closeSheet() {
    roadMapDispose(true);
    if (unChat) {
        unChat();
        unChat = null;
    }
    $("#sheetBody").dataset.k = "";
    $("#sheet").classList.remove("open");
}

function setNav() {
    document.querySelectorAll("nav button").forEach(button => {
        const selected=button.dataset.t===tab;
        button.classList.toggle("on",selected);
        if(selected)button.setAttribute("aria-current","page");
        else button.removeAttribute("aria-current");
    });
}

function initDialogAccessibility() {
    try {
        const sheet=$("#sheet"),body=$("#sheetBody");
        const background=[$('#main'),$('#nav'),document.querySelector('header')];
        let previousFocus=null,wasOpen=false;
        new MutationObserver(()=>{
            const open=sheet.classList.contains('open');
            if(open&&!wasOpen)previousFocus=document.activeElement;
            background.forEach(element=>{if(element)element.inert=open;});
            if(open) {
                body.setAttribute('aria-label',body.querySelector('.detail-top>b,.detail-top>span,h2')?.textContent||'NakGo penceresi');
                body.setAttribute('tabindex','-1');
                // İçerik değiştirilince eski odak DOM'dan çıkar; mobil klavyeyi açmadan güvenli düğmeye dön.
                if(!body.contains(document.activeElement)) (body.querySelector('#map-back,#close,#cx,button')||body).focus();
            } else if(wasOpen) {
                const target=previousFocus?.isConnected?previousFocus:
                    previousFocus?.id?document.getElementById(previousFocus.id):null;
                target?.focus({preventScroll:true});
            }
            wasOpen=open;
        }).observe(sheet,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
        document.addEventListener('keydown',event=>{
            if(event.key!=='Tab'||!sheet.classList.contains('open'))return;
            const items=[...body.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex="0"]')]
                .filter(element=>element.getClientRects().length&&!element.disabled);
            if(!items.length) {event.preventDefault();body.focus();return;}
            const first=items[0],last=items.at(-1);
            if(event.shiftKey&&(document.activeElement===first||document.activeElement===body)) {
                event.preventDefault();last.focus();
            } else if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
        });
    } catch(e) { }
}

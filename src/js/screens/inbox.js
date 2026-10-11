/**
 * Mesaj geçmişi ekranı
 * Görüşme seçimi; sohbet erişimi mevcut Premium kuralını kullanır.
 */

function inboxEntries() {
    const entries=new Map();
    [...offers,...incoming].forEach(offer=>{
        const mine=offer.bidder===me||(!cloud&&offers.includes(offer));
        const who=mine?(offer.owner||nm(offer.ownerUid)):nm(offer.bidder);
        const uid=mine?offer.ownerUid:offer.bidder;
        if(uid&&blocked.includes(uid))return;
        const key='o'+offer.loadId+'_'+offer.bidder;
        entries.set(key,{k:key,who,route:offer.from+' → '+offer.to});
    });
    Object.keys(chats).forEach(key=>{
        if(entries.has(key)||!chats[key].some(message=>message.me))return;
        const truck=trucks.find(item=>'t'+item.id===key);
        const load=loads.find(item=>key==='o'+item.id+'_'+me||key==='o'+item.id+'_');
        if((truck?.uid&&blocked.includes(truck.uid))||(load?.uid&&blocked.includes(load.uid)))return;
        entries.set(key,{
            k:key,
            who:truck?(truck.who||nm(truck.uid)):load?(load.owner||nm(load.uid)):'Görüşme',
            route:truck?truck.from+' → '+truck.to:load?load.from+' → '+load.to:'Kaydedilmiş sohbet'
        });
    });
    return [...entries.values()];
}

function openInbox() {
    const entries=inboxEntries(),body=$('#sheetBody');
    body.dataset.k='';
    body.innerHTML=`<div class="load-detail">
        <div class="detail-top"><b>Mesajlar</b><button class="chip detail-close" id="close">Kapat ×</button></div>
        <div class="detail-scroll">${entries.map((entry,index)=>`<button class="conversation" data-conv="${index}">
            <b>${entry.who}</b><span>${entry.route}</span>
            <small>${esc((chats[entry.k]||[]).slice(-1)[0]?.t||'Görüşmeyi aç')}</small>
        </button>`).join('')||'<div class="empty">Henüz görüşmen yok. İlan detayındaki Mesaj gönder düğmesinden başlayabilirsin.</div>'}</div>
    </div>`;
    body.querySelectorAll('[data-conv]').forEach(button=>button.onclick=()=>{
        const entry=entries[+button.dataset.conv];
        openChat(entry.k,entry.who);
    });
    $('#close').onclick=closeSheet;
    syncDetailViewport();$('#sheet').classList.add('open');
}

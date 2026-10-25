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
    if(nakgoMarket.active())return nakgoMessages.openInbox();
    const entries=inboxEntries(),body=$('#sheetBody');
    body.dataset.k='';
    body.innerHTML=`<div class="load-detail">
        <div class="detail-top"><b>Mesajlar</b><button class="chip detail-close" id="close">Kapat ×</button></div>
        <div class="detail-scroll">${entries.map((entry,index)=>`<button class="conversation" data-conv="${index}">
            <b>${esc(entry.who)}</b><span>${esc(entry.route)}</span>
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

// The account path uses Supabase conversations; demo inbox behavior is kept above.
function paintAccountMessages() {
    const s=nakgoMessages.state(),B=$('#sheetBody'),account=nakgoAuth.snapshot().user?.id;
    if(B.dataset.k==='account-inbox') {
        B.innerHTML='<div class="load-detail"><div class="detail-top"><b>Mesajlar</b><button class="chip detail-close" id="close">Kapat ×</button></div><div class="detail-scroll"><p class="estimate-note">Test ortamı · Görüşmeler hesabında saklanır.</p>'+
        (s.inboxError?'<p role="alert">'+esc(s.inboxError)+'</p>':'')+'<button class="chip" id="messages-refresh" '+(s.inboxBusy?'disabled':'')+'>Görüşmeleri yenile</button>'+
        (!s.inboxReady&&!s.inboxError?'<p role="status">Görüşmeler yükleniyor…</p>':'')+
        s.conversations.map((c,i)=>'<button class="conversation" data-account-conv="'+i+'"><b>'+esc(c.owner_id===account?c.guest_label:c.owner_label)+'</b><span>'+esc(c.from_city)+' → '+esc(c.to_city)+'</span><small>'+esc(c.last_message_body||'Henüz mesaj yok')+'</small>'+(c.unread_count?'<span>'+esc(c.unread_count)+' okunmamış</span>':'')+'</button>').join('')+
        (s.inboxReady&&!s.conversations.length?'<div class="empty">Henüz görüşmen yok. Bir ilan üzerinden başlayabilirsin.</div>':'')+
        (s.inboxMore?'<button class="chip" id="messages-more" '+(s.inboxBusy?'disabled':'')+'>Daha fazla görüşme</button>':'')+'</div></div>';
        $('#close').onclick=closeSheet;$('#messages-refresh').onclick=()=>{nakgoMessages.refreshInbox();nakgoMessages.refreshSummary();};
        B.querySelectorAll('[data-account-conv]').forEach(b=>b.onclick=()=>nakgoMessages.openConversation(s.conversations[+b.dataset.accountConv]));
        if($('#messages-more'))$('#messages-more').onclick=()=>nakgoMessages.refreshInbox(true);
        return;
    }
    if(!s.current||B.dataset.k!=='account-chat:'+s.current.id)return;
    const c=s.current;
    if(B.dataset.renderedConversation!==String(c.id)||!B.querySelector('#account-message-input')) {
        B.dataset.renderedConversation=String(c.id);
        B.innerHTML='<div class="load-detail chat-detail"><div class="detail-top"><b>'+esc(c.owner_id===account?c.guest_label:c.owner_label)+'</b><button class="chip detail-close" id="close" aria-label="Sohbeti kapat">Kapat ×</button></div><p class="estimate-note">'+esc(c.from_city)+' → '+esc(c.to_city)+' · Hesabında saklanan görüşme</p><div class="chips"><button class="chip" id="messages-back">Görüşmeler</button><button class="chip" id="messages-refresh">Yenile</button><button class="chip" id="message-older">Önceki mesajlar</button></div><p id="message-status" role="status"></p><div id="msgs" role="log" aria-live="polite" aria-label="Mesajlar"></div><p id="message-send-error" role="alert"></p><div class="chat-composer"><label class="sr-only" for="account-message-input">Mesajın</label><input id="account-message-input" placeholder="Mesaj yaz" maxlength="500"><button class="btn" id="account-message-send">Gönder</button></div></div>';
        $('#close').onclick=closeSheet;$('#messages-back').onclick=()=>nakgoMessages.openInbox();
        $('#messages-refresh').onclick=()=>nakgoMessages.refreshMessages();$('#message-older').onclick=()=>nakgoMessages.refreshMessages(true);
        const input=$('#account-message-input'),sendButton=$('#account-message-send');input.value=s.draft;input.oninput=()=>{nakgoMessages.saveDraft(input.value);$('#message-send-error').textContent=nakgoMessages.state().draftWarning;};$('#msgs').onscroll=()=>nakgoMessages.acknowledge();
        const submit=async()=>{const body=input.value;if(!body.trim())return;try{const row=await nakgoMessages.send(body);if(row&&$('#account-message-input')===input&&input.value===body)input.value='';}catch(e){/* Server-confirmed errors are rendered with the preserved draft. */}};
        sendButton.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();submit();}};
    }
    const log=$('#msgs'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<40,oldHeight=log.scrollHeight,oldTop=log.scrollTop;
    const first=s.messages[0]?.id||0,signature=s.messages.map(m=>m.id).join(',');
    if(log.dataset.signature!==signature){
        const prepended=+log.dataset.first>first&&first>0;
        log.innerHTML=s.messages.map(m=>'<div class="bub '+(m.sender_id===account?'me':'')+'">'+esc(m.body)+'</div>').join('');
        log.dataset.signature=signature;log.dataset.first=String(first);
        if(prepended)log.scrollTop=oldTop+log.scrollHeight-oldHeight;else if(bottom||!oldHeight)log.scrollTop=log.scrollHeight;else log.scrollTop=oldTop;
    }
    $('#message-status').textContent=s.messageError||(!s.messageReady?'Mesajlar yükleniyor…':'');
    $('#message-send-error').textContent=s.sendError||s.draftWarning;
    $('#message-older').hidden=!s.messageMore;$('#message-older').disabled=s.messageBusy||s.sending;
    $('#messages-refresh').disabled=s.messageBusy||s.sending;
    $('#account-message-send').disabled=s.sending||!s.messageReady;$('#account-message-input').disabled=s.sending;
}

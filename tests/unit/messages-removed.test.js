// Hesap mesajlaşması kaldırıldı: uygulama mesaj sunucusuna istek göndermez, okunmamış mesaj sayısını sormaz.
module.exports = ({run,fs,path,ROOT}) => {
    run('Hesap mesajlaşması sunucuya istek göndermez',(r,ok)=>{
        const src=['src/js/cloud.js','src/js/screens/inbox.js','src/js/screens/details.js','src/js/screens/main.js'].map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n');
        ok(!/nakgo_(open_conversation|send_message|read_conversation|message_unread_count)|message_inbox|conversation_messages/.test(src),'mesaj RPC ve tablo çağrıları yok');
        ok(!src.includes('mesaj göndermek')&&(src.match(/WhatsApp\\'tan iletişim kurmak/g)||[]).length===2,'misafir metinleri WhatsApp iletişimini anlatır');
        ok(r("return typeof nakgoMessages==='undefined'&&['listConversations','listMessages','openConversation','sendMessage','readConversation','unreadMessages'].every(n=>!(n in nakgoAuth))"),'mesaj modülü ve API yok');
        r("nakgoMarket.sync({marketplace:true,user:{id:'a'},profile:{display_name:'A'}});tab='me';render()");
        ok(r('return true'),'profil sekmesi mesaj sorgusu olmadan açılır');
    });
};

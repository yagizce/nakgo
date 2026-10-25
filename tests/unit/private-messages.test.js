module.exports=({run})=>{
 const setup='nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"A"}});nakgoAuth.unreadMessages=async()=>0;nakgoAuth.readConversation=async()=>1;window.crypto={randomUUID:()=>"00000000-0000-4000-8000-000000000001"};';
 const convo='({id:7,owner_id:"owner",guest_id:"a",owner_label:"Owner",guest_label:"A",from_city:"İstanbul",to_city:"Ankara"})';
 run('Private messages confirm sends, reuse retry nonce and never enter demo storage',async(r,ok)=>{
  const store=r('return localStorage.getItem("yy2")');r(setup+'nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation('+convo+');');
  await r('return Promise.resolve()');await r('return Promise.resolve()');
  r('window.requests=[];nakgoAuth.sendMessage=async(id,body,nonce)=>{window.requests.push(nonce);throw Error("network");};');
  let failed=false;try{await r('return nakgoMessages.send("Hello")');}catch{failed=true;}
  ok(failed&&r('return nakgoMessages.state().messages.length===0&&!!nakgoMessages.state().sendError'),'failed send never claims success or loses retry state');
  r('nakgoAuth.sendMessage=(id,body,nonce)=>{window.requests.push(nonce);return new Promise(done=>window.finishSend=()=>done({id:19,conversation_id:id,sender_id:"a",client_nonce:nonce,body}));};');
  const pending=r('return nakgoMessages.send("Hello")');const duplicate=await r('return nakgoMessages.send("Hello")');ok(duplicate===null&&r('return window.requests.length===2'),'double clicks do not issue a second write');
  r('window.finishSend();');await pending;
  ok(r('return window.requests[0]===window.requests[1]&&nakgoMessages.state().messages[0].body==="Hello"'),'retry uses the same nonce and server-confirmed row');
  ok(r('return localStorage.getItem("yy2")')===store&&r('return Object.keys(chats).length===0'),'private chat never writes demo persistence');
 },{win:{}});
 run('Late private message reads and sends cannot enter another account',async(r,ok)=>{
  r(setup+'nakgoAuth.listMessages=()=>new Promise(done=>window.finishRead=done);nakgoMessages.openConversation('+convo+');');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"b"},profile:{}});window.finishRead([{id:99,body:"Private A"}]);');
  await r('return Promise.resolve()');await r('return Promise.resolve()');ok(r('return !nakgoMessages.state().current&&nakgoMessages.state().messages.length===0'),'late read is discarded after reset');
  r('nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation({...'+convo+',guest_id:"b"});');await r('return Promise.resolve()');
  r('nakgoAuth.sendMessage=(id,body,nonce)=>new Promise(done=>window.finishWrite=()=>done({id:1,conversation_id:id,sender_id:"b",client_nonce:nonce,body}));');const pending=r('return nakgoMessages.send("Private B")');
  r('nakgoMarket.sync({marketplace:true,user:null});window.finishWrite();');let failed=false;try{await pending;}catch{failed=true;}ok(failed&&r('return !nakgoMessages.state().current&&!nakgoMessages.state().messages.length'),'late send cannot reopen or populate signed-out state');
 },{win:{}});
 run('Private message history paginates, escapes text and preserves errors',async(r,ok)=>{
  r(setup+'window.cursors=[];nakgoAuth.listMessages=async(id,before)=>{window.cursors.push(before);return before===null?Array.from({length:50},(_,i)=>({id:100-i,body:i?"Message":"<img src=x onerror=alert(1)>",sender_id:"owner"})):[{id:50,body:"Older",sender_id:"owner"}];};nakgoMessages.openConversation('+convo+');');
  await r('return Promise.resolve()');await r('return Promise.resolve()');await r('return nakgoMessages.refreshMessages(true)');
  ok(r('return nakgoMessages.state().messages.length===51&&window.cursors[1]===51&&!nakgoMessages.state().messageMore'),'history uses the oldest displayed ID and retains prior messages');
  ok(r('return el("#msgs").innerHTML.includes("&lt;img")&&!el("#msgs").innerHTML.includes("<img")'),'message text is escaped before rendering');
  r('nakgoAuth.listMessages=async()=>{throw Error("offline");};');await r('return nakgoMessages.refreshMessages()');ok(r('return nakgoMessages.state().messages.length===51&&!!nakgoMessages.state().messageError'),'failed refresh preserves existing history and shows retry');
 },{win:{}});
};

module.exports=({run,test,boot})=>{
 const setup='nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{display_name:"A"}});nakgoAuth.unreadMessages=async()=>0;nakgoAuth.readConversation=async()=>1;window.crypto={randomUUID:()=>"00000000-0000-4000-8000-000000000001"};';
 const convo='({id:7,owner_id:"owner",guest_id:"a",owner_label:"Owner",guest_label:"A",from_city:"İstanbul",to_city:"Ankara"})';
 const settle=async r=>{for(let i=0;i<8;i++)await r('return Promise.resolve()');};
 const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};};
 run('Read receipts require visible latest messages and are not rewritten on every poll',async(r,ok)=>{
  r(setup+'window.reads=[];nakgoAuth.readConversation=async(id,through)=>window.reads.push(through);nakgoAuth.listMessages=async()=>[{id:20,body:"New",sender_id:"owner"}];document.visibilityState="visible";el("#msgs").clientHeight=100;el("#msgs").scrollHeight=1000;el("#msgs").scrollTop=50;nakgoMessages.openConversation('+convo+');');await settle(r);
  ok(r('return window.reads.length===0'),'reading older history does not mark the unseen latest message read');
  r('el("#msgs").scrollTop=900;');await r('return nakgoMessages.acknowledge()');await r('return nakgoMessages.acknowledge()');
  ok(r('return JSON.stringify(window.reads)==="[20]"'),'bottom visibility acknowledges once and repeated calls do not write');
  r('document.visibilityState="hidden";nakgoAuth.listMessages=async()=>[{id:21,body:"Another",sender_id:"owner"},{id:20,body:"New",sender_id:"owner"}];');await r('return nakgoMessages.refreshMessages()');
  ok(r('return window.reads.length===1'),'background tab does not acknowledge a new message');
  r('document.visibilityState="visible";');await r('return nakgoMessages.acknowledge()');ok(r('return JSON.stringify(window.reads)==="[20,21]"'),'returning to visible latest messages advances the boundary');
 },{win:{}});
 test('Ambiguous send retry survives conversation changes and a page reload with the same nonce',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]),win={sessionStorage:storage()},r=boot({win});
  r(setup+'nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation('+convo+');');await settle(r);
  const server=new Map();let attempts=[];
  win.send=async(id,body,nonce)=>{attempts.push(nonce);if(!server.has(nonce))server.set(nonce,{id:50,conversation_id:id,body,client_nonce:nonce,sender_id:'a'});throw Error('Reply lost after commit');};
  r('nakgoAuth.sendMessage=(...args)=>window.send(...args);');try{await r('return nakgoMessages.send("Persisted draft")');}catch{}
  r('closeSheet();nakgoMessages.openInbox();nakgoMessages.openConversation('+convo+');');await settle(r);
  ok(r('return nakgoMessages.state().draft==="Persisted draft"'),'leaving and reopening a conversation preserves the pending draft');
  const next=boot({win});next(setup+'nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation('+convo+');');await settle(next);
  ok(next('return nakgoMessages.state().draft==="Persisted draft"'),'same-account page reload restores only its session draft');
  win.send=async(id,body,nonce)=>{attempts.push(nonce);return server.get(nonce);};next('nakgoAuth.sendMessage=(...args)=>window.send(...args);');await next('return nakgoMessages.send("Persisted draft")');
  ok(server.size===1&&attempts[0]===attempts[1],'explicit retry after reload uses the original nonce and cannot duplicate the committed row');
  ok(next('return nakgoMessages.state().draft===""'),'confirmed success clears the draft journal');
  return out;
 });
 run('Failed draft storage prevents sending and account changes clear private draft state',async(r,ok)=>{
  r(setup+'nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation('+convo+');');await settle(r);
  r('window.writes=0;window.sessionStorage={getItem:()=>null,setItem:()=>{throw Error("quota");},removeItem(){}};nakgoAuth.sendMessage=async()=>{window.writes++;};');
  let failed=false;try{await r('return nakgoMessages.send("Do not lose me")');}catch{failed=true;}
  ok(failed&&r('return window.writes===0&&nakgoMessages.state().draft==="Do not lose me"&&!!nakgoMessages.state().sendError'),'storage failure keeps the text and issues no ambiguous network write');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"b"},profile:{}});');ok(r('return !nakgoMessages.state().current&&nakgoMessages.state().draft===""'),'private draft never enters the next account');
 },{win:{}});
 test('Polling backs off after failures and cannot restart after closing a pending read',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]),tasks=new Map();let seq=0;
  const win={setTimeout:(fn,ms)=>{tasks.set(++seq,{fn,ms});return seq;},clearTimeout:id=>tasks.delete(id)},r=boot({win});
  r(setup+'nakgoAuth.listMessages=async()=>[];nakgoMessages.openConversation('+convo+');');await settle(r);
  const take=()=>{const [id,t]=[...tasks][0];tasks.delete(id);return t;};
  ok([...tasks.values()][0].ms===8000,'healthy visible conversation polls at the normal interval');
  r('nakgoAuth.listMessages=async()=>{throw Error("offline");};');await take().fn();ok([...tasks.values()][0].ms===16000,'first failure backs off');
  await take().fn();ok([...tasks.values()][0].ms===32000,'continued failure increases the delay');
  r('nakgoAuth.listMessages=()=>new Promise(done=>window.finishRead=done);');const running=take().fn();r('closeSheet();window.finishRead([]);');await running;
  ok(tasks.size===0,'completion of an old request cannot resurrect a closed polling loop');return out;
 });
 run('History rendering preserves scroll position and does not rebuild unchanged message nodes',async(r,ok)=>{
  r(setup+'nakgoAuth.listMessages=async()=>[{id:20,body:"Latest",sender_id:"owner"}];nakgoMessages.openConversation('+convo+');');await settle(r);
  r('el("#msgs").clientHeight=100;el("#msgs").scrollHeight=1000;el("#msgs").scrollTop=70;el("#msgs").innerHTML="selection sentinel";paintAccountMessages();');
  ok(r('return el("#msgs").innerHTML==="selection sentinel"&&el("#msgs").scrollTop===70'),'unchanged polls retain DOM selection and scroll anchor');
  r('nakgoAuth.listMessages=async()=>[{id:21,body:"Arrived",sender_id:"owner"},{id:20,body:"Latest",sender_id:"owner"}];');await r('return nakgoMessages.refreshMessages()');ok(r('return el("#msgs").scrollTop===70'),'new arrivals do not move a user reading older messages');
 },{win:{}});
};

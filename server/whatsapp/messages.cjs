'use strict';
const {normalizePhone,parseLoad,validateDraft,fingerprint,MAX_TEXT}=require('./parser.cjs');
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function normalizeMessages(payload){
  const found=new Map();
  if(!record(payload)||payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return [];
  for(const entry of payload.entry.slice(0,100)){
    if(!record(entry)||!Array.isArray(entry.changes))continue;
    for(const change of entry.changes.slice(0,100)){
      if(!record(change)||change.field!=='messages'||!record(change.value)||!Array.isArray(change.value.messages))continue;
      for(const message of change.value.messages.slice(0,100)){
        if(!record(message)||message.type!=='text'||!record(message.text)||typeof message.text.body!=='string'||message.text.body.length>MAX_TEXT||!message.text.body.trim())continue;
        const fromPhone=normalizePhone(message.from),id=message.id;
        const timestamp=typeof message.timestamp==='string'&&/^\d{1,12}$/.test(message.timestamp)?Number(message.timestamp):null;
        if(!fromPhone||typeof id!=='string'||!id.trim()||id.length>256||/[\u0000-\u001f]/.test(id)||!Number.isSafeInteger(timestamp)||timestamp<=0)continue;
        if(!found.has(id))found.set(id,{messageId:id,fromPhone,timestamp,text:message.text.body});
      }
    }
  }
  return [...found.values()];
}
function prepareDrafts(payload){
  return normalizeMessages(payload).map(message=>{
    const draft=parseLoad(message.text);
    return {message,draft,validation:validateDraft(draft),idempotencyKey:'whatsapp:'+message.messageId,fingerprint:fingerprint(message.fromPhone,draft)};
  });
}
module.exports={normalizeMessages,prepareDrafts};

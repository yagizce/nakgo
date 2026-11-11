import webhook from '../../server/whatsapp/webhook.cjs';
import store from '../../server/whatsapp/store.cjs';
import worker from '../../server/whatsapp/worker.cjs';
// Web Request/Response ham gövdeyi korur. Production'a unsigned mock seçeneği verilmez.
// Mesaj önce kalıcı kuyruğa yazılır; taslak çıkarma hemen denenir, hata olursa worker tekrar dener.
const handle=webhook.createWebhook({ingest:async messages=>{
  const s=store.createStore();
  await s.enqueue(messages);
  try{await worker.processBatch(s,5);}catch{}
}});
export const GET=handle;
export const POST=handle;

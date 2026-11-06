import webhook from '../../server/whatsapp/webhook.cjs';
import store from '../../server/whatsapp/store.cjs';
// Web Request/Response ham gÃ¶vdeyi korur. Production'a unsigned mock seÃ§eneÄŸi verilmez.
const handle=webhook.createWebhook({ingest:messages=>store.createStore().enqueue(messages)});
export const GET=handle;
export const POST=handle;

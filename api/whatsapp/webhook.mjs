import webhook from '../../server/whatsapp/webhook.cjs';
// Web Request/Response ham gövdeyi korur. Production'a unsigned mock seçeneği verilmez.
const handle=webhook.createWebhook();
export const GET=handle;
export const POST=handle;

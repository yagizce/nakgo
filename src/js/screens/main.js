/**
 * Ekran yönlendiricisi
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function render() {
 const m = $("#main"); bell();
 m.dataset.screen = tab;
 if(tab === "list") renderListings(m);
 else if(tab === "post") renderPost(m);
 else if(tab === "mine") renderOffers(m);
 else if(tab === "me") renderProfile(m);
 if(storageNotice && m.insertAdjacentHTML) m.insertAdjacentHTML("afterbegin",`<p class="demo-note" role="status">${esc(storageNotice)}</p>`);
}

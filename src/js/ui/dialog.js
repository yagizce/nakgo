/**
 * Pencere ve gezinti
 * Klasik uygulama kapsamında yüklenir; sıra tools/project.js içinde tanımlıdır.
 */

function closeSheet() {
    roadMapDispose(true);
    if (unChat) {
        unChat();
        unChat = null;
    }
    $("#sheetBody").dataset.k = "";
    $("#sheet").classList.remove("open");
}

function setNav() {
    document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
}

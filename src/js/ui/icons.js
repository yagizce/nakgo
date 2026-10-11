/**
 * Ortak arayüz simgeleri
 * Sabit SVG çizimleri; metin etiketleri düğmelerin erişilebilir adını sağlar.
 */

function uiIcon(name) {
    const paths={
        plus:'<path d="M12 5v14M5 12h14"/>',
        minus:'<path d="M5 12h14"/>',
        fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
        back:'<path d="m14 6-6 6 6 6"/>',
        arrow:'<path d="m10 6 6 6-6 6"/>',
        map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
        message:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8m-8 4h5"/>',
        heart:'<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C0 9 5 15 12 21c7-6 12-12 8-16Z"/>',
        fuel:'<path d="M4 21V4h10v17M2 21h14M6 7h6v5H6V7Zm8 7h2v4a2 2 0 0 0 4 0V8l-3-3m1 1-2 2 3 3"/>',
        phone:'<path d="m5 3 4 1 1 5-3 2a15 15 0 0 0 6 6l2-3 5 1 1 4c-2 6-10 1-14-3S0 5 5 3Z"/>'
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths.map}</svg>`;
}

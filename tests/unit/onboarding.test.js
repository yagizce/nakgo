/* Additional tests, discovered by the existing npm test runner. */
// İlk açılış tanıtımı güncel ürünü anlatır ve tüm adımlarda gezilebilir.
module.exports = ({run,fs,path,ROOT}) => {
    run('Tanıtım güncel özellikleri anlatır, geri ve atla çalışır',(r,ok)=>{
        const text=r('return SL.map(x=>x.join(" ")).join(" ")');
        ok(!/rozet|puan|belgeli|onaylı/i.test(text)&&text.includes('WhatsApp'),'kaldırılan özellikler tanıtımda yok');
        r('openOnb()');ok(r('return el("#onb").innerHTML').includes('1 / 3'),'ilk adım');
        r('el("#ob-next").onclick();el("#ob-next").onclick()');ok(r('return el("#onb").innerHTML').includes('3 / 3')&&r('return el("#onb").innerHTML').includes('>Başlayalım<'),'son adımda başlama düğmesi');
        r('el("#ob-back").onclick()');ok(r('return el("#onb").innerHTML').includes('2 / 3'),'geri düğmesi bir adım döner');
        r('el("#ob-skip").onclick()');ok(!!r('return el("#r-c")&&el("#r-o")')&&/id="onb" role="dialog" aria-modal="true" aria-labelledby="ob-title"/.test(fs.readFileSync(path.join(ROOT,'src/index.template.html'),'utf8')),'atla rol seçimine gider; tanıtım erişilebilir pencere');
        r('el("#r-c").onclick()');
    });
};

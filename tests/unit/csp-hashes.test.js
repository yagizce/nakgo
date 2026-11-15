/* CSP: satır içi betiklere 'unsafe-inline' yerine içerik özetiyle izin verilir; özetler index.html ile eşleşir. */
module.exports = ({test,fs,path,ROOT}) => {
    test('CSP betik özetleri index.html ile eşleşir',()=>{
        const {scriptSrc}=require(path.join(ROOT,'tools/bundle.js'));
        const csp=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8')).headers.flatMap(r=>r.headers).find(h=>h.key==='Content-Security-Policy').value;
        const script=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('script-src '));
        const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
        return [[!script.includes("'unsafe-inline'"),"script-src içinde 'unsafe-inline' yok"],
            [script===scriptSrc(html),'script-src özetleri index.html satır içi betikleriyle aynı'],
            [(script.match(/'sha256-/g)||[]).length===2,'iki satır içi betiğin ikisi de özetli']];
    });
};

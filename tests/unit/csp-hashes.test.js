/* CSP: satır içi betik ve stillere 'unsafe-inline' yerine içerik özetiyle izin verilir; özetler index.html ile eşleşir. */
module.exports = ({test,fs,path,ROOT}) => {
    test('CSP betik ve stil özetleri index.html ile eşleşir',()=>{
        const {scriptSrc,styleSrc}=require(path.join(ROOT,'tools/bundle.js'));
        const csp=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8')).headers.flatMap(r=>r.headers).find(h=>h.key==='Content-Security-Policy').value;
        const part=name=>csp.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+' '));
        const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
        return [[!part('script-src').includes("'unsafe-inline'"),"script-src içinde 'unsafe-inline' yok"],
            [part('script-src')===scriptSrc(html),'script-src özetleri index.html satır içi betikleriyle aynı'],
            [(part('script-src').match(/'sha256-/g)||[]).length===2,'iki satır içi betiğin ikisi de özetli'],
            [!part('style-src').includes("'unsafe-inline'"),"style-src içinde 'unsafe-inline' yok"],
            [part('style-src')===styleSrc(html),'style-src özeti index.html satır içi stiliyle aynı']];
    });
    test('Kaynakta satır içi style özniteliği yok',()=>{
        const files=[];
        const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const p=path.join(d,e.name);e.isDirectory()?walk(p):/\.(js|html)$/.test(e.name)&&files.push(p);});
        walk(path.join(ROOT,'src'));
        const bad=files.filter(f=>/\sstyle=|setAttribute\(\s*['"]style['"]/.test(fs.readFileSync(f,'utf8'))).map(f=>path.relative(ROOT,f));
        return [[bad.length===0,'style özniteliği kullanan dosya yok '+bad.join(', ')]];
    });
};

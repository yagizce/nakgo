/* İlçe seçimi ve 6 saatlik yayın süresi. */
module.exports = ({run,test,fs,path,ROOT}) => {
    run('Her şehrin isteğe bağlı ilçe listesi var ve ilan kartında görünür',(r,ok)=>{
        ok(r('return cities.every(c=>Array.isArray(DISTRICTS[c])&&DISTRICTS[c].length>0)&&Object.keys(DISTRICTS).length===cities.length'),'81 şehrin tamamı için ilçe listesi');
        ok(r('return Object.values(DISTRICTS).reduce((n,a)=>n+a.length,0)===973'),'973 ilçe');
        ok(r('return DISTRICTS["İzmir"].includes("Bornova")&&DISTRICTS["Kocaeli"].includes("Gebze")'),'bilinen ilçeler');
        const html=r('return cardRoute({from:"İzmir",fromD:"<b>Bornova",to:"Ankara",toD:""})');
        ok(html.includes('&lt;b&gt;Bornova')&&!html.includes('<b>Bornova'),'ilçe kaçışlanarak gösterilir');
        ok((html.match(/class="district"/g)||[]).length===1,'ilçesiz şehirde ek satır yok');
    });
    test('İlçe ve süre alanları sunucuya doğru eşlenir',async()=>{
        const out=[],ok=(v,m)=>out.push([!!v,m]);
        const cloud=fs.readFileSync(path.join(ROOT,'src/js/cloud.js'),'utf8');
        ok(/from_district:x\.fromD\|\|null,to_district:x\.toD\|\|null/.test(cloud),'boş ilçe null gönderilir');
        ok(/closed:r\.status!=='active'\|\|Date\.parse\(r\.expires_at\)<=Date\.now\(\)/.test(cloud),'süresi dolan kendi ilanı kapalı görünür');
        ok(!/listingFields=\[[^\]]*expires_at/.test(cloud),'istemci yayın süresini yazamaz');
        const sql=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261111040000_listing_districts_expiry.sql'),'utf8');
        ok(/interval '6 hours'/.test(sql)&&!/grant[^;]*expires_at/i.test(sql),'süre sunucuda belirlenir');
        return out;
    });
};

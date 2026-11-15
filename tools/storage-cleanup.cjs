/** Kuyruktaki sahipsiz belge dosyalarını Storage API ile siler (private.storage_cleanup).
 * Kullanım: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/storage-cleanup.cjs
 * Anahtar yalnız ortam değişkeninden okunur ve hiçbir yere yazdırılmaz. Tekrar çalıştırmak güvenlidir:
 * dosya zaten yoksa Storage boş liste döner ve kayıt tamamlandı sayılır; hata olursa kayıt
 * deneme sayısı ve hata metniyle kuyrukta kalır. */
'use strict';
async function cleanup({url,key,fetch,limit=100}) {
    if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url||''))throw Error('SUPABASE_URL geçersiz');
    if(!key)throw Error('SUPABASE_SERVICE_ROLE_KEY gerekli');
    const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
    const rpc=async(name,body)=>{
        const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body)});
        if(!r.ok)throw Error(name+' HTTP '+r.status);
        return r.status===204?null:r.json();
    };
    const pending=await rpc('nakgo_storage_cleanup_pending',{p_limit:limit});
    let removed=0,failed=0;
    for(const item of pending) {
        let ok=false,error=null;
        try {
            const r=await fetch(url+'/storage/v1/object/'+encodeURIComponent(item.bucket_id),{method:'DELETE',headers,body:JSON.stringify({prefixes:[item.object_path]})});
            ok=r.ok; if(!ok)error='HTTP '+r.status;
        } catch(e) { error=String(e&&e.message||e).slice(0,200); }
        await rpc('nakgo_storage_cleanup_result',{p_bucket:item.bucket_id,p_path:item.object_path,p_ok:ok,p_error:error});
        if(ok)removed++; else failed++;
    }
    return {pending:pending.length,removed,failed};
}
module.exports={cleanup};
if(require.main===module) {
    cleanup({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch})
        .then(r=>{console.log(JSON.stringify(r));process.exit(r.failed?1:0);})
        .catch(e=>{console.error(e.message);process.exit(1);});
}

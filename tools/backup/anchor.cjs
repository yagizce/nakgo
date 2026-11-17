/** B7-A4: dış çapa — kontrol noktası başlık hash'lerinin zincirden BAĞIMSIZ bir yere yazılması.
 * StoreAnchor ayrı bir kovaya (tercihen ayrı hesapta, yalnız yazma+okuma belirteciyle) şu nesneyi "yoksa yaz" ile koyar:
 *   anchors/<seq 12 hane>.<başlık sha256>
 * Nesneler hiçbir zaman güncellenmez; aynı sıra için ikinci, farklı hash bir çatal kanıtıdır ve legal-run bunu durdurur.
 * Çapa kovasına erişen biri sahte kayıt ekleyebilir: bu yalnız çalışmayı durdurur (fail-closed), silmeye yol açmaz. */
'use strict';
const PREFIX='anchors/';
const RE=/^anchors\/(\d{12})\.([0-9a-f]{64})$/;

class StoreAnchor{
  constructor(name,store){this.name=name;this.store=store;}
  async put(seq,sha){
    const r=await this.store.put(PREFIX+String(seq).padStart(12,'0')+'.'+sha,Buffer.from(JSON.stringify({seq,sha})),{ifNoneMatch:true});
    if(!r.ok&&r.status!==412)throw Error('çapa yazılamadı: '+r.status);
  }
  async list(){
    return (await this.store.list(PREFIX)).map(o=>RE.exec(o.key)).filter(Boolean).map(m=>({seq:Number(m[1]),sha:m[2]}));
  }
}

module.exports={StoreAnchor,PREFIX};

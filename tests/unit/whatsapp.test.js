/* Mevcut runner'ın yeni dosya keşfine bağlanır; runner/workflow değişmez. */
module.exports=({test,ROOT,isolated})=>{
  test('WhatsApp V1 ve inceleme kuyruğu sözleşme testleri',async()=>{
    const cp=require('node:child_process'),path=require('node:path');
    const result=cp.spawnSync(process.execPath,['--test',path.join(ROOT,'tests/whatsapp/v1.test.cjs'),path.join(ROOT,'tests/whatsapp/review.test.cjs')],{
      cwd:ROOT,encoding:'utf8',timeout:30000,env:{...process.env,NAKGO_ISOLATE_WHATSAPP:isolated?'1':'0'}});
    return [[!result.error&&result.status===0,'WhatsApp parser/webhook testleri: '+(result.status===0?'tamamı geçti':result.stdout+' '+result.stderr)]];
  });
};

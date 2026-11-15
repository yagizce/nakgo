/* Belge dosyası temizleyicisi: kuyruktakileri siler, hatayı kuyrukta bırakır, anahtarı yazdırmaz. */
module.exports=({test,fs,path,ROOT})=>{
 test('Storage temizleyici kuyruğu güvenle işler',async()=>{
  const out=[],ok=(v,m)=>out.push([!!v,m]);
  const vm=require('node:vm');
  const ctx=vm.createContext({module:{exports:{}},require:()=>({}),JSON,encodeURIComponent,Error,String});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'tools/storage-cleanup.cjs'),'utf8').replace(/if\(require\.main===module\)[\s\S]*$/,''),ctx);
  const {cleanup}=ctx.module.exports;
  const url='https://abcdefghijklmnopqrst.supabase.co',key='service-test-key';
  const calls=[];
  const fetch=async(u,o)=>{
   calls.push({u,o});
   if(u.endsWith('/rpc/nakgo_storage_cleanup_pending'))return {ok:true,status:200,json:async()=>[{bucket_id:'carrier-documents',object_path:'a/1/x.jpg'},{bucket_id:'carrier-documents',object_path:'b/2/y.jpg'}]};
   if(u.includes('/storage/v1/object/'))return JSON.parse(o.body).prefixes[0]==='a/1/x.jpg'?{ok:true,status:200}:{ok:false,status:500};
   return {ok:true,status:204};
  };
  const r=await cleanup({url,key,fetch});
  ok(r.pending===2&&r.removed===1&&r.failed===1,'bir dosya silindi, biri kuyrukta kaldı');
  const results=calls.filter(c=>c.u.endsWith('/rpc/nakgo_storage_cleanup_result')).map(c=>JSON.parse(c.o.body));
  ok(results.length===2&&results[0].p_ok===true&&results[1].p_ok===false&&results[1].p_error==='HTTP 500','sonuçlar kuyruğa yazıldı');
  ok(calls.filter(c=>c.o.method==='DELETE').every(c=>c.u===url+'/storage/v1/object/carrier-documents'),'yalnız kuyruktaki kovadan silinir');
  let refused=false;try{await cleanup({url:'https://evil.example',key,fetch});}catch{refused=true;}
  ok(refused,'Supabase dışı adrese anahtar gönderilmez');
  ok(!fs.readFileSync(path.join(ROOT,'tools/storage-cleanup.cjs'),'utf8').match(/console\.\w+\([^)]*key/),'anahtar yazdırılmaz');
  return out;
 });
};

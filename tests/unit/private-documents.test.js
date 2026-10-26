module.exports=({run})=>{
 const setup='nakgoMarket.sync({marketplace:true,user:{id:"00000000-0000-4000-8000-000000000001"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"00000000-0000-4000-8000-000000000001"},profile:{display_name:"A"}});';
 run('Private document state never trusts demo approvals or client reviewer flags',async(r,ok)=>{
  const demo=r('return localStorage.getItem("yy2")');r(setup+'admin=true;appr["00000000-0000-4000-8000-000000000001"]=true;nakgoAuth.documentRole=async()=>"admin";nakgoAuth.documentApplications=async()=>[{id:1,owner_id:"00000000-0000-4000-8000-000000000001",status:"submitted",license_class:"CE",revision:1}];');
  await r('return nakgoDocuments.refresh()');ok(r('return !nakgoDocuments.state().reviewer&&!nakgoDocuments.isApproved(nakgoAuth.snapshot().user.id)&&lvU(nakgoAuth.snapshot().user.id)===0'),'demo approval and string-valued role cannot grant real badge/reviewer');
  ok(r('return carCard().includes("İnceleme bekliyor")&&!carCard().includes("Belge başvurusu oluştur")&&adminCard()===""'),'submitted application stays distinct from approval and legacy admin UI');
  ok(r('return localStorage.getItem("yy2")')===demo,'document metadata does not enter demo storage');
 },{win:{}});
 run('Late document reads and public badge responses are discarded after account change',async(r,ok)=>{
  r(setup+'nakgoAuth.documentRole=()=>new Promise(done=>window.finishRole=done);');const pending=r('return nakgoDocuments.refresh()');
  r('nakgoMarket.sync({marketplace:true,user:{id:"b"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"b"},profile:{}});window.finishRole(true);');await pending;
  ok(r('return !nakgoDocuments.state().ready&&!nakgoDocuments.state().reviewer&&!nakgoDocuments.state().rows.length'),'role and metadata cannot enter another account');
  r('nakgoAuth.snapshot=()=>({user:{id:"00000000-0000-4000-8000-000000000001"},profile:{}});nakgoAuth.carrierVerifications=()=>new Promise(done=>window.finishBadge=done);');const badge=r('return nakgoDocuments.refreshPublic([nakgoAuth.snapshot().user.id])');
  r('nakgoMarket.sync({marketplace:true,user:null});window.finishBadge([{user_id:"00000000-0000-4000-8000-000000000001"}]);');await badge;ok(r('return !nakgoDocuments.isApproved("00000000-0000-4000-8000-000000000001")'),'late public badge is also account scoped');
 },{win:{}});
 run('Unreadable private document metadata remains retryable without claiming an empty application',async(r,ok)=>{
  r(setup+'nakgoAuth.documentRole=async()=>{throw Error("offline");};');await r('return nakgoDocuments.refresh()');
  ok(r('return !nakgoDocuments.state().ready&&!!nakgoDocuments.state().error&&!carCard().includes("Belge başvurusu oluştur")'),'network failure does not become a ready empty state');
  r('nakgoAuth.documentRole=async()=>false;nakgoAuth.documentApplications=async()=>[];');await r('return nakgoDocuments.refresh()');ok(r('return nakgoDocuments.state().ready&&!nakgoDocuments.state().error&&carCard().includes("Belge başvurusu oluştur")'),'explicit retry can establish an empty document account');
 },{win:{}});
 run('Document image headers are bounded before decoding and reject unsupported content',async(r,ok)=>{
  ok(r('return documentImageDimensions(new Uint8Array(30))===null'),'arbitrary bytes are not accepted as images');
  r('window.png=new Uint8Array(24);window.png.set([137,80,78,71,13,10,26,10]);window.png[18]=4;window.png[22]=3;');
  ok(r('const d=documentImageDimensions(window.png);return d.width===1024&&d.height===768'),'PNG dimensions are read before image decode');
  r('window.png[18]=0;');ok(r('return documentImageDimensions(window.png)===null'),'zero-sized images are rejected');
  ok(r('return documentImageDimensions(new Uint8Array([255,216,255,192,0,200,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,255,217]))===null'),'truncated JPEG segment cannot pass validation');
 },{win:{}});
};

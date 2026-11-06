/* Account transitions must not reactivate the retired private message module. */
module.exports=({run,test,fs,path,ROOT})=>{
 run('Account switching clears old account data without restoring message UI',(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"account-a"},profile:null});chats={a:[{t:"PRIVATE-ACCOUNT-A"}]};');
  r('nakgoMarket.sync({marketplace:true,user:{id:"account-b"},profile:null});tab="me";render();');
  ok(r('return Object.keys(chats).length===0'),'previous account history cleared');
  ok(!r('return main()').includes('PRIVATE-ACCOUNT-A'),'previous account text cannot render');
  r('nakgoMarket.sync({marketplace:true,user:null,profile:null});');
  ok(r('return typeof nakgoMessages==="undefined"&&typeof paintAccountMessages==="undefined"'),'sign out cannot restore a polling module');
 },{win:{}});
 test('The production bundle cannot load the retired inbox source',()=>{
  const sources=require(path.join(ROOT,'tools/project.js')).js;
  return [[!sources.includes('src/js/screens/inbox.js'),'retired inbox is outside the source loading graph'],[!fs.existsSync(path.join(ROOT,'src/js/screens/inbox.js')),'no legacy inbox entry to serve']];
 });
};

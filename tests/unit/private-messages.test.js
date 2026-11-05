/* Preserve legacy local records without exposing or reactivating conversations. */
module.exports=({run})=>{
 run('Legacy message content stays stored and never enters public screens',(r,ok)=>{
  r('chats={legacy:[{me:1,t:"PRIVATE-HISTORY-<img src=x onerror=boom>"}]};save();');
  const stored=r('return localStorage.getItem("yy2")');
  for(const tab of ['list','me','mine']){
   r('tab='+JSON.stringify(tab)+';render();');
   ok(!r('return main()').includes('PRIVATE-HISTORY'),'history absent from '+tab);
  }
  r('openLoad(loads[0].id)');
  ok(!r('return sheet()').includes('PRIVATE-HISTORY'),'history absent from details');
  ok(r('return localStorage.getItem("yy2")')===stored,'rendering never deletes or rewrites old history');
  ok(r('return typeof openChat==="undefined"&&typeof openInbox==="undefined"'),'legacy UI entry points absent');
 });
};

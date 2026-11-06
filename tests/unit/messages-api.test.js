/* Retired messaging is denied, including after authentication becomes active. */
module.exports=({run})=>{
 run('Retired message SDK methods never become callable for an account',(r,ok)=>{
  const methods=['listConversations','listMessages','openConversation','sendMessage','readConversation','unreadMessages'];
  for(const account of [null,'account-a','account-b']){
   r('nakgoMarket.sync({marketplace:true,user:'+JSON.stringify(account?{id:account}:null)+',profile:null})');
   for(const method of methods)ok(r('return typeof nakgoAuth['+JSON.stringify(method)+']==="undefined"'),'retired '+method+' for '+account);
  }
 },{win:{}});
};

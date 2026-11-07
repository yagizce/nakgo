module.exports=({run})=>{
 run('Account copy does not promise retired in-app messages',(r,ok)=>{
  r('nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:"a",email:"synthetic@example.test"},profile:{display_name:"Synthetic account"}});');
  ok(r('return !authCardHTML().includes("mesaj")'),'account-only mode does not advertise demo messages');
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});');
  ok(r('return !authCardHTML().includes("mesaj")'),'marketplace mode does not promise stored messages');
  ok(r('return authCardHTML().includes("Veri hakları ve hesap silme")'),'privacy and account deletion entry remains available');
 },{win:{}});
};

module.exports=({run})=>{
 run('İlan süresi saat farkında 360 dakikayı aşmaz',(r,ok)=>{
  ok(r("return listingRemaining({expiresAt:Date.now()+6*36e5+30000})")==='360 dk kaldı','server clock slightly ahead');
  ok(r("return listingRemaining({expiresAt:Date.now()+60000})")==='1 dk kaldı','one minute remains');
  ok(r("return listingRemaining({expiresAt:Date.now()})")==='Süresi doldu','exact expiry');
 });
};

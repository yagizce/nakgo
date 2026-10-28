module.exports=({run})=>{
 run('Google return waits for the verified profile before checking administrator access',async(r,ok)=>{
  r(`window.profileReady=false;window.roleCalls=0;window.roleValue=true;
   nakgoAuth.snapshot=()=>({enabled:true,ready:true,user:{id:'google-admin'},profile:window.profileReady?{id:'google-admin',display_name:'Admin',account_type:'owner'}:null});
   nakgoMarket.active=()=>true;nakgoMarket.token=()=> 'google-admin:1';
   nakgoJobs.summary=()=>({ready:true,active:0,done:0,busy:false,error:''});
   nakgoAuth.adminRole=async()=>{window.roleCalls++;if(!nakgoAuth.snapshot().profile)throw Error('Sign in required');return window.roleValue;};
   tab='me';renderProfile(el('#main'));`);
  await Promise.resolve();await Promise.resolve();
  ok(r('return window.roleCalls===0'),'no role request before profile hydration');
  ok(r('return !nakgoAdminAccess.isAdmin()'),'admin entry stays hidden while identity is incomplete');
  r('window.profileReady=true;renderProfile(el("#main"));');
  await Promise.resolve();await Promise.resolve();
  ok(r('return window.roleCalls===1'),'one role request starts after verified profile arrives');
  ok(r('return nakgoAdminAccess.isAdmin()&&main().includes("profile-admin")'),'Google return exposes only confirmed server admin without a manual reload');
  r('nakgoAdminAccess.reset();window.roleValue=false;renderProfile(el("#main"));');
  await Promise.resolve();await Promise.resolve();
  ok(r('return !nakgoAdminAccess.isAdmin()&&!main().includes("id="+String.fromCharCode(34)+"profile-admin")'),'ordinary server role keeps the panel hidden');
 },{win:{}});
};

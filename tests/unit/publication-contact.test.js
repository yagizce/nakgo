module.exports=({run})=>{
 run('Favorite expiry refresh does not erase an unsaved profile form',(r,ok)=>{
  r('nakgoMarket.active=()=>true;tab="me";window.renders=0;window.originalRender=render;render=()=>window.renders++;el("#profile-name").value="Unsaved profile";refreshListingExpiry();');
  ok(r('return window.renders===0&&el("#profile-name").value==="Unsaved profile"'),'updates favorite caption without rebuilding the profile');
  r('render=window.originalRender;');
 },{win:{}});
 run('Future publication cannot be displayed, saved or contacted',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{}});window.future=Date.now()+3600000;window.row={id:90,kind:"load",owner_id:"other",status:"active",published_at:new Date(window.future).toISOString(),expires_at:new Date(window.future+21600000).toISOString()};loads=[nakgoMarket.mapped(window.row)];nakgoAuth.listFavorites=async()=>[{listing_id:90,created_at:new Date(window.future+1000).toISOString(),listing:window.row}];window.calls=0;nakgoAuth.listingContact=async()=>{window.calls++;};');
  await r('return nakgoFavorites.refresh()');await r('return nakgoFavorites.refreshPage()');
  ok(r('return !availableListing(loads[0])&&!visibleListing(loads[0])'),'future listing excluded from list and detail access');
  ok(r('return nakgoFavorites.state().count===0&&nakgoFavorites.listings().length===0'),'future saved timestamp cannot revive future publication');
  await r('return contactListing(loads[0],false,"whatsapp")');ok(r('return window.calls===0'),'future listing never requests telephone');
  r('loads[0].publishedAt=NaN;');ok(r('return !availableListing(loads[0])'),'missing remote publication fails closed');
 },{win:{location:{href:''}}});
 run('Remote listing edits preserve contact when the optional replacement is empty',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});loads=[nakgoMarket.mapped({id:90,kind:"load",owner_id:"a",status:"active",published_at:new Date().toISOString(),expires_at:new Date(Date.now()+21600000).toISOString(),loading_text:"bugün"})];window.editPatch=null;patchIt=async(k,id,patch)=>{window.editPatch=patch;return true;};openEdit("l",90);el("#ed").value="yarın";el("#en").value="Synthetic edit";el("#edit-phone").value="";');
  ok(r('return sheet().includes("Değiştirmeyeceksen boş bırak")'),'phone is not downloaded just to prefill edit form');
  await r('return el("#es").onclick()');
  ok(r('return window.editPatch.note==="Synthetic edit"&&!("phone" in window.editPatch)&&!("contactConsent" in window.editPatch)'),'text-only edit does not clear existing contact or require new consent');
  r('window.editPatch=null;openEdit("l",90);el("#ed").value="yarın";el("#en").value="Synthetic edit";el("#edit-phone").value="invalid";');
  await r('return el("#es").onclick()');ok(r('return window.editPatch===null'),'invalid nonempty replacement still rejected');
 },{win:{}});
 run('Saved counts and cards follow exact expiry and publication identity',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{}});window.originalNow=Date.now;window.clock=window.originalNow();Date.now=()=>window.clock;window.end=window.clock+21600000;window.saved={listing_id:90,created_at:new Date(window.clock).toISOString(),listing:{id:90,kind:"load",owner_id:"other",from_city:"İstanbul",to_city:"Ankara",cargo:"Synthetic active favorite",amount:10,vehicle:"Tır",body:"Tenteli",status:"active",published_at:new Date(window.clock).toISOString(),expires_at:new Date(window.end).toISOString()}};window.savedOn=true;nakgoAuth.listFavorites=async()=>window.savedOn?[window.saved,{listing_id:91,listing:null}]:[];');
  try{
   await r('return nakgoFavorites.refresh()');await r('return nakgoFavorites.refreshPage()');
   r('F=F0();F.fav=true;tab="list";render();');
   ok(r('return nakgoFavorites.state().count===1&&main().includes("Synthetic active favorite")'),'only accessible active publication counts and appears');
   r('window.clock=window.end-1;');ok(r('return nakgoFavorites.has(90)'),'favorite exists just before six-hour deadline');
   r('window.clock=window.end;render();');
   ok(r('return !nakgoFavorites.has(90)&&nakgoFavorites.state().count===0&&nakgoFavorites.listings().length===0'),'exact six-hour deadline hides saved card and count');
   ok(r('return !main().includes("Synthetic active favorite")&&!main().includes("Yayında olmayan kayıtlar")&&!main().includes("data-unsave")'),'no bookmark archive or expired placeholder');
   r('window.clock++;');ok(r('return nakgoFavorites.state().count===0'),'favorite remains hidden after deadline');
   r('window.saved.listing.published_at=new Date(window.clock).toISOString();window.saved.listing.expires_at=new Date(window.clock+21600000).toISOString();');
   await r('return nakgoFavorites.refresh()');ok(r('return !nakgoFavorites.has(90)&&nakgoFavorites.state().count===0'),'old relation does not revive after republication');
   r('loads=[nakgoMarket.mapped(window.saved.listing)];nakgoAuth.setFavorite=async(id,saved)=>{window.savedOn=saved;if(saved)window.saved.created_at=new Date(window.clock).toISOString();return {listing_id:id,saved};};');
   await r('return nakgoFavorites.setSaved(90,true)');ok(r('return nakgoFavorites.has(90)&&nakgoFavorites.state().count===1'),'new publication requires explicit save');
   await r('return nakgoFavorites.setSaved(90,false)');ok(r('return !nakgoFavorites.has(90)&&nakgoFavorites.state().count===0'),'active saved publication can be removed');
  }finally{r('Date.now=window.originalNow;');}
 },{win:{}});
 run('WhatsApp card and detail use scoped contact and reject late expired responses',async(r,ok)=>{
  r('nakgoMarket.sync({marketplace:true,user:{id:"a"},profile:null});nakgoAuth.snapshot=()=>({user:{id:"a"},profile:{}});window.row={id:90,kind:"load",owner_id:"other",from_city:"İstanbul",to_city:"Ankara",cargo:"Synthetic",amount:10,vehicle:"Tır",body:"Tenteli",status:"active",published_at:new Date().toISOString(),expires_at:new Date(Date.now()+21600000).toISOString()};loads=[nakgoMarket.mapped(window.row)];window.contactCalls=0;nakgoAuth.listingContact=async()=>{window.contactCalls++;return "+905321234567";};');
  ok(r("return lCard(loads[0]).includes('data-whatsapp=\"90\"')&&lCard(loads[0]).includes('ui-icon')"),'load card has accessible WhatsApp logo');
  ok(r("return tCard({...loads[0],id:'t90'}).includes('data-whatsapp=\"t90\"')"),'truck card has WhatsApp logo');
  r('openLoad(90);');ok(r('return sheet().includes("WhatsApp")&&contactDockHTML().includes(uiIcon("whatsapp"))'),'detail includes same logo');
  await r('return contactListing(loads[0],false,"whatsapp")');ok(r('return window.location.href==="https://wa.me/905321234567"&&window.contactCalls===1'),'WhatsApp uses server-checked normalized owner phone');
  r('window.location.href="unchanged";nakgoAuth.listingContact=()=>new Promise(resolve=>window.finishContact=resolve);');
  const pending=r('return contactListing(loads[0],false,"whatsapp")');
  r('loads[0].expiresAt=Date.now();window.finishContact("+905321234567");');await pending;
  ok(r('return window.location.href==="unchanged"'),'expiry while contact is loading blocks WhatsApp navigation');
  r('window.contactCalls=0;nakgoAuth.listingContact=async()=>{window.contactCalls++;return "+905321234567";};');
  await r('return contactListing(loads[0],false,"whatsapp")');ok(r('return window.contactCalls===0'),'expired card never requests phone');
  r('loads[0].expiresAt=Date.now()+3600000;nakgoAuth.listingContact=async()=>{throw Error("permission revoked")};');
  await r('return contactListing(loads[0],false,"whatsapp")');ok(r('return window.location.href==="unchanged"'),'revoked permission cannot navigate');
  r('loads[0].closed=true;window.contactCalls=0;');await r('return contactListing(loads[0],false,"call")');ok(r('return window.contactCalls===0'),'removed listing cannot request telephone');
 },{win:{location:{href:''}}});
};

module.exports=({test})=>{
 test('Normal npm test enforces safe DEV deployment defaults',()=>{
  require('../cloudflare/deploy-safety.cjs');
  return [[true,'pinned project, disabled Cron/retention, one-message batch, secrets outside source']];
 });
};

module.exports=({test,ROOT,path})=>{
 test('Trusted browser fixture dispatch rejects candidate-ledger approval and arbitrary code',()=>{
  require('node:child_process').execFileSync(process.env.PYTHON||'python',[path.join(ROOT,'tests/gate/browser_dispatch_test.py')],{cwd:ROOT,stdio:'pipe',timeout:30000});
  return [[true,'six isolated trust-boundary cases passed']];
 });
};

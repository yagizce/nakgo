#!/usr/bin/env node
'use strict';
const {parseLoad,validateDraft}=require('../server/whatsapp/parser.cjs');
const samples=process.argv.slice(2);
for(const text of samples.length?samples:["Aliağa'dan Ankara'ya 24 ton sac tenteli lazım bugün 32000","Manisa > İstanbul kamyon 12 ton 25 bin","Ankara İzmir yük var"]){
  const draft=parseLoad(text);console.log(JSON.stringify({draft,validation:validateDraft(draft)},null,2));
}

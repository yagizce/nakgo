/** B7-A3: RFC 6962 tarzı Merkle ağacı (SHA-256).
 *   yaprak hash'i = SHA-256(0x00 ‖ veri), iç düğüm = SHA-256(0x01 ‖ sol ‖ sağ)  — alan ayrımı ikinci ön görüntüyü engeller.
 *   MTH(n): n>1 ise k = n'den küçük en büyük 2'nin kuvveti; MTH(D[0:k]) ve MTH(D[k:n]) birleştirilir. Boş ağaç = SHA-256("").
 * Kök TEK BAŞINA yeterli değildir: silinen kayıtları bulmak için kontrol noktası yaprak listesinin tamamını taşır;
 * kök, listenin özeti ve dış çapalara yazılan kısa değerdir. Kapsama kanıtı bir denetçiye tek kaydı göstermek içindir. */
'use strict';
const crypto=require('node:crypto');
const H=(...parts)=>crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
const leafHash=data=>H(Buffer.from([0]),Buffer.from(data));
const nodeHash=(l,r)=>H(Buffer.from([1]),l,r);
const split=n=>{let k=1;while(k*2<n)k*=2;return k;};

function mth(hashes){
  if(!hashes.length)return H(Buffer.alloc(0));
  if(hashes.length===1)return hashes[0];
  const k=split(hashes.length);
  return nodeHash(mth(hashes.slice(0,k)),mth(hashes.slice(k)));
}
const root=leaves=>mth(leaves.map(leafHash)).toString('hex');

function proof(leaves,index){
  const path=[];
  const walk=(hs,i)=>{
    if(hs.length<=1)return;
    const k=split(hs.length);
    if(i<k){walk(hs.slice(0,k),i);path.push(mth(hs.slice(k)).toString('hex'));}
    else{walk(hs.slice(k),i-k);path.push(mth(hs.slice(0,k)).toString('hex'));}
  };
  walk(leaves.map(leafHash),index);
  return {index,size:leaves.length,path};
}

/** RFC 6962 §2.1.1 kapsama doğrulaması. */
function verifyProof(leaf,{index,size,path},expectedRoot){
  if(index<0||index>=size)return false;
  let fn=index,sn=size-1,r=leafHash(leaf);
  for(const p of path){
    const h=Buffer.from(p,'hex');
    if(sn===0)return false;
    if(fn%2===1||fn===sn){
      r=nodeHash(h,r);
      if(fn%2===0)while(fn%2===0&&fn!==0){fn>>=1;sn>>=1;}
    }else r=nodeHash(r,h);
    fn>>=1;sn>>=1;
  }
  return sn===0&&r.toString('hex')===expectedRoot;
}

module.exports={root,proof,verifyProof,leafHash,nodeHash};

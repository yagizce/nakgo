#!/usr/bin/env node
// Kullanıcının özgün PNG logosundan yayın simgeleri; yalnızca Node yerleşik modülleri.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {root}=require('./project.js');
const layout=require('../assets/brand/layout.json');
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crc=b=>{let c=~0;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^~0)>>>0};
const chunk=(name,data)=>{const t=Buffer.from(name),len=Buffer.alloc(4),tail=Buffer.alloc(4);len.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,tail])};
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
function decode(file){
 const png=fs.readFileSync(file),parts=[];let w,h,channels;
 if(!png.subarray(0,8).equals(signature))throw Error('Marka kaynağı PNG olmalı.');
 for(let p=8;p<png.length;){
  const n=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),data=png.subarray(p+8,p+8+n);
  if(p+12+n>png.length||crc(png.subarray(p+4,p+8+n))!==png.readUInt32BE(p+8+n))throw Error('Bozuk PNG parçası.');
  if(type==='IHDR'){
   w=data.readUInt32BE(0);h=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;
   if(data[8]!==8||!channels||data[10]||data[11]||data[12])throw Error('Logo, 8 bit RGB/RGBA ve interlace kapalı PNG olmalı.');
  }else if(type==='IDAT')parts.push(data);
  p+=12+n;
 }
 const stride=w*channels,raw=zlib.inflateSync(Buffer.concat(parts)),pixels=Buffer.alloc(w*h*channels);
 if(raw.length!==h*(stride+1))throw Error('Logo piksel boyutu uyuşmuyor.');
 for(let y=0;y<h;y++){
  const filter=raw[y*(stride+1)];if(filter>4)throw Error('Desteklenmeyen PNG filtresi.');
  for(let x=0;x<stride;x++){
   const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
   pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
  }
 }
 return {w,h,channels,pixels};
}
const source=decode(path.join(root,'assets/brand/logo-transparent.png'));
function frame(value){
 if(!Array.isArray(value)||value.length!==4||value.some(x=>!Number.isFinite(x)))throw Error('Geçersiz logo çerçevesi.');
 const [x,y,w,h]=value;if(x<0||y<0||w<=0||h<=0||x+w>source.w||y+h>source.h)throw Error('Logo çerçevesi kaynak dışında.');
 return value;
}
function sample(x,y,k){
 x=Math.max(0,Math.min(source.w-1,x));y=Math.max(0,Math.min(source.h-1,y));
 const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(source.w-1,x0+1),y1=Math.min(source.h-1,y0+1),fx=x-x0,fy=y-y0;
 const at=(px,py)=>{const i=(py*source.w+px)*source.channels,a=source.channels===4?source.pixels[i+3]:255;return k===3?a:source.pixels[i+k]*a/255};
 return (at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy;
}
function render(w,h,crop,coverage=1,background=null){
 const [sx,sy,sw,sh]=frame(crop),scale=Math.min(w/sw,h/sh)*coverage,dw=sw*scale,dh=sh*scale,ox=(w-dw)/2,oy=(h-dh)/2;
 const raw=Buffer.alloc(h*(w*4+1));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const sum=[0,0,0,0];
  for(let ay=0;ay<2;ay++)for(let ax=0;ax<2;ax++){
   const px=x+(ax+.5)/2,py=y+(ay+.5)/2;
   if(px<ox||px>=ox+dw||py<oy||py>=oy+dh)continue;
   for(let k=0;k<4;k++)sum[k]+=sample(sx+(px-ox)/scale-.5,sy+(py-oy)/scale-.5,k);
  }
  const a=sum[3]/4,off=y*(w*4+1)+1+x*4;
  for(let k=0;k<3;k++)raw[off+k]=Math.round(background?sum[k]/4+background[k]*(1-a/255):a?sum[k]*255/sum[3]:0);
  raw[off+3]=background?255:Math.round(a);
 }
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w,0);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=6;
 return Buffer.concat([signature,chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const output=path.join(root,'icons');fs.mkdirSync(output,{recursive:true});
for(const [name,size,coverage,opaque]of [['icon-192.png',192,.94],['icon-512.png',512,.94],['icon-maskable-512.png',512,.64,true],['apple-touch-icon.png',180,.94,true]])fs.writeFileSync(path.join(output,name),render(size,size,layout.mark,coverage,opaque?[74,217,204]:null));
const [,,fw,fh]=frame(layout.full),width=576;
fs.writeFileSync(path.join(output,'brand-logo.png'),render(width,Math.round(width*fh/fw),layout.full));
const icon=fs.readFileSync(path.join(output,'icon-192.png')).toString('base64');
fs.writeFileSync(path.join(output,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><image width="192" height="192" href="data:image/png;base64,'+icon+'"/></svg>\n');
console.log('NakGo logosu ve simgeleri assets/brand/logo-transparent.png kaynağından üretildi.');

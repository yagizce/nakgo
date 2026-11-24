/** B7-A2: şifreleme (age, X25519 alıcıları) ve başlık denetimi.
 *
 * Yalnız AÇIK anahtarlarla (alıcılar) şifreler; şifre çözme anahtarı bu süreçte hiç bulunmaz.
 * Muaf tutulamayan kontroller:
 *   - Alıcı dosyasındaki "age1…" satırlarının sıralı listesinin SHA-256'sı sabitlenmiş değerle aynı olmalı
 *     (alıcı değiştirme saldırısına karşı; sabit değer iş akışında, dosya repoda; ikisi birlikte yalnız incelemeli PR ile değişir).
 *   - Çıktı başlığı "age-encryption.org/v1" ile başlamalı, alıcı sayısı kadar "X25519" bölümü içermeli, başka tür
 *     (ör. parola/scrypt) bölüm içermemeli.
 * "Şifreleme başarılı" bu kontroller + age çıkış kodu demektir; dosyanın gerçekten ÇÖZÜLEBİLDİĞİNİ kanıtlamaz.
 * Çözülebilirlik yalnız test anahtarlarıyla (testlerde) ve aylık çevrim dışı tatbikatla kanıtlanır. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run}=require('./dump.cjs');
const {sha256}=require('./crypto.cjs');

function recipientsOf(file){
  const lines=fs.readFileSync(file,'utf8').split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  const bad=lines.filter(l=>!/^age1[0-9a-z]{58}$/.test(l));
  if(bad.length)throw Error('Alıcı dosyasında yalnız age1… X25519 açık anahtarları olabilir');
  return [...new Set(lines)].sort();
}
const recipientsSha256=file=>sha256(recipientsOf(file).join('\n'));

function parseHeader(buf){
  const text=buf.subarray(0,Math.min(buf.length,8192)).toString('latin1');
  const end=text.indexOf('\n---');
  if(end<0)return {ok:false,reason:'age başlığı bulunamadı'};
  const lines=text.slice(0,end).split('\n');
  if(lines[0]!=='age-encryption.org/v1')return {ok:false,reason:'age v1 başlığı değil'};
  const stanzas=lines.filter(l=>l.startsWith('-> ')).map(l=>l.split(' ')[1]);
  return {ok:true,stanzas};
}

async function ageVersion(ageBin='age'){const r=await run(ageBin,['--version']);return r.code===0?r.out.trim().replace(/^v/,''):null;}

async function packBundle(dir,out){
  const files=['source.json','bootstrap.sql','A.dump','B.pre.sql','B.post.sql','X.pre.sql',
    ...(fs.existsSync(path.join(dir,'B'))?fs.readdirSync(path.join(dir,'B')).filter(f=>f.endsWith('.jsonl')).sort().map(f=>'B/'+f):[]),
    ...(fs.existsSync(path.join(dir,'meta'))?fs.readdirSync(path.join(dir,'meta')).filter(f=>f.endsWith('.jsonl')).sort().map(f=>'meta/'+f):[])]
    .filter(f=>fs.existsSync(path.join(dir,f)));
  const r=await run('tar',['-cf',out,'-C',dir,...files]);
  if(r.code!==0)throw Error('tar: '+r.err);
  return files;
}

async function encryptFile({input,output,recipientsFile,pinnedRecipientsSha256,ageBin='age',requiredRecipients=null}){
  let recips;
  try{recips=recipientsOf(recipientsFile);}catch(e){return {status:'failed',code:'recipients_invalid',reason:e.message};}
  // Elle yedek (bootstrap): tam olarak A ve B (iki alıcı). B7'de verilmez (davranış aynı).
  if(requiredRecipients!==null&&recips.length!==requiredRecipients)return {status:'failed',code:'recipients_count',reason:`alıcı sayısı ${requiredRecipients} olmalı`};
  const got=sha256(recips.join('\n'));
  if(!pinnedRecipientsSha256||got!==pinnedRecipientsSha256)return {status:'failed',code:'recipients_mismatch',reason:'alıcı listesi sabitlenmiş değerle uyuşmuyor',recipients_sha256:got};
  const ver=await ageVersion(ageBin);
  if(!ver||!/^1\.([1-9]|\d{2,})/.test(ver))return {status:'failed',code:'age_version',reason:'age 1.1 veya üstü gerekli: '+ver};
  const r=await run(ageBin,['-R',recipientsFile,'-o',output,input]);
  if(r.code!==0)return {status:'failed',code:'age_error',reason:r.err.trim()};
  const ct=fs.readFileSync(output);
  const h=parseHeader(ct);
  if(!h.ok)return {status:'failed',code:'header',reason:h.reason};
  if(h.stanzas.length!==recips.length||(requiredRecipients!==null&&h.stanzas.length!==requiredRecipients)||h.stanzas.some(s=>s!=='X25519'))return {status:'failed',code:'header',reason:'başlık bölümleri beklenen alıcılarla uyuşmuyor: '+h.stanzas.join(',')};
  return {status:'ok',ciphertext_sha256:sha256(ct),size:ct.length,recipients_count:recips.length,recipients_sha256:got,age_version:ver};
}

module.exports={recipientsOf,recipientsSha256,parseHeader,packBundle,encryptFile,ageVersion};

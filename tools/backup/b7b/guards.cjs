/** B7-B: canlı test çalıştırıcısının güvenlik kapıları. Hepsi saf fonksiyondur; ağ bağlantısı kurmaz.
 *
 * Kural: çalıştırıcı YALNIZ geçici test kaynaklarına bağlanır. Production ve DEV Supabase projeleri (AGENTS.md) ad ile
 * reddedilir; test projesinin kimliği açıkça verilmeli ve bağlantı adresi/kullanıcısı onunla tutarlı olmalıdır.
 * Kapıların herhangi biri başarısızsa hiçbir bağlantı kurulmaz. */
'use strict';

// AGENTS.md: DEV ve Production proje kimlikleri. Bunlara asla bağlanılmaz.
const FORBIDDEN_PROJECT_REFS=Object.freeze(['axkotffqrsddbrazhcwj','fimlifldsivecezbxwuo']);
const BRANCH='refs/heads/nakgo/b7b-test';
const ENVIRONMENT='backup-test';
const SUITES=Object.freeze(['r2','supabase-base','supabase-legal125']);
const REF_RE=/^[a-z]{20}$/;
const POOLER_RE=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/** GitHub çalışma bağlamı: yalnız test dalına push (onay ortam kuralıyla), yalnız test ortamı, takıma göre gizliler. */
function checkRunContext(env){
  const p=[];
  if(env.GITHUB_EVENT_NAME!=='push')p.push('yalnız nakgo/b7b-test dalına push ile tetiklenir: '+env.GITHUB_EVENT_NAME);
  if(env.GITHUB_REF!==BRANCH)p.push('yalnız '+BRANCH+' dalında çalışır: '+env.GITHUB_REF);
  if(env.NAKGO_TEST_ENVIRONMENT!==ENVIRONMENT)p.push('yalnız "'+ENVIRONMENT+'" ortamında çalışır');
  if(!SUITES.includes(env.NAKGO_TEST_SUITE))p.push('bilinmeyen test takımı: '+env.NAKGO_TEST_SUITE);
  // En az yetki: R2 takımında veritabanı gizlisi bulunmamalı (iş akışı bunları yalnız Supabase işine verir).
  if(env.NAKGO_TEST_SUITE==='r2'&&Object.keys(env).some(k=>k.startsWith('NAKGO_TEST_DB_')))p.push('R2 takımında veritabanı gizlisi olmamalı');
  return p;
}

/** Test Supabase projesi: kimlik biçimi, yasak listesi, Supavisor oturum modu adresi ve kullanıcı adı tutarlılığı. */
function checkSupabaseTarget({ref,host,port,adminUser,rootCertFile}){
  const p=[];
  if(!REF_RE.test(ref||''))p.push('test proje kimliği eksik ya da biçimi geçersiz');
  if(FORBIDDEN_PROJECT_REFS.includes(ref))p.push('production/DEV projesine bağlanılamaz');
  for(const r of FORBIDDEN_PROJECT_REFS)if(String(host).includes(r)||String(adminUser).includes(r))p.push('bağlantı bilgisi production/DEV projesini gösteriyor');
  if(!POOLER_RE.test(host||''))p.push('adres Supavisor havuzu (*.pooler.supabase.com) olmalı');
  if(Number(port)!==5432)p.push('port 5432 (oturum modu) olmalı');
  if(adminUser!=='postgres.'+ref)p.push('yönetici kullanıcı postgres.<test proje kimliği> olmalı');
  if(!rootCertFile)p.push('kök sertifika dosyası yok');
  return [...new Set(p)];
}

/** Test R2 kovası: adı "test" içermeli. Production kovası adı "test" içermeyecek şekilde seçilir (bkz. rapor). */
function checkR2Target({endpoint,bucket}){
  const p=[];
  // Varsayılan ya da AB yargı bölgesi (EU jurisdiction) uç noktası.
  if(!/^https:\/\/[0-9a-f]{32}\.(eu\.)?r2\.cloudflarestorage\.com$/.test(endpoint||''))p.push('R2 uç noktası https://<hesap>[.eu].r2.cloudflarestorage.com olmalı');
  if(!/^[a-z0-9-]*test[a-z0-9-]*$/.test(bucket||''))p.push('test kovası adı "test" içermeli');
  return p;
}

module.exports={FORBIDDEN_PROJECT_REFS,BRANCH,ENVIRONMENT,SUITES,checkRunContext,checkSupabaseTarget,checkR2Target};

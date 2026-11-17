/** B7-A3: yasal kayıtların kanıt katmanı.
 *
 * extractState(query)  Geri yüklenmiş (tutarlı anlık görüntüden gelen) veritabanından #125 tablolarının TAM listesini okur.
 *                      Satır hash'leri burada, fonksiyonlara güvenmeden, doğrudan ifadeyle yeniden hesaplanır.
 * buildLeaves(state)   Her kayıt için yaprak üretir. Yaprak; kimlik, UTC gün, row_hash ya da snapshot hash'i ve
 *                      politika kodu + politika hash'ini birlikte taşır. Yaprak listeleri kontrol noktası gövdesine TAM
 *                      olarak girer; Merkle kökü yalnız bu listenin imzalı özetidir.
 * internalChecks()     Tek anlık görüntü içinde: yeniden hesaplanan hash'ler, snapshot hash'leri, kapanış tutarlılığı.
 * verifyTransition()   Önceki kontrol noktasındaki tam listeyle şimdikini karşılaştırır. Kanıtlanamayan her silme ya da
 *                      değişiklik bir bulgudur; bulgu olayı açar (state-machine.cjs) ve olay açıkken silme yapılmaz.
 *
 * Tek başına yeterli SAYILMAYANLAR: hash zinciri (kuyruktan silmeyi göremez), dizi numarası (geri alınan işlemler de
 * boşluk bırakır), işlem zamanı (id ile birlikte artmaz) ve retention_runs sayısı (hangi satırların silindiğini söylemez).
 * Karar bu dördünün ve tam yaprak listelerinin birlikte değerlendirilmesiyle verilir.
 *
 * Güvenli varsayılanlar (belgelendi: docs/backup/legal-evidence.md):
 *  - İki kontrol noktası arasında eklenip silinen, hiç görülmemiş satır: yasal yoldan mümkün değildir (yeni satırın
 *    zamanı saklama sınırının içinde kalır). Zincir boşluğundan ya da retention sayısı fazlalığından görülürse 'integrity'.
 *  - Kuyruktan silinen satır: silinen yaprak önceki listede vardır; aynı kurallarla denetlenir. Sonradan eklenen satır
 *    silinen satıra bağlanırsa (prev_hash) boşluk açıklanmalıdır. Görülmemiş kuyruk ekle-sil sonraki ekleme olmadıkça
 *    görünmez: bilinen sınır.
 *  - Politika değişikliği: değişiklik kaydedilir; aynı aralıkta o politikaya dayanan her silme kanıtlanamaz sayılır.
 *    Kısalan süre ancak değişikliği gören kontrol noktasından SONRAKİ aralıkta geçerli olur. */
'use strict';
const {sha256Json}=require('./crypto.cjs');
const merkle=require('./merkle.cjs');
const {canonical}=require('./crypto.cjs');
const DAY_US=86400n*1000000n;

const US=col=>`((extract(epoch from ${col})*1000000)::bigint)::text`;
const DAYOF=col=>`(${col} at time zone 'UTC')::date::text`;
const ROWSHA=(alias,minus)=>`encode(pg_catalog.sha256(convert_to((to_jsonb(${alias})${minus.map(c=>`-'${c}'`).join('')})::text,'UTF8')),'hex')`;

/** Tam durum. Oturum saat dilimi UTC'ye zorlanır (to_jsonb zaman damgasını oturum diliyle yazar; tetikleyici UTC kullanır). */
async function extractState(query,{schema='private'}={}){
  const S=schema.replace(/[^a-z_]/g,'');
  await query("select set_config('timezone','UTC',false)");
  const exists=(await query(`select count(*)::int n from pg_tables where schemaname=$1 and tablename in('legal_policies','legal_records','legal_holds','legal_access_log','legal_destructions','retention_runs')`,[S])).rows[0].n;
  if(exists!==6)return {absent:true,tables_found:exists};
  const q=async sql=>(await query(sql)).rows;
  const policies=await q(`select code,legal_record,retain_days,label,basis,approved_by::text approved_by,${US('approved_at')} approved_at_us from ${S}.legal_policies order by code`);
  const log=await q(`select id::text id,${US('at')} at_us,${DAYOF('at')} as day,prev_hash,row_hash,${ROWSHA('x',['row_hash'])} recomputed from ${S}.legal_access_log x order by id`);
  const destructions=await q(`select id::text id,${US('at')} at_us,${DAYOF('at')} as day,prev_hash,row_hash,${ROWSHA('x',['row_hash'])} recomputed,
    record_no::text record_no,policy rec_policy,retain_days,opened_month::text opened_month,closed_month::text closed_month,holds_removed,cause
    from ${S}.legal_destructions x order by id`);
  const records=await q(`select id::text id,policy,status,${DAYOF('opened_at')} opened_day,${US('closed_at')} closed_at_us,${DAYOF('closed_at')} closed_day,
    to_char(date_trunc('month',opened_at at time zone 'UTC'),'YYYY-MM-DD') opened_month,to_char(date_trunc('month',closed_at at time zone 'UTC'),'YYYY-MM-DD') closed_month,
    snapshot_sha256,encode(pg_catalog.sha256(convert_to(snapshot::text,'UTF8')),'hex') snapshot_recomputed,
    ${ROWSHA('x',['status','closed_by','closed_at','close_reason'])} fixed_sha,
    encode(pg_catalog.sha256(convert_to(jsonb_build_object('s',status,'b',closed_by,'a',closed_at,'r',close_reason)::text,'UTF8')),'hex') closed_sha,
    (status='closed')=(closed_at is not null and closed_by is not null and close_reason is not null) close_consistent
    from ${S}.legal_records x order by id`);
  const holds=await q(`select id::text id,record_id::text record_id,${DAYOF('opened_at')} opened_day,released_at is not null released,
    ${ROWSHA('x',['released_by','released_at','release_reason'])} fixed_sha,
    encode(pg_catalog.sha256(convert_to(jsonb_build_object('b',released_by,'a',released_at,'r',release_reason)::text,'UTF8')),'hex') release_sha
    from ${S}.legal_holds x order by id`);
  const runs=await q(`select id::text id,${US('ran_at')} ran_at_us,counts from ${S}.retention_runs order by id`);
  const sequences={};
  for(const [name,rel] of [['log','legal_access_log_id'],['destructions','legal_destructions_id'],['records','legal_records_id_seq'],['holds','legal_holds_id_seq']]){
    const r=(await q(`select last_value::text v,is_called from ${S}.${rel}`).catch(()=>[]))[0];
    sequences[name]=r?{last_value:r.v,is_called:r.is_called}:null;
  }
  return {absent:false,policies,log,destructions,records,holds,runs,sequences};
}

const policyRow=p=>({code:p.code,legal_record:p.legal_record,retain_days:p.retain_days,label:p.label,basis:p.basis,approved_by:p.approved_by,approved_at_us:p.approved_at_us});
const policyIndex=policies=>Object.fromEntries((policies||[]).map(p=>[p.code,{...policyRow(p),sha:sha256Json(policyRow(p))}]));

/** Yapraklar. Silme kararında yaprak alanları (at_us, prev_hash, ...) kullanılır; kök bunların hepsini bağlar. */
function buildLeaves(state){
  const P=policyIndex(state.policies);
  const ref=code=>({policy:code,policy_sha:P[code]?P[code].sha:null});
  const counts=c=>Object.fromEntries(Object.entries(c||{}).filter(([,v])=>typeof v==='number'||typeof v==='boolean'));
  return {
    log:state.log.map(r=>({t:'log',id:r.id,day:r.day,at_us:r.at_us,prev_hash:r.prev_hash,row_hash:r.row_hash,...ref('legal_access_log')})),
    destructions:state.destructions.map(r=>({t:'destruction',id:r.id,day:r.day,at_us:r.at_us,prev_hash:r.prev_hash,row_hash:r.row_hash,record_no:r.record_no,
      rec_policy:r.rec_policy,retain_days:r.retain_days,opened_month:r.opened_month,closed_month:r.closed_month,holds_removed:r.holds_removed,cause:r.cause,...ref('destruction_record')})),
    records:state.records.map(r=>({t:'record',id:r.id,opened_day:r.opened_day,status:r.status,closed_at_us:r.closed_at_us,closed_day:r.closed_day,
      opened_month:r.opened_month,closed_month:r.closed_month,snapshot_sha256:r.snapshot_sha256,fixed_sha:r.fixed_sha,closed_sha:r.closed_sha,...ref(r.policy)})),
    holds:state.holds.map(r=>({t:'hold',id:r.id,record_id:r.record_id,opened_day:r.opened_day,released:r.released,fixed_sha:r.fixed_sha,release_sha:r.release_sha})),
    runs:state.runs.map(r=>({t:'run',id:r.id,ran_at_us:r.ran_at_us,counts:counts(r.counts),counts_sha:sha256Json(r.counts)})),
  };
}

const LISTS=['log','destructions','records','holds','runs'];
const roots=leaves=>Object.fromEntries(LISTS.map(k=>[k,merkle.root(leaves[k].map(canonical))]));
const commitments=leaves=>Object.fromEntries(LISTS.map(k=>[k,leaves[k].map(l=>sha256Json(l))]));

function internalChecks(state){
  const f=[];
  for(const [table,rows] of [['log',state.log],['destructions',state.destructions]])
    for(const r of rows)if(r.recomputed!==r.row_hash)f.push({code:'row_hash_mismatch',severity:'integrity',table,id:r.id});
  for(const r of state.records){
    if(r.snapshot_recomputed!==r.snapshot_sha256)f.push({code:'snapshot_hash_mismatch',severity:'integrity',table:'records',id:r.id});
    if(!r.close_consistent)f.push({code:'close_inconsistent',severity:'integrity',table:'records',id:r.id});
  }
  for(const h of state.holds)if(!state.records.some(r=>r.id===h.record_id))f.push({code:'orphan_hold',severity:'integrity',table:'holds',id:h.id});
  return f;
}

/** İlk kontrol noktası: mevcut durum yalnız insan onayıyla (K2 serbest bırakma) başlangıç kabul edilir. */
function genesisFindings(leaves){
  const f=[{code:'genesis_baseline',severity:'integrity',table:'*',id:'*'}];
  for(const t of ['log','destructions']){
    const rows=leaves[t];
    rows.forEach((r,i)=>{const want=i?rows[i-1].row_hash:'';if(r.prev_hash!==want)f.push({code:'genesis_chain_gap',severity:'integrity',table:t,id:r.id});});
  }
  return f;
}

/** retention_run: delete from retention_runs where ran_at < now() - interval '3 years' (takvim yılı, UTC oturum).
 * µs cinsinden zamandan 3 takvim yılı çıkarır; 29 Şubat → 28 Şubat (PostgreSQL ay aritmetiğiyle aynı). */
function minus3Years(us){
  if(us===0n)return 0n;
  const ms=Number(us/1000n),rest=us%1000n,d=new Date(ms);
  const y=d.getUTCFullYear()-3,m=d.getUTCMonth(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const t=Date.UTC(y,m,Math.min(d.getUTCDate(),last),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
  return BigInt(t)*1000n+rest;
}
const byId=list=>new Map(list.map(x=>[x.id,x]));
const maxId=list=>list.reduce((m,x)=>BigInt(x.id)>m?BigInt(x.id):m,0n);
const big=s=>BigInt(s);

/** prev: önceki gövdedeki {leaves,policies}; cur: {leaves,policies}. Dönen bulgular önem derecesiyle. */
function verifyTransition(prev,cur){
  const f=[];
  const add=(code,severity,table,id,extra)=>f.push({code,severity,table,id:String(id),...(extra||{})});
  const Pp=policyIndex(prev.policies),Pc=policyIndex(cur.policies);
  // Politikalar: silinemez; değişiklik kaydedilir ve o aralıktaki silmeleri kanıtlanamaz yapar.
  const changed=new Set();
  for(const code of Object.keys(Pp)){
    if(!Pc[code]){add('policy_removed','integrity','policies',code);changed.add(code);}
    else if(Pp[code].sha!==Pc[code].sha){add('policy_changed','info','policies',code);changed.add(code);}
  }
  for(const code of Object.keys(Pc))if(!Pp[code]){add('policy_added','info','policies',code);changed.add(code);}
  const stablePolicy=code=>!changed.has(code)&&Pc[code]&&Pc[code].approved_at_us!==null&&Pc[code].retain_days!==null?Pc[code]:null;

  // retention_runs: değişmez, yalnız 3 yıldan eski olanlar silinebilir; aralıktaki çalışmalar yeni kimliklilerdir.
  const runsP=byId(prev.leaves.runs),runsC=byId(cur.leaves.runs);
  const prevRunMax=maxId(prev.leaves.runs);
  // Silme yalnız aralıktaki (yeni) bir retention çalışmasıyla meşrudur; en geç aralık çalışmasının sınırı kullanılır.
  const curRunLatest=cur.leaves.runs.filter(r=>big(r.id)>prevRunMax).reduce((m,r)=>big(r.ran_at_us)>m?big(r.ran_at_us):m,0n);
  for(const [id,r] of runsP){
    const c=runsC.get(id);
    if(!c){if(!(big(r.ran_at_us)<minus3Years(curRunLatest)))add('run_deleted_early','integrity','runs',id);}
    else if(c.counts_sha!==r.counts_sha||c.ran_at_us!==r.ran_at_us)add('run_modified','integrity','runs',id);
  }
  const interval=cur.leaves.runs.filter(r=>big(r.id)>prevRunMax);
  for(const r of cur.leaves.runs)if(!runsP.has(r.id)&&big(r.id)<=prevRunMax)add('run_backfilled','integrity','runs',r.id);
  const sumCount=key=>interval.reduce((s,r)=>s+(typeof r.counts[key]==='number'?r.counts[key]:0),0);

  // Zincirli tablolar.
  const deletedByTable={};
  for(const [table,policy,countKey] of [['log','legal_access_log','legal_access_log_deleted'],['destructions','destruction_record','destructions_deleted']]){
    const P=byId(prev.leaves[table]),C=byId(cur.leaves[table]);
    const prevMax=maxId(prev.leaves[table]);
    const deleted=prev.leaves[table].filter(l=>!C.has(l.id));
    deletedByTable[table]=deleted;
    for(const c of cur.leaves[table]){
      const p=P.get(c.id);
      if(p){if(p.row_hash!==c.row_hash||p.prev_hash!==c.prev_hash)add('row_modified','integrity',table,c.id);}
      else if(big(c.id)<=prevMax)add('row_backfilled','integrity',table,c.id);
    }
    // Silmelerin meşruluğu: politika kararlı ve onaylı, aralıkta retention çalışması var, satır o çalışmanın sınırından eski.
    const pol=stablePolicy(policy);
    for(const d of deleted){
      if(!pol){add(changed.has(policy)?'deleted_under_policy_change':'deleted_without_policy','legal_regression',table,d.id);continue;}
      const cutoffOk=interval.some(r=>typeof r.counts[countKey]==='number'&&big(d.at_us)<big(r.ran_at_us)-BigInt(pol.retain_days)*DAY_US);
      if(!cutoffOk)add('deleted_before_retention','legal_regression',table,d.id);
    }
    // Sayım: aralıktaki çalışmaların bildirdiği silme sayısı gözlenenle birebir aynı olmalı.
    const counted=sumCount(countKey);
    if(counted>deleted.length)add('unseen_rows_deleted','integrity',table,'*',{counted,observed:deleted.length});
    if(counted<deleted.length&&deleted.length)add('deletion_not_counted','legal_regression',table,'*',{counted,observed:deleted.length});
    // Yeni satırların zinciri: tetikleyici yeni satırı ekleme anındaki son satıra bağlar. O satır ya şimdiki selefidir
    // ya da selef ile kendisi arasında kalan ve görülmüş (önceki listede bulunan) bir silinmiş satırdır; başka her şey
    // görülmemiş bir satırın varlığını gösterir.
    const deletedByHash=new Map(deleted.map(d=>[d.row_hash,d]));
    cur.leaves[table].forEach((c,i)=>{
      if(P.has(c.id))return;
      const pred=i?cur.leaves[table][i-1]:null;
      // Kimlik boşluğu tek başına kanıt değildir (geri alınan işlemler de dizi değeri tüketir): yalnız bilgi olarak kaydedilir.
      if(pred&&big(c.id)-big(pred.id)>1n&&!deleted.some(d=>big(d.id)>big(pred.id)&&big(d.id)<big(c.id)))add('id_gap','info',table,c.id,{after:pred.id});
      if(pred&&c.prev_hash===pred.row_hash)return;
      if(!pred&&c.prev_hash==='')return;
      const d=deletedByHash.get(c.prev_hash);
      if(d&&(!pred||big(d.id)>big(pred.id))&&big(d.id)<big(c.id))return;
      add('chain_gap_unexplained','integrity',table,c.id);
    });
  }

  // Yasal kayıtlar ve korumalar.
  const RP=byId(prev.leaves.records),RC=byId(cur.leaves.records);
  const HP=prev.leaves.holds,HC=byId(cur.leaves.holds);
  const prevRecMax=maxId(prev.leaves.records),prevHoldMax=maxId(prev.leaves.holds);
  for(const c of cur.leaves.records){
    const p=RP.get(c.id);
    if(!p){if(big(c.id)<=prevRecMax)add('record_backfilled','integrity','records',c.id);continue;}
    if(p.fixed_sha!==c.fixed_sha||p.snapshot_sha256!==c.snapshot_sha256||p.policy!==c.policy)add('record_modified','integrity','records',c.id);
    if(p.status==='closed'&&(c.status!=='closed'||p.closed_sha!==c.closed_sha))add('record_reopened_or_altered','integrity','records',c.id);
  }
  const newDest=cur.leaves.destructions.filter(d=>big(d.id)>maxId(prev.leaves.destructions));
  const destByRecord=new Map();
  for(const d of newDest)destByRecord.set(d.record_no,[...(destByRecord.get(d.record_no)||[]),d]);
  const destroyed=new Set();
  for(const p of prev.leaves.records){
    if(RC.has(p.id))continue;
    destroyed.add(p.id);
    const reasons=[];
    if(p.status!=='closed')reasons.push('not_seen_closed');
    if(HP.some(h=>h.record_id===p.id&&!h.released))reasons.push('active_hold');
    const pol=stablePolicy(p.policy);
    if(!pol)reasons.push(changed.has(p.policy)?'policy_changed':'policy_not_approved');
    const ds=destByRecord.get(p.id)||[];
    if(ds.length!==1)reasons.push(ds.length?'multiple_destruction_rows':'no_destruction_row');
    else if(pol&&p.status==='closed'){
      const d=ds[0];
      const holds=HP.filter(h=>h.record_id===p.id).length;
      if(d.rec_policy!==p.policy||d.retain_days!==pol.retain_days||d.opened_month!==p.opened_month||d.closed_month!==p.closed_month||d.holds_removed!==holds
        ||!['retention_expired','manual_expired'].includes(d.cause))reasons.push('destruction_row_mismatch');
      if(!(big(p.closed_at_us)+BigInt(pol.retain_days)*DAY_US<=big(d.at_us)))reasons.push('retention_not_elapsed');
    }
    if(reasons.length)add('record_deleted_unproven','legal_regression','records',p.id,{reasons});
  }
  for(const d of newDest)if(!destroyed.has(d.record_no))add('destruction_without_seen_record','legal_regression','destructions',d.id);
  for(const p of HP){
    const c=HC.get(p.id);
    if(!c){if(!destroyed.has(p.record_id))add('hold_deleted','integrity','holds',p.id);continue;}
    if(c.fixed_sha!==p.fixed_sha||(p.released&&(!c.released||c.release_sha!==p.release_sha)))add('hold_modified','integrity','holds',p.id);
  }
  for(const c of cur.leaves.holds)if(!HP.some(h=>h.id===c.id)&&big(c.id)<=prevHoldMax)add('hold_backfilled','integrity','holds',c.id);
  return f;
}

/** Bulgu → olay gerektiriyor mu? 'info' kaydedilir ama olay açmaz. */
const blocking=findings=>findings.filter(x=>x.severity==='integrity'||x.severity==='legal_regression');

module.exports={minus3Years,extractState,buildLeaves,roots,commitments,internalChecks,genesisFindings,verifyTransition,blocking,policyIndex,LISTS};

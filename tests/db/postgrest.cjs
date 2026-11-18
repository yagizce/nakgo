/** Yerel PostgREST: test veritabanına authenticator rolüyle bağlanır, public ve api şemalarını açar, Supabase'in auth.uid()
 * tanımını kurar. Yalnız testler için; NAKGO_POSTGREST_BIN ve yerel gerçek PostgreSQL (NAKGO_PG_HOST) gerekir. */
'use strict';
const crypto=require('node:crypto'),{spawn}=require('node:child_process');
const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');

/** schemas: PostgREST'in açtığı şemalar (varsayılan public,api; 'public' = api açılmamış Supabase gibi). */
async function startPostgrest(db,{schemas='public,api'}={}){
  const SECRET=crypto.randomBytes(32).toString('hex'),PW=crypto.randomBytes(16).toString('hex');
  const PORT=3900+Math.floor(Math.random()*90),ADMIN=PORT+100;
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
    do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$;
    alter role authenticator password '${PW}'; grant anon,authenticated to authenticator;`);
  const host=process.env.NAKGO_PG_HOST,port=process.env.NAKGO_PG_PORT||5432;
  const uri=host.startsWith('/')?`postgres://authenticator:${PW}@/${db.name}?host=${host}&port=${port}`:`postgres://authenticator:${PW}@${host}:${port}/${db.name}`;
  const proc=spawn(process.env.NAKGO_POSTGREST_BIN,[],{env:{PGRST_DB_URI:uri,PGRST_DB_SCHEMAS:schemas,PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:SECRET,
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(PORT),PGRST_ADMIN_SERVER_PORT:String(ADMIN),PGRST_LOG_LEVEL:'crit'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(`http://127.0.0.1:${ADMIN}/ready`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,150));}
  if(!ready){proc.kill();throw Error('PostgREST hazır değil');}
  const jwt=c=>{const h=b64({alg:'HS256',typ:'JWT'}),p=b64({aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+600,is_anonymous:false,...c});
    return h+'.'+p+'.'+crypto.createHmac('sha256',SECRET).update(h+'.'+p).digest('base64url');};
  /** POST /rpc/<fn>; schema null = varsayılan (public, v0). */
  const rpc=async(fn,{token=null,body={},schema='api'}={})=>{
    const h={'content-type':'application/json',accept:'application/json'};
    if(schema){h['content-profile']=schema;h['accept-profile']=schema;}
    if(token)h.authorization='Bearer '+token;
    const r=await fetch(`http://127.0.0.1:${PORT}/rpc/${fn}`,{method:'POST',headers:h,body:JSON.stringify(body)});
    const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null,raw:text};
  };
  const get=(path,token)=>fetch(`http://127.0.0.1:${PORT}${path}`,{headers:token?{authorization:'Bearer '+token}:{}});
  return {jwt,rpc,get,base:`http://127.0.0.1:${PORT}`,stop:()=>proc.kill()};
}
module.exports={startPostgrest};

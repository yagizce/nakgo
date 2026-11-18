-- Yasal kayıt ve delil arşivi (Aşama 3).
-- Beş kapalı tablo: legal_policies, legal_records, legal_holds, legal_access_log, legal_destructions.
-- Yasal kayıtlar ilan ve kullanıcıya yalnız ID ile işaret eder; hesap ya da ilan silinse de kalır.
-- Erişim: yalnız aktif, iki adımlı doğrulamalı (AAL2) ana yönetici ya da legal_access verilmiş yönetici.
-- Günlük ve tutanak tabloları yalnız eklenir ve SHA-256 zinciriyle bağlıdır. Veritabanı sahibi (postgres)
-- bu kuralları teknik olarak aşabilir; zincir ve dış yedek, değişikliğin fark edilmesini sağlar.
begin;

alter table private.admin_members add column legal_access boolean not null default false;

-- Oturum anahtarındaki doğrulama düzeyi (Supabase: aal1 / aal2). Anahtar Supabase tarafından imzalanır.
create function private.jwt_aal() returns text language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')
$$;
create function private.is_legal_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.jwt_aal()='aal2' and private.is_nakgo_admin()
  and exists(select 1 from private.admin_members where user_id=auth.uid() and active and (owner or legal_access));
$$;
create function private.is_legal_owner() returns boolean language sql stable security definer set search_path='' as $$
 select private.is_legal_admin() and exists(select 1 from private.admin_members where user_id=auth.uid() and active and owner);
$$;

-- Saklama politikaları. retain_days: kayıt kapandıktan sonraki süre. Onaysız politika otomatik imha yapmaz.
create table private.legal_policies (
 code text primary key check(code ~ '^[a-z_]{3,40}$'),
 label text not null check(char_length(label) between 3 and 100),
 legal_record boolean not null,
 retain_days integer check(retain_days between 1 and 36500),
 basis text not null default '' check(char_length(basis)<=500),
 approved_by uuid, approved_at timestamptz,
 check((approved_by is null)=(approved_at is null)),
 check(approved_at is null or retain_days is not null)
);
insert into private.legal_policies(code,label,legal_record,basis) values
 ('dispute','Hukuki uyuşmazlık',true,''),
 ('authority_request','Savcılık, mahkeme, kolluk talebi',true,''),
 ('unclassified','Panelden açılan saklama (türü belirlenmemiş)',true,''),
 ('listing','Normal ilan',false,'Mevcut kural (retention_run): süresi dolduktan 8 gün sonra arşiv, 1 yıl sonra silme'),
 ('access_log','Erişim ve IP kayıtları',false,'Mevcut kural (retention_run): 1 yıl'),
 ('admin_audit','Yönetici işlem geçmişi',false,'Mevcut kural (retention_run): 1 yıl'),
 ('legal_access_log','Yasal arşiv erişim günlüğü',false,''),
 ('destruction_record','İmha tutanakları',false,'Silme Yönetmeliği m.7/3: en az 3 yıl (hukukçu onayı bekleniyor)');

create table private.legal_records (
 id bigint generated always as identity primary key,
 policy text not null references private.legal_policies(code),
 listing_id bigint, user_id uuid,
 reason text not null check(char_length(reason) between 3 and 500),
 basis text not null default '' check(char_length(basis)<=500),
 request_no text not null default '' check(char_length(request_no)<=100),
 contact_basis text not null default '' check(char_length(contact_basis)<=500),
 opened_by uuid not null, opened_at timestamptz not null default now(),
 status text not null default 'open' check(status in('open','closed')),
 closed_by uuid, closed_at timestamptz, close_reason text check(char_length(close_reason) between 3 and 500),
 snapshot jsonb not null, snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 check(listing_id is not null or user_id is not null),
 check((status='closed')=(closed_at is not null and closed_by is not null and close_reason is not null))
);
create index legal_records_listing on private.legal_records(listing_id);
create index legal_records_user on private.legal_records(user_id);
create index legal_records_opened on private.legal_records(opened_at);
create index legal_records_policy on private.legal_records(policy,status);

create table private.legal_holds (
 id bigint generated always as identity primary key,
 record_id bigint not null references private.legal_records(id) on delete cascade,
 scope text not null check(scope in('listing','user')),
 listing_id bigint, user_id uuid,
 reason text not null check(char_length(reason) between 3 and 500),
 opened_by uuid not null, opened_at timestamptz not null default now(),
 released_by uuid, released_at timestamptz, release_reason text check(char_length(release_reason) between 3 and 500),
 check((scope='listing')=(listing_id is not null) and (scope='user')=(user_id is not null)),
 check((released_at is null)=(released_by is null) and (released_at is null)=(release_reason is null))
);
create index legal_holds_record on private.legal_holds(record_id);
create index legal_holds_listing_active on private.legal_holds(listing_id) where released_at is null;
create index legal_holds_user_active on private.legal_holds(user_id) where released_at is null;

-- Zincirli günlükler: id ve önceki özet, kilit altında tetikleyicide verilir; sıra, işlem sırasıyla aynıdır.
create sequence private.legal_access_log_id;
create table private.legal_access_log (
 id bigint primary key,
 at timestamptz not null default now(),
 actor uuid,
 action text not null check(action in('list','search','view_record','view_access','view_policies','view_destructions','view_integrity',
  'export','record_open','hold_add','hold_release','record_close','destroy','grant_legal','revoke_legal','policy_approve')),
 record_id bigint,
 detail jsonb not null default '{}' check(octet_length(detail::text)<=4000),
 prev_hash text not null, row_hash text not null
);
create index legal_access_log_at on private.legal_access_log(at);
create index legal_access_log_record on private.legal_access_log(record_id);

-- İmha tutanağı: kişisel veri yok. Kullanıcı ID, ilan ID, gerekçe metni ve özet bilerek tutulmaz.
create sequence private.legal_destructions_id;
create table private.legal_destructions (
 id bigint primary key,
 at timestamptz not null default now(),
 record_no bigint not null,
 policy text not null,
 retain_days integer not null,
 opened_month date not null,
 closed_month date not null,
 holds_removed integer not null,
 cause text not null check(cause in('retention_expired','manual_expired')),
 actor uuid,
 check((cause='retention_expired')=(actor is null)),
 prev_hash text not null, row_hash text not null
);

alter table private.legal_policies enable row level security;
alter table private.legal_records enable row level security;
alter table private.legal_holds enable row level security;
alter table private.legal_access_log enable row level security;
alter table private.legal_destructions enable row level security;
revoke all on private.legal_policies,private.legal_records,private.legal_holds,private.legal_access_log,private.legal_destructions from public,anon,authenticated;
revoke all on sequence private.legal_records_id_seq,private.legal_holds_id_seq,private.legal_access_log_id,private.legal_destructions_id from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  execute 'revoke all on private.legal_policies,private.legal_records,private.legal_holds,private.legal_access_log,private.legal_destructions from service_role';
 end if;
end $$;

create function private.legal_hash(j jsonb) returns text language sql immutable set search_path='' as $$
 select encode(pg_catalog.sha256(convert_to((j-'row_hash')::text,'UTF8')),'hex')
$$;
create function private.legal_chain() returns trigger language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(7310,case when tg_table_name='legal_access_log' then 1 else 2 end);
 if tg_table_name='legal_access_log' then
  new.id:=nextval('private.legal_access_log_id');
  new.prev_hash:=coalesce((select row_hash from private.legal_access_log order by id desc limit 1),'');
 else
  new.id:=nextval('private.legal_destructions_id');
  new.prev_hash:=coalesce((select row_hash from private.legal_destructions order by id desc limit 1),'');
 end if;
 new.row_hash:='';
 new.row_hash:=private.legal_hash(to_jsonb(new));
 return new;
end $$;
create function private.legal_append_only() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and current_setting('nakgo.legal_purge',true)='on' then return old; end if;
 raise exception 'Append-only legal table' using errcode='42501';
end $$;
create function private.legal_no_truncate() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Legal tables cannot be truncated' using errcode='42501'; end $$;
create function private.legal_record_guard() returns trigger language plpgsql set search_path='' as $$
declare fixed text[]:=array['status','closed_by','closed_at','close_reason'];
begin
 if tg_op='DELETE' then
  if current_setting('nakgo.legal_purge',true)='on' then return old; end if;
  raise exception 'Legal records are removed only by destruction' using errcode='42501';
 end if;
 if old.status<>'open' or new.status<>'closed' or (to_jsonb(new)-fixed)<>(to_jsonb(old)-fixed) then
  raise exception 'Legal record is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create function private.legal_hold_guard() returns trigger language plpgsql set search_path='' as $$
declare fixed text[]:=array['released_by','released_at','release_reason'];
begin
 if tg_op='DELETE' then
  if current_setting('nakgo.legal_purge',true)='on' then return old; end if;
  raise exception 'Legal holds are removed only by destruction' using errcode='42501';
 end if;
 if old.released_at is not null or new.released_at is null or (to_jsonb(new)-fixed)<>(to_jsonb(old)-fixed) then
  raise exception 'Legal hold is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger legal_access_log_chain before insert on private.legal_access_log for each row execute function private.legal_chain();
create trigger legal_destructions_chain before insert on private.legal_destructions for each row execute function private.legal_chain();
create trigger legal_access_log_append before update or delete on private.legal_access_log for each row execute function private.legal_append_only();
create trigger legal_destructions_append before update or delete on private.legal_destructions for each row execute function private.legal_append_only();
create trigger legal_records_guard before update or delete on private.legal_records for each row execute function private.legal_record_guard();
create trigger legal_holds_guard before update or delete on private.legal_holds for each row execute function private.legal_hold_guard();
create trigger legal_access_log_truncate before truncate on private.legal_access_log for each statement execute function private.legal_no_truncate();
create trigger legal_destructions_truncate before truncate on private.legal_destructions for each statement execute function private.legal_no_truncate();
create trigger legal_records_truncate before truncate on private.legal_records for each statement execute function private.legal_no_truncate();
create trigger legal_holds_truncate before truncate on private.legal_holds for each statement execute function private.legal_no_truncate();

-- Zincirin baştan sona doğrulanması (bağımsız denetim ve gece yedek testi için).
create function private.legal_chain_check() returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare t text; r record; prev text; bad integer; total integer; c jsonb:='{}';
begin
 foreach t in array array['legal_access_log','legal_destructions'] loop
  prev:=null; bad:=0; total:=0;
  for r in execute format('select to_jsonb(x) j from private.%I x order by id',t) loop
   total:=total+1;
   if (prev is not null and r.j->>'prev_hash'<>prev) or r.j->>'row_hash'<>private.legal_hash(r.j) then bad:=bad+1; end if;
   prev:=r.j->>'row_hash';
  end loop;
  c:=c||jsonb_build_object(t,jsonb_build_object('rows',total,'broken',bad,'head',coalesce(prev,'')));
 end loop;
 return c;
end $$;

create function private.legal_log(p_action text,p_record bigint,p_detail jsonb) returns void language sql security definer set search_path='' as $$
 insert into private.legal_access_log(actor,action,record_id,detail,prev_hash,row_hash) values(auth.uid(),p_action,p_record,coalesce(p_detail,'{}'),'','');
$$;

-- Dondurulmuş özet. Telefon, e-posta ve IP yalnız p_contacts ile (dayanak yazılarak) eklenir.
create function private.legal_snapshot(p_listing bigint,p_user uuid,p_contacts boolean) returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare s jsonb:=jsonb_build_object('taken_at',now()); l public.listings;
begin
 if p_listing is not null then
  select * into l from public.listings where id=p_listing;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  s:=s||jsonb_build_object('listing',jsonb_build_object('id',l.id,'owner_id',l.owner_id,'kind',l.kind,'from_city',l.from_city,'to_city',l.to_city,
   'from_district',l.from_district,'to_district',l.to_district,'vehicle',l.vehicle,'body',l.body,'amount',l.amount,'cargo',l.cargo,'items',l.items,
   'note',l.note,'owner_label',l.owner_label,'loading_text',l.loading_text,'available_on',l.available_on,'available_until',l.available_until,
   'status',l.status,'created_at',l.created_at,'updated_at',l.updated_at,'expires_at',l.expires_at,'redacted_at',l.redacted_at),
   'moderation',(select jsonb_build_object('removed',m.removed,'reason',m.reason,'updated_at',m.updated_at) from private.listing_moderation m where m.listing_id=p_listing));
  if p_contacts then
   s:=s||jsonb_build_object('contact',jsonb_build_object('phone',l.contact_phone,
    'email',(select email from auth.users where id=l.owner_id),
    'ips',coalesce((select jsonb_agg(distinct host(a.ip)) from private.access_log a where a.listing_id=p_listing and a.ip is not null),'[]')));
  end if;
 end if;
 if p_user is not null then
  s:=s||jsonb_build_object('account',jsonb_build_object('id',p_user,
   'profile',(select jsonb_build_object('display_name',p.display_name,'account_type',p.account_type,'created_at',p.created_at) from public.profiles p where p.id=p_user),
   'moderation',(select jsonb_build_object('suspended',m.suspended,'banned',m.banned,'deleted_at',m.deleted_at) from private.account_moderation m where m.user_id=p_user),
   'listing_ids',coalesce((select jsonb_agg(id order by id) from public.listings where owner_id=p_user),'[]')));
  if p_contacts then
   s:=s||jsonb_build_object('account_contact',jsonb_build_object(
    'email',(select email from auth.users where id=p_user),
    'phone',(select nullif(phone,'') from public.profiles where id=p_user),
    'ips',coalesce((select jsonb_agg(ip) from (select distinct host(a.ip) ip from private.access_log a where a.user_id=p_user and a.ip is not null limit 100) x),'[]')));
  end if;
 end if;
 return s;
end $$;

-- İlanın listing_moderation.hold işaretini aktif ilan korumalarına göre eşitler (mevcut temizlik kodu bu işarete bakar).
-- Gerekçe buraya yazılmaz; normal yöneticiler yalnız etiketi görür.
create function private.legal_sync_listing(p_listing bigint) returns void language plpgsql security definer set search_path='' as $$
declare want boolean:=exists(select 1 from private.legal_holds where listing_id=p_listing and released_at is null);
begin
 if not exists(select 1 from public.listings where id=p_listing) then return; end if;
 insert into private.listing_moderation(listing_id) values(p_listing) on conflict do nothing;
 update private.listing_moderation set hold=want,hold_reason=case when want then 'Yasal koruma altında' else '' end,revision=revision+1,updated_at=now()
 where listing_id=p_listing and hold is distinct from want;
end $$;

create function private.legal_open(p_policy text,p_listing bigint,p_user uuid,p_reason text,p_basis text,p_request text,p_contacts boolean,p_contact_basis text,p_hold boolean)
returns bigint language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare rid bigint; owner_user uuid; snap jsonb;
begin
 if not exists(select 1 from private.legal_policies where code=p_policy and legal_record) then raise exception 'Invalid policy' using errcode='22023'; end if;
 if p_contacts and char_length(btrim(coalesce(p_contact_basis,''))) not between 3 and 500 then raise exception 'Contact basis required' using errcode='22023'; end if;
 if p_listing is not null then
  select owner_id into owner_user from public.listings where id=p_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
 elsif p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'User unavailable' using errcode='22023';
 end if;
 snap:=private.legal_snapshot(p_listing,case when p_listing is null then p_user end,p_contacts);
 insert into private.legal_records(policy,listing_id,user_id,reason,basis,request_no,contact_basis,opened_by,snapshot,snapshot_sha256)
 values(p_policy,p_listing,coalesce(p_user,owner_user),btrim(p_reason),btrim(coalesce(p_basis,'')),btrim(coalesce(p_request,'')),
  case when p_contacts then btrim(p_contact_basis) else '' end,auth.uid(),snap,encode(pg_catalog.sha256(convert_to(snap::text,'UTF8')),'hex'))
 returning id into rid;
 if p_hold then
  insert into private.legal_holds(record_id,scope,listing_id,user_id,reason,opened_by)
  values(rid,case when p_listing is null then 'user' else 'listing' end,p_listing,case when p_listing is null then p_user end,btrim(p_reason),auth.uid());
  if p_listing is not null then perform private.legal_sync_listing(p_listing); end if;
 end if;
 perform private.legal_log('record_open',rid,jsonb_build_object('policy',p_policy,'hold',p_hold,'contacts',p_contacts));
 return rid;
end $$;

create function private.legal_release(p_hold bigint,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare h private.legal_holds;
begin
 select * into h from private.legal_holds where id=p_hold for update;
 if not found or h.released_at is not null then raise exception 'Hold unavailable' using errcode='22023'; end if;
 update private.legal_holds set released_by=auth.uid(),released_at=now(),release_reason=btrim(p_reason) where id=p_hold;
 if h.listing_id is not null then perform private.legal_sync_listing(h.listing_id); end if;
 perform private.legal_log('hold_release',h.record_id,jsonb_build_object('hold',p_hold));
end $$;

create function private.legal_close(p_record bigint,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.legal_records where id=p_record and status='open' for update;
 if not found then raise exception 'Record unavailable' using errcode='22023'; end if;
 if exists(select 1 from private.legal_holds where record_id=p_record and released_at is null) then raise exception 'Active hold' using errcode='22023'; end if;
 update private.legal_records set status='closed',closed_by=auth.uid(),closed_at=now(),close_reason=btrim(p_reason) where id=p_record;
 perform private.legal_log('record_close',p_record,'{}');
end $$;

-- Süresi dolan ve koruması olmayan kayıt; politika süresi hukukçu onaylı olmalı.
create function private.legal_expired(r private.legal_records) returns boolean language sql stable security definer set search_path='' as $$
 select r.status='closed'
  and exists(select 1 from private.legal_policies p where p.code=r.policy and p.approved_at is not null and r.closed_at+p.retain_days*interval '1 day'<=now())
  and not exists(select 1 from private.legal_holds h where h.record_id=r.id and h.released_at is null);
$$;

create function private.legal_destroy(p_record bigint,p_cause text) returns void language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r private.legal_records; days integer; n integer;
begin
 select * into r from private.legal_records where id=p_record for update;
 if not found or not private.legal_expired(r) then raise exception 'Record not destroyable' using errcode='22023'; end if;
 select retain_days into days from private.legal_policies where code=r.policy;
 select count(*) into n from private.legal_holds where record_id=p_record;
 perform set_config('nakgo.legal_purge','on',true);
 delete from private.legal_records where id=p_record;
 perform set_config('nakgo.legal_purge','off',true);
 insert into private.legal_destructions(record_no,policy,retain_days,opened_month,closed_month,holds_removed,cause,actor,prev_hash,row_hash)
 values(p_record,r.policy,days,date_trunc('month',r.opened_at)::date,date_trunc('month',r.closed_at)::date,n,p_cause,
  case when p_cause='manual_expired' then auth.uid() end,'','');
end $$;

revoke all on function private.jwt_aal(),private.is_legal_admin(),private.is_legal_owner(),private.legal_hash(jsonb),private.legal_chain(),
 private.legal_append_only(),private.legal_no_truncate(),private.legal_record_guard(),private.legal_hold_guard(),private.legal_chain_check(),
 private.legal_log(text,bigint,jsonb),private.legal_snapshot(bigint,uuid,boolean),private.legal_sync_listing(bigint),
 private.legal_open(text,bigint,uuid,text,text,text,boolean,text,boolean),private.legal_release(bigint,text),private.legal_close(bigint,text),
 private.legal_expired(private.legal_records),private.legal_destroy(bigint,text) from public,anon,authenticated;

-- Okuma: her çağrı sonuç dönmeden önce legal_access_log'a yazılır; yazılamazsa sonuç da dönmez.
create function public.nakgo_legal_page(p_section text,p_offset integer default 0,p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare q jsonb:=coalesce(p_query,'{}'); q_listing bigint; q_user uuid; q_from date; q_to date; q_policy text; q_hold text; q_ret text; q_record bigint;
 res jsonb; filtered boolean;
begin
 if not private.is_legal_admin() then raise exception 'Legal access required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or jsonb_typeof(q)<>'object' or octet_length(q::text)>2000 then raise exception 'Invalid query' using errcode='22023'; end if;
 if coalesce(q->>'listing','')<>'' then if q->>'listing'!~'^[0-9]{1,15}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_listing:=(q->>'listing')::bigint; end if;
 if coalesce(q->>'user','')<>'' then if q->>'user'!~'^[0-9a-f-]{36}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_user:=(q->>'user')::uuid; end if;
 if coalesce(q->>'from','')<>'' then if q->>'from'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_from:=(q->>'from')::date; end if;
 if coalesce(q->>'to','')<>'' then if q->>'to'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_to:=(q->>'to')::date; end if;
 if coalesce(q->>'policy','')<>'' then if not exists(select 1 from private.legal_policies where code=q->>'policy') then raise exception 'Invalid query' using errcode='22023'; end if; q_policy:=q->>'policy'; end if;
 if coalesce(q->>'hold','')<>'' then if q->>'hold' not in('active','none') then raise exception 'Invalid query' using errcode='22023'; end if; q_hold:=q->>'hold'; end if;
 if coalesce(q->>'retention','')<>'' then if q->>'retention' not in('expired','soon','pending') then raise exception 'Invalid query' using errcode='22023'; end if; q_ret:=q->>'retention'; end if;
 if coalesce(q->>'record','')<>'' then if q->>'record'!~'^[0-9]{1,15}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_record:=(q->>'record')::bigint; end if;

 if p_section='records' then
  filtered:=coalesce(q_listing::text,q_user::text,q_from::text,q_to::text,q_policy,q_hold,q_ret) is not null;
  perform private.legal_log(case when filtered then 'search' else 'list' end,null,jsonb_build_object('query',q,'offset',p_offset));
  select coalesce(jsonb_agg(x order by x->>'opened_at' desc,(x->>'id')::bigint desc),'[]') into res from (
   select jsonb_build_object('id',r.id,'policy',r.policy,'listing_id',r.listing_id,'user_id',r.user_id,'reason',r.reason,'request_no',r.request_no,
    'opened_at',r.opened_at,'status',r.status,'closed_at',r.closed_at,
    'active_holds',(select count(*) from private.legal_holds h where h.record_id=r.id and h.released_at is null),
    'retain_until',case when r.status='closed' and p.approved_at is not null then r.closed_at+p.retain_days*interval '1 day' end,
    'policy_pending',p.approved_at is null) x
   from private.legal_records r join private.legal_policies p on p.code=r.policy
   where (q_listing is null or r.listing_id=q_listing) and (q_user is null or r.user_id=q_user)
    and (q_from is null or r.opened_at>=q_from) and (q_to is null or r.opened_at<q_to+1)
    and (q_policy is null or r.policy=q_policy)
    and (q_hold is null or (q_hold='active')=exists(select 1 from private.legal_holds h where h.record_id=r.id and h.released_at is null))
    and (q_ret is null
     or (q_ret='pending' and p.approved_at is null)
     or (q_ret='expired' and private.legal_expired(r))
     or (q_ret='soon' and r.status='closed' and p.approved_at is not null and r.closed_at+p.retain_days*interval '1 day' between now() and now()+interval '30 days'))
   order by r.opened_at desc,r.id desc offset p_offset limit 50) y;
  return res;
 elsif p_section='record' then
  if q_record is null then raise exception 'Invalid query' using errcode='22023'; end if;
  perform private.legal_log('view_record',q_record,'{}');
  select jsonb_build_object('record',to_jsonb(r)||jsonb_build_object('snapshot_valid',r.snapshot_sha256=encode(pg_catalog.sha256(convert_to(r.snapshot::text,'UTF8')),'hex'),
    'retain_until',case when r.status='closed' and p.approved_at is not null then r.closed_at+p.retain_days*interval '1 day' end,'policy_pending',p.approved_at is null),
   'holds',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from private.legal_holds h where h.record_id=r.id),'[]'))
  into res from private.legal_records r join private.legal_policies p on p.code=r.policy where r.id=q_record;
  if res is null then raise exception 'Record unavailable' using errcode='22023'; end if;
  return res;
 elsif p_section='access' then
  perform private.legal_log('view_access',q_record,jsonb_build_object('offset',p_offset));
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',at,'actor',actor,'action',action,'record_id',record_id,'detail',detail) order by id desc),'[]') into res
  from (select * from private.legal_access_log where q_record is null or record_id=q_record order by id desc offset p_offset limit 50) a;
  return res;
 elsif p_section='policies' then
  perform private.legal_log('view_policies',null,'{}');
  select jsonb_agg(jsonb_build_object('code',p.code,'label',p.label,'legal_record',p.legal_record,'retain_days',p.retain_days,'basis',p.basis,
   'approved_at',p.approved_at,'approved_by',p.approved_by,'pending',p.approved_at is null,
   'open',(select count(*) from private.legal_records r where r.policy=p.code and r.status='open'),
   'closed',(select count(*) from private.legal_records r where r.policy=p.code and r.status='closed')) order by p.legal_record desc,p.code) into res
  from private.legal_policies p;
  return res;
 elsif p_section='destructions' then
  perform private.legal_log('view_destructions',null,jsonb_build_object('offset',p_offset));
  select coalesce(jsonb_agg(to_jsonb(d)-'prev_hash'-'row_hash' order by d.id desc),'[]') into res
  from (select * from private.legal_destructions order by id desc offset p_offset limit 50) d;
  return res;
 elsif p_section='integrity' then
  perform private.legal_log('view_integrity',null,'{}');
  return private.legal_chain_check()||jsonb_build_object('invalid_snapshots',
   (select count(*) from private.legal_records r where r.snapshot_sha256<>encode(pg_catalog.sha256(convert_to(r.snapshot::text,'UTF8')),'hex')));
 end if;
 raise exception 'Invalid section' using errcode='22023';
end $$;

-- Yazma: kayıt açma, koruma, kapatma, imha, dışa aktarma, yetki ve politika onayı.
create function public.nakgo_legal_action(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare d jsonb:=coalesce(p_data,'{}'); reason text:=btrim(coalesce(d->>'reason','')); rid bigint; hid bigint; v_listing bigint; v_user uuid;
 cols text[]; allowed text[]:=array['id','policy','listing_id','user_id','reason','basis','request_no','opened_at','status','closed_at','retain_until','active_holds'];
 ids bigint[]; res jsonb; target uuid; days integer;
begin
 if not private.is_legal_admin() then raise exception 'Legal access required' using errcode='42501'; end if;
 if jsonb_typeof(d)<>'object' or octet_length(d::text)>8000 then raise exception 'Invalid request' using errcode='22023'; end if;
 if coalesce(d->>'listing','')<>'' then if d->>'listing'!~'^[0-9]{1,15}$' then raise exception 'Invalid request' using errcode='22023'; end if; v_listing:=(d->>'listing')::bigint; end if;
 if coalesce(d->>'user','')<>'' then if d->>'user'!~'^[0-9a-f-]{36}$' then raise exception 'Invalid request' using errcode='22023'; end if; v_user:=(d->>'user')::uuid; end if;
 if coalesce(d->>'record','')<>'' then if d->>'record'!~'^[0-9]{1,15}$' then raise exception 'Invalid request' using errcode='22023'; end if; rid:=(d->>'record')::bigint; end if;
 if coalesce(d->>'hold','')<>'' then if d->>'hold'!~'^[0-9]{1,15}$' then raise exception 'Invalid request' using errcode='22023'; end if; hid:=(d->>'hold')::bigint; end if;
 if p_action in('open','add_hold','release_hold','close','grant_legal','revoke_legal','approve_policy') and char_length(reason) not between 3 and 500 then
  raise exception 'Reason required' using errcode='22023';
 end if;

 if p_action='open' then
  if (v_listing is null)=(v_user is null) then raise exception 'Listing or user required' using errcode='22023'; end if;
  rid:=private.legal_open(coalesce(d->>'policy',''),v_listing,v_user,reason,d->>'basis',d->>'request_no',
   coalesce((d->>'contacts')::boolean,false),d->>'contact_basis',coalesce((d->>'hold')::boolean,true));
  return jsonb_build_object('record',rid);
 elsif p_action='add_hold' then
  if rid is null or (v_listing is null)=(v_user is null) then raise exception 'Invalid request' using errcode='22023'; end if;
  perform 1 from private.legal_records where id=rid and status='open' for update;
  if not found then raise exception 'Record unavailable' using errcode='22023'; end if;
  if v_listing is not null and not exists(select 1 from public.listings where id=v_listing) then raise exception 'Listing unavailable' using errcode='22023'; end if;
  if v_user is not null and not exists(select 1 from auth.users where id=v_user) then raise exception 'User unavailable' using errcode='22023'; end if;
  insert into private.legal_holds(record_id,scope,listing_id,user_id,reason,opened_by)
  values(rid,case when v_listing is null then 'user' else 'listing' end,v_listing,v_user,reason,auth.uid()) returning id into hid;
  if v_listing is not null then perform private.legal_sync_listing(v_listing); end if;
  perform private.legal_log('hold_add',rid,jsonb_build_object('hold',hid,'scope',case when v_listing is null then 'user' else 'listing' end));
  return jsonb_build_object('hold',hid);
 elsif p_action='release_hold' then
  if hid is null then raise exception 'Invalid request' using errcode='22023'; end if;
  perform private.legal_release(hid,reason);
  return jsonb_build_object('hold',hid);
 elsif p_action='close' then
  if rid is null then raise exception 'Invalid request' using errcode='22023'; end if;
  perform private.legal_close(rid,reason);
  return jsonb_build_object('record',rid);
 elsif p_action='destroy' then
  if rid is null then raise exception 'Invalid request' using errcode='22023'; end if;
  perform private.legal_destroy(rid,'manual_expired');
  perform private.legal_log('destroy',rid,'{}');
  return jsonb_build_object('record',rid);
 elsif p_action='export' then
  -- Dışa aktarılacak satırlar yalnız buradan gelir; aktarma, veri dönmeden önce günlüğe yazılır.
  if jsonb_typeof(d->'records')<>'array' or jsonb_array_length(d->'records') not between 1 and 500
   or jsonb_typeof(d->'columns')<>'array' or coalesce(d->>'format','') not in('csv','pdf') then raise exception 'Invalid request' using errcode='22023'; end if;
  select array_agg(value) into cols from jsonb_array_elements_text(d->'columns');
  if cols is null or not cols<@allowed then raise exception 'Invalid request' using errcode='22023'; end if;
  begin select array_agg(value::bigint) into ids from jsonb_array_elements_text(d->'records'); exception when others then raise exception 'Invalid request' using errcode='22023'; end;
  perform private.legal_log('export',null,jsonb_build_object('format',d->>'format','columns',to_jsonb(cols),'records',to_jsonb(ids)));
  select coalesce(jsonb_agg((select jsonb_object_agg(k,x->k) from unnest(cols) k) order by (x->>'id')::bigint),'[]') into res from (
   select jsonb_build_object('id',r.id,'policy',r.policy,'listing_id',r.listing_id,'user_id',r.user_id,'reason',r.reason,'basis',r.basis,'request_no',r.request_no,
    'opened_at',r.opened_at,'status',r.status,'closed_at',r.closed_at,
    'retain_until',case when r.status='closed' and p.approved_at is not null then r.closed_at+p.retain_days*interval '1 day' end,
    'active_holds',(select count(*) from private.legal_holds h where h.record_id=r.id and h.released_at is null)) x
   from private.legal_records r join private.legal_policies p on p.code=r.policy where r.id=any(ids)) y;
  return res;
 elsif p_action in('grant_legal','revoke_legal') then
  if not private.is_legal_owner() then raise exception 'Owner required' using errcode='42501'; end if;
  if v_user is null then raise exception 'Invalid request' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(7291);
  if not exists(select 1 from private.admin_members where user_id=v_user and active and not owner) then raise exception 'Administrator unavailable' using errcode='22023'; end if;
  update private.admin_members set legal_access=(p_action='grant_legal') where user_id=v_user;
  perform private.legal_log(p_action,null,jsonb_build_object('user',v_user,'reason',reason));
  return jsonb_build_object('user',v_user,'legal_access',p_action='grant_legal');
 elsif p_action='approve_policy' then
  if not private.is_legal_owner() then raise exception 'Owner required' using errcode='42501'; end if;
  if coalesce(d->>'days','')!~'^[0-9]{1,5}$' then raise exception 'Invalid request' using errcode='22023'; end if;
  days:=(d->>'days')::integer;
  if days not between 1 and 36500 then raise exception 'Invalid request' using errcode='22023'; end if;
  update private.legal_policies set retain_days=days,basis=reason,approved_by=auth.uid(),approved_at=now()
  where code=coalesce(d->>'policy','') and code not in('listing','access_log','admin_audit');
  if not found then raise exception 'Invalid policy' using errcode='22023'; end if;
  perform private.legal_log('policy_approve',null,jsonb_build_object('policy',d->>'policy','days',days));
  return jsonb_build_object('policy',d->>'policy','days',days);
 end if;
 raise exception 'Invalid action' using errcode='22023';
end $$;
revoke all on function public.nakgo_legal_page(text,integer,jsonb),public.nakgo_legal_action(text,jsonb) from public,anon;
grant execute on function public.nakgo_legal_page(text,integer,jsonb),public.nakgo_legal_action(text,jsonb) to authenticated;

-- Panel düğmesi (saklamaya al / kaldır): artık yasal yetki ve AAL2 ister; yasal kayıt ve koruma açar.
-- Yönetici işlem geçmişine gerekçe yerine yalnız "Yasal kayıt #N" yazılır.
create or replace function public.nakgo_admin_moderate(p_kind text,p_target text,p_action text,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_user uuid; target_listing bigint; v bigint; desired boolean; current_state boolean; reason_value text:=btrim(coalesce(p_reason,''));
 m private.account_moderation; is_admin boolean; is_owner boolean; rid bigint; h record;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or char_length(reason_value) not between 3 and 500 then raise exception 'Invalid moderation' using errcode='22023'; end if;
 if p_kind='user' and p_action in('suspend','resume','ban','unban','delete','grant_admin','revoke_admin') then
  if p_target!~'^[0-9a-f-]{36}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_user:=p_target::uuid;
  if not exists(select 1 from public.profiles where id=target_user) then raise exception 'User unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,7290));
  -- Serialise administrator changes so the last administrator can never be removed by two admins at once.
  perform pg_catalog.pg_advisory_xact_lock(7291);
  select coalesce(bool_or(active),false),coalesce(bool_or(active and owner),false) into is_admin,is_owner from private.admin_members where user_id=target_user;
  if target_user=actor or is_owner then raise exception 'Protected administrator' using errcode='42501'; end if;
  if is_admin and p_action<>'revoke_admin' then raise exception 'Protected administrator' using errcode='42501'; end if;
  insert into private.account_moderation(user_id) values(target_user) on conflict do nothing;
  select * into m from private.account_moderation where user_id=target_user for update;v:=m.revision;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if m.deleted_at is not null then raise exception 'Account deleted' using errcode='22023'; end if;
  if p_action in('suspend','resume') then
   desired:=p_action='suspend';
   if m.banned then raise exception 'Account banned' using errcode='22023'; end if;
   if m.suspended=desired then return jsonb_build_object('revision',v,'changed',false); end if;
   update private.account_moderation set suspended=desired,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  elsif p_action in('ban','unban') then
   desired:=p_action='ban';
   if m.banned=desired then return jsonb_build_object('revision',v,'changed',false); end if;
   -- Ban kalkınca bandan önceki askıya alma durumu geri gelir.
   update private.account_moderation set banned=desired,
    suspended=case when desired then true else m.suspended_before_ban end,
    suspended_before_ban=case when desired then m.suspended else false end,
    revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
   perform private.auth_lock(target_user,desired);
   if desired then update public.listings set status='closed' where owner_id=target_user and status='active'; end if;
  elsif p_action='delete' then
   update private.account_moderation set banned=true,suspended=true,deleted_at=now(),deleted_by_self=false,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
   perform private.erase_account(target_user);
  elsif p_action='grant_admin' then
   if is_admin then return jsonb_build_object('revision',v,'changed',false); end if;
   if m.suspended or m.banned or not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null) then raise exception 'Account not eligible' using errcode='22023'; end if;
   insert into private.admin_members(user_id,active,granted_at,granted_by) values(target_user,true,now(),actor)
    on conflict(user_id) do update set active=true,granted_at=now(),granted_by=actor;
   update private.account_moderation set revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  else
   if not is_admin then return jsonb_build_object('revision',v,'changed',false); end if;
   if (select count(*) from private.admin_members where active)<=1 then raise exception 'Last administrator' using errcode='42501'; end if;
   update private.admin_members set active=false,legal_access=false where user_id=target_user;
   update private.account_moderation set revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  end if;
 elsif p_kind='listing' and p_action in('hold','release') then
  -- Yasal saklama: ayrı yasal kayıt ve koruma açar; gece temizliği koruma kalkana kadar ilana dokunmaz.
  if not private.is_legal_admin() then raise exception 'Legal access required' using errcode='42501'; end if;
  if p_target!~'^[0-9]{1,15}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_listing:=p_target::bigint;desired:=p_action='hold';
  perform 1 from public.listings where id=target_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  insert into private.listing_moderation(listing_id) values(target_listing) on conflict do nothing;
  select revision,hold into v,current_state from private.listing_moderation where listing_id=target_listing for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  if desired then
   rid:=private.legal_open('unclassified',target_listing,null,reason_value,'','',false,'',true);
   reason_value:='Yasal kayıt #'||rid;
  else
   -- Bu ilandaki bütün aktif korumalar kalkar; başka aktif koruması kalmayan kayıtlar kapanır.
   for h in select id,record_id from private.legal_holds where listing_id=target_listing and released_at is null order by id loop
    perform private.legal_release(h.id,reason_value);
    if not exists(select 1 from private.legal_holds where record_id=h.record_id and released_at is null)
     and exists(select 1 from private.legal_records where id=h.record_id and status='open') then perform private.legal_close(h.record_id,reason_value); end if;
    rid:=h.record_id;
   end loop;
   -- Eski (yasal kaydı olmayan) işaret varsa yine de kaldırılır.
   update private.listing_moderation set hold=false,hold_reason='',revision=v+1,updated_at=now() where listing_id=target_listing and hold;
   reason_value:=case when rid is null then 'Yasal koruma kaldırıldı' else 'Yasal kayıt #'||rid end;
  end if;
  -- legal_sync_listing revizyonu bir artırdı; denetim satırı aynı revizyonu kullanır.
  if (select revision from private.listing_moderation where listing_id=target_listing)<>v+1 then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
 elsif p_kind='listing' and p_action in('remove','restore') then
  if p_target!~'^[0-9]{1,15}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_listing:=p_target::bigint;desired:=p_action='remove';
  perform 1 from public.listings where id=target_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  insert into private.listing_moderation(listing_id) values(target_listing) on conflict do nothing;
  select revision,removed into v,current_state from private.listing_moderation where listing_id=target_listing for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  update private.listing_moderation set removed=desired,revision=v+1,reason=reason_value,updated_at=now() where listing_id=target_listing;
  -- Restore means unlock into closed state; never republish expired listings.
  update public.listings set status=case when desired then 'archived' else 'closed' end where id=target_listing;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(actor,p_target,p_action,reason_value,v+1);
 return jsonb_build_object('revision',v+1,'changed',true);
end $$;
revoke all on function public.nakgo_admin_moderate(text,text,text,text,bigint) from public,anon;
grant execute on function public.nakgo_admin_moderate(text,text,text,text,bigint) to authenticated;

-- Hesap silme: korunan her ilanın ve kullanıcının bağımsız ve bütünlüğü doğrulanmış yasal kopyası yoksa silme durur.
create or replace function private.erase_account(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lock_timeout','10s',true);
 if exists(select 1 from public.listings l join private.listing_moderation m on m.listing_id=l.id
   where l.owner_id=p_user and m.hold and not exists(select 1 from private.legal_holds h where h.listing_id=l.id and h.released_at is null)) then
  raise exception 'Held listing has no legal record' using errcode='55000';
 end if;
 if exists(select 1 from private.legal_holds h join private.legal_records r on r.id=h.record_id
   where h.released_at is null and (h.user_id=p_user or h.listing_id in(select id from public.listings where owner_id=p_user))
    and r.snapshot_sha256<>encode(pg_catalog.sha256(convert_to(r.snapshot::text,'UTF8')),'hex')) then
  raise exception 'Legal snapshot invalid' using errcode='55000';
 end if;
 -- Erasure is not user activity: skip the activity guards only inside this transaction.
 alter table public.listings disable trigger moderation_listing;
 alter table public.profiles disable trigger moderation_profile;
 update public.listings l set status=case when l.status='active' then 'closed' else l.status end,note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
  loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=coalesce(l.redacted_at,now())
 where l.owner_id=p_user
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.hold);
 -- Yasal saklamadaki ilan (KVKK m.5/2-ç,e): içerik korunur, yalnız yayından kalkar. Saklama kalkınca gece temizliği siler.
 update public.listings l set status='closed' where l.owner_id=p_user and l.status='active';
 update public.profiles set display_name='Silinmiş hesap',city='',about='',phone='' where id=p_user;
 alter table public.listings enable trigger moderation_listing;
 alter table public.profiles enable trigger moderation_profile;
 delete from public.listing_favorites where user_id=p_user;
 delete from public.route_alerts where user_id=p_user;
 delete from public.listing_conversations where owner_id=p_user or guest_id=p_user;
 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı' where owner_id=p_user or carrier_id=p_user;
 delete from public.carrier_document_files where owner_id=p_user;
 delete from public.carrier_applications where owner_id=p_user;
 update private.admin_members set active=false,legal_access=false where user_id=p_user;
 update auth.users set email='silindi-'||p_user::text||'@nakgo.invalid',phone=null,raw_user_meta_data='{}'::jsonb where id=p_user;
 if to_regclass('auth.identities') is not null then execute 'delete from auth.identities where user_id=$1' using p_user; end if;
 perform private.auth_lock(p_user,true);
end $$;
revoke all on function private.erase_account(uuid) from public,anon,authenticated;

-- Gece temizliği: mevcut adımlar aynı; kullanıcı kapsamlı koruma o kullanıcının erişim ve yönetici kayıtlarını
-- ve hesap kalıntısını korur; süresi dolan yasal kayıtlar imha edilip tutanağa yazılır; onaysız politikalar atlanır.
create or replace function private.retention_run() returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:='{}'; n bigint; r record; days integer;
begin
 -- One run at a time: a second concurrent call does nothing. Every step below is also safe to repeat.
 if not pg_catalog.pg_try_advisory_xact_lock(7300) then return jsonb_build_object('skipped',true); end if;
 perform set_config('lock_timeout','10s',true);
 -- Cleanup writes are not user activity: skip the user guards only inside this transaction.
 alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
 update public.listings l set note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
  loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=now()
 where l.redacted_at is null
  and ((case when l.status='active' then l.expires_at else least(l.expires_at,l.updated_at) end)<now()-interval '8 days'
   or exists(select 1 from private.account_moderation am where am.user_id=l.owner_id and am.deleted_at is not null))
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and (m.hold or (m.removed and m.updated_at>=now()-interval '1 year')));
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_redacted',n);
 alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 delete from public.listings l where l.redacted_at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.hold);
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_deleted',n);

 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı'
 where (listing_snapshot?'cargo' or listing_snapshot?'owner' or listing_snapshot?'dateText' or carrier_label<>'NakGo kullanıcısı')
  and (((status in('no','withdrawn') or stage=3) and updated_at<now()-interval '30 days')
   or (status='wait' and expires_at<now()-interval '30 days'));
 get diagnostics n=row_count; c:=c||jsonb_build_object('jobs_redacted',n);

 delete from public.listing_conversations;
 get diagnostics n=row_count; c:=c||jsonb_build_object('conversations_deleted',n);

 delete from private.admin_audit a where a.created_at<now()-interval '1 year'
  and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id::text=a.target)
  and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id::text=a.target);
 get diagnostics n=row_count; c:=c||jsonb_build_object('admin_audit_deleted',n);
 delete from private.account_moderation where not suspended and deleted_at is null and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('account_moderation_deleted',n);
 delete from private.listing_moderation where not removed and not hold and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listing_moderation_deleted',n);

 -- Deleted accounts: the anonymised remainder goes one year after deletion (cascades to profile and listings).
 delete from auth.users u where u.id in(select user_id from private.account_moderation where deleted_at<now()-interval '1 year')
  and not exists(select 1 from public.listings l join private.listing_moderation m on m.listing_id=l.id where l.owner_id=u.id and m.hold)
  and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=u.id);
 get diagnostics n=row_count; c:=c||jsonb_build_object('accounts_purged',n);
 delete from private.access_log a where a.at<now()-interval '1 year'
  and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id=a.listing_id)
  and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=a.user_id);
 get diagnostics n=row_count; c:=c||jsonb_build_object('access_log_deleted',n);

 -- Yasal kayıtlar: yalnız hukukçu onaylı süresi dolan ve aktif koruması olmayanlar imha edilir.
 n:=0;
 for r in select x.id from private.legal_records x where private.legal_expired(x) order by x.id loop
  perform private.legal_destroy(r.id,'retention_expired'); n:=n+1;
 end loop;
 c:=c||jsonb_build_object('legal_destroyed',n);
 select count(*) into n from private.legal_records x join private.legal_policies p on p.code=x.policy where x.status='closed' and p.approved_at is null;
 c:=c||jsonb_build_object('legal_policy_pending',n);
 select retain_days into days from private.legal_policies where code='legal_access_log' and approved_at is not null;
 if days is not null then
  perform set_config('nakgo.legal_purge','on',true);
  delete from private.legal_access_log where at<now()-days*interval '1 day';
  get diagnostics n=row_count; c:=c||jsonb_build_object('legal_access_log_deleted',n);
  perform set_config('nakgo.legal_purge','off',true);
 end if;
 days:=null;
 select retain_days into days from private.legal_policies where code='destruction_record' and approved_at is not null;
 if days is not null then
  perform set_config('nakgo.legal_purge','on',true);
  delete from private.legal_destructions where at<now()-days*interval '1 day';
  get diagnostics n=row_count; c:=c||jsonb_build_object('destructions_deleted',n);
  perform set_config('nakgo.legal_purge','off',true);
 end if;

 delete from private.retention_runs where ran_at<now()-interval '3 years';
 insert into private.retention_runs(counts) values(c);
 return c;
end $$;
revoke all on function private.retention_run() from public,anon,authenticated;
commit;

-- Administrators, permanent bans and account deletion.
--  * Any active administrator can appoint or remove administrators. The owner (the first administrator)
--    cannot be removed, suspended, banned or deleted. Nobody acts on their own account and the last
--    administrator is never removed.
--  * Permanent ban: sign-in is blocked, sessions end, open listings close. Reversible with unban.
--  * Account deletion (by an administrator or by the user): personal data is erased at once (KVKK m.7);
--    access logs (IP/time) and administrator decisions stay one year (5651 traffic data), then the
--    nightly retention job removes the anonymised account completely. Daily totals keep counts only.
begin;
drop index if exists private.admin_members_one_active;
alter table private.admin_members add column owner boolean not null default false, add column granted_by uuid;
create unique index admin_members_one_owner on private.admin_members(owner) where owner;
-- The administrator in place today becomes the owner.
update private.admin_members set owner=true where active and (select count(*) from private.admin_members where active)=1;
alter table private.account_moderation add column banned boolean not null default false, add column deleted_at timestamptz, add column deleted_by_self boolean;
create index account_moderation_deleted on private.account_moderation(deleted_at) where deleted_at is not null;

create function private.account_deleted(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.account_moderation where user_id=p_user and deleted_at is not null);
$$;
-- Supabase Auth refuses sign-in and token refresh while banned_until is in the future.
create function private.auth_lock(p_user uuid, p_lock boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update auth.users set banned_until=case when p_lock then now()+interval '100 years' end where id=p_user;
 if p_lock then
  if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id=$1' using p_user::text; end if;
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id=$1' using p_user; end if;
 end if;
end $$;
-- Erase personal data now; keep only what the law requires for one year.
create function private.erase_account(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lock_timeout','10s',true);
 -- Erasure is not user activity: skip the activity guards only inside this transaction.
 alter table public.listings disable trigger moderation_listing;
 alter table public.profiles disable trigger moderation_profile;
 update public.listings l set status=case when l.status='active' then 'closed' else l.status end,note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',redacted_at=coalesce(l.redacted_at,now())
 where l.owner_id=p_user;
 update public.profiles set display_name='Silinmiş hesap',city='',about='',phone='' where id=p_user;
 alter table public.listings enable trigger moderation_listing;
 alter table public.profiles enable trigger moderation_profile;
 delete from public.listing_favorites where user_id=p_user;
 delete from public.route_alerts where user_id=p_user;
 delete from public.listing_conversations where owner_id=p_user or guest_id=p_user;
 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı' where owner_id=p_user or carrier_id=p_user;
 delete from public.carrier_document_files where owner_id=p_user;
 delete from public.carrier_applications where owner_id=p_user;
 update private.admin_members set active=false where user_id=p_user;
 update auth.users set email='silindi-'||p_user::text||'@nakgo.invalid',phone=null,raw_user_meta_data='{}'::jsonb where id=p_user;
 if to_regclass('auth.identities') is not null then execute 'delete from auth.identities where user_id=$1' using p_user; end if;
 perform private.auth_lock(p_user,true);
end $$;
revoke all on function private.account_deleted(uuid),private.auth_lock(uuid,boolean),private.erase_account(uuid) from public,anon,authenticated;

create or replace function public.nakgo_admin_moderate(p_kind text,p_target text,p_action text,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_user uuid; target_listing bigint; v bigint; desired boolean; current_state boolean; reason_value text:=btrim(coalesce(p_reason,''));
 m private.account_moderation; is_admin boolean; is_owner boolean;
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
   update private.account_moderation set banned=desired,suspended=desired,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
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
   update private.admin_members set active=false where user_id=target_user;
   update private.account_moderation set revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  end if;
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

-- The signed-in user deletes their own account. The owner administrator cannot.
create function public.nakgo_delete_my_account() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); v bigint;
begin
 if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if exists(select 1 from private.admin_members where user_id=me and active and owner) then raise exception 'Owner account' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(me::text,7290));
 perform pg_catalog.pg_advisory_xact_lock(7291);
 insert into private.account_moderation(user_id) values(me) on conflict do nothing;
 select revision into v from private.account_moderation where user_id=me for update;
 if exists(select 1 from private.account_moderation where user_id=me and deleted_at is not null) then return jsonb_build_object('deleted',true); end if;
 if exists(select 1 from private.admin_members where user_id=me and active) and (select count(*) from private.admin_members where active)<=1 then raise exception 'Last administrator' using errcode='42501'; end if;
 update private.account_moderation set banned=true,suspended=true,deleted_at=now(),deleted_by_self=true,revision=v+1,reason='Kullanıcı hesabını sildi',updated_at=now() where user_id=me;
 perform private.erase_account(me);
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(me,me::text,'self_delete','Kullanıcı hesabını sildi',v+1);
 return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.nakgo_delete_my_account() from public,anon;
grant execute on function public.nakgo_delete_my_account() to authenticated;

create or replace function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '', p_filter text default '', p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; term text:=btrim(coalesce(p_search,'')); f text:=coalesce(p_filter,''); today date:=(now() at time zone 'Europe/Istanbul')::date;
 q jsonb:=coalesce(p_query,'{}'::jsonb); q_id bigint; q_from date; q_to date; q_owner text; q_user uuid;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or char_length(term)>100 or char_length(f)>20 or jsonb_typeof(q)<>'object' or octet_length(q::text)>2000 then raise exception 'Invalid query' using errcode='22023'; end if;
 -- Typed filter values; anything malformed is refused instead of guessed.
 if coalesce(q->>'id','')<>'' then if q->>'id'!~'^[0-9]{1,15}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_id:=(q->>'id')::bigint; end if;
 if coalesce(q->>'from','')<>'' then if q->>'from'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_from:=(q->>'from')::date; end if;
 if coalesce(q->>'to','')<>'' then if q->>'to'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_to:=(q->>'to')::date; end if;
 if coalesce(q->>'user','')<>'' then if q->>'user'!~'^[0-9a-f-]{36}$' then raise exception 'Invalid query' using errcode='22023'; end if; q_user:=(q->>'user')::uuid; end if;
 q_owner:=nullif(btrim(coalesce(q->>'owner','')),'');
 if char_length(coalesce(q_owner,''))>100 or exists(select 1 from jsonb_each_text(q) e where char_length(e.value)>60 and e.key<>'owner') then raise exception 'Invalid query' using errcode='22023'; end if;
 if p_section='overview' then
  return (with s as (
   select case when m.removed then 'removed' when l.redacted_at is not null then 'redacted' when l.status<>'active' then 'closed' when l.expires_at<=now() then 'expired' else 'active' end state,l.kind,l.created_at
   from public.listings l left join private.listing_moderation m on m.listing_id=l.id),
   live as (select count(*) listings,count(*) filter(where kind='load') loads,count(*) filter(where kind='truck') trucks,
    (select count(*) from public.profiles where (created_at at time zone 'Europe/Istanbul')::date=today) users from s where (created_at at time zone 'Europe/Istanbul')::date=today),
   past as (select coalesce(sum(listings),0) listings,coalesce(sum(loads),0) loads,coalesce(sum(trucks),0) trucks,coalesce(sum(users),0) users from private.daily_stats where day<today),
   d as (select day,listings,loads,trucks,users from private.daily_stats where day<today and day>today-60
    union all select today,listings,loads,trucks,users from live),
   per as (select v.k,v.n,
     (select coalesce(sum(listings),0) from d where day>today-v.n) listings,(select coalesce(sum(loads),0) from d where day>today-v.n) loads,
     (select coalesce(sum(trucks),0) from d where day>today-v.n) trucks,(select coalesce(sum(users),0) from d where day>today-v.n) users,
     (select coalesce(sum(listings),0) from d where day<=today-v.n and day>today-2*v.n) prev_listings,(select coalesce(sum(users),0) from d where day<=today-v.n and day>today-2*v.n) prev_users
    from (values('day',1),('week',7),('month',30)) v(k,n))
   select jsonb_build_object(
    'users',(select count(*) from public.profiles p where not private.account_deleted(p.id)),
    'accounts_banned',(select count(*) from private.account_moderation where banned and deleted_at is null),
    'accounts_deleted',(select count(*) from private.account_moderation where deleted_at is not null),
    'admins',(select count(*) from private.admin_members where active),
    'users_week',(select count(*) from public.profiles p where created_at>=now()-interval '7 days' and not private.account_deleted(p.id)),
    'listings',(select count(*) from s where state='active'),
    'listings_today',(select listings from live),
    'listings_removed',(select count(*) from s where state='removed'),
    'accounts_suspended',(select count(*) from private.account_moderation where suspended and not banned),
    'actions_month',(select count(*) from private.admin_audit where created_at>=now()-interval '30 days'),
    'listing_states',jsonb_build_object('all',(select count(*) from s),'active',(select count(*) from s where state='active'),'expired',(select count(*) from s where state='expired'),
     'closed',(select count(*) from s where state='closed'),'removed',(select count(*) from s where state='removed'),'redacted',(select count(*) from s where state='redacted')),
    'user_types',jsonb_build_object('carrier',(select count(*) from public.profiles p where account_type='carrier' and not private.account_deleted(p.id)),'owner',(select count(*) from public.profiles p where account_type='owner' and not private.account_deleted(p.id))),
    'totals',(select jsonb_build_object('listings',past.listings+live.listings,'loads',past.loads+live.loads,'trucks',past.trucks+live.trucks,'users',past.users+live.users) from past,live),
    'yesterday',(select coalesce(listings,0) from private.daily_stats where day=today-1),
    'vehicle_users',jsonb_build_object('tir',(select count(distinct owner_id) from public.listings where vehicle='Tır'),'kamyon',(select count(distinct owner_id) from public.listings where vehicle='Kamyon'),
     'kamyonet',(select count(distinct owner_id) from public.listings where vehicle='Kamyonet')),
    -- Period summaries: counts only, plus the busiest city-to-city routes (no names or contacts).
    'periods',(select jsonb_object_agg(per.k,jsonb_build_object('listings',per.listings,'loads',per.loads,'trucks',per.trucks,'users',per.users,'prev_listings',per.prev_listings,'prev_users',per.prev_users,
     'routes',(select coalesce(jsonb_agg(jsonb_build_object('route',r.from_city||' → '||r.to_city,'count',r.c) order by r.c desc,r.from_city,r.to_city),'[]'::jsonb)
      from (select from_city,to_city,count(*) c from public.listings where (created_at at time zone 'Europe/Istanbul')::date>today-per.n group by 1,2 order by 3 desc,1,2 limit 3) r))) from per)));
 elsif p_section='users' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
  (select p.id,p.display_name,p.account_type,p.city,p.created_at,coalesce(m.suspended,false) suspended,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason,
    exists(select 1 from private.admin_members a where a.user_id=p.id and a.active) protected,exists(select 1 from private.admin_members a where a.user_id=p.id and a.active and a.owner) owner,
    p.id=auth.uid() is_self,coalesce(m.banned,false) banned,m.deleted_at,(select u.email_confirmed_at is not null from auth.users u where u.id=p.id) verified,(select count(*) from public.listings l where l.owner_id=p.id) listings,
    (select coalesce(jsonb_agg(distinct l.vehicle),'[]'::jsonb) from public.listings l where l.owner_id=p.id and l.vehicle in('Tır','Kamyon','Kamyonet')) vehicles
   from public.profiles p left join private.account_moderation m on m.user_id=p.id
   where (term='' or position(lower(term) in lower(p.display_name))>0) and (q_user is null or p.id=q_user)
    and (f='' or (f='carrier' and p.account_type='carrier') or (f='owner' and p.account_type='owner') or (f='suspended' and coalesce(m.suspended,false) and not coalesce(m.banned,false)) or (f='banned' and coalesce(m.banned,false) and m.deleted_at is null) or (f='deleted' and m.deleted_at is not null)
     or (f='admins' and exists(select 1 from private.admin_members a where a.user_id=p.id and a.active)) or (f='new' and p.created_at>=now()-interval '7 days')
     or (f in('tir','kamyon','kamyonet') and exists(select 1 from public.listings l where l.owner_id=p.id and l.vehicle=case f when 'tir' then 'Tır' when 'kamyon' then 'Kamyon' else 'Kamyonet' end)))
   order by p.created_at desc,p.id limit 21 offset p_offset) t;
 elsif p_section='listings' then
  -- Filters combine (AND). State keeps owner-closed, expired and admin-removed apart.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc),'[]'::jsonb) into result from
  (select x.*,count(*) over() total from (select l.id,l.owner_id,coalesce(p.display_name,l.owner_label) owner_name,l.owner_label,l.kind,l.from_city,l.to_city,l.from_district,l.to_district,l.vehicle,l.body,l.cargo,l.loading_text,
    l.status,l.created_at,l.updated_at,l.expires_at,l.redacted_at,coalesce(m.removed,false) removed,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason,m.updated_at moderated_at,
    case when m.removed then 'removed' when l.redacted_at is not null then 'redacted' when l.status<>'active' then 'closed' when l.expires_at<=now() then 'expired' else 'active' end state
   from public.listings l left join private.listing_moderation m on m.listing_id=l.id left join public.profiles p on p.id=l.owner_id
   where (term='' or position(lower(term) in lower(l.owner_label||' '||coalesce(p.display_name,'')||' '||l.from_city||' '||l.to_city||' '||coalesce(l.from_district,'')||' '||coalesce(l.to_district,'')))>0)
    and (q_id is null or l.id=q_id) and (q_user is null or l.owner_id=q_user)
    and (coalesce(q->>'from_city','')='' or l.from_city=q->>'from_city') and (coalesce(q->>'to_city','')='' or l.to_city=q->>'to_city')
    and (coalesce(q->>'vehicle','')='' or l.vehicle=q->>'vehicle') and (coalesce(q->>'body','')='' or l.body=q->>'body')
    and (coalesce(q->>'kind','')='' or l.kind=q->>'kind')
    and (q_from is null or (l.created_at at time zone 'Europe/Istanbul')::date>=q_from) and (q_to is null or (l.created_at at time zone 'Europe/Istanbul')::date<=q_to)
    and (q_owner is null or position(lower(q_owner) in lower(coalesce(p.display_name,'')||' '||l.owner_label))>0)) x
   where (f='' or x.state=f or x.kind=f) and (coalesce(q->>'state','')='' or x.state=q->>'state')
   order by x.id desc limit 21 offset p_offset) t;
 elsif p_section='history' then
  -- One listing: who created and changed it (access log, without IP) and administrator decisions.
  if q_id is null then raise exception 'Invalid query' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.at,t.kind),'[]'::jsonb) into result from
  (select a.at,'user' kind,a.action,a.detail,coalesce(p.display_name,'Kullanıcı') actor,null::text reason from private.access_log a left join public.profiles p on p.id=a.user_id where a.listing_id=q_id
   union all select a.created_at,'admin',a.action,null,coalesce(p.display_name,'Yönetici'),a.reason from private.admin_audit a left join public.profiles p on p.id=a.actor_id
    where a.action in('remove','restore') and a.target=q_id::text
   order by 1 desc limit 100) t;
 elsif p_section='moderation' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
  (select a.id,a.actor_id,coalesce(p.display_name,'Yönetici') actor_label,a.target,a.action,a.reason,a.created_at
   from private.admin_audit a left join public.profiles p on p.id=a.actor_id
   where f='' or (f='listing' and a.action in('remove','restore')) or (f='user' and a.action not in('remove','restore'))
   order by a.id desc limit 21 offset p_offset) t;
 elsif p_section='stats' or p_section='insights' then
  q_to:=least(coalesce(q_to,today),today);q_from:=coalesce(q_from,q_to-89);
  if q_from>q_to or q_to-q_from>365 then raise exception 'Invalid query' using errcode='22023'; end if;
  if p_section='stats' then
   -- Every day of the range, newest first; days without listings are zero.
   select coalesce(jsonb_agg(to_jsonb(t) order by t.day desc),'[]'::jsonb) into result from
   (select g.day::date as day,coalesce(d.listings,0) listings,coalesce(d.loads,0) loads,coalesce(d.trucks,0) trucks,coalesce(d.users,0) users
    from generate_series(q_from,q_to,interval '1 day') g(day)
    left join (select ds.day,ds.listings,ds.loads,ds.trucks,ds.users from private.daily_stats ds where ds.day<today
     union all select today,count(*),count(*) filter(where kind='load'),count(*) filter(where kind='truck'),
      (select count(*) from public.profiles where (created_at at time zone 'Europe/Istanbul')::date=today)
     from public.listings where (created_at at time zone 'Europe/Istanbul')::date=today) d on d.day=g.day::date) t;
  else
   -- Listings still stored in the range; cleaned-up rows count only in the daily totals.
   return (with r as (select l.from_city,l.vehicle,l.created_at,
      case when m.removed then m.updated_at when l.status<>'active' then least(l.updated_at,l.expires_at) when l.expires_at<=now() then l.expires_at end ended_at
     from public.listings l left join private.listing_moderation m on m.listing_id=l.id
     where (l.created_at at time zone 'Europe/Istanbul')::date between q_from and q_to)
    select jsonb_build_object('listings',(select count(*) from r),
     'cities',(select coalesce(jsonb_agg(jsonb_build_object('name',c.from_city,'count',c.n) order by c.n desc,c.from_city),'[]'::jsonb) from (select from_city,count(*) n from r group by 1 order by 2 desc,1 limit 5) c),
     'vehicles',(select coalesce(jsonb_agg(jsonb_build_object('name',v.vehicle,'count',v.n) order by v.n desc,v.vehicle),'[]'::jsonb) from (select vehicle,count(*) n from r group by 1 order by 2 desc,1 limit 8) v),
     'avg_hours',(select round((extract(epoch from avg(ended_at-created_at))/3600)::numeric,1) from r where ended_at is not null and ended_at>=created_at),
     'ended',(select count(*) from r where ended_at is not null)));
  end if;
 else raise exception 'Invalid section' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.nakgo_admin_page(text,integer,text,text,jsonb) from public,anon;
grant execute on function public.nakgo_admin_page(text,integer,text,text,jsonb) to authenticated;

create or replace function private.retention_run() returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:='{}'; n bigint;
begin
 perform set_config('lock_timeout','10s',true);
 -- Cleanup writes are not user activity: skip the user guards only inside this transaction.
 alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
 update public.listings l set note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',redacted_at=now()
 where l.redacted_at is null
  and (case when l.status='active' then l.expires_at else least(l.expires_at,l.updated_at) end)<now()-interval '8 days'
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed and m.updated_at>=now()-interval '1 year');
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_redacted',n);
 alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 delete from public.listings where redacted_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_deleted',n);

 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı'
 where (listing_snapshot?'cargo' or listing_snapshot?'owner' or listing_snapshot?'dateText' or carrier_label<>'NakGo kullanıcısı')
  and (((status in('no','withdrawn') or stage=3) and updated_at<now()-interval '30 days')
   or (status='wait' and expires_at<now()-interval '30 days'));
 get diagnostics n=row_count; c:=c||jsonb_build_object('jobs_redacted',n);

 delete from public.listing_conversations;
 get diagnostics n=row_count; c:=c||jsonb_build_object('conversations_deleted',n);

 delete from private.admin_audit where created_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('admin_audit_deleted',n);
 delete from private.account_moderation where not suspended and deleted_at is null and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('account_moderation_deleted',n);
 delete from private.listing_moderation where not removed and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listing_moderation_deleted',n);

 -- Deleted accounts: the anonymised remainder goes one year after deletion (cascades to profile and listings).
 delete from auth.users where id in(select user_id from private.account_moderation where deleted_at<now()-interval '1 year');
 get diagnostics n=row_count; c:=c||jsonb_build_object('accounts_purged',n);
 delete from private.access_log where at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('access_log_deleted',n);
 delete from private.retention_runs where ran_at<now()-interval '3 years';
 insert into private.retention_runs(counts) values(c);
 return c;
end $$;
revoke all on function private.retention_run() from public,anon,authenticated;
commit;

-- Admin panel tools. No existing row changes.
--  * Access log rows for listing writes also record the listing and what changed (status or edit),
--    so a listing's history shows who created and changed it and when.
--  * nakgo_admin_page: combinable listing filters with a result count, listing history, users by the
--    vehicle in their own listings, period summaries, statistics for any date range (zero days included)
--    and an insights section (top cities, vehicle types, average time on air). All counts come from the database.
begin;
alter table private.access_log add column listing_id bigint, add column detail text check(char_length(detail)<=40);
create index access_log_listing on private.access_log(listing_id) where listing_id is not null;
create or replace function private.log_listing_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then
  insert into private.access_log(user_id,action,ip,listing_id,detail)
  values(auth.uid(),case tg_op when 'INSERT' then 'listing_create' else 'listing_update' end,private.request_ip(),new.id,
   case when tg_op='INSERT' then null when old.status is distinct from new.status then 'status:'||old.status||'>'||new.status else 'edit' end);
 end if;
 return null;
end $$;

drop function public.nakgo_admin_page(text,integer,text,text);
create function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '', p_filter text default '', p_query jsonb default '{}'::jsonb)
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
    'users',(select count(*) from public.profiles),
    'users_week',(select count(*) from public.profiles where created_at>=now()-interval '7 days'),
    'listings',(select count(*) from s where state='active'),
    'listings_today',(select listings from live),
    'listings_removed',(select count(*) from s where state='removed'),
    'accounts_suspended',(select count(*) from private.account_moderation where suspended),
    'actions_month',(select count(*) from private.admin_audit where created_at>=now()-interval '30 days'),
    'listing_states',jsonb_build_object('all',(select count(*) from s),'active',(select count(*) from s where state='active'),'expired',(select count(*) from s where state='expired'),
     'closed',(select count(*) from s where state='closed'),'removed',(select count(*) from s where state='removed'),'redacted',(select count(*) from s where state='redacted')),
    'user_types',jsonb_build_object('carrier',(select count(*) from public.profiles where account_type='carrier'),'owner',(select count(*) from public.profiles where account_type='owner')),
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
    exists(select 1 from private.admin_members a where a.user_id=p.id and a.active) protected,(select count(*) from public.listings l where l.owner_id=p.id) listings,
    (select coalesce(jsonb_agg(distinct l.vehicle),'[]'::jsonb) from public.listings l where l.owner_id=p.id and l.vehicle in('Tır','Kamyon','Kamyonet')) vehicles
   from public.profiles p left join private.account_moderation m on m.user_id=p.id
   where (term='' or position(lower(term) in lower(p.display_name))>0) and (q_user is null or p.id=q_user)
    and (f='' or (f='carrier' and p.account_type='carrier') or (f='owner' and p.account_type='owner') or (f='suspended' and coalesce(m.suspended,false)) or (f='new' and p.created_at>=now()-interval '7 days')
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
   where f='' or (f='listing' and a.action in('remove','restore')) or (f='user' and a.action in('suspend','resume'))
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
commit;

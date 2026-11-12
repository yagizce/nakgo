-- Admin summaries: period figures (day/week/month vs the previous period, busiest routes),
-- yesterday's count and users by the vehicle in their own listings. Read-only; no row changes.
begin;
create or replace function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '', p_filter text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; term text:=btrim(coalesce(p_search,'')); f text:=coalesce(p_filter,''); today date:=(now() at time zone 'Europe/Istanbul')::date;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or char_length(term)>100 or char_length(f)>20 then raise exception 'Invalid query' using errcode='22023'; end if;
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
   where (term='' or position(lower(term) in lower(p.display_name))>0)
    and (f='' or (f='carrier' and p.account_type='carrier') or (f='owner' and p.account_type='owner') or (f='suspended' and coalesce(m.suspended,false)) or (f='new' and p.created_at>=now()-interval '7 days')
     or (f in('tir','kamyon','kamyonet') and exists(select 1 from public.listings l where l.owner_id=p.id and l.vehicle=case f when 'tir' then 'Tır' when 'kamyon' then 'Kamyon' else 'Kamyonet' end)))
   order by p.created_at desc,p.id limit 21 offset p_offset) t;
 elsif p_section='listings' then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc),'[]'::jsonb) into result from
  (select * from (select l.id,l.owner_label,l.kind,l.from_city,l.to_city,l.from_district,l.to_district,l.vehicle,l.body,l.cargo,l.loading_text,l.status,l.created_at,l.updated_at,l.expires_at,l.redacted_at,
    coalesce(m.removed,false) removed,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason,
    case when m.removed then 'removed' when l.redacted_at is not null then 'redacted' when l.status<>'active' then 'closed' when l.expires_at<=now() then 'expired' else 'active' end state
   from public.listings l left join private.listing_moderation m on m.listing_id=l.id
   where term='' or position(lower(term) in lower(l.owner_label||' '||l.from_city||' '||l.to_city||' '||coalesce(l.from_district,'')||' '||coalesce(l.to_district,'')))>0) x
   where f='' or x.state=f or x.kind=f order by x.id desc limit 21 offset p_offset) t;
 elsif p_section='moderation' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
  (select a.id,a.actor_id,coalesce(p.display_name,'Yönetici') actor_label,a.target,a.action,a.reason,a.created_at
   from private.admin_audit a left join public.profiles p on p.id=a.actor_id
   where f='' or (f='listing' and a.action in('remove','restore')) or (f='user' and a.action in('suspend','resume'))
   order by a.id desc limit 21 offset p_offset) t;
 elsif p_section='stats' then
  -- Last 90 days; today is counted live.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.day desc),'[]'::jsonb) into result from
  (select d.day,d.listings,d.loads,d.trucks,d.users from private.daily_stats d where d.day<today and d.day>=today-89
   union all select today,count(*),count(*) filter(where kind='load'),count(*) filter(where kind='truck'),
    (select count(*) from public.profiles where (created_at at time zone 'Europe/Istanbul')::date=today)
   from public.listings where (created_at at time zone 'Europe/Istanbul')::date=today) t;
 else raise exception 'Invalid section' using errcode='22023'; end if;
 return result;
end $$;
commit;

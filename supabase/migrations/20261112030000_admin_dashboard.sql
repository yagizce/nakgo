-- Admin dashboard data. Read-only for clients; no existing row is changed.
--  * private.daily_stats: per-day counts (no ids, names, places or contacts) that stay after
--    listings and accounts are cleaned up by data retention. Recorded nightly at 00:30 Istanbul.
--  * nakgo_admin_page: overview figures, per-state counts, richer list rows, a filter and a stats section.
begin;
create table private.daily_stats (
 day date primary key,
 listings integer not null default 0 check(listings>=0),
 loads integer not null default 0 check(loads>=0),
 trucks integer not null default 0 check(trucks>=0),
 users integer not null default 0 check(users>=0),
 updated_at timestamptz not null default now()
);
alter table private.daily_stats enable row level security;
revoke all on private.daily_stats from public,anon,authenticated;

-- Re-recording a day never lowers it: rows removed later by retention keep their count.
create function private.record_daily_stats(p_day date) returns void language sql security definer set search_path='' as $$
 insert into private.daily_stats(day,listings,loads,trucks,users)
 select p_day,count(*),count(*) filter(where kind='load'),count(*) filter(where kind='truck'),
  (select count(*) from public.profiles where (created_at at time zone 'Europe/Istanbul')::date=p_day)
 from public.listings where (created_at at time zone 'Europe/Istanbul')::date=p_day
 on conflict(day) do update set listings=greatest(private.daily_stats.listings,excluded.listings),loads=greatest(private.daily_stats.loads,excluded.loads),
  trucks=greatest(private.daily_stats.trucks,excluded.trucks),users=greatest(private.daily_stats.users,excluded.users),updated_at=now();
$$;
revoke all on function private.record_daily_stats(date) from public,anon,authenticated;
select private.record_daily_stats(d::date) from generate_series(
 (select least((select min(created_at) from public.listings),(select min(created_at) from public.profiles)) at time zone 'Europe/Istanbul')::date,
 (now() at time zone 'Europe/Istanbul')::date-1,interval '1 day') d;

drop function public.nakgo_admin_page(text,integer,text);
create function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '', p_filter text default '')
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
   past as (select coalesce(sum(listings),0) listings,coalesce(sum(loads),0) loads,coalesce(sum(trucks),0) trucks,coalesce(sum(users),0) users from private.daily_stats where day<today)
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
    'totals',(select jsonb_build_object('listings',past.listings+live.listings,'loads',past.loads+live.loads,'trucks',past.trucks+live.trucks,'users',past.users+live.users) from past,live)));
 elsif p_section='users' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
  (select p.id,p.display_name,p.account_type,p.city,p.created_at,coalesce(m.suspended,false) suspended,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason,
    exists(select 1 from private.admin_members a where a.user_id=p.id and a.active) protected,(select count(*) from public.listings l where l.owner_id=p.id) listings
   from public.profiles p left join private.account_moderation m on m.user_id=p.id
   where (term='' or position(lower(term) in lower(p.display_name))>0)
    and (f='' or (f='carrier' and p.account_type='carrier') or (f='owner' and p.account_type='owner') or (f='suspended' and coalesce(m.suspended,false)) or (f='new' and p.created_at>=now()-interval '7 days'))
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
revoke all on function public.nakgo_admin_page(text,integer,text,text) from public,anon;
grant execute on function public.nakgo_admin_page(text,integer,text,text) to authenticated;

-- 21:30 UTC = 00:30 Istanbul: records the day that just ended. Local test databases have no pg_cron.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('nakgo-daily-stats','30 21 * * *',$q$select private.record_daily_stats(((now() at time zone 'Europe/Istanbul')::date-1))$q$);
 end if;
end $$;
commit;

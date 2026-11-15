-- Live admin page ("Canlı").
--  * private.contact_clicks: hourly Call/WhatsApp counts by listing kind. No account, listing, phone or IP is stored,
--    so the counts stay outside data retention. A click is counted only when nakgo_listing_contact actually returns
--    the number to another verified account (the owner's own listing and refused requests are not counted).
--  * nakgo_listing_contact gains an optional p_channel ('call' | 'whatsapp'); calls without it behave as before.
--  * nakgo_admin_live: read-only figures for the live page (today in Istanbul time), administrators only.
begin;
create table private.contact_clicks (
 hour timestamptz not null,
 kind text not null check(kind in('load','truck')),
 channel text not null check(channel in('call','whatsapp')),
 clicks integer not null default 0 check(clicks>=0),
 primary key(hour,kind,channel)
);
alter table private.contact_clicks enable row level security;
revoke all on private.contact_clicks from public,anon,authenticated;

-- Same checks as 20261111050000_listing_contact.sql; only the optional count is new.
drop function public.nakgo_listing_contact(bigint);
create function public.nakgo_listing_contact(p_id bigint, p_channel text default null) returns text language plpgsql security definer set search_path='' as $$
declare l public.listings; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
  or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then
  raise exception 'Verified account required' using errcode='42501';end if;
 perform private.require_activity(actor);select * into l from public.listings where id=p_id;
 if found and l.owner_id=actor then return l.contact_phone;end if;
 if not found or l.status<>'active' or l.expires_at<=statement_timestamp()
  or not l.contact_consent or l.contact_phone is null
  or exists(select 1 from private.listing_moderation where listing_id=p_id and removed)
  or private.account_suspended(l.owner_id) then
  raise exception 'Listing unavailable' using errcode='42501';end if;
 if p_channel in('call','whatsapp') then
  insert into private.contact_clicks(hour,kind,channel,clicks) values(date_trunc('hour',statement_timestamp()),l.kind,p_channel,1)
  on conflict(hour,kind,channel) do update set clicks=private.contact_clicks.clicks+1;
 end if;
 return l.contact_phone;
end $$;
revoke all on function public.nakgo_listing_contact(bigint,text) from public,anon;
grant execute on function public.nakgo_listing_contact(bigint,text) to authenticated;

-- p_kind: '' (all), 'load' or 'truck'. Removed listings count toward "today" like the daily stats,
-- but never appear in the feed or the city map. The feed carries no owner name or contact.
create function public.nakgo_admin_live(p_kind text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare k text:=coalesce(p_kind,''); t timestamptz:=statement_timestamp(); tz constant text:='Europe/Istanbul'; day0 timestamptz;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if k not in('','load','truck') then raise exception 'Invalid query' using errcode='22023'; end if;
 day0:=date_trunc('day',t at time zone tz) at time zone tz;
 return (with l as (
   select x.id,x.kind,x.from_city,x.to_city,x.vehicle,x.created_at,coalesce(m.removed,false) removed
   from public.listings x left join private.listing_moderation m on m.listing_id=x.id
   where x.created_at>=day0-interval '1 day' and (k='' or x.kind=k)),
  c as (select hour,channel,clicks from private.contact_clicks where hour>=day0-interval '1 day' and (k='' or kind=k))
  select jsonb_build_object(
   'at',t,
   'active',(select count(*) from public.listings x where x.status='active' and x.expires_at>t and x.redacted_at is null and (k='' or x.kind=k)
     and not exists(select 1 from private.listing_moderation m where m.listing_id=x.id and m.removed)),
   'today',(select count(*) from l where created_at>=day0),
   'yesterday',(select count(*) from l where created_at<day0 and created_at<=t-interval '1 day'),
   'last_hour',(select count(*) from l where created_at>t-interval '1 hour'),
   'users_today',(select count(*) from public.profiles where created_at>=day0),
   'calls',(select coalesce(sum(clicks),0) from c where hour>=day0 and channel='call'),
   'whatsapp',(select coalesce(sum(clicks),0) from c where hour>=day0 and channel='whatsapp'),
   'clicks_yesterday',(select coalesce(sum(clicks),0) from c where hour<day0 and hour<=t-interval '1 day'),
   'hours',(select jsonb_agg(jsonb_build_object('h',g,
      'loads',(select count(*) from l where created_at>=day0 and kind='load' and extract(hour from created_at at time zone tz)=g),
      'trucks',(select count(*) from l where created_at>=day0 and kind='truck' and extract(hour from created_at at time zone tz)=g),
      'clicks',(select coalesce(sum(clicks),0) from c where hour>=day0 and extract(hour from hour at time zone tz)=g)) order by g) from generate_series(0,23) g),
   'minutes',(select jsonb_agg(coalesce(n,0) order by g desc) from generate_series(0,59) g left join
      (select floor(extract(epoch from date_trunc('minute',t)+interval '1 minute'-created_at)/60)::int i,count(*) n from l
       where created_at>date_trunc('minute',t)-interval '59 minutes' group by 1) m on m.i=g),
   'recent',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) from
      (select id,kind,from_city,to_city,vehicle,created_at from l where not removed and created_at>t-interval '24 hours' order by created_at desc,id desc limit 12) r),
   'from_cities',(select coalesce(jsonb_object_agg(from_city,n),'{}'::jsonb) from (select from_city,count(*) n from l where created_at>=day0 and not removed group by 1) x),
   'to_cities',(select coalesce(jsonb_object_agg(to_city,n),'{}'::jsonb) from (select to_city,count(*) n from l where created_at>=day0 and not removed group by 1) x)));
end $$;
revoke all on function public.nakgo_admin_live(text) from public,anon;
grant execute on function public.nakgo_admin_live(text) to authenticated;
commit;

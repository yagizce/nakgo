-- Optional districts next to cities, and a six-hour publication window.
-- Filters and route alerts keep matching on cities only.
begin;
alter table public.listings
 add column from_district text check (from_district is null or char_length(from_district) between 1 and 40),
 add column to_district text check (to_district is null or char_length(to_district) between 1 and 40),
 add column expires_at timestamptz;
-- Existing listings get the same rule: six hours after they were published.
update public.listings set expires_at=created_at+interval '6 hours';
alter table public.listings alter column expires_at set default (now()+interval '6 hours'), alter column expires_at set not null;
grant insert(from_district,to_district),update(from_district,to_district) on public.listings to authenticated;

-- Clients cannot write expires_at (no column grant). Reopening a closed or expired
-- listing starts a new six-hour window; other edits keep the current one.
create or replace function public.nakgo_listing_write_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.owner_id<>old.owner_id or new.kind<>old.kind or new.created_at<>old.created_at then
   raise exception 'Listing identity is immutable' using errcode='23514';
  end if;
  if new.status='active' and (old.status<>'active' or old.expires_at<=now()) then new.expires_at:=now()+interval '6 hours';end if;
 end if;
 if new.status='active' and coalesce(new.available_until,new.available_on)<(now() at time zone 'Europe/Istanbul')::date then
  raise exception 'An active listing requires a current availability date' using errcode='23514';
 end if;
 new.updated_at=now();
 return new;
end $$;

alter policy listings_read on public.listings using(
 owner_id=(select auth.uid()) or (status='active' and expires_at>now()
  and (loading_text is not null or coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date)));

drop function public.nakgo_public_listings(bigint);
create function public.nakgo_public_listings(p_before bigint default null)
returns table(id bigint, kind text, from_city text, to_city text, from_district text, to_district text, vehicle text, body text, amount numeric, cargo text, items jsonb, available_on date, available_until date, available_time text, loading_text text, status text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select l.id,l.kind,l.from_city,l.to_city,l.from_district,l.to_district,l.vehicle,l.body,l.amount,
  l.cargo,l.items,l.available_on,l.available_until,l.available_time,
  l.loading_text,l.status,l.created_at
 from public.listings l
 where l.status='active' and l.expires_at>now()
  and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)
  and not private.account_suspended(l.owner_id)
  and (p_before is null or l.id<p_before)
 order by l.id desc
 limit 50
$$;
revoke all on function public.nakgo_public_listings(bigint) from public;
grant execute on function public.nakgo_public_listings(bigint) to anon, authenticated;

-- New messages, transport requests and favorites need an unexpired listing.
-- Existing conversations and requests keep working.
do $$ declare f regprocedure; d text; begin
 foreach f in array array['public.nakgo_open_conversation(bigint)','public.nakgo_request_transport(bigint)','public.nakgo_set_favorite(bigint,boolean)']::regprocedure[] loop
  d:=pg_get_functiondef(f);
  if (length(d)-length(replace(d,'l.status<>''active'' or ','')))/length('l.status<>''active'' or ')<>1 then raise exception 'Unexpected definition: %',f;end if;
  execute replace(d,'l.status<>''active'' or ','l.status<>''active'' or l.expires_at<=now() or ');
 end loop;
end $$;
commit;

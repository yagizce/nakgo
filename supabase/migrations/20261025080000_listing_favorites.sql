-- Private saved listings. Apply only to nakgo-dev before Preview verification.
begin;
create table public.listing_favorites (
 user_id uuid not null references auth.users(id) on delete cascade,
 listing_id bigint not null references public.listings(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,listing_id)
);
create index listing_favorites_listing on public.listing_favorites(listing_id);
alter table public.listing_favorites enable row level security;
revoke all on public.listing_favorites from public,anon,authenticated;
grant select on public.listing_favorites to authenticated;
create policy listing_favorites_read_own on public.listing_favorites for select to authenticated
 using(user_id=(select auth.uid()));

-- Set an explicit desired state: retrying a request cannot toggle it back.
create function public.nakgo_set_favorite(p_listing_id bigint,p_saved boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501'; end if;
 if p_listing_id is null or p_listing_id<1 or p_listing_id>9007199254740991 or p_saved is null then
  raise exception 'Invalid favorite' using errcode='22023'; end if;
 -- Both add and remove acquire the same listing lock, serializing concurrent retries.
 select * into l from public.listings where id=p_listing_id for update;
 if p_saved then
  if not found or l.status<>'active' or coalesce(l.available_until,l.available_on)<(now() at time zone 'Europe/Istanbul')::date then
   raise exception 'Listing unavailable' using errcode='42501'; end if;
  insert into public.listing_favorites(user_id,listing_id) values(actor,p_listing_id)
   on conflict(user_id,listing_id) do nothing;
 else
  -- Removal remains possible when the listing is no longer readable.
  delete from public.listing_favorites where user_id=actor and listing_id=p_listing_id;
 end if;
 return jsonb_build_object('listing_id',p_listing_id,'saved',p_saved);
end $$;
revoke all on function public.nakgo_set_favorite(bigint,boolean) from public,anon;
grant execute on function public.nakgo_set_favorite(bigint,boolean) to authenticated;
comment on table public.listing_favorites is 'Private bookmarks; listing joins retain listings RLS. No listing snapshots or demo import.';
commit;

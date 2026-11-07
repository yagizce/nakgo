-- Pending local SQL proposal, NOT an applied/registered migration.
-- Requires a separately approved migration and backup/rollback review.
-- No bulk deletion, new archive or change to listing/archive retention.
begin;
-- Additional SELECT restriction applies to owners too, without weakening the
-- existing status/consent/moderation policies. Contact stays RPC-only.
create policy listings_publication_started on public.listings as restrictive
 for select to authenticated using (published_at<=statement_timestamp());
revoke select(contact_phone) on public.listings from authenticated;
create or replace function public.nakgo_listing_contact(p_id bigint) returns text
language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
 perform private.require_activity(auth.uid());select * into l from public.listings where id=p_id;
 if not found or l.status<>'active' or l.published_at is null or l.published_at>statement_timestamp()
 or coalesce(l.expires_at,l.created_at+interval '6 hours')<=statement_timestamp()
 or not l.contact_consent or l.contact_phone is null
 or exists(select 1 from private.listing_moderation where listing_id=p_id and removed)
 or private.account_suspended(l.owner_id) then
 raise exception 'Listing unavailable' using errcode='42501';end if;
 return l.contact_phone;
end $$;
alter policy listing_favorites_read_own on public.listing_favorites using (
 user_id=(select auth.uid()) and exists (
  select 1 from public.listings l where l.id=listing_id and l.status='active'
  and l.expires_at>statement_timestamp() and l.published_at<=statement_timestamp()
  and l.published_at<=listing_favorites.created_at
 )
);
create or replace function public.nakgo_set_favorite(p_listing_id bigint,p_saved boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501';end if;
 if p_listing_id is null or p_listing_id<1 or p_listing_id>9007199254740991 or p_saved is null then
  raise exception 'Invalid favorite' using errcode='22023';end if;
 if p_saved then perform private.require_activity(actor);end if;
 select * into l from public.listings where id=p_listing_id for update;
 if p_saved then
  if not found or l.status<>'active' or l.published_at is null or l.published_at>statement_timestamp()
   or l.expires_at is null or l.expires_at<=statement_timestamp()
   or not l.contact_consent or l.contact_phone is null
   or coalesce(l.available_until,l.available_on)<(statement_timestamp() at time zone 'Europe/Istanbul')::date
   or private.account_suspended(l.owner_id)
   or exists(select 1 from private.listing_moderation where listing_id=p_listing_id and removed) then
   raise exception 'Listing unavailable' using errcode='42501';end if;
  insert into public.listing_favorites(user_id,listing_id,created_at) values(actor,p_listing_id,statement_timestamp())
   on conflict(user_id,listing_id) do update set created_at=case
    when listing_favorites.created_at<l.published_at then excluded.created_at else listing_favorites.created_at end;
 else
  -- Only the caller's explicit removal; never scheduled or bulk cleanup.
  delete from public.listing_favorites where user_id=actor and listing_id=p_listing_id;
 end if;
 return jsonb_build_object('listing_id',p_listing_id,'saved',p_saved);
end $$;
revoke all on function public.nakgo_set_favorite(bigint,boolean) from public,anon;
grant execute on function public.nakgo_set_favorite(bigint,boolean) to authenticated;
-- Keep the existing two-capability gate and access audit; archive detail is
-- listing information, not a contact or saver-history endpoint. Legal/consent
-- records remain under their existing private, separately scoped structures.
create or replace function public.nakgo_archive_detail(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_nakgo_admin() or
 (select count(*) from private.data_access_grants where user_id=auth.uid()
 and capability in ('listing_archive','archive_contact'))<>2 then
 raise exception 'Archive detail access denied' using errcode='42501';end if;
 select jsonb_build_object('id',id,'note',note,'cargo',cargo,'items',items,'image_data',image_data)
 into result from public.listings where id=p_id and content_redacted_at is null
 and expires_at<=statement_timestamp() and published_at+interval '198 hours'>statement_timestamp();
 if result is null then raise exception 'Archive unavailable' using errcode='P0002';end if;
 insert into private.archive_access_audit(actor,listing_id,action) values(auth.uid(),p_id,'detail_read');
 return result;
end $$;
commit;

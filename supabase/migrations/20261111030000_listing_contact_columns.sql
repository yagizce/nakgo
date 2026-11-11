-- DEV lifecycle: phone numbers leave the table projection; readers get them only
-- through nakgo_listing_contact. Verified, non-anonymous, active accounts only;
-- the owner can read its own number, everyone else only on a published listing.
create or replace function public.nakgo_listing_contact(p_id bigint) returns text language plpgsql security definer set search_path='' as $$
declare l public.listings; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
  or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then
  raise exception 'Verified account required' using errcode='42501';end if;
 perform private.require_activity(actor);select * into l from public.listings where id=p_id;
 if found and l.owner_id=actor then return l.contact_phone;end if;
 if not found or l.status<>'active' or l.published_at is null or l.published_at>statement_timestamp()
  or coalesce(l.expires_at,l.created_at+interval '6 hours')<=statement_timestamp()
  or not l.contact_consent or l.contact_phone is null
  or exists(select 1 from private.listing_moderation where listing_id=p_id and removed)
  or private.account_suspended(l.owner_id) then
  raise exception 'Listing unavailable' using errcode='42501';end if;
 return l.contact_phone;
end $$;
revoke select(contact_phone) on public.listings from authenticated;

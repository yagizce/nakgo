-- Listing contact phone with publication consent. Readers never select the column;
-- verified, non-anonymous accounts get it only through nakgo_listing_contact.
begin;
alter table public.listings
 add column contact_phone text check (contact_phone is null or contact_phone ~ '^\+90[235][0-9]{9}$'),
 add column contact_consent boolean not null default false;
grant insert(contact_phone,contact_consent),update(contact_phone,contact_consent) on public.listings to authenticated;
-- Table-wide SELECT becomes a column list without the phone.
revoke select on public.listings from authenticated;
grant select(id,owner_id,kind,from_city,to_city,from_district,to_district,vehicle,body,amount,cargo,note,owner_label,
 available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,expires_at,contact_consent)
 on public.listings to authenticated;

create function public.nakgo_listing_contact(p_id bigint) returns text language plpgsql security definer set search_path='' as $$
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
 return l.contact_phone;
end $$;
revoke all on function public.nakgo_listing_contact(bigint) from public,anon;
grant execute on function public.nakgo_listing_contact(bigint) to authenticated;
commit;

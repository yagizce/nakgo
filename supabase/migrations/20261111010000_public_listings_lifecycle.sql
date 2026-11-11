-- DEV lifecycle: signed-out visitors see the same open set as signed-in readers
-- (listings_read), so an expired or contact-less listing never reaches the guest list.
-- Same signature and columns as 20261110010000; no contact or owner data is added.
create or replace function public.nakgo_public_listings(p_before bigint default null)
returns table (
 id bigint, kind text, from_city text, to_city text, vehicle text, body text, amount numeric,
 cargo text, items jsonb, available_on date, available_until date, available_time text,
 loading_text text, status text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
 select l.id,l.kind,l.from_city,l.to_city,l.vehicle,l.body,l.amount,
  l.cargo,l.items,l.available_on,l.available_until,l.available_time,
  l.loading_text,l.status,l.created_at
 from public.listings l
 where l.status='active'
  and coalesce(l.expires_at,l.created_at+interval '6 hours')>statement_timestamp()
  and l.contact_consent and l.contact_phone is not null
  and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)
  and not private.account_suspended(l.owner_id)
  and (p_before is null or l.id<p_before)
 order by l.id desc
 limit 50
$$;
revoke all on function public.nakgo_public_listings(bigint) from public;
grant execute on function public.nakgo_public_listings(bigint) to anon, authenticated;

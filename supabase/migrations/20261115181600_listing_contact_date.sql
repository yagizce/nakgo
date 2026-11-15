-- Telefon numarası yalnız listede görünen ilan için verilir: listings_read politikasındaki
-- tarih koşulu (takvim tarihi bugünden eskiyse ilan listeden düşer) burada da uygulanır.
-- Böylece tarihi geçen ilan, 6 saatlik süresi dolmadan da numara vermez. Diğer kontroller aynı.
begin;
create or replace function public.nakgo_listing_contact(p_id bigint, p_channel text default null) returns text language plpgsql security definer set search_path='' as $$
declare l public.listings; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
  or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then
  raise exception 'Verified account required' using errcode='42501';end if;
 perform private.require_activity(actor);select * into l from public.listings where id=p_id;
 if found and l.owner_id=actor then return l.contact_phone;end if;
 if not found or l.status<>'active' or l.expires_at<=statement_timestamp()
  or (l.loading_text is null and coalesce(l.available_until,l.available_on)<(statement_timestamp() at time zone 'Europe/Istanbul')::date)
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
commit;

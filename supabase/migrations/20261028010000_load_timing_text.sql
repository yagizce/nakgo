-- Free text belongs only to load listings. Existing calendar records are untouched.
begin;
alter table public.listings add column loading_text text;
alter table public.listings alter column available_on drop not null;
alter table public.listings add constraint listings_loading_text_valid check (
 (loading_text is null and available_on is not null) or
 (kind='load' and loading_text is not null and loading_text ~ '[^[:space:]]'
  and char_length(loading_text)<=32 and available_on is null and available_until is null and available_time='')
);
grant insert(loading_text),update(loading_text) on public.listings to authenticated;
alter policy listings_read on public.listings using (
 owner_id=(select auth.uid()) or
 (status='active' and (loading_text is not null or coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date))
);
-- Preserve the installed functions' security and moderation checks; fail closed if their expected source differs.
do $migration$
declare source text; updated text;
begin
 source:=pg_get_functiondef('public.nakgo_request_transport(bigint)'::regprocedure);
 updated:=replace(source,'''date'',l.available_on,','''date'',l.available_on,''dateText'',l.loading_text,');
 if updated=source then raise exception 'Unexpected transport snapshot definition'; end if;
 execute updated;
 source:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text)'::regprocedure);
 updated:=replace(source,'and coalesce(available_until,available_on)>=','and (loading_text is not null or coalesce(available_until,available_on)>=');
 updated:=replace(updated,'''Europe/Istanbul'')::date),','''Europe/Istanbul'')::date)),');
 if updated=source then raise exception 'Unexpected admin overview definition'; end if;
 execute updated;
end $migration$;
comment on column public.listings.loading_text is 'Owner-entered load timing, displayed literally. No automatic calendar date or expiry is inferred; owner closure/moderation still apply.';
commit;

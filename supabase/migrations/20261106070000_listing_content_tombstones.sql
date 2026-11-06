begin;
-- Retain a non-content tombstone for existing audit FKs, not a fabricated route.
alter table public.listings alter column owner_id drop not null,
 alter column from_city drop not null,alter column to_city drop not null,
 alter column vehicle drop not null,alter column body drop not null,alter column amount drop not null;
alter table public.listings add constraint listing_content_presence check(
 (content_redacted_at is null and owner_id is not null and from_city is not null and to_city is not null and vehicle is not null and body is not null and amount is not null)
 or (content_redacted_at is not null and owner_id is null and from_city is null and to_city is null and vehicle is null and body is null and amount is null)) not valid;
-- Existing redacted tombstones require individual cleanup approval; NOT VALID
-- preserves them but enforces the complete rule for each new/changed row.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.nakgo_redact_listings()'::regprocedure);
 if strpos(definition,'update public.listings set status=''archived'',contact_phone=null,contact_consent=false,')=0 then raise exception 'Unexpected redaction routine';end if;
 execute replace(definition,'update public.listings set status=''archived'',contact_phone=null,contact_consent=false,',
 'update public.listings set owner_id=null,from_city=null,to_city=null,vehicle=null,body=null,amount=null,status=''archived'',contact_phone=null,contact_consent=false,');
end $$;
commit;

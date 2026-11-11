-- Main adaptation of the trusted DEV contact test (owner_label required, no published_at).
-- In-memory/local fixture only. Every synthetic account and row is rolled back.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
 other_id uuid:=gen_random_uuid(); unverified uuid:=gen_random_uuid();
 ids bigint[]; listing_id bigint; at timestamptz:=statement_timestamp();
begin
 insert into auth.users(id,email_confirmed_at) values(owner_id,at),(reader_id,at),(other_id,at),(unverified,null);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 with seeded as (
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent,owner_label)
  select 'load','İstanbul','Ankara','Tır','Tenteli',20,'Synthetic','bugün','+905321234567',true,'Synthetic'
  from generate_series(1,6) returning id
 ) select array_agg(id order by id) into ids from seeded;

 -- Shift only fixture timestamps; production triggers remain part of the test schema.
 alter table public.listings disable trigger user;
 update public.listings set created_at=at-interval '6 hours',expires_at=at where id=ids[2];
 update public.listings set status='closed' where id=ids[3];
 update public.listings set contact_consent=false where id=ids[4];
 update public.listings set created_at=at+interval '1 hour',expires_at=at+interval '7 hours' where id=ids[5];
 alter table public.listings enable trigger user;
 insert into private.listing_moderation(listing_id,removed) values(ids[6],true);

 perform set_config('request.jwt.claim.sub',reader_id::text,true);
 set local role authenticated;
 if public.nakgo_listing_contact(ids[1]) is distinct from '+905321234567' then raise exception 'FAIL consented active RPC';end if;
 perform public.nakgo_set_favorite(ids[1],true);
 if not exists(select 1 from public.listing_favorites f join public.listings l on l.id=f.listing_id where l.id=ids[1]) then raise exception 'FAIL safe favorite projection';end if;
 begin perform l.contact_phone from public.listing_favorites f join public.listings l on l.id=f.listing_id where l.id=ids[1];raise exception 'FAIL raw favorite contact';exception when insufficient_privilege then null;end;
 begin perform l.contact_phone from public.listings l where l.id=ids[1];raise exception 'FAIL raw listing contact';exception when insufficient_privilege then null;end;
 begin perform l.* from public.listings l where l.id=ids[1];raise exception 'FAIL wildcard contact';exception when insufficient_privilege then null;end;
 foreach listing_id in array array[ids[2],ids[3],ids[4],ids[6]] loop
  begin perform public.nakgo_listing_contact(listing_id);raise exception 'FAIL unavailable listing contact %',listing_id;exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub',unverified::text,true);
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL unverified contact';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',reader_id::text,true);
 perform set_config('request.jwt.claims','{"is_anonymous":true}',true);
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL anonymous auth session';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','',true);
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 if exists(select 1 from public.listing_favorites f where f.listing_id=ids[1]) then raise exception 'FAIL another account can see the favorite';end if;
 begin
  update public.listings l set contact_phone='+905333456789' where l.id=ids[1];
  if found then raise exception 'FAIL another account can change listing contact';end if;
 exception when insufficient_privilege then null;end;
 if public.nakgo_listing_contact(ids[1]) is distinct from '+905321234567' then raise exception 'FAIL unauthorized contact edit changed the number';end if;
 begin perform public.nakgo_listing_contact(ids[2]);raise exception 'FAIL another account can contact expired listing';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_listing_contact(null);raise exception 'FAIL null contact request';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL authenticated role without an actor';exception when insufficient_privilege then null;end;
 reset role;

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 begin perform l.contact_phone from public.listings l where l.id=ids[1];raise exception 'FAIL owner raw contact';exception when insufficient_privilege then null;end;
 update public.listings l set contact_phone='+905322345678' where l.id=ids[1];
 if public.nakgo_listing_contact(ids[1]) is distinct from '+905322345678' then raise exception 'FAIL owner authorized edit';end if;
 reset role;

 insert into private.account_moderation(user_id,suspended) values(reader_id,true);
 perform set_config('request.jwt.claim.sub',reader_id::text,true);
 set local role authenticated;
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL suspended reader contact';exception when insufficient_privilege then null;end;
 reset role;
 insert into private.account_moderation(user_id,suspended) values(owner_id,true);
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 set local role authenticated;
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL suspended seller contact';exception when insufficient_privilege then null;end;
 reset role;

 -- The anon role must be denied even with a synthetic verified subject.
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 set local role anon;
 begin perform public.nakgo_listing_contact(ids[1]);raise exception 'FAIL anon RPC';exception when insufficient_privilege then null;end;
 begin perform l.contact_phone from public.listings l;raise exception 'FAIL anon raw contact';exception when insufficient_privilege then null;end;
 reset role;
end $$;
rollback;

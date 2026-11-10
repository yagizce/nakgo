-- No real users, contact data or emails. Roll back every fixture.
begin;
select set_config('nakgo.test_a',gen_random_uuid()::text,true);
select set_config('nakgo.test_b',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.test_a')::uuid,now()),(current_setting('nakgo.test_b')::uuid,now());
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_a'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,note,image_data,loading_text)
 values('load','İstanbul','Ankara','Tır','Tenteli',22,'Test yük','Test A Kişisel Ad','Not: 05000000000','','bugün')
 returning set_config('nakgo.open_load',id::text,true);
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values('truck','Ankara','İzmir','Kamyon','Kapalı kasa',10,'Test A',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.open_truck',id::text,true);
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values('truck','Bursa','Konya','Kamyon','Kapalı kasa',10,'Test A',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.closed_truck',id::text,true);
update public.listings set status='closed' where id=current_setting('nakgo.closed_truck')::bigint;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values('truck','Adana','Mersin','Kamyon','Kapalı kasa',10,'Test A',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.past_truck',id::text,true);
reset role;
-- An active listing whose calendar date has passed stays hidden, as for signed-in readers.
alter table public.listings disable trigger listings_write_guard;
update public.listings set available_on=available_on-2 where id=current_setting('nakgo.past_truck')::bigint;
alter table public.listings enable trigger listings_write_guard;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare r record; n int;
begin
 begin
  perform 1 from public.listings;
  raise exception 'FAIL anon can read listings table';
 exception when insufficient_privilege then null; end;
 select count(*) into n from public.nakgo_public_listings() p
  where p.id in (current_setting('nakgo.open_load')::bigint,current_setting('nakgo.open_truck')::bigint);
 if n<>2 then raise exception 'FAIL anon sees open listings (%)',n; end if;
 if exists(select 1 from public.nakgo_public_listings() p where p.id=current_setting('nakgo.closed_truck')::bigint) then
  raise exception 'FAIL closed listing public'; end if;
 if exists(select 1 from public.nakgo_public_listings() p where p.id=current_setting('nakgo.past_truck')::bigint) then
  raise exception 'FAIL past-date listing public'; end if;
 select to_jsonb(p) j into r from public.nakgo_public_listings() p where p.id=current_setting('nakgo.open_load')::bigint;
 if r.j ?| array['owner_id','owner_label','note','image_data','contact_phone','updated_at'] then
  raise exception 'FAIL private column exposed: %',r.j; end if;
 if r.j::text like '%05000000000%' or r.j::text like '%Kişisel%' then raise exception 'FAIL personal text exposed'; end if;
 if r.j->>'loading_text'<>'bugün' or r.j->>'cargo'<>'Test yük' then raise exception 'FAIL listing facts missing'; end if;
 if exists(select 1 from public.nakgo_public_listings(current_setting('nakgo.open_truck')::bigint) p
  where p.id>=current_setting('nakgo.open_truck')::bigint) then raise exception 'FAIL cursor'; end if;
end $$;
reset role;
-- Moderated listings and suspended owners disappear from the public list.
insert into private.listing_moderation(listing_id,removed) values(current_setting('nakgo.open_truck')::bigint,true);
insert into private.account_moderation(user_id,suspended) values(current_setting('nakgo.test_a')::uuid,true);
set local role anon;
do $$ begin
 if exists(select 1 from public.nakgo_public_listings() p where p.id in
  (current_setting('nakgo.open_load')::bigint,current_setting('nakgo.open_truck')::bigint)) then
  raise exception 'FAIL moderated or suspended listing public'; end if;
end $$;
reset role;
rollback;

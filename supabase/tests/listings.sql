-- No real users, contact data or emails. Roll back every fixture.
begin;
select set_config('nakgo.test_a',gen_random_uuid()::text,true);
select set_config('nakgo.test_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('nakgo.test_a')::uuid),(current_setting('nakgo.test_b')::uuid);
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_a'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
 values('load','İstanbul','Ankara','Tır','Tenteli',22,'Test yük','Test A',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.listing_a',id::text,true);
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values('truck','Ankara','İzmir','Kamyon','Kapalı kasa',10,'Test A',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.truck_a',id::text,true);
do $$ begin
 if (select owner_id from public.listings where id=current_setting('nakgo.listing_a')::bigint)<>auth.uid() then raise exception 'FAIL owner assigned by database'; end if;
 update public.listings set note='Updated' where id=current_setting('nakgo.listing_a')::bigint;
 if (select note from public.listings where id=current_setting('nakgo.listing_a')::bigint)<>'Updated' then raise exception 'FAIL own edit'; end if;
 begin
  update public.listings set owner_id=current_setting('nakgo.test_b')::uuid where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL owner forgery';
 exception when insufficient_privilege then null; end;
 begin
  update public.listings set created_at=now() where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL timestamp forgery';
 exception when insufficient_privilege then null; end;
 begin
  update public.listings set kind='truck' where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL kind mutation';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.listings where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL hard delete';
 exception when insufficient_privilege then null; end;
 begin
  update public.listings set from_city=to_city where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL same route';
 exception when check_violation then null; end;
 begin
  update public.listings set amount=0 where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL amount';
 exception when check_violation then null; end;
 begin
  update public.listings set items='[{"n":"test","q":1,"u":"ton","phone":"private"}]' where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL arbitrary payload';
 exception when check_violation then null; end;
 begin
  update public.listings set available_on=(now() at time zone 'Europe/Istanbul')::date-1 where id=current_setting('nakgo.listing_a')::bigint;
  raise exception 'FAIL past active date';
 exception when check_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_b'),true);
set local role authenticated;
do $$ declare n integer; begin
 if (select count(*) from public.listings where id in(current_setting('nakgo.listing_a')::bigint,current_setting('nakgo.truck_a')::bigint))<>2 then raise exception 'FAIL authenticated active visibility'; end if;
 update public.listings set note='Forged' where id=current_setting('nakgo.listing_a')::bigint;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL cross-user edit'; end if;
 update public.listings set status='archived' where id=current_setting('nakgo.listing_a')::bigint;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL cross-user archive'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_a'),true);
set local role authenticated;
update public.listings set status='closed' where id=current_setting('nakgo.listing_a')::bigint;
update public.listings set status='archived' where id=current_setting('nakgo.truck_a')::bigint;
do $$ begin
 if (select count(*) from public.listings where owner_id=auth.uid())<>2 then raise exception 'FAIL owner history'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_b'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.listings where id in(current_setting('nakgo.listing_a')::bigint,current_setting('nakgo.truck_a')::bigint)) then raise exception 'FAIL closed/archived visibility'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.listings;
  raise exception 'FAIL anonymous read';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: load/truck creation, own update, active visibility, closed/archive isolation, owner/timestamp/kind protection, cross-user denial, payload/date/amount validation, anonymous denial; fixtures rolled back.' as result;

-- Temporary identities only; every fixture rolls back.
begin;
select set_config('nakgo.test_a', gen_random_uuid()::text, true);
select set_config('nakgo.test_b', gen_random_uuid()::text, true);
insert into auth.users(id) values (current_setting('nakgo.test_a')::uuid),(current_setting('nakgo.test_b')::uuid);
insert into public.profiles(id,display_name) values (current_setting('nakgo.test_a')::uuid,'A'),(current_setting('nakgo.test_b')::uuid,'B');
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_a'),true);
set local role authenticated;
do $$
declare n integer;
begin
 update public.profiles set city='Ankara', about='Test', phone='05555555555' where id=auth.uid();
 get diagnostics n=row_count;
 if n<>1 or (select phone from public.profiles where id=auth.uid())<>'05555555555' then raise exception 'FAIL own contact persistence'; end if;
 if (select count(*) from public.profiles)<>1 then raise exception 'FAIL cross-user read'; end if;
 update public.profiles set phone='05555555556' where id=current_setting('nakgo.test_b')::uuid;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL cross-user write'; end if;
 begin
  update public.profiles set city=repeat('x',41) where id=auth.uid();
  raise exception 'FAIL city length';
 exception when check_violation then null; end;
 begin
  update public.profiles set about=repeat('x',201) where id=auth.uid();
  raise exception 'FAIL about length';
 exception when check_violation then null; end;
 begin
  update public.profiles set phone='123' where id=auth.uid();
  raise exception 'FAIL phone format';
 exception when check_violation then null; end;
 begin
  update public.profiles set id=gen_random_uuid() where id=auth.uid();
  raise exception 'FAIL editable identity';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_b'),true);
set local role authenticated;
do $$ begin
 if (select city||about||phone from public.profiles where id=auth.uid())<>'' then raise exception 'FAIL second account isolation'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin
  perform phone from public.profiles;
  raise exception 'FAIL anonymous contact access';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: own contact persistence, cross-account and anonymous isolation, immutable identity, length and phone constraints; fixtures rolled back.' as result;

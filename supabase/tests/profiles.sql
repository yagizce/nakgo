-- Run as postgres in the development SQL Editor. All fixtures roll back.
-- No credentials, emails, sessions or real user data are created.
begin;
select set_config('nakgo.test_a', gen_random_uuid()::text, true);
select set_config('nakgo.test_b', gen_random_uuid()::text, true);
insert into auth.users (id) values
    (current_setting('nakgo.test_a')::uuid),
    (current_setting('nakgo.test_b')::uuid);
insert into public.profiles (id, display_name, account_type)
    values (current_setting('nakgo.test_b')::uuid, 'Test B', 'owner');
select set_config('request.jwt.claim.sub', current_setting('nakgo.test_a'), true);
set local role authenticated;

do $$
declare n integer;
begin
    insert into public.profiles (display_name, account_type) values ('Test A', 'carrier');
    select count(*) into n from public.profiles;
    if n <> 1 then raise exception 'FAIL own read / other read'; end if;
    update public.profiles set display_name = 'Updated A' where id = auth.uid();
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FAIL own update'; end if;
    update public.profiles set display_name = 'Forbidden' where id = current_setting('nakgo.test_b')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL other update'; end if;
    begin
        insert into public.profiles (id, display_name) values (current_setting('nakgo.test_b')::uuid, 'Forbidden');
        raise exception 'FAIL other insert allowed';
    exception when insufficient_privilege then null; end;
    begin
        update public.profiles set id = gen_random_uuid() where id = auth.uid();
        raise exception 'FAIL identity update allowed';
    exception when insufficient_privilege then null; end;
    begin
        update public.profiles set created_at = now() where id = auth.uid();
        raise exception 'FAIL timestamp update allowed';
    exception when insufficient_privilege then null; end;
    begin
        delete from public.profiles where id = auth.uid();
        raise exception 'FAIL delete allowed';
    exception when insufficient_privilege then null; end;
    begin
        update public.profiles set account_type = 'admin' where id = auth.uid();
        raise exception 'FAIL invalid role allowed';
    exception when check_violation then null; end;
    begin
        update public.profiles set display_name = repeat('x', 101) where id = auth.uid();
        raise exception 'FAIL oversized name allowed';
    exception when check_violation then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('nakgo.test_b'), true);
set local role authenticated;
do $$
begin
    if (select count(*) from public.profiles) <> 1 or
       (select display_name from public.profiles where id = auth.uid()) <> 'Test B'
    then raise exception 'FAIL second user isolation'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
    begin
        perform 1 from public.profiles;
        raise exception 'FAIL anonymous read allowed';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: own insert/read/update; cross-user read/update/insert denied; identity/timestamp/delete protected; constraints; second-user isolation; anonymous denial. Fixtures rolled back.' as result;

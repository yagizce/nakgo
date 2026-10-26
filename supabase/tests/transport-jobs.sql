-- Three synthetic identities; every row and identity is rolled back.
begin;
select set_config('nakgo.owner',gen_random_uuid()::text,true),set_config('nakgo.carrier',gen_random_uuid()::text,true),set_config('nakgo.other',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.owner')::uuid,now()),(current_setting('nakgo.carrier')::uuid,now()),(current_setting('nakgo.other')::uuid,now());
-- Fixture writes use a synthetic actor under the current moderation guards.
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
insert into public.profiles(id,display_name) values(current_setting('nakgo.owner')::uuid,'Test owner'),(current_setting('nakgo.carrier')::uuid,'Test carrier'),(current_setting('nakgo.other')::uuid,'Test other');
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
values('load','İstanbul','Ankara','Tır','Tenteli',20,'Test job load','Test owner',(now() at time zone 'Europe/Istanbul')::date)
returning set_config('nakgo.load',id::text,true);
do $$ begin
 begin perform public.nakgo_request_transport(current_setting('nakgo.load')::bigint);raise exception 'FAIL self request';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.carrier'),true);
set local role authenticated;
select set_config('nakgo.job',(public.nakgo_request_transport(current_setting('nakgo.load')::bigint)).id::text,true);
do $$ declare j public.transport_jobs; begin
 j:=public.nakgo_request_transport(current_setting('nakgo.load')::bigint);
 if j.id<>current_setting('nakgo.job')::bigint or (select count(*) from public.transport_jobs)<>1 then raise exception 'FAIL duplicate request';end if;
 if j.carrier_id<>auth.uid() or j.owner_id<>current_setting('nakgo.owner')::uuid or j.listing_snapshot->>'cargo'<>'Test job load' then raise exception 'FAIL server snapshot';end if;
 begin perform public.nakgo_transition_transport(j.id,'accept');raise exception 'FAIL carrier accept';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_transition_transport(j.id,'loaded');raise exception 'FAIL unaccepted loading';exception when check_violation then null;end;
 begin update public.transport_jobs set owner_id=auth.uid();raise exception 'FAIL direct write';exception when insufficient_privilege then null;end;
 begin delete from public.transport_jobs;raise exception 'FAIL delete';exception when insufficient_privilege then null;end;
 j:=public.nakgo_transition_transport(j.id,'withdraw');if j.status<>'withdrawn' then raise exception 'FAIL withdraw';end if;
 j:=public.nakgo_request_transport(j.listing_id);if j.status<>'wait' then raise exception 'FAIL retry';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.other'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.transport_jobs) then raise exception 'FAIL third-party visibility';end if;
 begin perform public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'accept');raise exception 'FAIL stranger mutation';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
set local role authenticated;
do $$ declare j public.transport_jobs; begin
 j:=public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'reject');if j.status<>'no' then raise exception 'FAIL reject';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.carrier'),true);
set local role authenticated;
select public.nakgo_request_transport(current_setting('nakgo.load')::bigint);
reset role;
update public.transport_jobs set expires_at=now()-interval '1 second' where id=current_setting('nakgo.job')::bigint;
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'accept');raise exception 'FAIL expired acceptance';exception when check_violation then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.carrier'),true);
set local role authenticated;
select public.nakgo_request_transport(current_setting('nakgo.load')::bigint);
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
set local role authenticated;
do $$ declare j public.transport_jobs; begin
 j:=public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'accept');if j.status<>'ok' then raise exception 'FAIL acceptance';end if;
 begin perform public.nakgo_transition_transport(j.id,'confirm');raise exception 'FAIL premature confirmation';exception when check_violation then null;end;
 begin perform public.nakgo_transition_transport(j.id,'loaded');raise exception 'FAIL owner loading';exception when insufficient_privilege then null;end;
 update public.listings set status='archived' where id=j.listing_id;
 if not exists(select 1 from public.transport_jobs where id=j.id) then raise exception 'FAIL history after archive';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.carrier'),true);
set local role authenticated;
do $$ declare j public.transport_jobs; begin
 j:=public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'loaded');if j.stage<>1 then raise exception 'FAIL loading';end if;
 begin perform public.nakgo_transition_transport(j.id,'confirm');raise exception 'FAIL self confirmation';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_transition_transport(j.id,'withdraw');raise exception 'FAIL accepted withdrawal';exception when check_violation then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.owner'),true);
set local role authenticated;
do $$ declare j public.transport_jobs; begin
 j:=public.nakgo_transition_transport(current_setting('nakgo.job')::bigint,'confirm');if j.stage<>3 or j.confirmed_at is null then raise exception 'FAIL final confirmation';end if;
 if (public.nakgo_transition_transport(j.id,'confirm')).confirmed_at<>j.confirmed_at then raise exception 'FAIL repeated confirm';end if;
end $$;
reset role;
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
values(current_setting('nakgo.owner')::uuid,'truck','İstanbul','Ankara','Tır','Tenteli',20,'Test owner',(now() at time zone 'Europe/Istanbul')::date)
returning set_config('nakgo.truck',id::text,true);
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on,status)
values(current_setting('nakgo.owner')::uuid,'load','İstanbul','Ankara','Tır','Tenteli',20,'Closed test','Test owner',(now() at time zone 'Europe/Istanbul')::date,'closed')
returning set_config('nakgo.closed',id::text,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.carrier'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_request_transport(current_setting('nakgo.truck')::bigint);raise exception 'FAIL truck request';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_request_transport(current_setting('nakgo.closed')::bigint);raise exception 'FAIL closed request';exception when check_violation then null;end;
end $$;
reset role;
update auth.users set email_confirmed_at=null where id=current_setting('nakgo.carrier')::uuid;
set local role authenticated;
do $$ begin
 begin perform public.nakgo_request_transport(current_setting('nakgo.load')::bigint);raise exception 'FAIL unverified RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin perform 1 from public.transport_jobs;raise exception 'FAIL anonymous read';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_request_transport(current_setting('nakgo.load')::bigint);raise exception 'FAIL anonymous RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: request/retry/withdraw/reject/accept/loading/confirmation, duplicate idempotency, expiry, private participant reads, direct-write and anonymous denial; all fixtures rolled back.' as result;

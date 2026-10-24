begin;
select set_config('nakgo.test_time',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('nakgo.test_time')::uuid);
select set_config('request.jwt.claim.sub',current_setting('nakgo.test_time'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on,available_time)
 values('load','İstanbul','Ankara','Tır','Tenteli',1,'Test','Test',(now() at time zone 'Europe/Istanbul')::date,'14:30');
do $$ begin
 if not exists(select 1 from public.listings where owner_id=auth.uid() and available_time='14:30') then raise exception 'FAIL time persistence';end if;
 begin
  update public.listings set available_time='25:70' where owner_id=auth.uid();
  raise exception 'FAIL invalid time';
 exception when check_violation then null;end;
end $$;
reset role;
rollback;
select 'PASS: typed time persists, invalid clock values rejected; fixtures rolled back.' as result;

-- Synthetic users and listings only; no persistent test data.
begin;
select set_config('nakgo.timing_owner',gen_random_uuid()::text,true);
select set_config('nakgo.timing_carrier',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.timing_owner')::uuid,now()),(current_setting('nakgo.timing_carrier')::uuid,now());
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_owner'),true);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.timing_owner')::uuid,'Timing owner','owner');
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_carrier'),true);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.timing_carrier')::uuid,'Timing carrier','carrier');
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_owner'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
 values('load','İstanbul','Ankara','Tır','Tenteli',10,'Synthetic timing test','Timing owner','yarın sabah') returning set_config('nakgo.timing_listing',id::text,true);
do $$ begin
 if (select available_on is not null or loading_text<>'yarın sabah' from public.listings where id=current_setting('nakgo.timing_listing')::bigint) then raise exception 'FAIL invented date/text loss'; end if;
 begin update public.listings set loading_text='   ' where id=current_setting('nakgo.timing_listing')::bigint; raise exception 'FAIL whitespace accepted'; exception when check_violation then null; end;
 begin update public.listings set loading_text=E'\t\n' where id=current_setting('nakgo.timing_listing')::bigint; raise exception 'FAIL whitespace controls accepted'; exception when check_violation then null; end;
 begin update public.listings set loading_text=repeat('x',33) where id=current_setting('nakgo.timing_listing')::bigint; raise exception 'FAIL overlong accepted'; exception when check_violation then null; end;
 begin update public.listings set loading_text=null where id=current_setting('nakgo.timing_listing')::bigint; raise exception 'FAIL missing timing accepted'; exception when check_violation then null; end;
 begin update public.listings set available_on=current_date where id=current_setting('nakgo.timing_listing')::bigint; raise exception 'FAIL conflicting date accepted'; exception when check_violation then null; end;
 begin insert into public.listings(kind,from_city,to_city,vehicle,body,amount,owner_label,loading_text) values('truck','İstanbul','Ankara','Tır','Tenteli',10,'Timing owner','bugün'); raise exception 'FAIL truck free text accepted'; exception when check_violation then null; end;
 update public.listings set loading_text='Ne zaman uygun olursa' where id=current_setting('nakgo.timing_listing')::bigint;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_carrier'),true);
set local role authenticated;
do $$ declare job public.transport_jobs; begin
 if not exists(select 1 from public.listings where id=current_setting('nakgo.timing_listing')::bigint and loading_text='Ne zaman uygun olursa') then raise exception 'FAIL other account feed'; end if;
 update public.listings set loading_text='forged' where id=current_setting('nakgo.timing_listing')::bigint;
 if found then raise exception 'FAIL other account edit'; end if;
 perform public.nakgo_set_favorite(current_setting('nakgo.timing_listing')::bigint,true);
 perform public.nakgo_open_conversation(current_setting('nakgo.timing_listing')::bigint);
 job:=public.nakgo_request_transport(current_setting('nakgo.timing_listing')::bigint);
 if job.listing_snapshot->>'dateText'<>'Ne zaman uygun olursa' then raise exception 'FAIL transport timing snapshot'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_owner'),true);
set local role authenticated;
update public.listings set status='closed' where id=current_setting('nakgo.timing_listing')::bigint;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.timing_carrier'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.listings where id=current_setting('nakgo.timing_listing')::bigint) then raise exception 'FAIL closed load visible'; end if;
end $$;
reset role;
rollback;

-- Per-account listing quota (10 active). Synthetic accounts only; everything rolls back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); i int; first_id bigint; t0 timestamptz:=statement_timestamp(); n int;
begin
 insert into auth.users(id,email_confirmed_at) values(a,t0),(b,t0);

 -- 10 listings succeed, the 11th is refused on the server.
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 for i in 1..10 loop
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','A','bugün');
 end loop;
 begin
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','A','bugün');
  raise exception 'FAIL 11th active listing accepted';
 exception when program_limit_exceeded then null; end;
 -- Editing a live listing is not blocked by the quota.
 update public.listings set cargo='Yük 2' where id=(select min(id) from public.listings where owner_id=a);
 reset role;

 -- Another account is unaffected.
 perform set_config('request.jwt.claim.sub',b::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','B','bugün');
 -- B cannot touch A's listings (RLS still applies).
 update public.listings set status='closed' where owner_id=a;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL cross-account update'; end if;
 reset role;

 -- Closing one frees a slot; reopening it while 10 are live is refused.
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 select min(id) into first_id from public.listings where owner_id=a;
 update public.listings set status='closed' where id=first_id;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','A','bugün');
 begin
  update public.listings set status='active' where id=first_id;
  raise exception 'FAIL reopening over quota accepted';
 exception when program_limit_exceeded then null; end;
 reset role;

 -- Expired listings do not count: after the 6-hour window the account can publish again,
 -- and republishing an expired listing is allowed while under the limit.
 alter table public.listings disable trigger user;
 update public.listings set expires_at=t0-interval '1 minute' where owner_id=a and status='active';
 alter table public.listings enable trigger user;
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','A','bugün');
 update public.listings set status='active' where id=first_id;
 reset role;
 if (select expires_at from public.listings where id=first_id)<=t0 then raise exception 'FAIL republished listing has no new window'; end if;

 -- Any edit revives an expired listing (write guard), so edits are counted too: with 10 live,
 -- editing an expired listing is refused instead of silently pushing the account to 11.
 alter table public.listings disable trigger user;
 update public.listings set status='active',expires_at=t0-interval '1 minute' where owner_id=a and status<>'active';
 alter table public.listings enable trigger user;
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 for i in 1..(10-(select count(*) from public.listings where owner_id=a and status='active' and expires_at>now())) loop
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','A','bugün');
 end loop;
 begin
  update public.listings set cargo='Canlandır' where id=(select min(id) from public.listings where owner_id=a and expires_at<=now());
  raise exception 'FAIL edit revived expired listing over quota';
 exception when program_limit_exceeded then null; end;
 reset role;
 if (select count(*) from public.listings where owner_id=a and status='active' and expires_at>now())<>10 then raise exception 'FAIL live count drifted'; end if;
 -- System jobs are not limited: nightly retention runs fine for an account at the limit.
 perform private.retention_run();

 -- The check runs under a per-account advisory lock (serialises concurrent inserts).
 if not exists(select 1 from pg_proc where proname='listing_quota' and prosrc like '%pg_advisory_xact_lock%') then
  raise exception 'FAIL quota not serialised'; end if;
end $$;
rollback;

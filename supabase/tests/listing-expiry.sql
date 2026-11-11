-- Six-hour publication window and optional districts. Synthetic rows only; rolled back.
begin;
select set_config('nakgo.exp_owner',gen_random_uuid()::text,true);
select set_config('nakgo.exp_reader',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.exp_owner')::uuid,now()),(current_setting('nakgo.exp_reader')::uuid,now());
select set_config('request.jwt.claim.sub',current_setting('nakgo.exp_owner'),true);
set local role authenticated;
insert into public.listings(kind,from_city,to_city,from_district,vehicle,body,amount,cargo,owner_label,loading_text)
 values('load','İzmir','Ankara','Bornova','Tır','Tenteli',20,'Test yük','Test','bugün')
 returning set_config('nakgo.exp_id',id::text,true);
do $$ declare l record; begin
 select expires_at-created_at d,from_district,to_district into l from public.listings where id=current_setting('nakgo.exp_id')::bigint;
 if l.d<>interval '6 hours' then raise exception 'FAIL six-hour default (%)',l.d; end if;
 if l.from_district<>'Bornova' or l.to_district is not null then raise exception 'FAIL optional districts'; end if;
 begin
  update public.listings set expires_at=now()+interval '1 year' where id=current_setting('nakgo.exp_id')::bigint;
  raise exception 'FAIL client extends expiry';
 exception when insufficient_privilege then null; end;
 begin
  update public.listings set from_district=repeat('x',41) where id=current_setting('nakgo.exp_id')::bigint;
  raise exception 'FAIL long district accepted';
 exception when check_violation then null; end;
end $$;
reset role;
-- Age the fixture past six hours.
alter table public.listings disable trigger listings_write_guard;
update public.listings set created_at=now()-interval '7 hours',expires_at=now()-interval '1 hour' where id=current_setting('nakgo.exp_id')::bigint;
alter table public.listings enable trigger listings_write_guard;
select set_config('request.jwt.claim.sub',current_setting('nakgo.exp_reader'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.listings where id=current_setting('nakgo.exp_id')::bigint) then raise exception 'FAIL expired listing readable'; end if;
 if exists(select 1 from public.nakgo_public_listings() p where p.id=current_setting('nakgo.exp_id')::bigint) then raise exception 'FAIL expired listing public'; end if;
 begin perform public.nakgo_set_favorite(current_setting('nakgo.exp_id')::bigint,true); raise exception 'FAIL favorite on expired listing';
 exception when insufficient_privilege then null; end;
 begin perform public.nakgo_open_conversation(current_setting('nakgo.exp_id')::bigint); raise exception 'FAIL message on expired listing';
 exception when insufficient_privilege then null; end;
 begin perform public.nakgo_request_transport(current_setting('nakgo.exp_id')::bigint); raise exception 'FAIL transport request on expired listing';
 exception when check_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.exp_owner'),true);
set local role authenticated;
do $$ declare e timestamptz; begin
 if not exists(select 1 from public.listings where id=current_setting('nakgo.exp_id')::bigint) then raise exception 'FAIL owner loses expired listing'; end if;
 -- Reopening (status active on an expired listing) starts a new window.
 update public.listings set status='active' where id=current_setting('nakgo.exp_id')::bigint;
 select expires_at into e from public.listings where id=current_setting('nakgo.exp_id')::bigint;
 if e-now()<>interval '6 hours' then raise exception 'FAIL reopen renews (%)',e-now(); end if;
 -- A plain edit of a live listing keeps the window.
 update public.listings set note='edit' where id=current_setting('nakgo.exp_id')::bigint;
 if (select expires_at from public.listings where id=current_setting('nakgo.exp_id')::bigint)<>e then raise exception 'FAIL edit renews'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare j jsonb; begin
 select to_jsonb(p) into j from public.nakgo_public_listings() p where p.id=current_setting('nakgo.exp_id')::bigint;
 if j is null or j->>'from_district'<>'Bornova' then raise exception 'FAIL reopened listing public with district (%)',j; end if;
end $$;
reset role;
rollback;

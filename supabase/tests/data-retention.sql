-- Daily retention job. Synthetic accounts and rows only; everything is rolled back.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid(); carrier_id uuid:=gen_random_uuid();
 ids bigint[]; job bigint; conv bigint; c jsonb; r record; t0 timestamptz:=statement_timestamp();
begin
 insert into auth.users(id,email_confirmed_at) values(owner_id,t0),(carrier_id,t0);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 -- Headers as the Supabase gateway forwards them: the client may prepend a fake x-forwarded-for entry.
 perform set_config('request.headers','{"x-forwarded-for":"192.0.2.66,203.0.113.7","sb-forwarded-for":"203.0.113.7","cf-connecting-ip":"203.0.113.7","x-real-ip":"192.0.2.77"}',true);
 set local role authenticated;
 with seeded as (
  insert into public.listings(kind,from_city,to_city,from_district,to_district,vehicle,body,amount,cargo,note,loading_text,contact_phone,contact_consent,owner_label)
  select 'load','İstanbul','Ankara','Kadıköy','Çankaya','Tır','Tenteli',20,'Synthetic cargo','Ara beni','bugün','+905321234567',true,'Synthetic Owner'
  from generate_series(1,5) returning id
 ) select array_agg(id order by id) into ids from seeded;
 reset role;
 if (select count(*) from private.access_log where user_id=owner_id and action='listing_create' and ip='203.0.113.7')<>5 then
  raise exception 'FAIL listing create logged with client IP'; end if;
 -- Only gateway-set headers are trusted; client-controlled x-forwarded-for / x-real-ip are never logged.
 perform set_config('request.headers','{"x-forwarded-for":"192.0.2.66","x-real-ip":"192.0.2.77"}',true);
 if private.request_ip() is not null then raise exception 'FAIL untrusted forwarded header used'; end if;
 perform set_config('request.headers','{"cf-connecting-ip":"198.51.100.7","x-forwarded-for":"192.0.2.66"}',true);
 if private.request_ip()<>'198.51.100.7'::inet then raise exception 'FAIL cf-connecting-ip fallback'; end if;
 perform set_config('request.headers','{"sb-forwarded-for":"not-an-ip","x-forwarded-for":"192.0.2.66"}',true);
 if private.request_ip() is not null then raise exception 'FAIL malformed gateway header replaced by client value'; end if;
 perform set_config('request.headers','{"sb-forwarded-for":"203.0.113.7","cf-connecting-ip":"203.0.113.7","x-forwarded-for":"192.0.2.66,203.0.113.7"}',true);

 -- Age fixtures only. [1] ended 9 days ago, [2] 7 days ago, [3] moderated 9 days ago,
 -- [4] cleared over a year ago, [5] closed by the owner 9 days ago.
 alter table public.listings disable trigger user;
 update public.listings set expires_at=t0-interval '9 days' where id in(ids[1],ids[3]);
 update public.listings set expires_at=t0-interval '7 days' where id=ids[2];
 update public.listings set redacted_at=t0-interval '366 days' where id=ids[4];
 update public.listings set status='closed',updated_at=t0-interval '9 days' where id=ids[5];
 alter table public.listings enable trigger user;
 insert into private.listing_moderation(listing_id,removed) values(ids[3],true);

 alter table public.transport_jobs disable trigger user;
 insert into public.transport_jobs(listing_id,owner_id,carrier_id,carrier_label,listing_snapshot,status,updated_at)
 values(ids[2],owner_id,carrier_id,'Synthetic Carrier','{"from":"İstanbul","to":"Ankara","cargo":"Synthetic cargo","owner":"Synthetic Owner"}','no',t0-interval '31 days')
 returning id into job;
 alter table public.transport_jobs enable trigger user;
 alter table public.listing_conversations disable trigger user;
 alter table public.conversation_messages disable trigger user;
 insert into public.listing_conversations(listing_id,owner_id,guest_id,owner_label,guest_label,listing_kind,from_city,to_city)
 values(ids[2],owner_id,carrier_id,'A','B','load','İstanbul','Ankara') returning id into conv;
 insert into public.conversation_messages(conversation_id,sender_id,client_nonce,body) values(conv,carrier_id,gen_random_uuid(),'Merhaba');
 alter table public.listing_conversations enable trigger user;
 alter table public.conversation_messages enable trigger user;
 insert into private.access_log(at,user_id,action) values(t0-interval '366 days',owner_id,'login'),(t0-interval '364 days',owner_id,'login');

 c:=private.retention_run();
 if (c->>'listings_redacted')::int<2 or (c->>'listings_deleted')::int<1 then raise exception 'FAIL counts %',c; end if;
 select * into r from public.listings where id=ids[1];
 if r.contact_phone is not null or r.contact_consent or r.note<>'' or r.owner_label<>'NakGo kullanıcısı'
  or r.cargo<>'Silindi' or r.redacted_at is null or r.from_city<>'İstanbul' then raise exception 'FAIL ended listing cleared'; end if;
 -- Owner-written free text is cleared too; the CHECK keeps a placeholder instead of null.
 if r.loading_text<>'Silindi' or r.from_district is not null or r.to_district is not null then raise exception 'FAIL ended listing free text kept'; end if;
 if exists(select 1 from public.listings where id=ids[2] and (loading_text<>'bugün' or from_district<>'Kadıköy')) then raise exception 'FAIL 7-day listing free text cleared early'; end if;
 if (select redacted_at from public.listings where id=ids[5]) is null then raise exception 'FAIL closed listing cleared'; end if;
 if (select contact_phone from public.listings where id=ids[2]) is null then raise exception 'FAIL 7-day listing kept'; end if;
 if (select contact_phone from public.listings where id=ids[3]) is null then raise exception 'FAIL moderated listing held'; end if;
 if exists(select 1 from public.listings where id=ids[4]) then raise exception 'FAIL old cleared listing deleted'; end if;
 if exists(select 1 from public.transport_jobs where id=job and (listing_snapshot?'cargo' or listing_snapshot?'owner' or carrier_label<>'NakGo kullanıcısı'))
  then raise exception 'FAIL closed job snapshot cleared'; end if;
 if (select listing_snapshot->>'to' from public.transport_jobs where id=job)<>'Ankara' then raise exception 'FAIL job route kept'; end if;
 if exists(select 1 from public.listing_conversations where id=conv) or exists(select 1 from public.conversation_messages where conversation_id=conv)
  then raise exception 'FAIL retired messaging deleted'; end if;
 if exists(select 1 from private.access_log where user_id=owner_id and at<t0-interval '365 days') then raise exception 'FAIL old access log deleted'; end if;
 if not exists(select 1 from private.access_log where user_id=owner_id and action='login') then raise exception 'FAIL recent access log kept'; end if;
 if not exists(select 1 from private.retention_runs where counts=c) then raise exception 'FAIL run recorded'; end if;
 if exists(select 1 from pg_trigger where tgrelid='public.listings'::regclass and not tgisinternal and tgenabled<>'O')
  then raise exception 'FAIL listing triggers re-enabled'; end if;
 -- A second run finds nothing new to clear.
 if (private.retention_run()->>'listings_redacted')::int<>0 then raise exception 'FAIL idempotent'; end if;

 -- The owner no longer sees or reopens a cleared listing; clients cannot run the job.
 set local role authenticated;
 if exists(select 1 from public.listings where id=ids[1]) then raise exception 'FAIL cleared listing visible to owner'; end if;
 update public.listings set status='active' where id=ids[1];
 if exists(select 1 from public.listings where id=ids[2]) is false then raise exception 'FAIL owner keeps live listings'; end if;
 begin perform private.retention_run(); raise exception 'FAIL client runs retention'; exception when insufficient_privilege then null; end;
 begin perform 1 from private.access_log; raise exception 'FAIL client reads access log'; exception when insufficient_privilege then null; end;
 reset role;
 if (select status from public.listings where id=ids[1])<>'active' or (select expires_at from public.listings where id=ids[1])>t0
  then raise exception 'FAIL cleared listing reopened'; end if;
end $$;
rollback;

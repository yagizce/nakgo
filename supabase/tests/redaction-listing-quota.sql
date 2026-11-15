-- Free-text redaction on erase/retention and the per-account listing quota. Synthetic rows only; everything rolls back.
begin;
do $$
declare u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid(); l1 bigint; l2 bigint; i int; t0 timestamptz:=statement_timestamp(); x record;
begin
 insert into auth.users(id,email_confirmed_at,email) values(u1,t0,'q1@example.test'),(u2,t0,'q2@example.test'),(u3,t0,'q3@example.test');

 -- Erasure clears loading_text and districts like every other owner-written text.
 perform set_config('request.jwt.claim.sub',u1::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,from_district,to_district,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','İzmir','Manisa','Bornova','Yunusemre','Tır','Tenteli',10,'Yük','Bir','ara 0555 000 00 00') returning id into l1;
 perform public.nakgo_delete_my_account();
 reset role;
 select loading_text,from_district,to_district,redacted_at into x from public.listings where id=l1;
 if x.loading_text<>'Silindi' or x.from_district is not null or x.to_district is not null or x.redacted_at is null then
  raise exception 'FAIL erase kept free text: % % %',x.loading_text,x.from_district,x.to_district; end if;

 -- Nightly retention does the same for listings that ended more than 8 days ago.
 perform set_config('request.jwt.claim.sub',u2::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,from_district,to_district,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','İzmir','Manisa','Bornova','Yunusemre','Tır','Tenteli',10,'Yük','İki','yarın sabah') returning id into l2;
 reset role;
 alter table public.listings disable trigger user;
 update public.listings set expires_at=t0-interval '9 days' where id=l2;
 alter table public.listings enable trigger user;
 perform private.retention_run();
 select loading_text,from_district,to_district,redacted_at into x from public.listings where id=l2;
 if x.loading_text<>'Silindi' or x.from_district is not null or x.to_district is not null or x.redacted_at is null then
  raise exception 'FAIL retention kept free text: % % %',x.loading_text,x.from_district,x.to_district; end if;

 -- Quota: at most 10 active listings per account; the 11th is refused, others are unaffected.
 perform set_config('request.jwt.claim.sub',u3::text,true);
 set local role authenticated;
 for i in 1..10 loop
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Üç','bugün');
 end loop;
 begin
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Üç','bugün');
  raise exception 'FAIL 11th active listing accepted';
 exception when program_limit_exceeded then null; end;
 -- Closing one frees a slot.
 update public.listings set status='closed' where id=(select max(id) from public.listings where owner_id=u3);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Üç','bugün');
 reset role;

 -- Daily cap: 30 new listings in 24 hours even when older ones are closed.
 update public.listings set status='closed' where owner_id=u3;
 perform set_config('request.jwt.claim.sub',u3::text,true);
 set local role authenticated;
 for i in 1..19 loop
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Üç','bugün');
  update public.listings set status='closed' where id=(select max(id) from public.listings where owner_id=u3);
 end loop;
 begin
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','Üç','bugün');
  raise exception 'FAIL 31st listing in 24 hours accepted';
 exception when program_limit_exceeded then null; end;
 reset role;
end $$;
rollback;

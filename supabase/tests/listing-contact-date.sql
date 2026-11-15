-- Contact number follows the feed's date rule: a calendar listing whose date has passed gives no number,
-- even inside its 6-hour window. Synthetic rows only; everything rolls back.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid(); old_id bigint; today_id bigint; text_id bigint;
 t0 timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Europe/Istanbul')::date;
begin
 insert into auth.users(id,email_confirmed_at) values(owner_id,t0),(reader_id,t0);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,available_on,contact_phone,contact_consent,owner_label)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük',today,'+905321234567',true,'A') returning id into old_id;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,available_on,contact_phone,contact_consent,owner_label)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük',today,'+905321234567',true,'A') returning id into today_id;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent,owner_label)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Yük','bugün','+905321234567',true,'A') returning id into text_id;
 reset role;
 -- Midnight passed for the first listing while its 6-hour window is still open.
 alter table public.listings disable trigger user;
 update public.listings set available_on=today-1 where id=old_id;
 alter table public.listings enable trigger user;

 perform set_config('request.jwt.claim.sub',reader_id::text,true);
 set local role authenticated;
 if exists(select 1 from public.listings where id=old_id) then raise exception 'FAIL past-date listing still in feed'; end if;
 begin perform public.nakgo_listing_contact(old_id); raise exception 'FAIL past-date listing gave number';
 exception when insufficient_privilege then null; end;
 if public.nakgo_listing_contact(today_id) is distinct from '+905321234567' then raise exception 'FAIL current listing number'; end if;
 if public.nakgo_listing_contact(text_id) is distinct from '+905321234567' then raise exception 'FAIL free-text listing number'; end if;
 reset role;
 -- The owner still sees their own number.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 set local role authenticated;
 if public.nakgo_listing_contact(old_id) is distinct from '+905321234567' then raise exception 'FAIL owner own number'; end if;
 reset role;
end $$;
rollback;

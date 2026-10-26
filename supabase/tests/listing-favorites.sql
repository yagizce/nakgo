-- All synthetic accounts, listings and bookmarks are rolled back.
begin;
select set_config('nakgo.fav_owner',gen_random_uuid()::text,true),set_config('nakgo.fav_a',gen_random_uuid()::text,true),set_config('nakgo.fav_b',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.fav_owner')::uuid,now()),(current_setting('nakgo.fav_a')::uuid,now()),(current_setting('nakgo.fav_b')::uuid,now());
-- Fixture writes use a synthetic actor under the current moderation guards.
select set_config('request.jwt.claim.sub',current_setting('nakgo.fav_owner'),true);
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
 values(current_setting('nakgo.fav_owner')::uuid,'load','İstanbul','Ankara','Tır','Tenteli',10,'Favorite rollback load','Synthetic owner',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.fav_load',id::text,true);
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values(current_setting('nakgo.fav_owner')::uuid,'truck','İstanbul','Ankara','Tır','Tenteli',10,'Synthetic owner',(now() at time zone 'Europe/Istanbul')::date)
 returning set_config('nakgo.fav_truck',id::text,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.fav_a'),true);
set local role authenticated;
do $$ declare id bigint:=current_setting('nakgo.fav_load')::bigint; result jsonb; begin
 result:=public.nakgo_set_favorite(id,true);
 if result<>jsonb_build_object('listing_id',id,'saved',true) then raise exception 'FAIL explicit saved state';end if;
 perform public.nakgo_set_favorite(id,true);
 perform public.nakgo_set_favorite(current_setting('nakgo.fav_truck')::bigint,true);
 if (select count(*) from public.listing_favorites)<>2 then raise exception 'FAIL duplicate or truck favorite';end if;
 if exists(select 1 from public.listing_favorites where user_id<>auth.uid()) then raise exception 'FAIL identity';end if;
 begin insert into public.listing_favorites(user_id,listing_id) values(current_setting('nakgo.fav_b')::uuid,id);raise exception 'FAIL forged user';exception when insufficient_privilege then null;end;
 begin update public.listing_favorites set user_id=current_setting('nakgo.fav_b')::uuid;raise exception 'FAIL direct update';exception when insufficient_privilege then null;end;
 begin delete from public.listing_favorites;raise exception 'FAIL direct delete';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_set_favorite(null,true);raise exception 'FAIL null id';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_set_favorite(id,null);raise exception 'FAIL null state';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_set_favorite(9007199254740991,true);raise exception 'FAIL missing listing';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.fav_b'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.listing_favorites) then raise exception 'FAIL cross-account read';end if;
 perform public.nakgo_set_favorite(current_setting('nakgo.fav_load')::bigint,false);
 perform public.nakgo_set_favorite(current_setting('nakgo.fav_load')::bigint,true);
 if (select count(*) from public.listing_favorites)<>1 then raise exception 'FAIL second account save';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.fav_a'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.listing_favorites)<>2 then raise exception 'FAIL another account removed favorite';end if;
end $$;
reset role;
update public.listings set status='closed' where id=current_setting('nakgo.fav_load')::bigint;
update public.listings set status='archived' where id=current_setting('nakgo.fav_truck')::bigint;
set local role authenticated;
do $$ declare id bigint:=current_setting('nakgo.fav_load')::bigint; begin
 if exists(select 1 from public.listing_favorites f join public.listings l on l.id=f.listing_id) then raise exception 'FAIL favorite bypasses listing RLS';end if;
 if (select count(*) from public.listing_favorites)<>2 then raise exception 'FAIL unavailable bookmark missing';end if;
 begin perform public.nakgo_set_favorite(id,true);raise exception 'FAIL closed save';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_set_favorite(current_setting('nakgo.fav_truck')::bigint,true);raise exception 'FAIL archived save';exception when insufficient_privilege then null;end;
 perform public.nakgo_set_favorite(id,false);perform public.nakgo_set_favorite(id,false);
 if exists(select 1 from public.listing_favorites where listing_id=id) then raise exception 'FAIL closed removal';end if;
end $$;
reset role;
update auth.users set email_confirmed_at=null where id=current_setting('nakgo.fav_a')::uuid;
set local role authenticated;
do $$ begin
 begin perform public.nakgo_set_favorite(current_setting('nakgo.fav_truck')::bigint,false);raise exception 'FAIL unverified write';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin perform 1 from public.listing_favorites;raise exception 'FAIL anonymous read';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_set_favorite(current_setting('nakgo.fav_load')::bigint,true);raise exception 'FAIL anonymous RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from public.listings where id in(current_setting('nakgo.fav_load')::bigint,current_setting('nakgo.fav_truck')::bigint);
do $$ begin
 if exists(select 1 from public.listing_favorites where user_id in(current_setting('nakgo.fav_a')::uuid,current_setting('nakgo.fav_b')::uuid)) then raise exception 'FAIL listing cascade';end if;
end $$;
rollback;
select 'PASS: private favorites, load/truck, retries, isolation, listing visibility, removal and anonymous/unverified denial; fixtures rolled back' as result;

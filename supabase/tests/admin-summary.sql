-- Admin summaries and vehicle filters. Synthetic rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1); owner uuid:=gen_random_uuid(); o jsonb; before jsonb; rows jsonb; t0 timestamptz:=statement_timestamp();
 today date:=(t0 at time zone 'Europe/Istanbul')::date;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at) values(owner,t0);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.profiles(id,display_name,account_type) values(owner,'Synthetic summary carrier','carrier');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 before:=public.nakgo_admin_page('overview');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
  select 'load','Hakkari','Ardahan','Kamyonet','Tenteli',1,'Synthetic cargo','Synthetic owner','bugün' from generate_series(1,4);
 -- Previous week: 2 listings recorded 8 days ago.
 insert into private.daily_stats(day,listings,loads,trucks,users) values(today-8,2,2,0,0)
  on conflict(day) do update set listings=private.daily_stats.listings+2,loads=private.daily_stats.loads+2;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 o:=public.nakgo_admin_page('overview');
 if (o#>>'{periods,day,listings}')::int<>(before#>>'{periods,day,listings}')::int+4 or (o#>>'{periods,week,listings}')::int<>(before#>>'{periods,week,listings}')::int+4
  or (o#>>'{periods,week,prev_listings}')::int<>(before#>>'{periods,week,prev_listings}')::int+2 or o#>'{periods,month}' is null then raise exception 'FAIL periods %',o->'periods'; end if;
 if not (o#>'{periods,day,routes}') @> '[{"route":"Hakkari → Ardahan","count":4}]' then raise exception 'FAIL routes %',o#>'{periods,day,routes}'; end if;
 if (o#>>'{vehicle_users,kamyonet}')::int<>(before#>>'{vehicle_users,kamyonet}')::int+1 or o->'yesterday' is null then raise exception 'FAIL vehicle users'; end if;
 if (o#>'{periods,day,routes}')::text ~ '(phone|owner|label|@)' then raise exception 'FAIL routes carry personal data'; end if;
 rows:=public.nakgo_admin_page('users',0,'Synthetic summary','kamyonet');
 if jsonb_array_length(rows)<>1 or not (rows->0->'vehicles') @> '["Kamyonet"]' then raise exception 'FAIL vehicle filter %',rows; end if;
 if jsonb_array_length(public.nakgo_admin_page('users',0,'Synthetic summary','tir'))<>0 then raise exception 'FAIL tir filter'; end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 set local role authenticated;
 begin perform public.nakgo_admin_page('overview');raise exception 'FAIL ordinary overview';exception when insufficient_privilege then null;end;
 reset role;
end $$;
rollback;

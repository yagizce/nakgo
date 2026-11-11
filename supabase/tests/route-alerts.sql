-- Synthetic accounts only; everything is rolled back.
begin;
select set_config('nakgo.ra_a',gen_random_uuid()::text,true),set_config('nakgo.ra_b',gen_random_uuid()::text,true),set_config('nakgo.ra_u',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.ra_a')::uuid,now()),(current_setting('nakgo.ra_b')::uuid,now()),(current_setting('nakgo.ra_u')::uuid,null);
select set_config('request.jwt.claim.sub',current_setting('nakgo.ra_a'),true);
set local role authenticated;
do $$ declare r public.route_alerts; first_seen timestamptz; n int; begin
 r:=public.nakgo_save_route_alert('load',' İstanbul ',null,'Tır','');
 if r.from_city<>'İstanbul' or r.to_city is not null or r.body is not null or not r.active then raise exception 'FAIL trimmed alert %',to_jsonb(r);end if;
 perform set_config('nakgo.ra_id',r.id::text,true);
 begin perform public.nakgo_save_route_alert('load','İstanbul','','Tır',null);raise exception 'FAIL duplicate alert';exception when unique_violation then null;end;
 perform public.nakgo_save_route_alert('truck','İstanbul',null,'Tır',null);
 begin perform public.nakgo_save_route_alert('load','',' ',null,null);raise exception 'FAIL alert without route';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_save_route_alert('boat','İzmir',null,null,null);raise exception 'FAIL bad kind';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_save_route_alert('load',repeat('x',61),null,null,null);raise exception 'FAIL long city';exception when check_violation then null;end;
 for i in 1..18 loop perform public.nakgo_save_route_alert('load','Şehir '||i,null,null,null);end loop;
 begin perform public.nakgo_save_route_alert('load','Fazla',null,null,null);raise exception 'FAIL limit';exception when program_limit_exceeded then null;end;
 select seen_at into first_seen from public.route_alerts where id=r.id;
 r:=public.nakgo_set_route_alert(r.id,false);
 if r.active then raise exception 'FAIL pause';end if;
 n:=public.nakgo_route_alerts_seen();
 if n<>19 then raise exception 'FAIL seen marks only active alerts (%)',n;end if;
 if (select seen_at from public.route_alerts where id=r.id)<>first_seen then raise exception 'FAIL paused alert seen moved';end if;
 r:=public.nakgo_set_route_alert(r.id,true);
 if not r.active or r.seen_at<first_seen then raise exception 'FAIL resume restarts from now';end if;
 begin insert into public.route_alerts(user_id,from_city) values(auth.uid(),'X');raise exception 'FAIL direct insert';exception when insufficient_privilege then null;end;
 begin update public.route_alerts set active=false;raise exception 'FAIL direct update';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.ra_b'),true);
set local role authenticated;
do $$ declare aid bigint:=current_setting('nakgo.ra_id')::bigint; begin
 if exists(select 1 from public.route_alerts) then raise exception 'FAIL other account reads alerts';end if;
 begin perform public.nakgo_set_route_alert(aid,false);raise exception 'FAIL other account pauses';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_remove_route_alert(aid);raise exception 'FAIL other account removes';exception when insufficient_privilege then null;end;
 if public.nakgo_route_alerts_seen()<>0 then raise exception 'FAIL other account seen';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.ra_u'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_save_route_alert('load','İzmir',null,null,null);raise exception 'FAIL unverified alert';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- A suspended owner cannot add alerts but can still remove their own.
insert into private.account_moderation(user_id,suspended) values(current_setting('nakgo.ra_a')::uuid,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.ra_a'),true);
set local role authenticated;
do $$ declare aid bigint:=current_setting('nakgo.ra_id')::bigint; begin
 begin perform public.nakgo_save_route_alert('load','Bolu',null,null,null);raise exception 'FAIL suspended add';exception when insufficient_privilege then null;end;
 perform public.nakgo_remove_route_alert(aid);
 if exists(select 1 from public.route_alerts where route_alerts.id=aid) then raise exception 'FAIL remove';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.route_alerts;raise exception 'FAIL anon read';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_route_alerts_seen();raise exception 'FAIL anon rpc';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;

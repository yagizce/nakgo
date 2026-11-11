-- Account route alerts (item 18). Owner-only rows; writes go through RPCs so
-- limits, duplicates and the seen marker are enforced on the server.
begin;
create table public.route_alerts (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null default 'load' check(kind in ('load','truck')),
 from_city text check(from_city is null or char_length(from_city) between 1 and 60),
 to_city text check(to_city is null or char_length(to_city) between 1 and 60),
 vehicle text check(vehicle is null or char_length(vehicle) between 1 and 40),
 body text check(body is null or char_length(body) between 1 and 40),
 active boolean not null default true,
 -- Listings created after this moment count as new for the bell.
 seen_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint route_alerts_has_route check(from_city is not null or to_city is not null)
);
create unique index route_alerts_unique on public.route_alerts
 (user_id,kind,coalesce(from_city,''),coalesce(to_city,''),coalesce(vehicle,''),coalesce(body,''));
create index route_alerts_user on public.route_alerts(user_id,id desc);
alter table public.route_alerts enable row level security;
revoke all on public.route_alerts from public,anon,authenticated;
grant select on public.route_alerts to authenticated;
create policy route_alerts_read_own on public.route_alerts for select to authenticated
 using(user_id=(select auth.uid()));

create function private.route_alert_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501'; end if;
 perform private.require_activity(actor);
 return actor;
end $$;
revoke all on function private.route_alert_actor() from public,anon,authenticated;

create function public.nakgo_save_route_alert(p_kind text,p_from text,p_to text,p_vehicle text,p_body text)
returns public.route_alerts language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.route_alert_actor(); r public.route_alerts;
 v_from text:=nullif(btrim(coalesce(p_from,'')),''); v_to text:=nullif(btrim(coalesce(p_to,'')),'');
 v_vehicle text:=nullif(btrim(coalesce(p_vehicle,'')),''); v_body text:=nullif(btrim(coalesce(p_body,'')),'');
begin
 if p_kind is null or p_kind not in ('load','truck') or (v_from is null and v_to is null) then
  raise exception 'Invalid route alert' using errcode='22023'; end if;
 -- One lock per account serializes the limit check with concurrent inserts.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7311));
 if (select count(*) from public.route_alerts where user_id=actor)>=20 then
  raise exception 'Route alert limit' using errcode='54000'; end if;
 insert into public.route_alerts(user_id,kind,from_city,to_city,vehicle,body)
  values(actor,p_kind,v_from,v_to,v_vehicle,v_body)
  on conflict (user_id,kind,coalesce(from_city,''),coalesce(to_city,''),coalesce(vehicle,''),coalesce(body,'')) do nothing
  returning * into r;
 if r.id is null then raise exception 'Route alert exists' using errcode='23505'; end if;
 return r;
end $$;

create function public.nakgo_set_route_alert(p_id bigint,p_active boolean)
returns public.route_alerts language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.route_alert_actor(); r public.route_alerts;
begin
 if p_id is null or p_active is null then raise exception 'Invalid route alert' using errcode='22023'; end if;
 -- Turning an alert back on starts from now, so old listings do not ring again.
 update public.route_alerts set active=p_active,updated_at=now(),
  seen_at=case when p_active and not active then now() else seen_at end
  where id=p_id and user_id=actor returning * into r;
 if r.id is null then raise exception 'Route alert unavailable' using errcode='42501'; end if;
 return r;
end $$;

create function public.nakgo_remove_route_alert(p_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 -- Removal works even for a suspended account: it only deletes the user's own preference.
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_id is null then raise exception 'Invalid route alert' using errcode='22023'; end if;
 delete from public.route_alerts where id=p_id and user_id=actor;
 if not found then raise exception 'Route alert unavailable' using errcode='42501'; end if;
 return jsonb_build_object('id',p_id,'removed',true);
end $$;

-- Opening the bell marks every alert of the account as seen, on every device.
create function public.nakgo_route_alerts_seen()
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); n integer;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 update public.route_alerts set seen_at=now() where user_id=actor and active;
 get diagnostics n=row_count;
 return n;
end $$;

revoke all on function public.nakgo_save_route_alert(text,text,text,text,text) from public,anon;
revoke all on function public.nakgo_set_route_alert(bigint,boolean) from public,anon;
revoke all on function public.nakgo_remove_route_alert(bigint) from public,anon;
revoke all on function public.nakgo_route_alerts_seen() from public,anon;
grant execute on function public.nakgo_save_route_alert(text,text,text,text,text) to authenticated;
grant execute on function public.nakgo_set_route_alert(bigint,boolean) to authenticated;
grant execute on function public.nakgo_remove_route_alert(bigint) to authenticated;
grant execute on function public.nakgo_route_alerts_seen() to authenticated;
comment on table public.route_alerts is 'Private route alerts. Matching happens on listings the user can already read; no listing data is copied here.';
commit;

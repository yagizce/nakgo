begin;
create table private.maintenance_state (
 task text primary key check(task in ('redact','purge')),
 failures integer not null default 0,last_attempt timestamptz,last_success timestamptz,
 next_attempt timestamptz,last_error_code text
);
insert into private.maintenance_state(task) values('redact'),('purge');
alter table private.maintenance_state enable row level security;
revoke all on private.maintenance_state from public,anon,authenticated;
create table private.maintenance_events (
 id bigint generated always as identity primary key,task text not null,
 outcome text not null check(outcome in ('failed','recovered')),
 error_code text,at timestamptz not null default statement_timestamp()
);
alter table private.maintenance_events enable row level security;
revoke all on private.maintenance_events from public,anon,authenticated;
create function public.nakgo_maintenance(p_task text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.maintenance_state;code text;n integer:=0;
begin
 if p_task is null or p_task not in ('redact','purge') then raise exception 'Invalid maintenance task' using errcode='22023';end if;
 select * into s from private.maintenance_state where task=p_task for update;
 if s.next_attempt>statement_timestamp() then return jsonb_build_object('ok',false,'backoff',true);end if;
 begin
  if p_task='redact' then n:=public.nakgo_redact_listings();else perform public.nakgo_wa_purge();end if;
 exception when others then
  get stacked diagnostics code=returned_sqlstate;
  update private.maintenance_state set failures=least(failures+1,30),last_attempt=statement_timestamp(),last_error_code=code,
  next_attempt=statement_timestamp()+make_interval(secs=>least(3600,60*power(2,least(s.failures,6)))::integer) where task=p_task;
  insert into private.maintenance_events(task,outcome,error_code) values(p_task,'failed',code);
  return jsonb_build_object('ok',false,'backoff',false);
 end;
 if s.failures>0 then insert into private.maintenance_events(task,outcome) values(p_task,'recovered');end if;
 update private.maintenance_state set failures=0,last_error_code=null,next_attempt=null,last_attempt=statement_timestamp(),last_success=statement_timestamp() where task=p_task;
 return jsonb_build_object('ok',true,'count',n);
end $$;
revoke all on function public.nakgo_maintenance(text) from public,anon,authenticated;
grant execute on function public.nakgo_maintenance(text) to service_role;
create function public.nakgo_maintenance_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants where user_id=auth.uid() and capability='privacy_cases') then raise exception 'Privacy access denied' using errcode='42501';end if;
 return (select jsonb_agg(to_jsonb(s)) from private.maintenance_state s);
end $$;
revoke all on function public.nakgo_maintenance_status() from public,anon;
grant execute on function public.nakgo_maintenance_status() to authenticated;
commit;

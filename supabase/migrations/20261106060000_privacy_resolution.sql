begin;
create table private.privacy_settings(id boolean primary key default true check(id),account_deletion_enabled boolean not null default false);
alter table private.privacy_settings enable row level security;
revoke all on private.privacy_settings from public,anon,authenticated;
insert into private.privacy_settings(id) values(true);
create table private.account_erasure_events (
 id bigint generated always as identity primary key,
 request_id bigint not null unique references private.privacy_requests(id),
 subject_hash text not null check(length(subject_hash)=64),
 performed_at timestamptz not null default statement_timestamp(),
 retain_until timestamptz not null default statement_timestamp()+interval '3 years'
);
alter table private.account_erasure_events enable row level security;
revoke all on private.account_erasure_events from public,anon,authenticated;
create trigger protect_account_erasure_event before update or delete on private.account_erasure_events
 for each row execute function private.protect_erasure_event();
alter table private.privacy_requests add column revision integer not null default 0;
create table private.privacy_case_events (
 id bigint generated always as identity primary key,
 request_id bigint not null references private.privacy_requests(id),
 actor uuid references auth.users(id) on delete set null,
 status text not null,result_reference text not null,
 at timestamptz not null default statement_timestamp()
);
alter table private.privacy_case_events enable row level security;
revoke all on private.privacy_case_events from public,anon,authenticated;
-- Conservative automatic deletion: unknown business relations require individual
-- review. Check every user FK so a future table cannot silently cascade away.
create function private.account_deletion_blockers(p_user uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare c record; n bigint; reasons text[]:='{}';
begin
 if exists(select 1 from private.admin_members where user_id=p_user) then return array['protected_administrator'];end if;
 for c in select ns.nspname,t.relname,a.attname from pg_constraint fk
 join pg_class t on t.oid=fk.conrelid join pg_namespace ns on ns.oid=t.relnamespace
 join pg_attribute a on a.attrelid=t.oid and a.attnum=fk.conkey[1]
 where fk.contype='f' and fk.confrelid='auth.users'::regclass and ns.nspname<>'auth' loop
  if (c.nspname,c.relname,c.attname) in (('public','profiles','id'),('public','listing_favorites','user_id'),('private','privacy_requests','subject_id')) then continue;end if;
  execute format('select count(*) from %I.%I where %I=$1',c.nspname,c.relname,c.attname) into n using p_user;
  if n>0 then reasons:=array_append(reasons,c.nspname||'.'||c.relname);end if;
 end loop;
 if exists(select 1 from storage.objects where owner_id=p_user::text or name like p_user::text||'/%') then reasons:=array_append(reasons,'storage.objects');end if;
 return reasons;
end $$;
revoke all on function private.account_deletion_blockers(uuid) from public,anon,authenticated;
create function public.nakgo_privacy_resolve(p_id bigint,p_revision integer,p_status text,p_result text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.privacy_requests; blockers text[];
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants where user_id=auth.uid() and capability='privacy_cases') then raise exception 'Privacy access denied' using errcode='42501';end if;
 if p_status is null or p_status not in ('reviewing','completed','rejected') or p_result is null or length(btrim(p_result)) not between 10 and 500 then raise exception 'Invalid resolution' using errcode='22023';end if;
 select * into r from private.privacy_requests where id=p_id for update;
 if not found then raise exception 'Request unavailable' using errcode='P0002';end if;
 if r.revision is distinct from p_revision or r.status in ('completed','rejected') then raise exception 'Request changed' using errcode='40001';end if;
 if r.kind='deletion' and p_status='completed' then
  -- This gate is local-schema configuration, never accepted from a caller.
  if not coalesce((select account_deletion_enabled from private.privacy_settings where id),false) then raise exception 'Account deletion not enabled' using errcode='42501';end if;
  if r.subject_id is null then raise exception 'Missing subject' using errcode='P0002';end if;
  perform 1 from auth.users where id=r.subject_id for update;
  blockers:=private.account_deletion_blockers(r.subject_id);
  if cardinality(blockers)>0 then return jsonb_build_object('completed',false,'requires_review',true,'relations',blockers);end if;
  delete from auth.users where id=r.subject_id;
  insert into private.account_erasure_events(request_id,subject_hash) values(r.id,encode(sha256(convert_to(r.subject_id::text,'UTF8')),'hex'));
 end if;
 update private.privacy_requests set status=p_status,revision=revision+1,
 resolved_at=case when p_status='reviewing' then null else statement_timestamp() end,
 result_reference=btrim(p_result) where id=p_id;
 insert into private.privacy_case_events(request_id,actor,status,result_reference) values(p_id,auth.uid(),p_status,btrim(p_result));
 return jsonb_build_object('completed',p_status='completed','status',p_status);
end $$;
revoke all on function public.nakgo_privacy_resolve(bigint,integer,text,text) from public,anon;
grant execute on function public.nakgo_privacy_resolve(bigint,integer,text,text) to authenticated;
-- No identity/phone in the queue; case outcome references are restricted.
create or replace function public.nakgo_privacy_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants where user_id=auth.uid() and capability='privacy_cases') then raise exception 'Privacy access denied' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from
 (select id,kind,status,created_at,due_at,revision from private.privacy_requests where status in ('open','reviewing') order by due_at,id limit 50) r);
end $$;
commit;

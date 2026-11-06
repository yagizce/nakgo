-- Request tracking is not a claim that account erasure has completed.
begin;
create table private.privacy_requests (
 id bigint generated always as identity primary key,
 subject_id uuid references auth.users(id) on delete set null,
 kind text not null check(kind in ('access','correction','deletion','objection')),
 status text not null default 'open' check(status in ('open','reviewing','completed','rejected')),
 created_at timestamptz not null default statement_timestamp(),
 due_at timestamptz not null default statement_timestamp()+interval '30 days',
 resolved_at timestamptz,
 result_reference text,
 check((status in ('open','reviewing') and resolved_at is null) or
 (status in ('completed','rejected') and resolved_at is not null and length(result_reference) between 10 and 500))
);
create unique index privacy_one_open_request on private.privacy_requests(subject_id,kind)
 where status in ('open','reviewing');
alter table private.privacy_requests enable row level security;
revoke all on private.privacy_requests from public,anon,authenticated;
create function public.nakgo_privacy_request(p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.privacy_requests;
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
 raise exception 'Authentication required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('access','correction','deletion','objection') then
 raise exception 'Invalid request type' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_kind,6130));
 select * into r from private.privacy_requests where subject_id=auth.uid() and kind=p_kind and status in ('open','reviewing');
 if not found then insert into private.privacy_requests(subject_id,kind) values(auth.uid(),p_kind) returning * into r;end if;
 return jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'created_at',r.created_at,'due_at',r.due_at);
end $$;
create function public.nakgo_privacy_requests() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) from
 (select id,kind,status,created_at,due_at,resolved_at from private.privacy_requests
 where subject_id=auth.uid() order by id desc limit 50) r
$$;
create function public.nakgo_privacy_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants
 where user_id=auth.uid() and capability='privacy_cases') then
 raise exception 'Privacy access denied' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from
 (select id,kind,status,created_at,due_at from private.privacy_requests
 where status in ('open','reviewing') order by due_at,id limit 50) r);
end $$;
revoke all on function public.nakgo_privacy_request(text),public.nakgo_privacy_requests(),public.nakgo_privacy_queue() from public,anon;
grant execute on function public.nakgo_privacy_request(text),public.nakgo_privacy_requests(),public.nakgo_privacy_queue() to authenticated;
commit;

-- Account-scoped transport requests. Apply to development first.
begin;
create table public.transport_jobs (
 id bigint generated always as identity primary key check(id<=9007199254740991),
 listing_id bigint not null references public.listings(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 carrier_id uuid not null references auth.users(id) on delete cascade,
 carrier_label text not null,
 listing_snapshot jsonb not null,
 status text not null default 'wait' check(status in ('wait','ok','no','withdrawn')),
 stage smallint not null default 0 check(stage in (0,1,3)),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '3 days',
 loaded_at timestamptz,
 confirmed_at timestamptz,
 unique(listing_id,carrier_id),
 check(owner_id<>carrier_id),
 check((status='ok') or stage=0),
 check((stage=0 and loaded_at is null and confirmed_at is null) or
       (stage=1 and loaded_at is not null and confirmed_at is null) or
       (stage=3 and loaded_at is not null and confirmed_at is not null))
);
create index transport_jobs_owner on public.transport_jobs(owner_id,id desc);
create index transport_jobs_carrier on public.transport_jobs(carrier_id,id desc);
alter table public.transport_jobs enable row level security;
revoke all on public.transport_jobs from public,anon,authenticated;
revoke all on sequence public.transport_jobs_id_seq from public,anon,authenticated;
grant select on public.transport_jobs to authenticated;
create policy transport_jobs_participants on public.transport_jobs for select to authenticated
 using ((select auth.uid())=owner_id or (select auth.uid())=carrier_id);

create function public.nakgo_request_transport(p_listing_id bigint)
returns public.transport_jobs language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings; j public.transport_jobs; label text;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501'; end if;
 select * into l from public.listings where id=p_listing_id for update;
 if not found or l.owner_id=actor or l.kind<>'load' then
  raise exception 'Transport request unavailable' using errcode='42501'; end if;
 select * into j from public.transport_jobs where listing_id=l.id and carrier_id=actor for update;
 if found and (j.status='ok' or (j.status='wait' and j.expires_at>now())) then return j; end if;
 if l.status<>'active' or coalesce(l.available_until,l.available_on)<(now() at time zone 'Europe/Istanbul')::date then
  raise exception 'Listing is unavailable' using errcode='23514'; end if;
 select left(trim(display_name),60) into label from public.profiles where id=actor;
 if label is null or label='' then raise exception 'Profile name required' using errcode='23514'; end if;
 insert into public.transport_jobs(listing_id,owner_id,carrier_id,carrier_label,listing_snapshot)
 values(l.id,l.owner_id,actor,label,jsonb_build_object('from',l.from_city,'to',l.to_city,'cargo',l.cargo,
 'ton',l.amount,'veh',l.vehicle,'body',l.body,'date',l.available_on,'time',l.available_time,'owner',l.owner_label))
 on conflict(listing_id,carrier_id) do update set status='wait',stage=0,carrier_label=excluded.carrier_label,
 listing_snapshot=excluded.listing_snapshot,updated_at=now(),expires_at=now()+interval '3 days',loaded_at=null,confirmed_at=null
 returning * into j;
 return j;
end $$;
revoke all on function public.nakgo_request_transport(bigint) from public,anon;
grant execute on function public.nakgo_request_transport(bigint) to authenticated;

create function public.nakgo_transition_transport(p_job_id bigint,p_action text)
returns public.transport_jobs language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings; j public.transport_jobs; listing bigint;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501'; end if;
 select listing_id into listing from public.transport_jobs where id=p_job_id and actor in(owner_id,carrier_id);
 if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
 -- Use the same lock order as creation, so concurrent retries serialize safely.
 select * into l from public.listings where id=listing for update;
 select * into j from public.transport_jobs where id=p_job_id for update;
 if not found then raise exception 'Job unavailable' using errcode='42501'; end if;
 if p_action in('accept','reject','confirm') and actor<>j.owner_id or
    p_action in('withdraw','loaded') and actor<>j.carrier_id then
  raise exception 'Other participant required' using errcode='42501'; end if;
 if p_action='accept' then
  if j.status='ok' then return j; end if;
  if j.status<>'wait' or j.expires_at<=now() or l.status<>'active' or
    coalesce(l.available_until,l.available_on)<(now() at time zone 'Europe/Istanbul')::date then
   raise exception 'Request no longer available' using errcode='23514'; end if;
  update public.transport_jobs set status='ok',updated_at=now() where id=j.id returning * into j;
 elsif p_action='reject' then
  if j.status='no' then return j; end if;
  if j.status<>'wait' or j.expires_at<=now() then raise exception 'Invalid transition' using errcode='23514'; end if;
  update public.transport_jobs set status='no',updated_at=now() where id=j.id returning * into j;
 elsif p_action='withdraw' then
  if j.status='withdrawn' then return j; end if;
  if j.status<>'wait' then raise exception 'Invalid transition' using errcode='23514'; end if;
  update public.transport_jobs set status='withdrawn',updated_at=now() where id=j.id returning * into j;
 elsif p_action='loaded' then
  if j.status<>'ok' then raise exception 'Accepted job required' using errcode='23514'; end if;
  if j.stage>=1 then return j; end if;
  update public.transport_jobs set stage=1,loaded_at=now(),updated_at=now() where id=j.id returning * into j;
 elsif p_action='confirm' then
  if j.status<>'ok' or j.stage=0 then raise exception 'Loading report required' using errcode='23514'; end if;
  if j.stage=3 then return j; end if;
  update public.transport_jobs set stage=3,confirmed_at=now(),updated_at=now() where id=j.id returning * into j;
 else raise exception 'Unknown action' using errcode='22023';
 end if;
 return j;
end $$;
revoke all on function public.nakgo_transition_transport(bigint,text) from public,anon;
grant execute on function public.nakgo_transition_transport(bigint,text) to authenticated;
commit;

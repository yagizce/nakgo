begin;
-- Unknown historical holds remain protected pending individual legal review.
alter table private.listing_retention_holds add column expires_at timestamptz;
create table private.legal_hold_events (
 id bigint generated always as identity primary key,
 listing_id bigint not null references public.listings(id),
 actor uuid references auth.users(id) on delete set null,
 reason_reference text not null, expires_at timestamptz not null,
 at timestamptz not null default statement_timestamp()
);
alter table private.legal_hold_events enable row level security;
revoke all on private.legal_hold_events from public,anon,authenticated;
create table private.erasure_events (
 id bigint generated always as identity primary key,
 listing_id bigint not null,
 operation text not null check(operation='routine_listing_redaction'),
 performed_at timestamptz not null default statement_timestamp(),
 retain_until timestamptz not null default statement_timestamp()+interval '3 years',
 policy_version text not null default 'publication-6h-archive-8d',
 unique(listing_id,operation)
);
alter table private.erasure_events enable row level security;
revoke all on private.erasure_events from public,anon,authenticated;
create function private.record_listing_erasure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.content_redacted_at is null and new.content_redacted_at is not null then
 insert into private.erasure_events(listing_id,operation) values(new.id,'routine_listing_redaction');
 end if;
 return new;
end $$;
revoke all on function private.record_listing_erasure() from public,anon,authenticated;
create trigger record_listing_erasure after update on public.listings
 for each row execute function private.record_listing_erasure();
create function private.protect_erasure_event() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' or old.retain_until>statement_timestamp() then
 raise exception 'Erasure evidence retention' using errcode='42501';end if;
 return old;
end $$;
revoke all on function private.protect_erasure_event() from public,anon,authenticated;
create trigger protect_erasure_event before update or delete on private.erasure_events
 for each row execute function private.protect_erasure_event();
create function public.nakgo_archive_hold(p_id bigint,p_reference text,p_until timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants
 where user_id=auth.uid() and capability='privacy_cases') then
 raise exception 'Privacy access denied' using errcode='42501';end if;
 if p_until is null or p_until<=statement_timestamp() or p_reference is null
 or length(btrim(p_reference)) not between 10 and 500 then
 raise exception 'Reason reference and future expiry required' using errcode='22023';end if;
 perform 1 from public.listings where id=p_id and content_redacted_at is null for update;
 if not found then raise exception 'Listing unavailable' using errcode='P0002';end if;
 if exists(select 1 from private.listing_retention_holds where listing_id=p_id
 and (expires_at is null or expires_at>p_until)) then
 raise exception 'Existing hold cannot be shortened by this action' using errcode='42501';end if;
 -- References point to separately restricted evidence; no phone or copied message.
 insert into private.listing_retention_holds(listing_id,reason_reference,expires_at)
 values(p_id,btrim(p_reference),p_until)
 on conflict(listing_id) do update set reason_reference=excluded.reason_reference,expires_at=excluded.expires_at;
 insert into private.legal_hold_events(listing_id,actor,reason_reference,expires_at)
 values(p_id,auth.uid(),btrim(p_reference),p_until);
end $$;
revoke all on function public.nakgo_archive_hold(bigint,text,timestamptz) from public,anon;
grant execute on function public.nakgo_archive_hold(bigint,text,timestamptz) to authenticated;
create or replace function private.listing_retention_blocked(p_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.listing_retention_holds where listing_id=p_id
 and (expires_at is null or expires_at>statement_timestamp()))
 or exists(select 1 from private.archive_reviews where listing_id=p_id and status in ('open','reviewing'))
 or exists(select 1 from public.transport_jobs where listing_id=p_id)
 or exists(select 1 from public.listing_conversations where listing_id=p_id)
 or exists(select 1 from private.listing_moderation where listing_id=p_id)
$$;
commit;

-- DEV preparation; requires the matching lifecycle client. No physical row deletion.
begin;
alter table public.listings add column content_redacted_at timestamptz;
create index listings_retention_due on public.listings(created_at,id) where content_redacted_at is null;
create table private.listing_retention_holds (
 listing_id bigint primary key references public.listings(id),
 reason_reference text not null check(length(btrim(reason_reference)) between 10 and 500),
 created_at timestamptz not null default now()
);
create table private.listing_retention_state (
 id boolean primary key default true check(id),last_success_at timestamptz,
 last_redacted integer not null default 0,total_redacted bigint not null default 0
);
alter table private.listing_retention_holds enable row level security;
alter table private.listing_retention_state enable row level security;
revoke all on private.listing_retention_holds,private.listing_retention_state from public,anon,authenticated;
insert into private.listing_retention_state(id) values(true);

-- Without an approved legal schedule, all transaction/conversation/moderation links
-- count as holds, including completed transactions. Never cascade-delete evidence.
create function private.listing_retention_blocked(p_id bigint) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.listing_retention_holds where listing_id=p_id)
 or exists(select 1 from public.transport_jobs where listing_id=p_id)
 or exists(select 1 from public.listing_conversations where listing_id=p_id)
 or exists(select 1 from private.listing_moderation where listing_id=p_id)
$$;
revoke all on function private.listing_retention_blocked(bigint) from public,anon,authenticated;

create function private.listing_retention_guard() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.content_redacted_at is not null then raise exception 'Invalid redaction' using errcode='42501';end if;
  return new;
 end if;
 if old.content_redacted_at is not null then raise exception 'Redacted listing is immutable' using errcode='42501';end if;
 if new.content_redacted_at is not null then
  if current_setting('role',true) in ('authenticated','anon')
   or old.created_at>statement_timestamp()-interval '30 days'
   or coalesce(old.expires_at,old.created_at+interval '6 hours')>statement_timestamp()
   or private.listing_retention_blocked(old.id)
   or new.status<>'archived' or new.contact_phone is not null or new.contact_consent
   or new.note<>'' or new.image_data<>'' or new.items<>'[]'::jsonb
   or new.owner_label<>'İlan sahibi'
   or new.cargo<>(case when old.kind='load' then 'Temizlendi' else '' end)
   or new.loading_text is distinct from (case when old.kind='load' then 'Temizlendi' end)
   or new.available_on is distinct from (case when old.kind='truck' then date '1970-01-01' end)
   or new.available_until is not null or new.available_time<>'' then
   raise exception 'Invalid redaction' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.listing_retention_guard() from public,anon,authenticated;
-- Runs before the lifecycle guard; clients have no grant on the redaction marker.
create trigger a_listing_retention before insert or update on public.listings
 for each row execute function private.listing_retention_guard();
do $$ declare src text;begin
 src:=pg_get_functiondef('private.listing_lifecycle_guard()'::regprocedure);
 if strpos(src,E'begin\n if tg_op=')=0 then raise exception 'Unexpected lifecycle guard';end if;
 src:=replace(src,E'begin\n if tg_op=',E'begin\n if new.content_redacted_at is not null then return new;end if;\n if tg_op=');
 execute src;
end $$;

create function public.nakgo_redact_listings() returns integer
 language plpgsql security definer set search_path='' as $$
declare l public.listings; n integer:=0; prior text:=current_setting('request.jwt.claim.sub',true);
begin
 -- Serialize with another retention run; row locks also serialize normal edits.
 if not pg_try_advisory_xact_lock(6104,30) then return 0;end if;
 for l in select * from public.listings where content_redacted_at is null
  and created_at<=statement_timestamp()-interval '30 days'
  and coalesce(expires_at,created_at+interval '6 hours')<=statement_timestamp()
  and not private.listing_retention_blocked(id)
  order by created_at,id for update skip locked limit 100 loop
  perform set_config('request.jwt.claim.sub',l.owner_id::text,true);
  update public.listings set status='archived',contact_phone=null,contact_consent=false,
   owner_label='İlan sahibi',cargo=case when kind='load' then 'Temizlendi' else '' end,
   note='',image_data='',items='[]',loading_text=case when kind='load' then 'Temizlendi' end,
   available_on=case when kind='truck' then date '1970-01-01' end,
   available_until=null,available_time='',content_redacted_at=statement_timestamp() where id=l.id;
  insert into private.listing_lifecycle_audit(listing_id,action) values(l.id,'content_redacted_30d');n:=n+1;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(prior,''),true);
 update private.listing_retention_state set last_success_at=statement_timestamp(),last_redacted=n,total_redacted=total_redacted+n where id;
 return n;
end $$;
revoke all on function public.nakgo_redact_listings() from public,anon,authenticated;
grant execute on function public.nakgo_redact_listings() to service_role;

-- Preserve permission and audit evidence pending the approved legal schedule.
-- Never destroy pending/failed work. No physical deletes or storage.objects deletes.
create or replace function public.nakgo_wa_purge() returns void
 language plpgsql security definer set search_path='' as $$
declare s private.wa_sources;
begin
 for s in select * from private.wa_sources w where state in ('done','purged')
  and received_at<=statement_timestamp()-interval '30 days'
  and (original_text is not null or sender is not null or exists(
   select 1 from private.wa_drafts d left join public.listings l on l.id=d.listing_id
   where d.source_id=w.id and d.status<>'purged' and
    (l.content_redacted_at is not null or (d.listing_id is null and
     ((d.created_at<=statement_timestamp()-interval '30 days' and d.fields ?| array['description','contactPhone','company'])
      or d.updated_at<=statement_timestamp()-interval '90 days')))))
  and not exists(select 1 from private.wa_drafts d where d.source_id=w.id
   and d.listing_id is not null and private.listing_retention_blocked(d.listing_id))
  order by id for update skip locked limit 100 loop
  update private.wa_sources set original_text=null,sender=null where id=s.id;
  update private.wa_drafts d set fields='{}',issues='[]',status='purged',revision=revision+1
   where source_id=s.id and status<>'purged' and exists(select 1 from public.listings l
    where l.id=d.listing_id and l.content_redacted_at is not null);
  -- Preserve the previous unpublished-draft retention without deleting legal basis.
  update private.wa_drafts set fields=fields-'description'-'contactPhone'-'company',revision=revision+1
   where source_id=s.id and listing_id is null and created_at<=statement_timestamp()-interval '30 days'
    and fields ?| array['description','contactPhone','company'];
  update private.wa_drafts set fields='{}',issues='[]',status='purged',revision=revision+1
   where source_id=s.id and listing_id is null and status<>'purged'
    and updated_at<=statement_timestamp()-interval '90 days';
 end loop;
end $$;

-- Aggregate-only monitoring. Database bytes include indexes/bloat; object bytes
-- are metadata estimates, not billing or guaranteed recovered physical disk space.
create function public.nakgo_retention_status() returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.wa_admin();
 return jsonb_build_object(
  'observedAt',statement_timestamp(),
  'databaseBytes',pg_database_size(current_database()),
  'listingRelationBytes',pg_total_relation_size('public.listings'),
  'waAuditRelationBytes',pg_total_relation_size('private.wa_audit'),
  'retainedPermissionCount',(select count(*) from private.wa_publication_permissions),
  'unprocessedOldSources',(select count(*) from private.wa_sources where state in ('pending','processing','failed') and received_at<=statement_timestamp()-interval '30 days'),
  'storageObjectCount',(select count(*) from storage.objects),
  'storageMetadataBytes',(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,18}$' then (metadata->>'size')::numeric else 0 end),0) from storage.objects),
  'redacted',(select count(*) from public.listings where content_redacted_at is not null),
  'due',(select count(*) from public.listings where content_redacted_at is null and created_at<=statement_timestamp()-interval '30 days' and coalesce(expires_at,created_at+interval '6 hours')<=statement_timestamp() and not private.listing_retention_blocked(id)),
  'held',(select count(*) from public.listings where content_redacted_at is null and created_at<=statement_timestamp()-interval '30 days' and private.listing_retention_blocked(id)),
  'state',(select to_jsonb(s)-'id' from private.listing_retention_state s where id)
 );
end $$;
revoke all on function public.nakgo_retention_status() from public,anon;
grant execute on function public.nakgo_retention_status() to authenticated;
commit;

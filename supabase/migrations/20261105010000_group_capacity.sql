-- New operational metadata only; existing content/evidence is not deleted or rewritten.
begin;
create index wa_sources_ready_claim on private.wa_sources(next_attempt,id) where state='pending' and attempts<8;
create index wa_sources_expired_claim on private.wa_sources(lease_until,id) where state='processing' and attempts<8;
create or replace function public.nakgo_wa_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.wa_sources;
begin
 -- Recover expired leases without scanning every already-completed source.
 select * into s from private.wa_sources where state='processing' and lease_until<now() and attempts<8
  order by lease_until,id for update skip locked limit 1;
 if not found then
  select * into s from private.wa_sources where state='pending' and next_attempt<=now() and attempts<8
   order by next_attempt,id for update skip locked limit 1;
 end if;
 if not found then return null;end if;
 update private.wa_sources set state='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes'
  where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'lease',s.lease,'text',s.original_text);
end $$;
create table private.wa_publication_keys(
 fingerprint text primary key check(length(fingerprint)=64),
 listing_id bigint not null references public.listings(id),expires_at timestamptz not null
);
create index wa_publication_keys_expiry on private.wa_publication_keys(expires_at);
alter table private.wa_publication_keys enable row level security;
revoke all on private.wa_publication_keys from public,anon,authenticated;

create function private.wa_listing_key(l public.listings) returns text
language sql stable strict set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(l.kind,l.from_city,l.to_city,l.vehicle,l.body,l.amount,l.cargo,l.note,l.available_on,l.available_until,l.available_time,l.loading_text,l.items,l.contact_phone)::text,'UTF8')),'hex')
$$;
revoke all on function private.wa_listing_key(public.listings) from public,anon,authenticated;

-- Preserve the reviewed validator, identity, expiry, permissions and full audit.
alter function public.nakgo_wa_change(bigint,integer,text,jsonb,text) set schema private;
alter function private.nakgo_wa_change(bigint,integer,text,jsonb,text) rename to wa_change_core;
revoke all on function private.wa_change_core(bigint,integer,text,jsonb,text) from public,anon,authenticated,service_role;
create function public.nakgo_wa_change(p_id bigint,p_revision integer,p_action text,p_fields jsonb default null,p_basis text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;l public.listings;k text;other_id bigint;
begin
 result:=private.wa_change_core(p_id,p_revision,p_action,p_fields,p_basis);
 if p_action='publish' then
  select * into strict l from public.listings where id=(result->>'listingId')::bigint;
  k:=private.wa_listing_key(l);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(k,6105));
  select x.listing_id into other_id from private.wa_publication_keys x join public.listings other on other.id=x.listing_id
   where x.fingerprint=k and x.listing_id<>l.id and other.status='active'
   and other.expires_at>statement_timestamp() and private.wa_listing_key(other)=k;
  if found then
   -- The entire statement (including core insert/update/audit) rolls back.
   -- Source/draft remain intact; expiry never silently refreshes another listing.
   raise exception 'Duplicate active WhatsApp listing' using errcode='23514';
  end if;
  -- Expired cache keys are not consent/audit evidence. Keep real records intact.
  delete from private.wa_publication_keys where fingerprint in (
   select fingerprint from private.wa_publication_keys where expires_at<statement_timestamp()-interval '1 day'
   order by expires_at for update skip locked limit 16);
  insert into private.wa_publication_keys values(k,l.id,l.expires_at)
   on conflict(fingerprint) do update set listing_id=excluded.listing_id,expires_at=excluded.expires_at;
 end if;
 return result;
end $$;
revoke all on function public.nakgo_wa_change(bigint,integer,text,jsonb,text) from public,anon;
grant execute on function public.nakgo_wa_change(bigint,integer,text,jsonb,text) to authenticated;

-- Compression affects future tuples only. No rewrite, redaction or evidence loss.
do $$
declare t text;c text;
begin
 for t,c in select * from (values ('private.wa_sources','original_text'),('private.wa_drafts','fields'),('private.wa_audit','before_value'),('private.wa_audit','after_value'),('public.listings','image_data')) as v(t,c) loop
  begin
   execute format('alter table %s alter column %I set compression lz4',t,c);
  exception when feature_not_supported then
   execute format('alter table %s alter column %I set compression pglz',t,c);
  end;
 end loop;
end $$;

create function public.nakgo_capacity_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare bytes bigint;
begin
 if current_setting('role',true)<>'service_role' then perform private.wa_admin();end if;
 bytes:=(select sum(pg_database_size(datname)) from pg_database);
 return jsonb_build_object('databaseBytes',bytes,'applicationDatabaseBytes',pg_database_size(current_database()),'warningBytes',350000000,'highBytes',400000000,'criticalBytes',450000000,
  'level',case when bytes>=450000000 then 'critical' when bytes>=400000000 then 'high' when bytes>=350000000 then 'warning' else 'ok' end,
  'pending',(select count(*) from private.wa_sources where state='pending'),
  'processing',(select count(*) from private.wa_sources where state='processing'),
  'failed',(select count(*) from private.wa_sources where state='failed'),
  'oldestPendingSeconds',(select coalesce(extract(epoch from statement_timestamp()-min(received_at)),0) from private.wa_sources where state='pending'),
  'observedAt',statement_timestamp());
end $$;
revoke all on function public.nakgo_capacity_status() from public,anon;
grant execute on function public.nakgo_capacity_status() to authenticated,service_role;
commit;

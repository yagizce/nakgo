-- Inactive by default: existing worker purge flag remains false.
begin;
create table private.wa_erasure_events (
 id bigint generated always as identity primary key,
 object_kind text not null check(object_kind in ('source','draft')),
 object_id bigint not null,
 performed_at timestamptz not null default statement_timestamp(),
 retain_until timestamptz not null default statement_timestamp()+interval '3 years',
 unique(object_kind,object_id)
);
alter table private.wa_erasure_events enable row level security;
revoke all on private.wa_erasure_events from public,anon,authenticated;
create trigger protect_wa_erasure_event before update or delete on private.wa_erasure_events
 for each row execute function private.protect_erasure_event();
create or replace function public.nakgo_wa_purge() returns void
language plpgsql security definer set search_path='' as $$
declare s private.wa_sources; d private.wa_drafts;
begin
 if not pg_try_advisory_xact_lock(6104,31) then return;end if;
 -- Completed input has a bounded 72h troubleshooting window. Pending, leased
 -- and failed work is never silently discarded. Legal evidence remains held.
 for s in select * from private.wa_sources w where state in ('done','purged')
 and (original_text is not null or sender is not null or exists(
 select 1 from private.wa_drafts x left join public.listings l on l.id=x.listing_id
 where x.source_id=w.id and x.status<>'purged' and
 ((x.listing_id is null and x.created_at<=statement_timestamp()-interval '72 hours') or l.content_redacted_at is not null)))
 and not private.wa_retention_blocked(w.id)
 and (received_at<=statement_timestamp()-interval '72 hours' or exists(
 select 1 from private.wa_drafts x join public.listings l on l.id=x.listing_id
 where x.source_id=w.id and l.content_redacted_at is not null))
 order by id for update skip locked limit 100 loop
  -- A multi-ad message is cleared only when every candidate's temporary window
  -- has ended or its published content has already been redacted.
  if s.received_at<=statement_timestamp()-interval '72 hours' or not exists(
   select 1 from private.wa_drafts x left join public.listings l on l.id=x.listing_id
   where x.source_id=s.id and x.status<>'purged' and l.content_redacted_at is null) then
   if s.original_text is not null or s.sender is not null then
    insert into private.wa_erasure_events(object_kind,object_id) values('source',s.id) on conflict do nothing;
   end if;
   update private.wa_sources set original_text=null,sender=null where id=s.id;
  end if;
  for d in select * from private.wa_drafts x where source_id=s.id and status<>'purged'
   and ((listing_id is null and created_at<=statement_timestamp()-interval '72 hours')
    or exists(select 1 from public.listings l where l.id=x.listing_id and l.content_redacted_at is not null))
   for update loop
   -- Keep action/revision evidence without a duplicate of erased content.
   update private.wa_audit set
    before_value=jsonb_build_object('revision',before_value->'revision','status',before_value->'status','listing_id',before_value->'listing_id'),
    after_value=jsonb_build_object('revision',after_value->'revision','status',after_value->'status','listing_id',after_value->'listing_id')
    where draft_id=d.id;
   insert into private.wa_erasure_events(object_kind,object_id) values('draft',d.id) on conflict do nothing;
   update private.wa_drafts set fields='{}',issues='[]',status='purged',revision=revision+1 where id=d.id;
  end loop;
 end loop;
end $$;
-- Purged review objects are not an alternative legal-evidence reader.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.nakgo_wa_detail(bigint)'::regprocedure);
 if strpos(definition,'if not found then raise exception ''Not found'';end if;')=0 then raise exception 'Unexpected review detail';end if;
 execute replace(definition,'if not found then raise exception ''Not found'';end if;',
 'if not found or d.status=''purged'' then raise exception ''Not found'';end if;');
end $$;
commit;

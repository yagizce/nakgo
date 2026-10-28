-- Local preparation only. No memberships or existing listings are modified.
begin;
create table private.wa_sources (
 id bigint generated always as identity primary key,
 message_id text not null unique check(length(message_id) between 1 and 256),
 sender text, original_text text, sent_at timestamptz not null, received_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','processing','done','failed','purged')),
 attempts integer not null default 0, lease uuid, lease_until timestamptz, next_attempt timestamptz not null default now(),
 check(original_text is null or length(original_text) between 1 and 4096)
);
create index wa_sources_pending on private.wa_sources(next_attempt) where state in ('pending','processing');
create table private.wa_drafts (
 id bigint generated always as identity primary key,
 source_id bigint not null references private.wa_sources(id), ordinal integer not null,
 fields jsonb not null, issues jsonb not null, confidence numeric not null check(confidence between 0 and 1), fingerprint text not null,
 status text not null default 'draft' check(status in ('draft','published','rejected','withdrawn','purged')),
 revision integer not null default 0, listing_id bigint references public.listings(id) on delete set null,
 legal_basis text, reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id,ordinal)
);
create index wa_drafts_route on private.wa_drafts((fields->>'kind'),(fields#>>'{from,city}'),(fields#>>'{destinations,0,city}'));
create index wa_sources_retention on private.wa_sources(received_at) where original_text is not null;
create index wa_drafts_fingerprint on private.wa_drafts(fingerprint);
create table private.wa_audit (
 id bigint generated always as identity primary key, draft_id bigint not null references private.wa_drafts(id),
 actor uuid references auth.users(id) on delete set null, action text not null,
 before_value jsonb, after_value jsonb, created_at timestamptz not null default now()
);
create index wa_audit_history on private.wa_audit(draft_id,id desc);
alter table private.wa_sources enable row level security;
alter table private.wa_drafts enable row level security;
alter table private.wa_audit enable row level security;
revoke all on private.wa_sources,private.wa_drafts,private.wa_audit from public,anon,authenticated;
-- No direct table policies: access only through bounded, role-checked RPCs.
create function public.nakgo_wa_ingest(p_messages jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare m jsonb; n integer:=0; changed integer;
begin
 if jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages)>100 then raise exception 'Invalid batch'; end if;
 for m in select value from jsonb_array_elements(p_messages) loop
  if m->>'messageId' is null or m->>'text' is null or not (m->>'fromPhone' ~ '^\+[1-9][0-9]{7,14}$') or (m->>'timestamp')::numeric<=0 then raise exception 'Invalid message'; end if;
  insert into private.wa_sources(message_id,sender,original_text,sent_at) values(m->>'messageId',m->>'fromPhone',m->>'text',to_timestamp((m->>'timestamp')::double precision)) on conflict(message_id) do nothing;
  get diagnostics changed=row_count;n:=n+changed;
 end loop;return n;
end $$;
create function public.nakgo_wa_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.wa_sources;
begin
 select * into s from private.wa_sources where ((state='pending' and next_attempt<=now()) or (state='processing' and lease_until<now())) and attempts<8 order by id for update skip locked limit 1;
 if not found then return null; end if;
 update private.wa_sources set state='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'lease',s.lease,'text',s.original_text);
end $$;
create function public.nakgo_wa_finish(p_id bigint,p_lease uuid,p_drafts jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s private.wa_sources; d jsonb; i integer:=0;
begin
 select * into s from private.wa_sources where id=p_id for update;
 if s.state is distinct from 'processing' or s.lease is distinct from p_lease or s.lease_until<now() then raise exception 'Stale lease' using errcode='40001'; end if;
 if jsonb_typeof(p_drafts) is distinct from 'array' or jsonb_array_length(p_drafts) not between 1 and 30 then raise exception 'Invalid drafts';end if;
 for d in select value from jsonb_array_elements(p_drafts) loop
  if jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(d->'issues') is distinct from 'array' or length(d->>'fingerprint')<>64 then raise exception 'Invalid draft';end if;
  i:=i+1;insert into private.wa_drafts(source_id,ordinal,fields,issues,confidence,fingerprint) values(p_id,i,d->'fields',d->'issues',(d->>'confidence')::numeric,d->>'fingerprint');
 end loop;
 update private.wa_sources set state='done',lease=null,lease_until=null where id=p_id;
end $$;
create function public.nakgo_wa_fail(p_id bigint,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.wa_sources set state=case when attempts>=8 then 'failed' else 'pending' end,next_attempt=now()+least(attempts*attempts,60)*interval '1 minute',lease=null,lease_until=null where id=p_id and lease=p_lease and state='processing';
end $$;
create function private.wa_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501';end if;
 perform private.require_activity(auth.uid());
end $$;
create function public.nakgo_wa_page(p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.wa_admin();if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid page';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
 select d.id,d.fields,d.status,d.revision,d.confidence,d.issues,d.created_at,d.source_id,
 (select count(*) from private.wa_drafts x where x.id<>d.id and (x.fingerprint=d.fingerprint or (x.fields->>'kind'=d.fields->>'kind' and x.fields#>>'{from,city}'=d.fields#>>'{from,city}' and x.fields#>>'{destinations,0,city}'=d.fields#>>'{destinations,0,city}')) and x.status<>'purged') similar_count
 from private.wa_drafts d where status<>'purged' order by d.id desc limit 21 offset p_offset) t;
 return jsonb_build_object('drafts',result,'pending',(select count(*) from private.wa_sources where state in ('pending','processing')),'failed',(select count(*) from private.wa_sources where state='failed' or (state='processing' and attempts>=8 and lease_until<now())));
end $$;
create function public.nakgo_wa_detail(p_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d private.wa_drafts; result jsonb;
begin
 perform private.wa_admin();select * into d from private.wa_drafts where id=p_id;
 if not found then raise exception 'Not found';end if;
 select to_jsonb(d)||jsonb_build_object('source',jsonb_build_object('text',s.original_text,'receivedAt',s.received_at,'sentAt',s.sent_at),
 'similar',(select coalesce(jsonb_agg(x.id),'[]') from (select id from private.wa_drafts where fingerprint=d.fingerprint and id<>d.id and status<>'purged' limit 20) x),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select actor,action,before_value,after_value,created_at from private.wa_audit where draft_id=d.id order by id desc limit 50) a)) into result from private.wa_sources s where s.id=d.source_id;
 return result;
end $$;
create function public.nakgo_wa_change(p_id bigint,p_revision integer,p_action text,p_fields jsonb default null,p_basis text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.wa_drafts; previous jsonb; f jsonb; listing bigint; v_kind text;
begin
 perform private.wa_admin();select * into d from private.wa_drafts where id=p_id for update;
 if not found or d.status='purged' then raise exception 'Not found';end if;
 if p_revision is distinct from d.revision then raise exception 'Revision conflict' using errcode='40001';end if;
 if p_action is null or p_action not in ('save','publish','reject','withdraw') then raise exception 'Invalid action';end if;
 previous:=to_jsonb(d);f:=coalesce(p_fields,d.fields);v_kind:=f->>'kind';
 if jsonb_typeof(f) is distinct from 'object' or octet_length(f::text)>16000 or (f-array['kind','from','destinations','vehicle','body','weightMin','weightMax','amount','cargo','timing','availableOn','availableUntil','availableTime','vehicleCount','conditions','company','contactPhone','description','publicNote','ownerLabel','items','imageData'])<>'{}'::jsonb then raise exception 'Invalid fields';end if;
 if jsonb_typeof(f->'from') is distinct from 'object' or jsonb_typeof(f->'destinations') is distinct from 'array' or jsonb_array_length(f->'destinations')>20 then raise exception 'Invalid route';end if;
 if p_action='save' and d.status='published' then raise exception 'Published edits require reviewed publish';end if;
 if p_action='publish' then
  if p_basis is null or length(btrim(p_basis)) not between 10 and 1000 then raise exception 'Publication legal basis required';end if;
  if v_kind is null or v_kind not in ('load','truck') or jsonb_array_length(f->'destinations')=0 or f->>'amount' is null or (f->>'amount')::numeric<=0 then raise exception 'Required fields missing';end if;
  if (f->>'weightMin')::numeric<0 or (f->>'weightMax')::numeric>100 or (f->>'weightMin')::numeric>(f->>'weightMax')::numeric then raise exception 'Invalid weight range';end if;
  if jsonb_array_length(f->'destinations')>1 and coalesce(f->>'publicNote','')='' then raise exception 'Describe all delivery stops in reviewed public note';end if;
  if v_kind='load' and (f->>'timing' is null or not (f->>'timing' ~ '[^[:space:]]') or length(f->>'timing')>32) then raise exception 'Loading text required';end if;
  if v_kind='truck' and nullif(f->>'availableOn','') is null then raise exception 'Truck calendar required';end if;
  -- Public note/label are explicit reviewed fields, not raw message/contact copies.
  -- Existing listing identity is immutable: type changes close the old listing and publish a new one.
  listing:=d.listing_id;
  if listing is not null and (select l.kind from public.listings l where l.id=listing)<>v_kind then
   update public.listings set status='closed' where id=listing;listing:=null;
  end if;
  if listing is null then
   insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,loading_text,items,image_data)
   values(auth.uid(),v_kind,f#>>'{from,city}',f#>>'{destinations,0,city}',f->>'vehicle',f->>'body',(f->>'amount')::numeric,case when v_kind='truck' then '' else f->>'cargo' end,coalesce(f->>'publicNote',''),f->>'ownerLabel',case when v_kind='truck' then (f->>'availableOn')::date end,case when v_kind='truck' then nullif(f->>'availableUntil','')::date end,case when v_kind='truck' then coalesce(f->>'availableTime','') else '' end,case when v_kind='load' then f->>'timing' end,case when v_kind='truck' then '[]'::jsonb else coalesce(f->'items','[]') end,coalesce(f->>'imageData','')) returning id into listing;
  else
   update public.listings set from_city=f#>>'{from,city}',to_city=f#>>'{destinations,0,city}',vehicle=f->>'vehicle',body=f->>'body',amount=(f->>'amount')::numeric,cargo=case when v_kind='truck' then '' else f->>'cargo' end,note=coalesce(f->>'publicNote',''),owner_label=f->>'ownerLabel',available_on=case when v_kind='truck' then (f->>'availableOn')::date end,available_until=case when v_kind='truck' then nullif(f->>'availableUntil','')::date end,available_time=case when v_kind='truck' then coalesce(f->>'availableTime','') else '' end,loading_text=case when v_kind='load' then f->>'timing' end,items=case when v_kind='truck' then '[]'::jsonb else coalesce(f->'items','[]') end,image_data=coalesce(f->>'imageData',''),status='active' where id=listing;
  end if;
  update private.wa_drafts set fields=f,status='published',listing_id=listing,legal_basis=btrim(p_basis),reviewed_by=auth.uid(),reviewed_at=now() where id=d.id;
 elsif p_action in ('withdraw','reject') then
  if d.listing_id is not null then update public.listings set status='closed' where id=d.listing_id;end if;
  update private.wa_drafts set status=case when p_action='withdraw' then 'withdrawn' else 'rejected' end where id=d.id;
 else
  update private.wa_drafts set fields=f,status='draft',legal_basis=null,reviewed_by=null,reviewed_at=null where id=d.id;
 end if;
 update private.wa_drafts set revision=revision+1,updated_at=now() where id=d.id returning * into d;
 insert into private.wa_audit(draft_id,actor,action,before_value,after_value) values(d.id,auth.uid(),p_action,previous,to_jsonb(d));
 return jsonb_build_object('id',d.id,'revision',d.revision,'status',d.status,'listingId',d.listing_id);
end $$;
-- Prevent regular owner editing from bypassing WhatsApp review/audit. Moderation RPC still works.
-- Invoker trigger cannot read private tables as authenticated: expose only a boolean helper.
create function private.wa_linked(p_id bigint) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from private.wa_drafts where listing_id=p_id); $$;
create function private.wa_listing_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' and private.wa_linked(old.id) then raise exception 'Use WhatsApp review panel' using errcode='42501';end if;return new;
end $$;
grant execute on function private.wa_linked(bigint) to authenticated;
create trigger wa_listing_review before update on public.listings for each row execute function private.wa_listing_guard();
create function public.nakgo_wa_retry() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform private.wa_admin();update private.wa_sources set state='pending',attempts=0,lease=null,lease_until=null,next_attempt=now() where state='failed' or (state='processing' and attempts>=8 and lease_until<now());get diagnostics n=row_count;return n;
end $$;
-- Privacy retention: source body/sender 30 days, non-public drafts 90 days,
-- detailed audit snapshots 90 days. Minimal IDs/status remain for retry safety.
create function public.nakgo_wa_purge() returns void language plpgsql security definer set search_path='' as $$
begin
 update private.wa_sources set original_text=null,sender=null,state=case when state='done' then state else 'purged' end where received_at<now()-interval '30 days' and original_text is not null;
 update private.wa_drafts set fields=fields-'description'-'contactPhone'-'company',revision=revision+1 where created_at<now()-interval '30 days' and fields ?| array['description','contactPhone','company'];
 update private.wa_drafts set fields='{}',issues='[]',legal_basis=null,status='purged',revision=revision+1 where status not in ('published','purged') and updated_at<now()-interval '90 days';
 update private.wa_audit set before_value=before_value#-'{fields,description}'#-'{fields,contactPhone}'#-'{fields,company}',after_value=after_value#-'{fields,description}'#-'{fields,contactPhone}'#-'{fields,company}' where created_at<now()-interval '30 days' and (before_value is not null or after_value is not null);
 update private.wa_audit set before_value=null,after_value=null where created_at<now()-interval '90 days' and (before_value is not null or after_value is not null);
end $$;
revoke all on function private.wa_admin(),private.wa_listing_guard() from public,anon,authenticated;
revoke all on function private.wa_linked(bigint) from public,anon;
revoke all on function public.nakgo_wa_ingest(jsonb),public.nakgo_wa_claim(),public.nakgo_wa_finish(bigint,uuid,jsonb),public.nakgo_wa_fail(bigint,uuid),public.nakgo_wa_purge() from public,anon,authenticated;
-- Supabase service_role exists remotely; synthetic local harness may omit it.
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.nakgo_wa_ingest(jsonb),public.nakgo_wa_claim(),public.nakgo_wa_finish(bigint,uuid,jsonb),public.nakgo_wa_fail(bigint,uuid),public.nakgo_wa_purge() to service_role;
end if;end $$;
revoke all on function public.nakgo_wa_page(integer),public.nakgo_wa_detail(bigint),public.nakgo_wa_change(bigint,integer,text,jsonb,text),public.nakgo_wa_retry() from public,anon;
grant execute on function public.nakgo_wa_page(integer),public.nakgo_wa_detail(bigint),public.nakgo_wa_change(bigint,integer,text,jsonb,text),public.nakgo_wa_retry() to authenticated;
commit;

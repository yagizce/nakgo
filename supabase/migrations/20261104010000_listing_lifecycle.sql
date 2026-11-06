-- Local preparation. Apply only after reviewing the target DEV schema. No row deletion.
begin;
create function public.nakgo_normalize_phone(p text) returns text language plpgsql immutable set search_path='' as $$
declare d text;
begin
 if p is null or length(p)>32 or p !~ '^[+0-9 () .-]+$' then return null;end if;
 d:=regexp_replace(p,'[^0-9]','','g');
 if left(d,4)='0090' then d:=substr(d,5);
 elsif length(d)=12 and left(d,2)='90' then d:=substr(d,3);
 elsif length(d)=11 and left(d,1)='0' then d:=substr(d,2);end if;
 if d !~ '^[235][0-9]{9}$' or d=repeat(left(d,1),10) then return null;end if;
 return '+90'||d;
end $$;
revoke all on function public.nakgo_normalize_phone(text) from public,anon;
grant execute on function public.nakgo_normalize_phone(text) to authenticated;
alter table public.listings add column contact_phone text, add column contact_consent boolean not null default false,
 add column published_at timestamptz, add column expires_at timestamptz;
alter table public.listings alter column owner_label set default 'İlan sahibi';
-- Preserve legacy rows and histories, without inventing consent or new publication time.
-- Run before installing the new guard; existing trigger preserves updated_at semantics.
-- Identity timestamps are immutable, so expiry derives from existing created_at.
create or replace function private.activity_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='listings' then
  if tg_op='UPDATE' then
   if current_setting('role',true) not in ('authenticated','anon') and new.status='archived' and coalesce(old.expires_at,old.created_at+interval '6 hours')<=statement_timestamp() then return new;end if;
  end if;
 end if;
 perform private.require_activity(auth.uid());
 if tg_table_name='listings' then
  if new.status='active' and exists(select 1 from private.listing_moderation where listing_id=new.id and removed) then
   raise exception 'Listing moderated' using errcode='42501';
  end if;
 end if;
 return new;
end $$;

create index listings_expiry on public.listings(expires_at) where status='active';
create table private.listing_lifecycle_audit(id bigint generated always as identity primary key,listing_id bigint not null references public.listings(id),action text not null,at timestamptz not null default now());
alter table private.listing_lifecycle_audit enable row level security;
revoke all on private.listing_lifecycle_audit from public,anon,authenticated;
create function private.listing_lifecycle_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or (new.status='active' and (old.status<>'active' or coalesce(old.expires_at,old.created_at+interval '6 hours')<=statement_timestamp())) then
  if public.nakgo_normalize_phone(new.contact_phone) is null or not new.contact_consent then raise exception 'Contact and permission required' using errcode='23514';end if;
  new.contact_phone:=public.nakgo_normalize_phone(new.contact_phone);
  new.published_at:=statement_timestamp();new.expires_at:=new.published_at+interval '6 hours';
 elsif new.contact_phone is distinct from old.contact_phone then
  if public.nakgo_normalize_phone(new.contact_phone) is null or not new.contact_consent then raise exception 'Contact and permission required';end if;
  new.contact_phone:=public.nakgo_normalize_phone(new.contact_phone);
  new.published_at:=old.published_at;new.expires_at:=old.expires_at;
 else new.published_at:=old.published_at;new.expires_at:=old.expires_at;end if;
 return new;
end $$;
create trigger listing_lifecycle before insert or update on public.listings for each row execute function private.listing_lifecycle_guard();
revoke all on function private.listing_lifecycle_guard() from public,anon,authenticated;
grant insert(contact_phone,contact_consent),update(contact_phone,contact_consent) on public.listings to authenticated;
-- The personal owner label is no longer part of the client-facing table projection.
revoke select on public.listings from authenticated;
grant select(id,owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,note,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,contact_phone,published_at,expires_at) on public.listings to authenticated;
alter policy listings_read on public.listings using(owner_id=(select auth.uid()) or (status='active' and coalesce(expires_at,created_at+interval '6 hours')>statement_timestamp() and contact_consent and contact_phone is not null));
create function public.nakgo_listing_contact(p_id bigint) returns text language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
 perform private.require_activity(auth.uid());select * into l from public.listings where id=p_id;
 if not found or l.status<>'active' or coalesce(l.expires_at,l.created_at+interval '6 hours')<=statement_timestamp() or not l.contact_consent or l.contact_phone is null or exists(select 1 from private.listing_moderation where listing_id=p_id and removed) or private.account_suspended(l.owner_id) then raise exception 'Listing unavailable' using errcode='42501';end if;
 return l.contact_phone;
end $$;
revoke all on function public.nakgo_listing_contact(bigint) from public,anon;
grant execute on function public.nakgo_listing_contact(bigint) to authenticated;
create function public.nakgo_expire_listings() returns integer language plpgsql security definer set search_path='' as $$
declare l public.listings; n integer:=0; prior text:=current_setting('request.jwt.claim.sub',true);
begin
 for l in select * from public.listings where status='active' and coalesce(expires_at,created_at+interval '6 hours')<=statement_timestamp() order by id for update skip locked limit 100 loop
  -- Archiving must also work for suspended owners: bypass only the activity guard
  -- via its narrowly scoped expiry branch below, never by disabling triggers at runtime.
  perform set_config('request.jwt.claim.sub',l.owner_id::text,true);
  update public.listings set status='archived' where id=l.id;
  insert into private.listing_lifecycle_audit(listing_id,action) values(l.id,'expired');n:=n+1;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(prior,''),true);return n;
end $$;
revoke all on function public.nakgo_expire_listings() from public,anon,authenticated;
grant execute on function public.nakgo_expire_listings() to service_role;
-- Remove application messaging permissions, preserving historical records.
revoke all on public.listing_conversations,public.conversation_messages,public.message_inbox from authenticated,anon;
revoke all on function public.nakgo_open_conversation(bigint),public.nakgo_send_message(bigint,text,uuid),public.nakgo_read_conversation(bigint,bigint),public.nakgo_message_unread_count() from public,anon,authenticated;
create or replace function public.nakgo_wa_change(p_id bigint,p_revision integer,p_action text,p_fields jsonb default null,p_basis text default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if public.nakgo_normalize_phone(f->>'contactPhone') is null then raise exception 'Valid contact required';end if;
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
   insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,available_time,loading_text,items,image_data,contact_phone,contact_consent)
   values(auth.uid(),v_kind,f#>>'{from,city}',f#>>'{destinations,0,city}',f->>'vehicle',f->>'body',(f->>'amount')::numeric,case when v_kind='truck' then '' else f->>'cargo' end,coalesce(f->>'publicNote',''),'İlan sahibi',case when v_kind='truck' then (f->>'availableOn')::date end,case when v_kind='truck' then nullif(f->>'availableUntil','')::date end,case when v_kind='truck' then coalesce(f->>'availableTime','') else '' end,case when v_kind='load' then f->>'timing' end,case when v_kind='truck' then '[]'::jsonb else coalesce(f->'items','[]') end,coalesce(f->>'imageData',''),public.nakgo_normalize_phone(f->>'contactPhone'),true) returning id into listing;
  else
   update public.listings set from_city=f#>>'{from,city}',to_city=f#>>'{destinations,0,city}',vehicle=f->>'vehicle',body=f->>'body',amount=(f->>'amount')::numeric,cargo=case when v_kind='truck' then '' else f->>'cargo' end,note=coalesce(f->>'publicNote',''),owner_label='İlan sahibi',available_on=case when v_kind='truck' then (f->>'availableOn')::date end,available_until=case when v_kind='truck' then nullif(f->>'availableUntil','')::date end,available_time=case when v_kind='truck' then coalesce(f->>'availableTime','') else '' end,loading_text=case when v_kind='load' then f->>'timing' end,items=case when v_kind='truck' then '[]'::jsonb else coalesce(f->'items','[]') end,image_data=coalesce(f->>'imageData',''),contact_phone=public.nakgo_normalize_phone(f->>'contactPhone'),contact_consent=true,status='active' where id=listing;
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

create table private.wa_publication_permissions(message_id text primary key,contact_phone text not null,legal_basis text not null,valid_until timestamptz not null,granted_by uuid not null references auth.users(id),active boolean not null default true,updated_at timestamptz not null default now());
alter table private.wa_publication_permissions enable row level security;
revoke all on private.wa_publication_permissions from public,anon,authenticated;
create function private.wa_auto_publish(p_source bigint) returns integer language plpgsql security definer set search_path='' as $$
declare s private.wa_sources; p private.wa_publication_permissions; d private.wa_drafts; actor_before text:=current_setting('request.jwt.claim.sub',true); n integer:=0;
begin
 select * into s from private.wa_sources where id=p_source;
 select * into p from private.wa_publication_permissions where message_id=s.message_id and active and valid_until>=statement_timestamp()+interval '6 hours' for share;
 if not found then return 0;end if;
 perform set_config('request.jwt.claim.sub',p.granted_by::text,true);
 if not private.is_nakgo_admin() then perform set_config('request.jwt.claim.sub',coalesce(actor_before,''),true);return 0;end if;
 for d in select * from private.wa_drafts where source_id=p_source and status='draft' order by id for update loop
  if d.issues<>'[]'::jsonb or d.confidence<1 or jsonb_array_length(d.fields->'destinations')<>1 or public.nakgo_normalize_phone(d.fields->>'contactPhone') is distinct from p.contact_phone then continue;end if;
  -- Never copy raw message/company/name into public fields.
  begin
   perform public.nakgo_wa_change(d.id,d.revision,'publish',d.fields||jsonb_build_object('publicNote','','ownerLabel','İlan sahibi'),p.legal_basis);
   n:=n+1;
  exception when check_violation or invalid_text_representation or raise_exception then
   -- Invalid/ambiguous candidate stays a draft, preserving its source and audit.
   null;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(actor_before,''),true);return n;
end $$;
revoke all on function private.wa_auto_publish(bigint) from public,anon,authenticated;
create function public.nakgo_wa_permission(p_message_id text,p_phone text,p_basis text,p_until timestamptz,p_active boolean) returns integer language plpgsql security definer set search_path='' as $$
declare phone text:=public.nakgo_normalize_phone(p_phone); s bigint; d private.wa_drafts;
begin
 perform private.wa_admin();
 if p_message_id is null or p_basis is null or p_until is null or length(btrim(p_message_id)) not between 1 and 256 or phone is null or length(btrim(p_basis)) not between 10 and 1000 or p_until<=statement_timestamp() or p_until>statement_timestamp()+interval '30 days' or p_active is null then raise exception 'Invalid documented permission';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_message_id,6104));
 insert into private.wa_publication_permissions values(p_message_id,phone,btrim(p_basis),p_until,auth.uid(),p_active,now()) on conflict(message_id) do update set contact_phone=excluded.contact_phone,legal_basis=excluded.legal_basis,valid_until=excluded.valid_until,granted_by=excluded.granted_by,active=excluded.active,updated_at=now();
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(auth.uid(),'wa-permission:'||p_message_id,case when p_active then 'grant' else 'revoke' end,btrim(p_basis),0);
 select id into s from private.wa_sources where message_id=p_message_id;
 if not p_active or exists(select 1 from private.wa_drafts where source_id=s and status='published' and (public.nakgo_normalize_phone(fields->>'contactPhone') is distinct from phone or (select expires_at from public.listings where id=listing_id)>p_until)) then
  for d in select * from private.wa_drafts where source_id=s and status='published' for update loop perform public.nakgo_wa_change(d.id,d.revision,'withdraw',null,null);end loop;
  return 0;
 end if;
 return private.wa_auto_publish(s);
end $$;
revoke all on function public.nakgo_wa_permission(text,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.nakgo_wa_permission(text,text,text,timestamptz,boolean) to authenticated;


create or replace function public.nakgo_wa_finish(p_id bigint,p_lease uuid,p_drafts jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s private.wa_sources; d jsonb; i integer:=0;
begin
 select * into s from private.wa_sources where id=p_id for update;
 if s.state is distinct from 'processing' or s.lease is distinct from p_lease or s.lease_until<now() then raise exception 'Stale lease' using errcode='40001'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.message_id,6104));
 if jsonb_typeof(p_drafts) is distinct from 'array' or jsonb_array_length(p_drafts) not between 1 and 30 then raise exception 'Invalid drafts';end if;
 for d in select value from jsonb_array_elements(p_drafts) loop
  if jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(d->'issues') is distinct from 'array' or length(d->>'fingerprint')<>64 then raise exception 'Invalid draft';end if;
  i:=i+1;insert into private.wa_drafts(source_id,ordinal,fields,issues,confidence,fingerprint) values(p_id,i,d->'fields',d->'issues',(d->>'confidence')::numeric,d->>'fingerprint');
 end loop;
 update private.wa_sources set state='done',lease=null,lease_until=null where id=p_id;
 perform private.wa_auto_publish(p_id);
end $$;

-- Existing security-definer entry points must reject an expired public listing too.
do $patch$
declare signature text; source text;
begin
 foreach signature in array array['public.nakgo_request_transport(bigint)','public.nakgo_set_favorite(bigint,boolean)'] loop
  if to_regprocedure(signature) is null then raise exception 'Missing required RPC: %',signature;end if;
  source:=pg_get_functiondef(signature::regprocedure);
  if strpos(source,'l.status<>''active''')=0 then raise exception 'Unexpected RPC definition: %',signature;end if;
  source:=replace(source,'l.status<>''active''','l.status<>''active'' or coalesce(l.expires_at,l.created_at+interval ''6 hours'')<=statement_timestamp() or not l.contact_consent or l.contact_phone is null');
  execute source;
 end loop;
end $patch$;
create or replace function public.nakgo_wa_detail(p_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d private.wa_drafts; result jsonb;
begin
 perform private.wa_admin();select * into d from private.wa_drafts where id=p_id;
 if not found then raise exception 'Not found';end if;
 select to_jsonb(d)||jsonb_build_object('source',jsonb_build_object('messageId',s.message_id,'text',s.original_text,'receivedAt',s.received_at,'sentAt',s.sent_at),
 'similar',(select coalesce(jsonb_agg(x.id),'[]') from (select id from private.wa_drafts where fingerprint=d.fingerprint and id<>d.id and status<>'purged' limit 20) x),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select actor,action,before_value,after_value,created_at from private.wa_audit where draft_id=d.id order by id desc limit 50) a)) into result from private.wa_sources s where s.id=d.source_id;
 return result;
end $$;

commit;

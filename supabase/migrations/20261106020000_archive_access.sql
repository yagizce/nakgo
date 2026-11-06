-- A grant is explicit, scoped, and revocable. No automatic memberships.
begin;
create table private.data_access_grants (
 user_id uuid not null references auth.users(id) on delete cascade,
 capability text not null check (capability in ('listing_archive','archive_contact','privacy_cases')),
 primary key(user_id,capability)
);
alter table private.data_access_grants enable row level security;
revoke all on private.data_access_grants from public,anon,authenticated;
create table private.archive_access_audit (
 id bigint generated always as identity primary key,
 actor uuid references auth.users(id) on delete set null,
 listing_id bigint not null references public.listings(id),
 action text not null check(action='detail_read'),
 at timestamptz not null default statement_timestamp()
);
alter table private.archive_access_audit enable row level security;
revoke all on private.archive_access_audit from public,anon,authenticated;
create function public.nakgo_data_capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(capability),'[]'::jsonb) from private.data_access_grants
 where user_id=auth.uid() and private.is_nakgo_admin()
$$;
revoke all on function public.nakgo_data_capabilities() from public,anon;
grant execute on function public.nakgo_data_capabilities() to authenticated;
create table private.archive_reviews (
 listing_id bigint primary key references public.listings(id),
 status text not null check(status in ('open','reviewing','closed')),
 reference text not null check(length(btrim(reference)) between 10 and 500),
 revision integer not null default 1,
 updated_at timestamptz not null default statement_timestamp()
);
alter table private.archive_reviews enable row level security;
revoke all on private.archive_reviews from public,anon,authenticated;
create table private.archive_review_events (
 id bigint generated always as identity primary key,
 listing_id bigint not null references public.listings(id),
 actor uuid references auth.users(id) on delete set null,
 status text not null, reference text not null,
 revision integer not null, at timestamptz not null default statement_timestamp()
);
alter table private.archive_review_events enable row level security;
revoke all on private.archive_review_events from public,anon,authenticated;
create function public.nakgo_archive_review(p_id bigint,p_status text,p_reference text,p_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer;
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants where user_id=auth.uid() and capability='listing_archive') then raise exception 'Archive access denied' using errcode='42501';end if;
 if p_status is null or p_status not in ('open','reviewing','closed') or p_reference is null or length(btrim(p_reference)) not between 10 and 500 then raise exception 'Invalid review' using errcode='22023';end if;
 perform 1 from public.listings where id=p_id and expires_at<=statement_timestamp() and published_at+interval '198 hours'>statement_timestamp() and content_redacted_at is null for update;
 if not found then raise exception 'Archive unavailable' using errcode='P0002';end if;
 select revision into current_revision from private.archive_reviews where listing_id=p_id;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception 'Review changed' using errcode='40001';end if;
 insert into private.archive_reviews(listing_id,status,reference) values(p_id,p_status,btrim(p_reference)) on conflict(listing_id) do update set status=excluded.status,reference=excluded.reference,revision=archive_reviews.revision+1,updated_at=statement_timestamp();
 insert into private.archive_review_events(listing_id,actor,status,reference,revision) values(p_id,auth.uid(),p_status,btrim(p_reference),coalesce(current_revision,0)+1);
end $$;
revoke all on function public.nakgo_archive_review(bigint,text,text,integer) from public,anon;
grant execute on function public.nakgo_archive_review(bigint,text,text,integer) to authenticated;
alter policy listings_read on public.listings using (
 status='active' and coalesce(expires_at,created_at+interval '6 hours')>statement_timestamp()
 and (owner_id=(select auth.uid()) or (contact_consent and contact_phone is not null))
);
create function public.nakgo_archive_list(p_search text default '',p_before bigint default null,p_kind text default null,p_source text default null,p_from timestamptz default null,p_to timestamptz default null,p_review text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_nakgo_admin() or not exists(select 1 from private.data_access_grants
 where user_id=auth.uid() and capability='listing_archive') then
  raise exception 'Archive access denied' using errcode='42501';
 end if;
 if (p_review is not null and p_review not in ('none','open','reviewing','closed')) or (p_kind is not null and p_kind not in ('load','truck')) or (p_source is not null and p_source not in ('manual','whatsapp')) or (p_from is not null and p_to is not null and p_from>=p_to) then raise exception 'Invalid archive filters' using errcode='22023';end if;
 return (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.id desc),'[]'::jsonb)
 from (select coalesce(r.status,'none') as review_status,coalesce(r.revision,0) as review_revision,l.id,l.kind,l.from_city,l.to_city,l.published_at,l.expires_at,
 case when exists(select 1 from private.wa_drafts d where d.listing_id=l.id) then 'whatsapp' else 'manual' end as source,
 published_at+interval '198 hours' as archive_until
 from public.listings l left join private.archive_reviews r on r.listing_id=l.id where expires_at<=statement_timestamp()
 and published_at+interval '198 hours'>statement_timestamp()
 and (p_review is null or coalesce(r.status,'none')=p_review)
 and (p_kind is null or kind=p_kind)
 and (p_source is null or (p_source='whatsapp')=exists(select 1 from private.wa_drafts d where d.listing_id=l.id))
 and (p_from is null or published_at>=p_from) and (p_to is null or published_at<p_to)
 and (p_before is null or id<p_before)
 and (coalesce(p_search,'')='' or id::text=p_search or
 strpos(lower(from_city||' '||to_city),lower(left(p_search,100)))>0)
 order by id desc limit 50) entry);
end $$;
revoke all on function public.nakgo_archive_list(text,bigint,text,text,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.nakgo_archive_list(text,bigint,text,text,timestamptz,timestamptz,text) to authenticated;
create function public.nakgo_archive_detail(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_nakgo_admin() or
 (select count(*) from private.data_access_grants where user_id=auth.uid()
 and capability in ('listing_archive','archive_contact'))<>2 then
 raise exception 'Archive detail access denied' using errcode='42501';end if;
 select jsonb_build_object('id',id,'contact_phone',contact_phone,'note',note,
 'cargo',cargo,'items',items,'image_data',image_data) into result
 from public.listings where id=p_id and content_redacted_at is null
 and expires_at<=statement_timestamp() and published_at+interval '198 hours'>statement_timestamp();
 if result is null then raise exception 'Archive unavailable' using errcode='P0002';end if;
 insert into private.archive_access_audit(actor,listing_id,action)
 values(auth.uid(),p_id,'detail_read');
 return result;
end $$;
revoke all on function public.nakgo_archive_detail(bigint) from public,anon;
grant execute on function public.nakgo_archive_detail(bigint) to authenticated;
-- The legacy moderation listing route must not bypass scoped archive access.
do $legacy$
declare definition text;
begin
 definition:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text)'::regprocedure);
 -- Parenthesize the existing search predicate before adding the expiry boundary.
 if strpos(definition,'where term='''' or position(lower(term) in lower(l.owner_label')=0 then
 raise exception 'Unexpected legacy listing query';end if;
 definition:=replace(definition,'where term='''' or position(lower(term) in lower(l.owner_label',
 'where coalesce(l.expires_at,l.created_at+interval ''6 hours'')>statement_timestamp() and (term='''' or position(lower(term) in lower(l.owner_label');
 definition:=replace(definition,'l.to_city))>0 order by l.id','l.to_city))>0) order by l.id');
 execute definition;
end $legacy$;
-- Review screens are not a second route into the expired publication archive.
do $review$
declare definition text; needle text; signature text;
begin
 signature:='public.nakgo_wa_page(integer)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='from private.wa_drafts d where status<>''purged''';
 if strpos(definition,needle)=0 then raise exception 'Unexpected review page';end if;
 execute replace(definition,needle,needle||' and not exists(select 1 from public.listings l where l.id=d.listing_id and coalesce(l.expires_at,l.created_at+interval ''6 hours'')<=statement_timestamp())');
 foreach signature in array array['public.nakgo_wa_detail(bigint)','private.wa_change_core(bigint,integer,text,jsonb,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature='public.nakgo_wa_detail(bigint)' then
   'if not found then raise exception ''Not found'';end if;'
   else 'if not found or d.status=''purged'' then raise exception ''Not found'';end if;' end;
  if strpos(definition,needle)=0 then raise exception 'Unexpected review detail/change';end if;
  execute replace(definition,needle,needle||E'\n if '||(case when signature='public.nakgo_wa_detail(bigint)' then '' else 'p_action in (''save'',''publish'') and ' end)||'exists(select 1 from public.listings l where l.id=d.listing_id and coalesce(l.expires_at,l.created_at+interval ''6 hours'')<=statement_timestamp()) then raise exception ''Expired publication requires archive access'' using errcode=''42501'';end if;');
 end loop;
end $review$;
-- Use one server deadline in both the batch selection and the write guard.
-- Preserve the old deadline for legacy rows with no recorded publication time.
do $patch$
declare definition text; old_text text; new_text text; signature text;
begin
 foreach signature in array array['private.listing_retention_guard()','public.nakgo_redact_listings()'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if signature='private.listing_retention_guard()' then
   old_text:='old.created_at>statement_timestamp()-interval ''30 days''';
   new_text:='coalesce(old.published_at+interval ''198 hours'',old.created_at+interval ''30 days'')>statement_timestamp()';
  else
   old_text:='created_at<=statement_timestamp()-interval ''30 days''';
   new_text:='coalesce(published_at+interval ''198 hours'',created_at+interval ''30 days'')<=statement_timestamp()';
  end if;
  if strpos(definition,old_text)=0 then raise exception 'Unexpected retention definition';end if;
  execute replace(replace(definition,old_text,new_text),'content_redacted_30d','routine_content_redacted');
 end loop;
end $patch$;
commit;

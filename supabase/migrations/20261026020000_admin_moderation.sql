-- DEV first: moderation never deletes transport history or private conversations.
begin;
create table private.account_moderation (
 user_id uuid primary key references auth.users(id) on delete cascade,
 suspended boolean not null default false, revision bigint not null default 0,
 reason text not null default '', updated_at timestamptz not null default now()
);
create table private.listing_moderation (
 listing_id bigint primary key references public.listings(id) on delete cascade,
 removed boolean not null default false, revision bigint not null default 0,
 reason text not null default '', updated_at timestamptz not null default now()
);
create table private.admin_audit (
 id bigint generated always as identity primary key,
 actor_id uuid not null, target text not null, action text not null,
 reason text not null, revision bigint not null, created_at timestamptz not null default now()
);
alter table private.account_moderation enable row level security;
alter table private.listing_moderation enable row level security;
alter table private.admin_audit enable row level security;
revoke all on private.account_moderation,private.listing_moderation,private.admin_audit from public,anon,authenticated;
revoke all on sequence private.admin_audit_id_seq from public,anon,authenticated;

create function private.account_suspended(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.account_moderation where user_id=p_user and suspended);
$$;
create function private.require_activity(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Moderation takes the exclusive version of this lock. A committed suspension
 -- cannot race a new activity write. It does not lock or rewrite listings/jobs.
 if p_user is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(p_user::text,7290));
 if private.account_suspended(p_user) then raise exception 'Account suspended' using errcode='42501'; end if;
end $$;
create function private.activity_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.require_activity(auth.uid());
 if tg_table_name='listings' then
  if new.status='active' and exists(select 1 from private.listing_moderation where listing_id=new.id and removed) then
   raise exception 'Listing moderated' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger moderation_listing before insert or update on public.listings for each row execute function private.activity_write_guard();
create trigger moderation_profile before insert or update on public.profiles for each row execute function private.activity_write_guard();
create trigger moderation_message before insert on public.conversation_messages for each row execute function private.activity_write_guard();
create trigger moderation_conversation before insert on public.listing_conversations for each row execute function private.activity_write_guard();
create trigger moderation_favorite before insert on public.listing_favorites for each row execute function private.activity_write_guard();
create trigger moderation_application before insert or update on public.carrier_applications for each row execute function private.activity_write_guard();
create trigger moderation_document before insert or update on public.carrier_document_files for each row execute function private.activity_write_guard();

create function private.storage_activity_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.bucket_id='carrier-documents' then perform private.require_activity(auth.uid()); end if;
  return old;
 end if;
 if new.bucket_id='carrier-documents' then perform private.require_activity(auth.uid()); end if;
 return new;
end $$;
create trigger moderation_storage before insert or update or delete on storage.objects for each row execute function private.storage_activity_guard();
revoke all on function private.storage_activity_guard() from public,anon,authenticated;

-- Existing accepted work can still be loaded/confirmed; pending requests can
-- be rejected/withdrawn. Creating or accepting work is blocked while suspended.
create function private.job_activity_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare participant uuid;
begin
 if tg_op='INSERT' or (new.status='ok' and old.status<>'ok') or (new.status='wait' and old.status<>'wait') then
  -- Starting work requires both participants and the actor to remain active.
  -- Use one UUID order for shared locks, including when their roles are reversed.
  for participant in select distinct user_id from unnest(array[auth.uid(),new.owner_id,new.carrier_id]) as participants(user_id) order by user_id loop
   perform private.require_activity(participant);
  end loop;
 end if;
 return new;
end $$;
create trigger moderation_job before insert or update on public.transport_jobs for each row execute function private.job_activity_guard();
-- Storage already calls this helper; suspended users cannot mutate/read documents.
create or replace function private.document_account_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) and not private.account_suspended(auth.uid());
$$;
revoke all on function private.account_suspended(uuid),private.require_activity(uuid),private.activity_write_guard(),private.job_activity_guard() from public,anon,authenticated;

create function public.nakgo_admin_moderate(p_kind text,p_target text,p_action text,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_user uuid; target_listing bigint; v bigint; desired boolean; current_state boolean; reason_value text:=btrim(coalesce(p_reason,''));
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or char_length(reason_value) not between 3 and 500 then raise exception 'Invalid moderation' using errcode='22023'; end if;
 if p_kind='user' and p_action in('suspend','resume') then
  target_user:=p_target::uuid;desired:=p_action='suspend';
  if target_user=actor or exists(select 1 from private.admin_members where user_id=target_user and active) then raise exception 'Protected administrator' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=target_user) then raise exception 'User unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,7290));
  insert into private.account_moderation(user_id) values(target_user) on conflict do nothing;
  select revision,suspended into v,current_state from private.account_moderation where user_id=target_user for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  update private.account_moderation set suspended=desired,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
 elsif p_kind='listing' and p_action in('remove','restore') then
  target_listing:=p_target::bigint;desired:=p_action='remove';
  perform 1 from public.listings where id=target_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  insert into private.listing_moderation(listing_id) values(target_listing) on conflict do nothing;
  select revision,removed into v,current_state from private.listing_moderation where listing_id=target_listing for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  update private.listing_moderation set removed=desired,revision=v+1,reason=reason_value,updated_at=now() where listing_id=target_listing;
  -- Restore means unlock into closed state; never republish expired listings.
  update public.listings set status=case when desired then 'archived' else 'closed' end where id=target_listing;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(actor,p_target,p_action,reason_value,v+1);
 return jsonb_build_object('revision',v+1,'changed',true);
end $$;
revoke all on function public.nakgo_admin_moderate(text,text,text,text,bigint) from public,anon;
grant execute on function public.nakgo_admin_moderate(text,text,text,text,bigint) to authenticated;
create or replace function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; term text:=btrim(coalesce(p_search,''));
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or char_length(term)>100 then raise exception 'Invalid query' using errcode='22023'; end if;
 if p_section='overview' then
 return jsonb_build_object('users',(select count(*) from public.profiles),
 'listings',(select count(*) from public.listings where status='active' and coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date),
 'documents',(select count(*) from public.carrier_applications where status='submitted'),
 'jobs',(select count(*) from public.transport_jobs where status='ok' and stage<>3));
 elsif p_section='users' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select p.id,p.display_name,p.account_type,p.city,p.created_at,coalesce(m.suspended,false) suspended,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason,exists(select 1 from private.admin_members a where a.user_id=p.id and a.active) protected
 from public.profiles p left join private.account_moderation m on m.user_id=p.id
 where term='' or position(lower(term) in lower(p.display_name))>0 order by p.created_at desc,p.id limit 21 offset p_offset) t;
 elsif p_section='listings' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select l.id,l.owner_label,l.kind,l.from_city,l.to_city,l.status,l.created_at,coalesce(m.removed,false) removed,coalesce(m.revision,0) revision,coalesce(m.reason,'') reason
 from public.listings l left join private.listing_moderation m on m.listing_id=l.id
 where term='' or position(lower(term) in lower(l.owner_label||' '||l.from_city||' '||l.to_city))>0 order by l.id desc limit 21 offset p_offset) t;
 elsif p_section='moderation' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select a.id,a.actor_id,coalesce(p.display_name,'Yönetici') actor_label,a.target,a.action,a.reason,a.created_at
 from private.admin_audit a left join public.profiles p on p.id=a.actor_id order by a.id desc limit 21 offset p_offset) t;
 elsif p_section='audit' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select id,application_id,actor_id,action,note,created_at from public.carrier_document_audit order by id desc limit 21 offset p_offset) t;
 else raise exception 'Invalid section' using errcode='22023'; end if;
 return result;
end $$;
commit;

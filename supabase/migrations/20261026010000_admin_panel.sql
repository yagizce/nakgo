-- DEV first. Grant each partner separately; no automatic admins or reviewer grants.
begin;
create table private.admin_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true, granted_at timestamptz not null default now()
);
alter table private.admin_members enable row level security;
revoke all on private.admin_members from public, anon, authenticated;
create function private.is_nakgo_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.document_account_verified() and exists(select 1 from private.admin_members where user_id=auth.uid() and active);
$$;
revoke all on function private.is_nakgo_admin() from public, anon, authenticated;
create function public.nakgo_admin_page(p_section text, p_offset integer default 0, p_search text default '')
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
 (select id,display_name,account_type,city,created_at from public.profiles
 where term='' or position(lower(term) in lower(display_name))>0 order by created_at desc,id limit 21 offset p_offset) t;
 elsif p_section='listings' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select id,owner_label,kind,from_city,to_city,status,created_at from public.listings
 where term='' or position(lower(term) in lower(owner_label||' '||from_city||' '||to_city))>0 order by id desc limit 21 offset p_offset) t;
 elsif p_section='audit' then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
 (select id,application_id,actor_id,action,note,created_at from public.carrier_document_audit order by id desc limit 21 offset p_offset) t;
 else raise exception 'Invalid section' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.nakgo_admin_page(text,integer,text) from public,anon;
grant execute on function public.nakgo_admin_page(text,integer,text) to authenticated;
commit;

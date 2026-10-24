-- NakGo: first Supabase step. Apply once to the empty development project.
-- This migration does not connect the frontend or import local demo data.
-- Existing objects cause an error and the transaction rolls back; no drops.
begin;

create table public.profiles (
    id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    display_name text not null default ''
        check (char_length(display_name) <= 100),
    account_type text
        check (account_type in ('carrier', 'owner')),
    created_at timestamptz not null default now()
);

comment on table public.profiles is
    'NakGo private account profile. Public profile/contact access is not enabled.';
comment on column public.profiles.account_type is
    'User-selected product preference only; never an admin or Premium permission.';

alter table public.profiles enable row level security;

-- Explicit privileges work even when automatic table exposure is disabled.
revoke all on table public.profiles from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, display_name, account_type) on public.profiles to authenticated;
grant update (display_name, account_type) on public.profiles to authenticated;

create policy profiles_select_own
    on public.profiles for select to authenticated
    using ((select auth.uid()) = id);

create policy profiles_insert_own
    on public.profiles for insert to authenticated
    with check ((select auth.uid()) = id);

create policy profiles_update_own
    on public.profiles for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

commit;

-- Structural confirmation, not a substitute for two-user RLS integration tests.
select
    c.relrowsecurity as rls_enabled,
    (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'profiles') as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'profiles';

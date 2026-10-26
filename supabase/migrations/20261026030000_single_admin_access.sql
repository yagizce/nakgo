-- One active general administrator; membership is provisioned only by trusted SQL.
begin;
create unique index admin_members_one_active on private.admin_members(active) where active;
create function public.nakgo_admin_role() returns boolean language sql stable security definer set search_path='' as $$
 select private.is_nakgo_admin();
$$;
revoke all on function public.nakgo_admin_role() from public,anon;
grant execute on function public.nakgo_admin_role() to authenticated;
commit;

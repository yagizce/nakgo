-- Prepare locally. Account deletion remains disabled by the existing setting.
begin;
create or replace function private.account_deletion_blockers(p_user uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare c record; n bigint; linked boolean; reasons text[]:='{}';
begin
 if exists(select 1 from private.admin_members where user_id=p_user) then return array['protected_administrator'];end if;
 for c in select ns.nspname,t.relname,a.attname from pg_constraint fk
 join pg_class t on t.oid=fk.conrelid join pg_namespace ns on ns.oid=t.relnamespace
 join pg_attribute a on a.attrelid=t.oid and a.attnum=fk.conkey[1]
 where fk.contype='f' and fk.confrelid='auth.users'::regclass and ns.nspname<>'auth' loop
  if (c.nspname,c.relname,c.attname) in (('public','profiles','id'),('public','listing_favorites','user_id'),('private','privacy_requests','subject_id')) then continue;end if;
  execute format('select count(*) from %I.%I where %I=$1',c.nspname,c.relname,c.attname) into n using p_user;
  if n>0 then reasons:=array_append(reasons,c.nspname||'.'||c.relname);end if;
 end loop;
 if exists(select 1 from storage.objects where owner_id=p_user::text or name like p_user::text||'/%') then reasons:=array_append(reasons,'storage.objects');end if;

 -- Lock rows the resolver may cascade through before checking incoming FKs.
 perform 1 from public.profiles where id=p_user for update;
 perform 1 from public.listing_favorites where user_id=p_user for update;
 for c in
  select ns.nspname,child.relname as child_name,parent.relname as parent_name,
   case when parent.relname='profiles' then 'id' else 'user_id' end as subject_column,
   string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by keys.position) as join_clause
  from pg_constraint fk
  join pg_class child on child.oid=fk.conrelid
  join pg_namespace ns on ns.oid=child.relnamespace
  join pg_class parent on parent.oid=fk.confrelid
  cross join lateral unnest(fk.conkey,fk.confkey) with ordinality as keys(child_col,parent_col,position)
  join pg_attribute ca on ca.attrelid=child.oid and ca.attnum=keys.child_col
  join pg_attribute pa on pa.attrelid=parent.oid and pa.attnum=keys.parent_col
  where fk.contype='f' and fk.confdeltype in ('c','n','d')
   and fk.confrelid in ('public.profiles'::regclass,'public.listing_favorites'::regclass)
  group by fk.oid,ns.nspname,child.relname,parent.relname
 loop
  execute format('select exists(select 1 from %I.%I c join public.%I p on %s where p.%I=$1)',
   c.nspname,c.child_name,c.parent_name,c.join_clause,c.subject_column) into linked using p_user;
  if linked then reasons:=array_append(reasons,c.nspname||'.'||c.child_name);end if;
 end loop;
 return reasons;
end $$;
revoke all on function private.account_deletion_blockers(uuid) from public,anon,authenticated;
commit;

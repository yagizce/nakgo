-- Storage completes an authorized upload in a service-role transaction without a user sub.
-- Keep caller RLS policies intact; only trusted internal writes may resolve the reserved owner.
begin;
create or replace function private.storage_activity_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); obj storage.objects; f public.carrier_document_files; a public.carrier_applications;
 effective_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
begin
 if tg_op='DELETE' then obj:=old; else obj:=new; end if;
 if obj.bucket_id<>'carrier-documents' then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if actor is null then
  if effective_role not in ('service_role','supabase_storage_admin') then
   raise exception 'Sign in required' using errcode='42501';
  end if;
  select * into f from public.carrier_document_files where object_path=obj.name;
  if not found or obj.owner_id is distinct from f.owner_id::text then
   raise exception 'Reserved document owner required' using errcode='42501';
  end if;
  actor:=f.owner_id;
  perform private.require_activity(actor);
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
   raise exception 'Verified account required' using errcode='42501';
  end if;
  select * into a from public.carrier_applications where id=f.application_id and owner_id=actor for update;
  select * into f from public.carrier_document_files where id=f.id;
  if a.id is null or f.status='removed' then raise exception 'Document unavailable' using errcode='42501';end if;
  if tg_op='DELETE' then
   if a.status not in ('draft','rejected','withdrawn') then raise exception 'Withdraw before removing' using errcode='42501';end if;
  else
   if a.status<>'draft' or f.status<>'reserved' or f.created_at<=now()-interval '24 hours' then
    raise exception 'Editable reservation required' using errcode='42501';
   end if;
   if tg_op='UPDATE' and (old.name is distinct from new.name or old.bucket_id is distinct from new.bucket_id or old.owner_id is distinct from new.owner_id) then
    raise exception 'Document identity cannot change' using errcode='42501';
   end if;
  end if;
 else
  perform private.require_activity(actor);
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.storage_activity_guard() from public,anon,authenticated;
commit;

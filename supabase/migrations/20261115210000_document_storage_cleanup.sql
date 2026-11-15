-- Taşıyıcı belge dosyaları için güvenli silme kuyruğu.
-- SQL işlemi Storage'daki dosyayı silemez (dosya ayrı serviste durur). Bu yüzden:
--  1. Belge kaydı silindiğinde (hesap silme dahil) dosya yolu private.storage_cleanup kuyruğuna yazılır.
--  2. storage_activity_guard, kuyrukta bekleyen yolları yalnız service_role/supabase_storage_admin için silinebilir yapar;
--     kullanıcılar ve anon için kurallar değişmez.
--  3. tools/storage-cleanup.cjs servis anahtarıyla bekleyenleri Storage API'den siler, sonucu kuyruğa yazar.
--     Başarısız silmeler deneme sayısı ve hata ile kuyrukta kalır; tekrar çalıştırmak güvenlidir.
begin;
create table private.storage_cleanup(
 bucket_id text not null, object_path text not null, owner_id uuid, queued_at timestamptz not null default now(),
 attempts integer not null default 0, last_error text, done_at timestamptz,
 primary key(bucket_id,object_path));
alter table private.storage_cleanup enable row level security;
revoke all on private.storage_cleanup from public,anon,authenticated;

create function private.queue_document_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.storage_cleanup(bucket_id,object_path,owner_id) values('carrier-documents',old.object_path,old.owner_id)
 on conflict (bucket_id,object_path) do update set done_at=null;
 return old;
end $$;
revoke all on function private.queue_document_cleanup() from public,anon,authenticated;
create trigger carrier_file_cleanup after delete on public.carrier_document_files for each row execute function private.queue_document_cleanup();

-- Daha önce kaydı silinmiş ama dosyası kalmış nesneler de kuyruğa alınır.
insert into private.storage_cleanup(bucket_id,object_path,owner_id)
select o.bucket_id,o.name,nullif(o.owner_id,'')::uuid from storage.objects o
where o.bucket_id='carrier-documents' and not exists(select 1 from public.carrier_document_files f where f.object_path=o.name)
on conflict do nothing;

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
  -- Hesap silme sonrası kuyruğa alınmış (sahipsiz kalmış) belge dosyası: yalnız güvenilir rol silebilir.
  if tg_op='DELETE' and exists(select 1 from private.storage_cleanup c where c.bucket_id=obj.bucket_id and c.object_path=obj.name and c.done_at is null) then
   return old;
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

-- Yalnız service_role: bekleyenleri al ve sonucu yaz.
create function public.nakgo_storage_cleanup_pending(p_limit integer default 100) returns table(bucket_id text,object_path text)
language sql stable security definer set search_path='' as $$
 select c.bucket_id,c.object_path from private.storage_cleanup c where c.done_at is null
 order by c.queued_at limit least(greatest(coalesce(p_limit,100),1),1000)
$$;
create function public.nakgo_storage_cleanup_result(p_bucket text,p_path text,p_ok boolean,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.storage_cleanup set attempts=attempts+1,
  done_at=case when p_ok then now() end,last_error=case when p_ok then null else left(coalesce(p_error,'unknown'),500) end
 where bucket_id=p_bucket and object_path=p_path and done_at is null;
end $$;
revoke all on function public.nakgo_storage_cleanup_pending(integer),public.nakgo_storage_cleanup_result(text,text,boolean,text) from public,anon,authenticated;
-- service_role Supabase'de her zaman vardır; yerel test ortamında yoksa izin adımı atlanır.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.nakgo_storage_cleanup_pending(integer),public.nakgo_storage_cleanup_result(text,text,boolean,text) to service_role;
 end if;
end $$;
commit;

-- DEV first. Private files; no reviewer is granted by this migration.
begin;
create schema if not exists private;
create table private.document_reviewers(user_id uuid primary key references auth.users(id) on delete cascade,active boolean not null default true,granted_at timestamptz not null default now());
alter table private.document_reviewers enable row level security;
revoke all on private.document_reviewers from public,anon,authenticated;
create function private.document_account_verified() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null); $$;
create function private.is_document_reviewer() returns boolean language sql stable security definer set search_path='' as $$ select private.document_account_verified() and exists(select 1 from private.document_reviewers where user_id=auth.uid() and active); $$;
grant usage on schema private to authenticated;
revoke all on function private.document_account_verified(),private.is_document_reviewer() from public,anon;
grant execute on function private.document_account_verified(),private.is_document_reviewer() to authenticated;
create table public.carrier_applications(
 id bigint generated always as identity primary key check(id<=9007199254740991),owner_id uuid not null references auth.users(id) on delete cascade,
 owner_label text not null,license_class text not null check(license_class in('B','C','CE','D')),
 status text not null default 'draft' check(status in('draft','submitted','approved','rejected','withdrawn')),
 revision bigint not null default 1,created_at timestamptz not null default now(),submitted_at timestamptz,
 reviewed_at timestamptz,reviewed_by uuid references auth.users(id),review_note text not null default '' check(char_length(review_note)<=500),
 updated_at timestamptz not null default now()
);
create unique index carrier_application_active_owner on public.carrier_applications(owner_id) where status in('draft','submitted','approved');
create index carrier_application_queue on public.carrier_applications(status,id desc);
create table public.carrier_document_files(
 id uuid primary key,application_id bigint not null references public.carrier_applications(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,kind text not null check(kind in('src','kb','ruh')),
 object_path text not null unique,status text not null default 'reserved' check(status in('reserved','ready','removed')),
 byte_size integer check(byte_size between 1 and 1048576),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index carrier_file_current_kind on public.carrier_document_files(application_id,kind) where status<>'removed';
create index carrier_file_owner on public.carrier_document_files(owner_id,status);
create table public.carrier_document_audit(
 id bigint generated always as identity primary key,application_id bigint not null references public.carrier_applications(id) on delete cascade,
 actor_id uuid not null,action text not null,revision bigint not null,note text not null default '',created_at timestamptz not null default now()
);
alter table public.carrier_applications enable row level security;
alter table public.carrier_document_files enable row level security;
alter table public.carrier_document_audit enable row level security;
revoke all on public.carrier_applications,public.carrier_document_files,public.carrier_document_audit from public,anon,authenticated;
revoke all on sequence public.carrier_applications_id_seq,public.carrier_document_audit_id_seq from public,anon,authenticated;
grant select on public.carrier_applications,public.carrier_document_files,public.carrier_document_audit to authenticated;
create policy carrier_app_read on public.carrier_applications for select to authenticated using(private.document_account_verified() and (owner_id=auth.uid() or (private.is_document_reviewer() and status in('submitted','approved','rejected'))));
create policy carrier_file_read on public.carrier_document_files for select to authenticated using(private.document_account_verified() and (owner_id=auth.uid() or (status='ready' and exists(select 1 from public.carrier_applications a where a.id=application_id and a.status in('submitted','approved','rejected') and private.is_document_reviewer()))));
create policy carrier_audit_read on public.carrier_document_audit for select to authenticated using(exists(select 1 from public.carrier_applications a where a.id=application_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('carrier-documents','carrier-documents',false,1048576,array['image/jpeg']);
create function private.document_object_access(p_path text,p_action text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare a public.carrier_applications;f public.carrier_document_files;
begin
 if not private.document_account_verified() then return false;end if;
 if p_action='read' then
 select a0.* into a from public.carrier_applications a0 join public.carrier_document_files f0 on f0.application_id=a0.id where f0.object_path=p_path;
 else
 -- Serialize Storage mutations with submit/withdraw/review to prevent a stale draft policy from deleting an approved file.
 select a0.* into a from public.carrier_applications a0 join public.carrier_document_files f0 on f0.application_id=a0.id where f0.object_path=p_path for update of a0;
 end if;
 if not found then return false;end if;
 select * into f from public.carrier_document_files where object_path=p_path;
 if not found or f.status='removed' then return false;end if;
 if p_action='read' then return f.owner_id=auth.uid() or (private.is_document_reviewer() and f.status='ready' and a.status in('submitted','approved','rejected'));
 elsif p_action='insert' then return f.owner_id=auth.uid() and f.status='reserved' and a.status='draft' and f.created_at>now()-interval '24 hours';
 elsif p_action='delete' then return f.owner_id=auth.uid() and a.status in('draft','rejected','withdrawn');
 else return false;end if;
end $$;
revoke all on function private.document_object_access(text,text) from public,anon;
grant execute on function private.document_object_access(text,text) to authenticated;
create policy carrier_object_read on storage.objects for select to authenticated using(bucket_id='carrier-documents' and private.document_object_access(name,'read'));
create policy carrier_object_insert on storage.objects for insert to authenticated with check(bucket_id='carrier-documents' and private.document_object_access(name,'insert'));
create policy carrier_object_delete on storage.objects for delete to authenticated using(bucket_id='carrier-documents' and private.document_object_access(name,'delete'));
-- No UPDATE policy: document contents cannot be overwritten, especially during review.

create function public.nakgo_document_reviewer() returns boolean language sql stable security invoker set search_path='' as $$ select private.is_document_reviewer(); $$;
create function public.nakgo_create_carrier_application(p_license text) returns public.carrier_applications language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();a public.carrier_applications;label text;
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 if p_license is null or p_license not in('B','C','CE','D') then raise exception 'Invalid license' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7282));
 select * into a from public.carrier_applications where owner_id=actor and status in('draft','submitted','approved') for update;
 if found then
 if a.status='draft' and a.license_class<>p_license then update public.carrier_applications set license_class=p_license,revision=revision+1,updated_at=now() where id=a.id returning * into a;end if;
 return a;end if;
 if(select count(*) from public.carrier_applications where owner_id=actor and created_at>now()-interval '1 day')>=5 then raise exception 'Application limit reached' using errcode='54000';end if;
 select coalesce(nullif(btrim(display_name),''),'NakGo kullanıcısı') into label from public.profiles where id=actor;
 if not found then raise exception 'Profile required' using errcode='42501';end if;
 insert into public.carrier_applications(owner_id,owner_label,license_class) values(actor,label,p_license) returning * into a;return a;
end $$;
create function public.nakgo_reserve_document(p_application_id bigint,p_kind text,p_file_id uuid) returns public.carrier_document_files language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();a public.carrier_applications;f public.carrier_document_files;
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 if p_kind is null or p_kind not in('src','kb','ruh') or p_file_id is null then raise exception 'Invalid document' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7282));
 select * into a from public.carrier_applications where id=p_application_id and owner_id=actor for update;
 if not found or a.status<>'draft' then raise exception 'Editable application required' using errcode='42501';end if;
 select * into f from public.carrier_document_files where id=p_file_id;
 if found then if f.application_id<>a.id or f.kind<>p_kind or f.status='removed' then raise exception 'Invalid retry' using errcode='22023';end if;return f;end if;
 if(select count(*) from public.carrier_document_files where owner_id=actor and status<>'removed')>=12 then raise exception 'Remove old documents first' using errcode='54000';end if;
 insert into public.carrier_document_files(id,application_id,owner_id,kind,object_path) values(p_file_id,a.id,actor,p_kind,actor::text||'/'||a.id::text||'/'||p_file_id::text||'.jpg') returning * into f;
 update public.carrier_applications set revision=revision+1,updated_at=now() where id=a.id;return f;
end $$;
create function public.nakgo_finalize_document(p_file_id uuid) returns public.carrier_document_files language plpgsql security definer set search_path='' as $$
declare a public.carrier_applications;f public.carrier_document_files;o storage.objects;file_app bigint;
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 select application_id into file_app from public.carrier_document_files where id=p_file_id and owner_id=auth.uid();
 select * into a from public.carrier_applications where id=file_app and owner_id=auth.uid() for update;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 select * into f from public.carrier_document_files where id=p_file_id for update;
 if f.status='ready' then return f;end if;
 if a.status<>'draft' or f.status<>'reserved' then raise exception 'Editable document required' using errcode='42501';end if;
 select * into o from storage.objects where bucket_id='carrier-documents' and name=f.object_path;
 if not found or coalesce(o.metadata->>'mimetype','')<>'image/jpeg' or coalesce((o.metadata->>'size')::bigint,0) not between 1 and 1048576 then raise exception 'Uploaded JPEG required' using errcode='22023';end if;
 update public.carrier_document_files set status='ready',byte_size=(o.metadata->>'size')::integer,updated_at=now() where id=f.id returning * into f;
 update public.carrier_applications set revision=revision+1,updated_at=now() where id=a.id;return f;
end $$;
create function public.nakgo_remove_document(p_file_id uuid) returns public.carrier_document_files language plpgsql security definer set search_path='' as $$
declare a public.carrier_applications;f public.carrier_document_files;file_app bigint;
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 select application_id into file_app from public.carrier_document_files where id=p_file_id and owner_id=auth.uid();
 select * into a from public.carrier_applications where id=file_app and owner_id=auth.uid() for update;
 if not found then raise exception 'Document unavailable' using errcode='42501';end if;
 select * into f from public.carrier_document_files where id=p_file_id for update;
 if f.status='removed' then return f;end if;
 if a.status not in('draft','rejected','withdrawn') then raise exception 'Withdraw before removing' using errcode='42501';end if;
 if exists(select 1 from storage.objects where bucket_id='carrier-documents' and name=f.object_path) then raise exception 'Remove file from storage first' using errcode='22023';end if;
 update public.carrier_document_files set status='removed',updated_at=now() where id=f.id returning * into f;
 update public.carrier_applications set revision=revision+1,updated_at=now() where id=a.id;return f;
end $$;
create function public.nakgo_transition_documents(p_application_id bigint,p_action text,p_revision bigint) returns public.carrier_applications language plpgsql security definer set search_path='' as $$
declare a public.carrier_applications;
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 select * into a from public.carrier_applications where id=p_application_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Application unavailable' using errcode='42501';end if;
 if p_action='withdraw' and a.status='withdrawn' then return a;end if;
 if p_action='submit' and a.status='submitted' and p_revision=a.revision-1 then return a;end if;
 if p_revision is null or p_revision<>a.revision then raise exception 'Application changed; refresh' using errcode='40001';end if;
 if p_action='submit' then
 if a.status<>'draft' or (select count(*) from public.carrier_document_files f join storage.objects o on o.bucket_id='carrier-documents' and o.name=f.object_path where f.application_id=a.id and f.status='ready')<>3 then raise exception 'Three ready documents required' using errcode='22023';end if;
 elsif p_action='withdraw' then
 if a.status not in('draft','submitted','approved','rejected') then raise exception 'Invalid transition' using errcode='22023';end if;
 else raise exception 'Invalid action' using errcode='22023';end if;
 update public.carrier_applications set status=case when p_action='submit' then 'submitted' else 'withdrawn' end,submitted_at=case when p_action='submit' then now() else submitted_at end,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 insert into public.carrier_document_audit(application_id,actor_id,action,revision) values(a.id,auth.uid(),p_action,a.revision);return a;
end $$;
create function public.nakgo_review_documents(p_application_id bigint,p_decision text,p_note text,p_revision bigint) returns public.carrier_applications language plpgsql security definer set search_path='' as $$
declare a public.carrier_applications;note_value text:=btrim(coalesce(p_note,''));
begin
 if not private.is_document_reviewer() then raise exception 'Reviewer required' using errcode='42501';end if;
 if p_decision is null or p_decision not in('approved','rejected') or char_length(note_value)>500 or (p_decision='rejected' and char_length(note_value)<3) then raise exception 'Invalid review' using errcode='22023';end if;
 select * into a from public.carrier_applications where id=p_application_id for update;
 if not found or a.owner_id=auth.uid() then raise exception 'Independent reviewer required' using errcode='42501';end if;
 if a.status=p_decision and a.reviewed_by=auth.uid() and a.review_note=note_value and p_revision=a.revision-1 then return a;end if;
 if a.status<>'submitted' or p_revision is null or p_revision<>a.revision then raise exception 'Application changed; refresh' using errcode='40001';end if;
 if(select count(*) from public.carrier_document_files f join storage.objects o on o.bucket_id='carrier-documents' and o.name=f.object_path where f.application_id=a.id and f.status='ready')<>3 then raise exception 'Documents unavailable' using errcode='22023';end if;
 update public.carrier_applications set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid(),review_note=note_value,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 insert into public.carrier_document_audit(application_id,actor_id,action,revision,note) values(a.id,auth.uid(),p_decision,a.revision,note_value);return a;
end $$;
create function public.nakgo_carrier_verifications(p_users uuid[]) returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.document_account_verified() then raise exception 'Verified account required' using errcode='42501';end if;
 if p_users is null or cardinality(p_users)>100 then raise exception 'Invalid user list' using errcode='22023';end if;
 return query select distinct a.owner_id from public.carrier_applications a where a.owner_id=any(p_users) and a.status='approved';
end $$;
revoke all on function public.nakgo_document_reviewer(),public.nakgo_create_carrier_application(text),public.nakgo_reserve_document(bigint,text,uuid),public.nakgo_finalize_document(uuid),public.nakgo_remove_document(uuid),public.nakgo_transition_documents(bigint,text,bigint),public.nakgo_review_documents(bigint,text,text,bigint),public.nakgo_carrier_verifications(uuid[]) from public,anon;
grant execute on function public.nakgo_document_reviewer(),public.nakgo_create_carrier_application(text),public.nakgo_reserve_document(bigint,text,uuid),public.nakgo_finalize_document(uuid),public.nakgo_remove_document(uuid),public.nakgo_transition_documents(bigint,text,bigint),public.nakgo_review_documents(bigint,text,text,bigint),public.nakgo_carrier_verifications(uuid[]) to authenticated;
commit;

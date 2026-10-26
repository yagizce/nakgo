-- Synthetic SQL/RLS fixtures only, including Storage metadata; no physical files are created. Everything rolls back.
begin;
select set_config('nakgo.doc_owner',gen_random_uuid()::text,true),set_config('nakgo.doc_other',gen_random_uuid()::text,true),set_config('nakgo.doc_admin',gen_random_uuid()::text,true),set_config('nakgo.doc_second_admin',gen_random_uuid()::text,true),set_config('nakgo.doc_unverified',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.doc_owner')::uuid,now()),(current_setting('nakgo.doc_other')::uuid,now()),(current_setting('nakgo.doc_admin')::uuid,now()),(current_setting('nakgo.doc_second_admin')::uuid,now()),(current_setting('nakgo.doc_unverified')::uuid,null);
-- Fixture writes use a synthetic actor under the current moderation guards.
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_owner'),true);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.doc_owner')::uuid,'Document rollback owner','carrier'),(current_setting('nakgo.doc_other')::uuid,'Document rollback outsider','carrier'),(current_setting('nakgo.doc_admin')::uuid,'Document rollback reviewer','owner');
insert into private.document_reviewers(user_id) values(current_setting('nakgo.doc_admin')::uuid),(current_setting('nakgo.doc_second_admin')::uuid);
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_owner'),true);
set local role authenticated;
do $$ declare a public.carrier_applications;f public.carrier_document_files;k text;begin
 if public.nakgo_document_reviewer() then raise exception 'FAIL owner reviewer';end if;
 begin insert into private.document_reviewers(user_id) values(auth.uid());raise exception 'FAIL reviewer escalation';exception when insufficient_privilege then null;end;
 a:=public.nakgo_create_carrier_application('CE');perform set_config('nakgo.doc_app',a.id::text,true);
 if(public.nakgo_create_carrier_application('CE')).id<>a.id then raise exception 'FAIL duplicate application';end if;
 begin update public.carrier_applications set status='approved' where id=a.id;raise exception 'FAIL direct approval';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_transition_documents(a.id,'submit',a.revision);raise exception 'FAIL missing files';exception when invalid_parameter_value then null;end;
 foreach k in array array['src','kb','ruh'] loop
 f:=public.nakgo_reserve_document(a.id,k,gen_random_uuid());perform set_config('nakgo.doc_'||k,f.id::text,true);
 if(public.nakgo_reserve_document(a.id,k,f.id)).id<>f.id then raise exception 'FAIL reserve retry';end if;
 if f.object_path<>auth.uid()::text||'/'||a.id::text||'/'||f.id::text||'.jpg' then raise exception 'FAIL server path';end if;
 begin perform public.nakgo_finalize_document(f.id);raise exception 'FAIL finalize missing upload';exception when invalid_parameter_value then null;end;
 end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_admin'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.carrier_applications where id=current_setting('nakgo.doc_app')::bigint) then raise exception 'FAIL reviewer sees draft';end if;
 if exists(select 1 from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint) then raise exception 'FAIL reviewer sees draft files';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_owner'),true);
set local role authenticated;
-- Exercise the real Storage INSERT policy with metadata-only rollback rows.
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'carrier-documents',object_path,auth.uid()::text,'{"mimetype":"image/jpeg","size":100}'::jsonb from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint;
do $$ declare f public.carrier_document_files;a public.carrier_applications;begin
 for f in select * from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint loop
 perform public.nakgo_finalize_document(f.id);perform public.nakgo_finalize_document(f.id);
 begin perform public.nakgo_remove_document(f.id);raise exception 'FAIL metadata removed before file';exception when invalid_parameter_value then null;end;
 end loop;
 select * into a from public.carrier_applications where id=current_setting('nakgo.doc_app')::bigint;
 begin perform public.nakgo_transition_documents(a.id,'submit',1);raise exception 'FAIL stale submit';exception when serialization_failure then null;end;
 a:=public.nakgo_transition_documents(a.id,'submit',a.revision);
 if(public.nakgo_transition_documents(a.id,'submit',a.revision-1)).revision<>a.revision then raise exception 'FAIL submit retry';end if;
 perform set_config('nakgo.doc_review_revision',a.revision::text,true);
 if exists(select 1 from public.nakgo_carrier_verifications(array[auth.uid()])) then raise exception 'FAIL self-reported badge';end if;
 if private.document_object_access((select object_path from public.carrier_document_files where id=current_setting('nakgo.doc_src')::uuid),'insert') then raise exception 'FAIL submitted upload';end if;
 if private.document_object_access((select object_path from public.carrier_document_files where id=current_setting('nakgo.doc_src')::uuid),'delete') then raise exception 'FAIL submitted delete';end if;
 begin perform public.nakgo_reserve_document(a.id,'src',gen_random_uuid());raise exception 'FAIL review replacement';exception when insufficient_privilege then null;end;
end $$;
-- No UPDATE policy: overwriting contents remains impossible.
do $$ declare n integer;begin
 update storage.objects set metadata='{}'::jsonb where bucket_id='carrier-documents' and name in(select object_path from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint);get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL storage overwrite';end if;
 begin
 delete from storage.objects where bucket_id='carrier-documents' and name in(select object_path from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint);get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL submitted storage delete';end if;
 exception when insufficient_privilege then null;end;
 if(select count(*) from storage.objects where bucket_id='carrier-documents' and name in(select object_path from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint))<>3 then raise exception 'FAIL submitted objects lost';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_other'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.carrier_applications where id=current_setting('nakgo.doc_app')::bigint) or exists(select 1 from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint) then raise exception 'FAIL outsider metadata';end if;
 if exists(select 1 from storage.objects where bucket_id='carrier-documents' and name like current_setting('nakgo.doc_owner')||'/%') then raise exception 'FAIL outsider download/list';end if;
 begin perform public.nakgo_review_documents(current_setting('nakgo.doc_app')::bigint,'approved','',current_setting('nakgo.doc_review_revision')::bigint);raise exception 'FAIL outsider approval';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name,metadata) values('carrier-documents',auth.uid()::text||'/unreserved.jpg','{"mimetype":"image/jpeg","size":100}');raise exception 'FAIL arbitrary upload';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- A reviewer can never approve their own application, even if added to the private registry.
insert into private.document_reviewers(user_id) values(current_setting('nakgo.doc_owner')::uuid);
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_owner'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_review_documents(current_setting('nakgo.doc_app')::bigint,'approved','',current_setting('nakgo.doc_review_revision')::bigint);raise exception 'FAIL self review';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_admin'),true);
set local role authenticated;
do $$ declare a public.carrier_applications;begin
 if not public.nakgo_document_reviewer() then raise exception 'FAIL reviewer role';end if;
 if(select count(*) from public.carrier_document_files where application_id=current_setting('nakgo.doc_app')::bigint and status='ready')<>3 then raise exception 'FAIL reviewer files';end if;
 if(select count(*) from storage.objects where bucket_id='carrier-documents' and name like current_setting('nakgo.doc_owner')||'/%')<>3 then raise exception 'FAIL reviewer storage';end if;
 begin perform public.nakgo_review_documents(current_setting('nakgo.doc_app')::bigint,'rejected','',current_setting('nakgo.doc_review_revision')::bigint);raise exception 'FAIL empty rejection';exception when invalid_parameter_value then null;end;
 a:=public.nakgo_review_documents(current_setting('nakgo.doc_app')::bigint,'approved','Rollback review',current_setting('nakgo.doc_review_revision')::bigint);
 if(public.nakgo_review_documents(a.id,'approved','Rollback review',current_setting('nakgo.doc_review_revision')::bigint)).revision<>a.revision then raise exception 'FAIL review retry';end if;
 if(select count(*) from public.carrier_document_audit where application_id=a.id and action='approved')<>1 then raise exception 'FAIL duplicate/missing audit';end if;
 perform set_config('nakgo.doc_approved_revision',a.revision::text,true);
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_second_admin'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_review_documents(current_setting('nakgo.doc_app')::bigint,'rejected','Late conflicting review',current_setting('nakgo.doc_review_revision')::bigint);raise exception 'FAIL competing review';exception when serialization_failure then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_other'),true);
set local role authenticated;
do $$ begin
 if(select count(*) from public.nakgo_carrier_verifications(array[current_setting('nakgo.doc_owner')::uuid]))<>1 then raise exception 'FAIL approved minimal badge';end if;
 if exists(select 1 from public.carrier_applications where id=current_setting('nakgo.doc_app')::bigint) then raise exception 'FAIL badge leaks private application';end if;
end $$;
reset role;
update private.document_reviewers set active=false where user_id=current_setting('nakgo.doc_admin')::uuid;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_admin'),true);
set local role authenticated;
do $$ begin
 if public.nakgo_document_reviewer() or exists(select 1 from storage.objects where bucket_id='carrier-documents' and name like current_setting('nakgo.doc_owner')||'/%') then raise exception 'FAIL revoked reviewer access';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_owner'),true);
set local role authenticated;
do $$ declare a public.carrier_applications;begin
 a:=public.nakgo_transition_documents(current_setting('nakgo.doc_app')::bigint,'withdraw',current_setting('nakgo.doc_approved_revision')::bigint);
 if exists(select 1 from public.nakgo_carrier_verifications(array[auth.uid()])) then raise exception 'FAIL withdrawn approval';end if;
 if not private.document_object_access((select object_path from public.carrier_document_files where id=current_setting('nakgo.doc_src')::uuid),'delete') then raise exception 'FAIL owner cleanup permission';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.doc_unverified'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_create_carrier_application('CE');raise exception 'FAIL unverified application';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform count(*) from public.carrier_document_files;raise exception 'FAIL anonymous metadata';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_document_reviewer();raise exception 'FAIL anonymous role';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: private documents, Storage policies, immutable review, revisions, audit, independent reviewers and revoked access; fixtures rolled back' as result;

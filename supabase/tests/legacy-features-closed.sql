-- Removed features stay closed: no RPC, no direct read, no document upload. Everything rolls back.
begin;
do $$
declare u uuid:=gen_random_uuid(); f text; app bigint; pth text;
begin
 foreach f in array array['nakgo_open_conversation','nakgo_send_message','nakgo_read_conversation','nakgo_message_unread_count',
  'nakgo_request_transport','nakgo_transition_transport','nakgo_document_reviewer','nakgo_create_carrier_application','nakgo_reserve_document',
  'nakgo_finalize_document','nakgo_remove_document','nakgo_transition_documents','nakgo_review_documents','nakgo_carrier_verifications'] loop
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f) then raise exception 'FAIL % still exists',f; end if;
 end loop;
 if to_regclass('public.message_inbox') is not null then raise exception 'FAIL message_inbox still exists'; end if;
 insert into auth.users(id,email_confirmed_at) values(u,now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.profiles(id,display_name,account_type) values(u,'Kapalı Deneme','carrier');
 insert into public.carrier_applications(owner_id,owner_label,license_class) values(u,'Kapalı Deneme','CE') returning id into app;
 pth:=u::text||'/'||app::text||'/'||gen_random_uuid()::text||'.jpg';
 insert into public.carrier_document_files(id,application_id,owner_id,kind,object_path) values(split_part(split_part(pth,'/',3),'.',1)::uuid,app,u,'src',pth);
 set local role authenticated;
 foreach f in array array['listing_conversations','conversation_messages','transport_jobs','carrier_applications','carrier_document_files','carrier_document_audit'] loop
  begin execute format('select count(*) from public.%I',f); raise exception 'FAIL % readable',f; exception when insufficient_privilege then null; end;
 end loop;
 begin
  insert into storage.objects(bucket_id,name,owner_id,metadata) values('carrier-documents',pth,u::text,'{"mimetype":"image/jpeg","size":100}');
  raise exception 'FAIL document upload allowed';
 exception when insufficient_privilege then null; end;
 reset role;
end $$;
rollback;

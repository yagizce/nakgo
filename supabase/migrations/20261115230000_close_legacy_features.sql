-- Kaldırılmış özellikler (mesajlaşma, taşıma işleri, taşıyıcı belgeleri) veritabanında da kapatılır.
-- Tablolar ve içindeki veriler silinmez: hesap silme, gece temizliği ve Storage temizlik kuyruğu onları işlemeye devam eder.
begin;
drop function public.nakgo_open_conversation(bigint);
drop function public.nakgo_send_message(bigint,text,uuid);
drop function public.nakgo_read_conversation(bigint,bigint);
drop function public.nakgo_message_unread_count();
drop function public.nakgo_request_transport(bigint);
drop function public.nakgo_transition_transport(bigint,text);
drop function public.nakgo_document_reviewer();
drop function public.nakgo_create_carrier_application(text);
drop function public.nakgo_reserve_document(bigint,text,uuid);
drop function public.nakgo_finalize_document(uuid);
drop function public.nakgo_remove_document(uuid);
drop function public.nakgo_transition_documents(bigint,text,bigint);
drop function public.nakgo_review_documents(bigint,text,text,bigint);
drop function public.nakgo_carrier_verifications(uuid[]);
drop view public.message_inbox;
-- Kullanıcılar bu tabloları ve belge dosyalarını artık doğrudan okuyamaz, yükleyemez, silemez.
drop policy carrier_object_read on storage.objects;
drop policy carrier_object_insert on storage.objects;
drop policy carrier_object_delete on storage.objects;
revoke select on public.listing_conversations,public.conversation_messages,public.transport_jobs,
 public.carrier_applications,public.carrier_document_files,public.carrier_document_audit from authenticated;
commit;

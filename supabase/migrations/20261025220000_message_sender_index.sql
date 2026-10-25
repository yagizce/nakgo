-- Keep sender rate-limit checks bounded as message history grows. DEV first.
begin;
create index if not exists conversation_messages_sender_time on public.conversation_messages(sender_id,created_at desc);
commit;

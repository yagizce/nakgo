-- Synthetic participants/listings only; every test mutation is rolled back.
begin;
select set_config('nakgo.msg_owner',gen_random_uuid()::text,true),set_config('nakgo.msg_guest',gen_random_uuid()::text,true),set_config('nakgo.msg_out',gen_random_uuid()::text,true),set_config('nakgo.msg_unverified',gen_random_uuid()::text,true),set_config('nakgo.msg_nonce',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.msg_owner')::uuid,now()),(current_setting('nakgo.msg_guest')::uuid,now()),(current_setting('nakgo.msg_out')::uuid,now()),(current_setting('nakgo.msg_unverified')::uuid,null);
-- Fixture writes use a synthetic actor under the current moderation guards.
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_owner'),true);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.msg_owner')::uuid,'Message owner','owner'),(current_setting('nakgo.msg_guest')::uuid,'Message guest','carrier'),(current_setting('nakgo.msg_out')::uuid,'Outsider','carrier'),(current_setting('nakgo.msg_unverified')::uuid,'Unverified','carrier') on conflict(id) do nothing;
insert into public.listings(contact_phone,contact_consent,owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on) values('+905321234567',true,current_setting('nakgo.msg_owner')::uuid,'load','İstanbul','Ankara','Tır','Tenteli',10,'Rollback conversation load','Message owner',(now() at time zone 'Europe/Istanbul')::date) returning set_config('nakgo.msg_load',id::text,true);
insert into public.listings(contact_phone,contact_consent,owner_id,kind,from_city,to_city,vehicle,body,amount,owner_label,available_on) values('+905321234567',true,current_setting('nakgo.msg_owner')::uuid,'truck','İstanbul','Ankara','Tır','Tenteli',10,'Message owner',(now() at time zone 'Europe/Istanbul')::date) returning set_config('nakgo.msg_truck',id::text,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_guest'),true);

-- Seed history with database-owner access to prove records survive API retirement.
select set_config('nakgo.msg_conv',(public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint)).id::text,true);
select public.nakgo_send_message(current_setting('nakgo.msg_conv')::bigint,'Synthetic retained history',gen_random_uuid());
set local role authenticated;
do $$declare actor text;begin
 foreach actor in array array[current_setting('nakgo.msg_owner'),current_setting('nakgo.msg_guest'),current_setting('nakgo.msg_out'),current_setting('nakgo.msg_unverified')] loop
  perform set_config('request.jwt.claim.sub',actor,true);
  begin perform public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint);raise exception 'FAIL retired open';exception when insufficient_privilege then null;end;
  begin perform public.nakgo_send_message(current_setting('nakgo.msg_conv')::bigint,'Forbidden',gen_random_uuid());raise exception 'FAIL retired send';exception when insufficient_privilege then null;end;
  begin perform public.nakgo_read_conversation(current_setting('nakgo.msg_conv')::bigint,1);raise exception 'FAIL retired read';exception when insufficient_privilege then null;end;
  begin perform public.nakgo_message_unread_count();raise exception 'FAIL retired count';exception when insufficient_privilege then null;end;
  begin perform 1 from public.message_inbox;raise exception 'FAIL retired inbox';exception when insufficient_privilege then null;end;
  begin perform 1 from public.conversation_messages;raise exception 'FAIL retired messages';exception when insufficient_privilege then null;end;
 end loop;
end $$;
reset role;
do $$begin
 if not exists(select 1 from public.conversation_messages where conversation_id=current_setting('nakgo.msg_conv')::bigint and body='Synthetic retained history') then raise exception 'FAIL history lost';end if;
end $$;
set local role anon;
do $$begin
 begin perform public.nakgo_message_unread_count();raise exception 'FAIL anonymous count';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;

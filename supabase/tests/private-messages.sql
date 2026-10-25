-- Synthetic participants/listings only; every test mutation is rolled back.
begin;
select set_config('nakgo.msg_owner',gen_random_uuid()::text,true),set_config('nakgo.msg_guest',gen_random_uuid()::text,true),set_config('nakgo.msg_out',gen_random_uuid()::text,true),set_config('nakgo.msg_unverified',gen_random_uuid()::text,true),set_config('nakgo.msg_nonce',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.msg_owner')::uuid,now()),(current_setting('nakgo.msg_guest')::uuid,now()),(current_setting('nakgo.msg_out')::uuid,now()),(current_setting('nakgo.msg_unverified')::uuid,null);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.msg_owner')::uuid,'Message owner','owner'),(current_setting('nakgo.msg_guest')::uuid,'Message guest','carrier'),(current_setting('nakgo.msg_out')::uuid,'Outsider','carrier'),(current_setting('nakgo.msg_unverified')::uuid,'Unverified','carrier') on conflict(id) do nothing;
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
 values(current_setting('nakgo.msg_owner')::uuid,'load','İstanbul','Ankara','Tır','Tenteli',10,'Rollback conversation load','Message owner',(now() at time zone 'Europe/Istanbul')::date) returning set_config('nakgo.msg_load',id::text,true);
insert into public.listings(owner_id,kind,from_city,to_city,vehicle,body,amount,owner_label,available_on)
 values(current_setting('nakgo.msg_owner')::uuid,'truck','İstanbul','Ankara','Tır','Tenteli',10,'Message owner',(now() at time zone 'Europe/Istanbul')::date) returning set_config('nakgo.msg_truck',id::text,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_guest'),true);
set local role authenticated;
do $$ declare c public.listing_conversations;m public.conversation_messages;again public.conversation_messages;begin
 c:=public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint);
 perform set_config('nakgo.msg_conv',c.id::text,true);
 if c.guest_id<>auth.uid() or c.owner_id<>current_setting('nakgo.msg_owner')::uuid then raise exception 'FAIL server participants';end if;
 if (public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint)).id<>c.id then raise exception 'FAIL duplicate conversation';end if;
 perform public.nakgo_open_conversation(current_setting('nakgo.msg_truck')::bigint);
 if(select count(*) from public.message_inbox)<>2 then raise exception 'FAIL truck/duplicate';end if;
 m:=public.nakgo_send_message(c.id,'<img src=x onerror=alert(1)>',current_setting('nakgo.msg_nonce')::uuid);perform set_config('nakgo.msg_message',m.id::text,true);
 again:=public.nakgo_send_message(c.id,'<img src=x onerror=alert(1)>',current_setting('nakgo.msg_nonce')::uuid);
 if m.id<>again.id or m.sender_id<>auth.uid() or (select count(*) from public.conversation_messages)<>1 then raise exception 'FAIL idempotent sender';end if;
 begin perform public.nakgo_send_message(c.id,'Different text',current_setting('nakgo.msg_nonce')::uuid);raise exception 'FAIL reused nonce';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_send_message(c.id,' ',gen_random_uuid());raise exception 'FAIL empty';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_send_message(c.id,repeat('x',501),gen_random_uuid());raise exception 'FAIL length';exception when invalid_parameter_value then null;end;
 begin update public.listing_conversations set guest_id=current_setting('nakgo.msg_out')::uuid;raise exception 'FAIL direct participant update';exception when insufficient_privilege then null;end;
 begin insert into public.conversation_messages(conversation_id,sender_id,body,client_nonce) values(c.id,current_setting('nakgo.msg_owner')::uuid,'Forged',gen_random_uuid());raise exception 'FAIL direct insert';exception when insufficient_privilege then null;end;
 begin delete from public.conversation_messages;raise exception 'FAIL direct delete';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_out'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.listing_conversations) or exists(select 1 from public.conversation_messages) or exists(select 1 from public.message_inbox) then raise exception 'FAIL third-party read';end if;
 begin perform public.nakgo_send_message(current_setting('nakgo.msg_conv')::bigint,'Intruder',gen_random_uuid());raise exception 'FAIL third-party send';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_read_conversation(current_setting('nakgo.msg_conv')::bigint,current_setting('nakgo.msg_message')::bigint);raise exception 'FAIL third-party read marker';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_owner'),true);
set local role authenticated;
do $$ declare c bigint:=current_setting('nakgo.msg_conv')::bigint;m public.conversation_messages;begin
 if public.nakgo_message_unread_count()<>1 then raise exception 'FAIL recipient unread';end if;
 perform public.nakgo_read_conversation(c,current_setting('nakgo.msg_message')::bigint);
 if public.nakgo_message_unread_count()<>0 then raise exception 'FAIL read marker';end if;
 begin perform public.nakgo_read_conversation(c,9007199254740991);raise exception 'FAIL future read';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint);raise exception 'FAIL self conversation';exception when insufficient_privilege then null;end;
 m:=public.nakgo_send_message(c,'Reply',gen_random_uuid());
end $$;
reset role;
update public.listings set status='closed' where id in(current_setting('nakgo.msg_load')::bigint,current_setting('nakgo.msg_truck')::bigint);
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_out'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint);raise exception 'FAIL closed new conversation';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_guest'),true);
set local role authenticated;
do $$ begin
 if (public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint)).id<>current_setting('nakgo.msg_conv')::bigint then raise exception 'FAIL history after close';end if;
 if public.nakgo_message_unread_count()<>1 then raise exception 'FAIL reply unread';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.msg_unverified'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_send_message(current_setting('nakgo.msg_conv')::bigint,'Unverified',gen_random_uuid());raise exception 'FAIL unverified send';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin perform public.nakgo_open_conversation(current_setting('nakgo.msg_load')::bigint);raise exception 'FAIL anonymous open';exception when insufficient_privilege then null;end;
 begin perform count(*) from public.conversation_messages;raise exception 'FAIL anonymous read';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: private messages, participants, idempotency, unread boundaries and lifecycle; fixtures rolled back' as result;

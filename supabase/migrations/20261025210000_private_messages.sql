-- DEV-only private listing conversations. No payment entitlement is provisioned.
begin;
create table public.listing_conversations (
 id bigint generated always as identity primary key check(id<=9007199254740991),
 listing_id bigint references public.listings(id) on delete set null,
 owner_id uuid not null references auth.users(id) on delete cascade,
 guest_id uuid not null references auth.users(id) on delete cascade,
 owner_label text not null, guest_label text not null,
 listing_kind text not null check(listing_kind in ('load','truck')),
 from_city text not null, to_city text not null,
 last_message_id bigint not null default 0,
 last_message_body text not null default '', last_sender_id uuid,
 owner_read_id bigint not null default 0, guest_read_id bigint not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(listing_id,guest_id), check(owner_id<>guest_id)
);
create table public.conversation_messages (
 id bigint generated always as identity primary key check(id<=9007199254740991),
 conversation_id bigint not null references public.listing_conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade,
 client_nonce uuid not null, body text not null check(char_length(btrim(body)) between 1 and 500),
 created_at timestamptz not null default now(),
 unique(conversation_id,sender_id,client_nonce)
);
create index conversations_owner on public.listing_conversations(owner_id,last_message_id desc,id desc);
create index conversations_guest on public.listing_conversations(guest_id,last_message_id desc,id desc);
create index messages_conversation on public.conversation_messages(conversation_id,id desc);
alter table public.listing_conversations enable row level security;
alter table public.conversation_messages enable row level security;
revoke all on public.listing_conversations,public.conversation_messages from public,anon,authenticated;
revoke all on sequence public.listing_conversations_id_seq,public.conversation_messages_id_seq from public,anon,authenticated;
grant select on public.listing_conversations,public.conversation_messages to authenticated;
create policy conversations_participants on public.listing_conversations for select to authenticated
 using((select auth.uid()) in (owner_id,guest_id));
create policy messages_participants on public.conversation_messages for select to authenticated
 using(exists(select 1 from public.listing_conversations c where c.id=conversation_id and (select auth.uid()) in(c.owner_id,c.guest_id)));

create view public.message_inbox with(security_invoker=true) as
 select c.*, (select count(*) from public.conversation_messages m where m.conversation_id=c.id and m.sender_id<>auth.uid()
 and m.id>case when c.owner_id=auth.uid() then c.owner_read_id else c.guest_read_id end) as unread_count
 from public.listing_conversations c;
revoke all on public.message_inbox from public,anon;
grant select on public.message_inbox to authenticated;

-- Derive both participants from the verified caller and the listing, never client labels/IDs.
create function public.nakgo_open_conversation(p_listing_id bigint)
returns public.listing_conversations language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings; c public.listing_conversations; label text;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
 raise exception 'Verified account required' using errcode='42501';end if;
 if p_listing_id is null or p_listing_id<1 or p_listing_id>9007199254740991 then raise exception 'Invalid listing' using errcode='22023';end if;
 select * into l from public.listings where id=p_listing_id for update;
 if not found or l.owner_id=actor then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select * into c from public.listing_conversations where listing_id=l.id and guest_id=actor;
 if found then return c;end if;
 if l.status<>'active' or coalesce(l.available_until,l.available_on)<(now() at time zone 'Europe/Istanbul')::date then
 raise exception 'Listing unavailable' using errcode='42501';end if;
 select coalesce(nullif(btrim(display_name),''),'NakGo kullanıcısı') into label from public.profiles where id=actor;
 if not found then raise exception 'Profile required' using errcode='42501';end if;
 insert into public.listing_conversations(listing_id,owner_id,guest_id,owner_label,guest_label,listing_kind,from_city,to_city)
 values(l.id,l.owner_id,actor,l.owner_label,label,l.kind,l.from_city,l.to_city) returning * into c;
 return c;
end $$;

-- Per-conversation lock serializes sends and read boundaries. Retrying the same nonce cannot duplicate a message.
create function public.nakgo_send_message(p_conversation_id bigint,p_body text,p_client_nonce uuid)
returns public.conversation_messages language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c public.listing_conversations; m public.conversation_messages; text_value text:=btrim(p_body);
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
 raise exception 'Verified account required' using errcode='42501';end if;
 if p_conversation_id is null or p_conversation_id<1 or p_conversation_id>9007199254740991 or p_client_nonce is null
 or text_value is null or char_length(text_value) not between 1 and 500 then raise exception 'Invalid message' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7281));
 select * into c from public.listing_conversations where id=p_conversation_id for update;
 if not found or actor not in(c.owner_id,c.guest_id) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select * into m from public.conversation_messages where conversation_id=c.id and sender_id=actor and client_nonce=p_client_nonce;
 if found then
 if m.body<>text_value then raise exception 'Retry content changed' using errcode='22023';end if;
 return m;end if;
 if (select count(*) from public.conversation_messages where sender_id=actor and created_at>now()-interval '1 minute')>=30 then
 raise exception 'Please wait before sending' using errcode='54000';end if;
 insert into public.conversation_messages(conversation_id,sender_id,body,client_nonce) values(c.id,actor,text_value,p_client_nonce) returning * into m;
 update public.listing_conversations set last_message_id=m.id,last_message_body=m.body,last_sender_id=actor,updated_at=m.created_at where id=c.id;
 return m;
end $$;

create function public.nakgo_read_conversation(p_conversation_id bigint,p_through_id bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c public.listing_conversations; boundary bigint;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'Verified account required' using errcode='42501';end if;
 select * into c from public.listing_conversations where id=p_conversation_id for update;
 if not found or actor not in(c.owner_id,c.guest_id) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if p_through_id is null or not exists(select 1 from public.conversation_messages where id=p_through_id and conversation_id=c.id) then
 raise exception 'Invalid read boundary' using errcode='22023';end if;
 if actor=c.owner_id then boundary:=greatest(c.owner_read_id,p_through_id);update public.listing_conversations set owner_read_id=boundary where id=c.id;
 else boundary:=greatest(c.guest_read_id,p_through_id);update public.listing_conversations set guest_read_id=boundary where id=c.id;end if;
 return boundary;
end $$;
create function public.nakgo_message_unread_count() returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce(sum(unread_count),0)::bigint from public.message_inbox;
$$;
revoke all on function public.nakgo_open_conversation(bigint),public.nakgo_send_message(bigint,text,uuid),public.nakgo_read_conversation(bigint,bigint),public.nakgo_message_unread_count() from public,anon;
grant execute on function public.nakgo_open_conversation(bigint),public.nakgo_send_message(bigint,text,uuid),public.nakgo_read_conversation(bigint,bigint),public.nakgo_message_unread_count() to authenticated;
commit;

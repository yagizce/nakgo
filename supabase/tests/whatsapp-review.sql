-- WhatsApp review queue. Synthetic messages and numbers only; everything rolls back. Run as postgres.
begin;
do $$begin
 if (select count(*) from private.admin_members where active)<>1 then raise exception 'Exactly one administrator required';end if;
end $$;
select set_config('nakgo.wa_admin',(select user_id::text from private.admin_members where active),true),
 set_config('nakgo.wa_user',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.wa_user')::uuid,now());
do $$ declare job jsonb; n int; begin
 -- Service side: ingest is idempotent and never stores the sender number.
 n:=public.nakgo_wa_ingest('[{"messageId":"wa-test-1","text":"KONYA ANTALYA FRİGO TIR 0532 000 11 22","timestamp":1794400000,"fromPhone":"+905559990000"},{"messageId":"wa-test-1","text":"duplicate","timestamp":1794400000}]');
 if n<>1 then raise exception 'FAIL idempotent ingest (%)',n;end if;
 if exists(select 1 from private.wa_sources where sender is not null) then raise exception 'FAIL sender stored';end if;
 job:=public.nakgo_wa_claim();
 if job->>'text' not like 'KONYA%' then raise exception 'FAIL claim';end if;
 perform public.nakgo_wa_finish((job->>'id')::bigint,(job->>'lease')::uuid,jsonb_build_array(
  jsonb_build_object('fields',jsonb_build_object('kind','load','from',jsonb_build_object('city','Konya','district','Selçuklu'),'destinations',jsonb_build_array(jsonb_build_object('city','Antalya')),
   'vehicle','Tır','body','Frigorifik','amount',20,'cargo','Gıda','timing','bugün','contactPhone','0532 000 11 22'),'issues','[]'::jsonb,'confidence',1,'fingerprint',repeat('a',64)),
  jsonb_build_object('fields',jsonb_build_object('kind','load','from',jsonb_build_object('city','İzmir'),'destinations',jsonb_build_array(jsonb_build_object('city','Denizli')),
   'vehicle','Tır','body','Frigorifik','amount',20,'cargo','Gıda','timing','bugün'),'issues','["contact_review"]'::jsonb,'confidence',0.9,'fingerprint',repeat('b',64)),
  jsonb_build_object('fields',jsonb_build_object('kind','load','from',jsonb_build_object('city','Eskişehir','district','Seyitgazi'),'destinations',jsonb_build_array(jsonb_build_object('city','Kocaeli','district','Körfez')),
   'vehicle','Tır','contactPhone','0500 000 00 02'),'issues','["weight_review"]'::jsonb,'confidence',0.8,'fingerprint',repeat('c',64))));
 if (select count(*) from private.wa_drafts)<>3 then raise exception 'FAIL drafts';end if;
 if exists(select 1 from public.listings where note like '%0532 000 11 22%') then raise exception 'FAIL auto publish';end if;
end $$;
-- A normal account cannot read or act on the queue.
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_user'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_wa_page(0); raise exception 'FAIL user page'; exception when insufficient_privilege then null; end;
 begin perform public.nakgo_wa_ingest('[]'); raise exception 'FAIL user ingest'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('nakgo.wa_d3',(select id::text from private.wa_drafts where fingerprint=repeat('c',64)),true);
select set_config('nakgo.wa_d1',(select id::text from private.wa_drafts where fingerprint=repeat('a',64)),true),
 set_config('nakgo.wa_d2',(select id::text from private.wa_drafts where fingerprint=repeat('b',64)),true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_admin'),true);
set local role authenticated;
do $$ declare d1 bigint:=current_setting('nakgo.wa_d1')::bigint; d2 bigint:=current_setting('nakgo.wa_d2')::bigint; r jsonb; l record; begin
 if jsonb_array_length(public.nakgo_wa_page(0)->'drafts')<>3 then raise exception 'FAIL admin page';end if;
 begin perform public.nakgo_wa_change(d1,0,'publish',null,null); raise exception 'FAIL publish without basis'; exception when others then if sqlerrm not like '%legal basis%' then raise; end if; end;
 begin perform public.nakgo_wa_change(d2,0,'publish',null,'Kendi paylaştığı grup ilanı (alenileştirme)'); raise exception 'FAIL publish without message phone';
 exception when others then if sqlerrm not like '%phone%' then raise; end if; end;
 r:=public.nakgo_wa_change(d1,0,'publish',null,'Kendi paylaştığı grup ilanı (alenileştirme)');
 if r->>'status'<>'published' then raise exception 'FAIL publish';end if;
 reset role;
 select * into l from public.listings where id=(r->>'listingId')::bigint;
 if l.contact_phone<>'+905320001122' or not l.contact_consent or l.from_district<>'Selçuklu' or l.to_district is not null or l.expires_at-l.created_at<>interval '6 hours' then
  raise exception 'FAIL listing fields % % % %',l.contact_phone,l.contact_consent,l.from_district,l.expires_at-l.created_at;end if;
 perform set_config('nakgo.wa_listing',l.id::text,true);
end $$;
-- Route, vehicle and phone are enough; unknown tonnage, body and cargo stay empty instead of being invented.
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_admin'),true);
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.nakgo_wa_change(current_setting('nakgo.wa_d3')::bigint,0,'publish',null,'Kendi paylaştığı grup ilanı (alenileştirme)');
 perform set_config('nakgo.wa_min',r->>'listingId',true);
end $$;
reset role;
do $$ declare l record; begin
 select * into l from public.listings where id=current_setting('nakgo.wa_min')::bigint;
 if l.amount is not null or l.body is not null or l.cargo<>'' or l.loading_text<>'Belirtilmedi' or not l.wa_source or l.contact_phone<>'+905000000002' or l.to_district<>'Körfez' then
  raise exception 'FAIL minimal listing % % % % %',l.amount,l.body,l.cargo,l.loading_text,l.wa_source;end if;
end $$;
-- Normal accounts keep the strict rules and cannot mark a listing as WhatsApp-sourced.
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_user'),true);
set local role authenticated;
do $$ begin
 begin insert into public.listings(kind,from_city,to_city,vehicle,body,cargo,owner_label,loading_text) values('load','İzmir','Ankara','Tır','Tenteli','Palet','Test','bugün');
  raise exception 'FAIL user listing without tonnage'; exception when not_null_violation or check_violation then null; end;
 begin insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,wa_source) values('load','İzmir','Ankara','Tır','Tenteli',5,'Palet','Test','bugün',true);
  raise exception 'FAIL user sets wa_source'; exception when insufficient_privilege then null; end;
end $$;
reset role;
reset role;
-- Readers get the message phone only through the contact RPC; owner edits go through review.
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_user'),true);
set local role authenticated;
do $$ begin
 if public.nakgo_listing_contact(current_setting('nakgo.wa_listing')::bigint)<>'+905320001122' then raise exception 'FAIL reader contact';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('nakgo.wa_admin'),true);
set local role authenticated;
do $$ begin
 begin update public.listings set note='bypass' where id=current_setting('nakgo.wa_listing')::bigint; raise exception 'FAIL review bypass';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

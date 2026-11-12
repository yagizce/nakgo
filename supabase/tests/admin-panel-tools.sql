-- Admin listing filters, listing history, statistics range and insights. Synthetic rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1); owner uuid:=gen_random_uuid(); ids bigint[]; rows jsonb; h jsonb; st jsonb; ins jsonb;
 t0 timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Europe/Istanbul')::date;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at) values(owner,t0);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.headers','{"x-forwarded-for":"198.51.100.4"}',true);
 insert into public.profiles(id,display_name,account_type) values(owner,'Filtre Deneme Taşıyıcı','carrier');
 set local role authenticated;
 with seeded as (insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','Hakkari','Ardahan','Tır','Tenteli',1,'Synthetic','Filtre Deneme','bugün'),('load','Hakkari','Ardahan','Tır','Frigorifik',1,'Synthetic','Filtre Deneme','bugün'),
   ('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Synthetic','Filtre Deneme','bugün') returning id)
 select array_agg(id order by id) into ids from seeded;
 update public.listings set status='closed' where id=ids[3];
 reset role;

 perform set_config('request.jwt.claim.sub',admin::text,true);
 -- Combined filters (AND) with a result count.
 rows:=public.nakgo_admin_page('listings',0,'','','{"from_city":"Hakkari","to_city":"Ardahan","vehicle":"Tır","body":"Tenteli"}');
 if jsonb_array_length(rows)<>1 or (rows->0->>'id')::bigint<>ids[1] or (rows->0->>'total')::int<>1 then raise exception 'FAIL combined filters %',rows; end if;
 rows:=public.nakgo_admin_page('listings',0,'','',jsonb_build_object('owner','filtre deneme','from',today::text,'to',today::text));
 if (rows->0->>'total')::int<>3 or rows->0->>'owner_name'<>'Filtre Deneme Taşıyıcı' or rows::text ~ '(contact_phone|"phone")' then raise exception 'FAIL owner/date filters'; end if;
 rows:=public.nakgo_admin_page('listings',0,'','',jsonb_build_object('state','closed','owner','filtre deneme'));
 if jsonb_array_length(rows)<>1 or (rows->0->>'id')::bigint<>ids[3] then raise exception 'FAIL state filter'; end if;
 rows:=public.nakgo_admin_page('listings',0,'','',jsonb_build_object('id',ids[2]::text));
 if jsonb_array_length(rows)<>1 or (rows->0->>'id')::bigint<>ids[2] then raise exception 'FAIL id filter'; end if;
 rows:=public.nakgo_admin_page('users',0,'','',jsonb_build_object('user',owner::text));
 if jsonb_array_length(rows)<>1 then raise exception 'FAIL owner link'; end if;
 begin perform public.nakgo_admin_page('listings',0,'','','{"id":"1 or 1=1"}');raise exception 'FAIL bad id accepted';exception when invalid_parameter_value then null;end;
 begin perform public.nakgo_admin_page('listings',0,'','','{"from":"dün"}');raise exception 'FAIL bad date accepted';exception when invalid_parameter_value then null;end;

 -- History: creation and owner close from the access log (no IP), administrator removal with reason.
 perform public.nakgo_admin_moderate('listing',ids[3]::text,'remove','Deneme gerekçesi',0);
 h:=public.nakgo_admin_page('history',0,'','',jsonb_build_object('id',ids[3]::text));
 if not h @> '[{"kind":"user","action":"listing_create","actor":"Filtre Deneme Taşıyıcı"}]' or not h @> '[{"kind":"user","action":"listing_update","detail":"status:active>closed"}]'
  or not h @> '[{"kind":"admin","action":"remove","reason":"Deneme gerekçesi"}]' or h::text like '%198.51.100.4%' then raise exception 'FAIL history %',h; end if;
 rows:=public.nakgo_admin_page('listings',0,'','',jsonb_build_object('id',ids[3]::text));
 if rows->0->>'state'<>'removed' then raise exception 'FAIL removed state separate from closed'; end if;

 -- Statistics: every day of the range, zeros included, newest first; insights from stored rows.
 st:=public.nakgo_admin_page('stats',0,'','',jsonb_build_object('from',(today-6)::text,'to',today::text));
 if jsonb_array_length(st)<>7 or (st->0->>'day')::date<>today or (st->6->>'day')::date<>today-6 or (st->0->>'listings')::int<3 then raise exception 'FAIL stats range %',st; end if;
 if exists(select 1 from jsonb_array_elements(st) e where e->>'listings' is null) then raise exception 'FAIL zero days'; end if;
 if jsonb_array_length(public.nakgo_admin_page('stats'))<>90 then raise exception 'FAIL default range'; end if;
 begin perform public.nakgo_admin_page('stats',0,'','',jsonb_build_object('from',(today-400)::text));raise exception 'FAIL long range accepted';exception when invalid_parameter_value then null;end;
 ins:=public.nakgo_admin_page('insights',0,'','',jsonb_build_object('from',today::text,'to',today::text));
 if not (ins->'cities') @> '[{"name":"Hakkari"}]' or not (ins->'vehicles') @> '[{"name":"Tır"}]' or (ins->>'ended')::int<1 or ins->'avg_hours' is null then raise exception 'FAIL insights %',ins; end if;

 -- Ordinary accounts cannot use any of it.
 perform set_config('request.jwt.claim.sub',owner::text,true);
 set local role authenticated;
 begin perform public.nakgo_admin_page('history',0,'','',jsonb_build_object('id',ids[1]::text));raise exception 'FAIL ordinary history';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_page('insights');raise exception 'FAIL ordinary insights';exception when insufficient_privilege then null;end;
 begin perform 1 from private.access_log;raise exception 'FAIL client log';exception when insufficient_privilege then null;end;
 reset role;
end $$;
rollback;

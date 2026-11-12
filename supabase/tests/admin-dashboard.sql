-- Admin dashboard figures and permanent daily counts. Synthetic rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1); owner uuid:=gen_random_uuid(); ids bigint[]; o jsonb; rows jsonb; t0 timestamptz:=statement_timestamp();
 before jsonb; before_total int;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at) values(owner,t0);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.profiles(id,display_name,account_type) values(owner,'Synthetic dashboard owner','carrier');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 before:=public.nakgo_admin_page('overview');before_total:=(before#>>'{totals,listings}')::int;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 with seeded as (
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,available_on)
  select case when g<5 then 'load' else 'truck' end,'İstanbul','Ankara','Tır','Tenteli',10,case when g<5 then 'Synthetic cargo' else '' end,'Synthetic owner',
   case when g<5 then 'bugün' end,case when g=5 then (t0 at time zone 'Europe/Istanbul')::date+1 end
  from generate_series(1,5) g returning id)
 select array_agg(id order by id) into ids from seeded;
 -- States: [1] active, [2] expired, [3] closed, [4] removed, [5] cleared by retention.
 alter table public.listings disable trigger user;
 update public.listings set expires_at=t0-interval '1 hour' where id=ids[2];
 update public.listings set status='closed' where id=ids[3];
 update public.listings set redacted_at=t0 where id=ids[5];
 alter table public.listings enable trigger user;
 insert into private.listing_moderation(listing_id,removed) values(ids[4],true);

 perform set_config('request.jwt.claim.sub',admin::text,true);
 o:=public.nakgo_admin_page('overview');
 if (o#>>'{listing_states,active}')::int<>(before#>>'{listing_states,active}')::int+1
  or (o#>>'{listing_states,expired}')::int<>(before#>>'{listing_states,expired}')::int+1
  or (o#>>'{listing_states,closed}')::int<>(before#>>'{listing_states,closed}')::int+1
  or (o#>>'{listing_states,removed}')::int<>(before#>>'{listing_states,removed}')::int+1
  or (o#>>'{listing_states,redacted}')::int<>(before#>>'{listing_states,redacted}')::int+1 then raise exception 'FAIL listing states %',o->'listing_states'; end if;
 if (o->>'listings_today')::int<>(before->>'listings_today')::int+5 or (o#>>'{totals,listings}')::int<>before_total+5 or (o->>'users_week')::int<1
  then raise exception 'FAIL overview %',o; end if;
 rows:=public.nakgo_admin_page('listings',0,'','expired');
 if jsonb_array_length(rows)<1 or exists(select 1 from jsonb_array_elements(rows) r where r->>'state'<>'expired') or not rows @> jsonb_build_array(jsonb_build_object('id',ids[2]))
  then raise exception 'FAIL expired filter'; end if;
 rows:=public.nakgo_admin_page('listings',0,'Synthetic owner','');
 if (select count(*) from jsonb_array_elements(rows) r where (r->>'id')::bigint=any(ids))<>5 or rows::text like '%contact_phone%' then raise exception 'FAIL listing rows'; end if;
 rows:=public.nakgo_admin_page('users',0,'Synthetic dashboard','carrier');
 if jsonb_array_length(rows)<>1 or (rows->0->>'listings')::int<>5 or rows::text like '%"phone"%' then raise exception 'FAIL user rows %',rows; end if;
 rows:=public.nakgo_admin_page('stats');
 if (rows->0->>'day')::date<>(t0 at time zone 'Europe/Istanbul')::date or (rows->0->>'listings')::int<5 then raise exception 'FAIL stats today'; end if;

 -- A recorded day keeps its count after retention deletes the rows; ids stay out of the stats.
 perform private.record_daily_stats((t0 at time zone 'Europe/Istanbul')::date);
 delete from public.listings where id=any(ids);
 perform private.record_daily_stats((t0 at time zone 'Europe/Istanbul')::date);
 if (select listings from private.daily_stats where day=(t0 at time zone 'Europe/Istanbul')::date)<5 then raise exception 'FAIL stats lowered'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='daily_stats' and column_name not in('day','listings','loads','trucks','users','updated_at'))
  then raise exception 'FAIL stats columns'; end if;

 -- Ordinary accounts and clients see nothing.
 perform set_config('request.jwt.claim.sub',owner::text,true);
 set local role authenticated;
 begin perform public.nakgo_admin_page('overview');raise exception 'FAIL ordinary overview';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_page('stats');raise exception 'FAIL ordinary stats';exception when insufficient_privilege then null;end;
 begin perform 1 from private.daily_stats;raise exception 'FAIL client stats table';exception when insufficient_privilege then null;end;
 begin perform private.record_daily_stats(current_date);raise exception 'FAIL client records stats';exception when insufficient_privilege then null;end;
 reset role;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 begin perform public.nakgo_admin_page('audit');raise exception 'FAIL removed section';exception when invalid_parameter_value then null;end;
end $$;
rollback;

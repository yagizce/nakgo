-- Live DEV moderation acceptance. Only synthetic fixtures are changed; everything rolls back.
-- Run as postgres. Requires one existing active general administrator; never grants a role.
begin;
do $$begin
 if (select count(*) from private.admin_members where active)<>1 then raise exception 'Exactly one administrator required';end if;
end $$;
select set_config('nakgo.mod_admin',(select user_id::text from private.admin_members where active),true),
 set_config('nakgo.mod_owner',gen_random_uuid()::text,true),set_config('nakgo.mod_carrier',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.mod_owner')::uuid,now()),(current_setting('nakgo.mod_carrier')::uuid,now());
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_owner'),true);
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.mod_owner')::uuid,'Synthetic moderation owner','owner'),(current_setting('nakgo.mod_carrier')::uuid,'Synthetic moderation carrier','carrier');
set local role authenticated;
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
 values('load','İstanbul','Ankara','Tır','Tenteli',10,'Synthetic accepted load','Synthetic owner',(now() at time zone 'Europe/Istanbul')::date+2) returning set_config('nakgo.mod_accepted_load',id::text,true);
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on)
 values('load','İstanbul','Ankara','Tır','Tenteli',10,'Synthetic pending load','Synthetic owner',(now() at time zone 'Europe/Istanbul')::date+2) returning set_config('nakgo.mod_pending_load',id::text,true);
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_owner'),true);
-- Ordinary accounts cannot see the role or call administration RPCs.
do $$begin
 if public.nakgo_admin_role() then raise exception 'FAIL ordinary admin role';end if;
 begin perform public.nakgo_admin_page('overview',0,'');raise exception 'FAIL ordinary dashboard';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_moderate('user',current_setting('nakgo.mod_carrier'),'suspend','Synthetic unauthorized attempt',0);raise exception 'FAIL ordinary moderation';exception when insufficient_privilege then null;end;
 begin insert into private.admin_members(user_id) values(auth.uid());raise exception 'FAIL self grant';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_admin'),true);
do $$begin
 if not public.nakgo_admin_role() then raise exception 'FAIL administrator role';end if;
 begin perform public.nakgo_admin_moderate('user',auth.uid()::text,'suspend','Synthetic self suspension',0);raise exception 'FAIL self suspension';exception when insufficient_privilege then null;end;
 perform public.nakgo_admin_moderate('user',current_setting('nakgo.mod_carrier'),'suspend','Synthetic rollback suspension',0);
 begin perform public.nakgo_admin_moderate('user',current_setting('nakgo.mod_carrier'),'resume','Synthetic stale revision',0);raise exception 'FAIL stale account revision';exception when sqlstate 'PT409' then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_carrier'),true);
do $$begin
 begin update public.profiles set display_name='Forbidden synthetic change' where id=auth.uid();raise exception 'FAIL suspended profile';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_set_favorite(current_setting('nakgo.mod_pending_load')::bigint,true);raise exception 'FAIL suspended favorite';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_admin'),true);
select public.nakgo_admin_moderate('user',current_setting('nakgo.mod_carrier'),'resume','Synthetic rollback resume',1);
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_admin'),true);
select public.nakgo_admin_moderate('listing',current_setting('nakgo.mod_pending_load'),'remove','Synthetic rollback removal',0);
do $$begin
 begin perform public.nakgo_admin_moderate('listing',current_setting('nakgo.mod_pending_load'),'restore','Synthetic stale listing revision',0);raise exception 'FAIL stale listing revision';exception when sqlstate 'PT409' then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_owner'),true);
do $$begin
 begin update public.listings set status='active' where id=current_setting('nakgo.mod_pending_load')::bigint;raise exception 'FAIL republish removed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_admin'),true);
select public.nakgo_admin_moderate('listing',current_setting('nakgo.mod_pending_load'),'restore','Synthetic rollback restoration',1);
do $$declare result jsonb;begin
 result:=public.nakgo_admin_page('moderation',0,'');
 if (select count(*) from jsonb_array_elements(result) a where a->>'target' in(current_setting('nakgo.mod_carrier'),current_setting('nakgo.mod_pending_load')))<>4 then raise exception 'FAIL four successful audited changes';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_owner'),true);
do $$begin
 if (select status from public.listings where id=current_setting('nakgo.mod_pending_load')::bigint)<>'closed' then raise exception 'FAIL restoration republished listing';end if;
end $$;
reset role;
-- Revoke inside this uncommitted transaction only; the real membership is restored by ROLLBACK.
update private.admin_members set active=false where user_id=current_setting('nakgo.mod_admin')::uuid;
select set_config('request.jwt.claim.sub',current_setting('nakgo.mod_admin'),true);
set local role authenticated;
do $$begin
 if public.nakgo_admin_role() then raise exception 'FAIL revoked role';end if;
 begin perform public.nakgo_admin_page('overview',0,'');raise exception 'FAIL revoked dashboard';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: single-admin access, suspension, restore, stale revisions, audit and role revocation; all changes rolled back' as result;

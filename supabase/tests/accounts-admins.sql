-- Administrators, permanent bans and account deletion. Synthetic rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1); u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid();
 l1 bigint; l2 bigint; r jsonb; o jsonb; t0 timestamptz:=statement_timestamp(); c jsonb;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 update private.admin_members set owner=true where user_id=admin;
 insert into auth.users(id,email_confirmed_at,email,raw_user_meta_data) values(u1,t0,'u1@example.test','{"full_name":"Bir Kişi"}'),(u2,t0,'u2@example.test','{}'),(u3,null,'u3@example.test','{}');
 if to_regclass('auth.identities') is not null then execute 'insert into auth.identities(user_id,provider) values($1,''google'')' using u1; end if;
 if to_regclass('auth.refresh_tokens') is not null then execute 'insert into auth.refresh_tokens(user_id,token) values($1,''t'')' using u2::text; end if;
 foreach r in array array[to_jsonb(u1),to_jsonb(u2),to_jsonb(u3)] loop
  perform set_config('request.jwt.claim.sub',r#>>'{}',true);
  insert into public.profiles(id,display_name,account_type,phone,city) values((r#>>'{}')::uuid,'Hesap Deneme '||left(r#>>'{}',4),'carrier','05551112233','Hakkari');
 end loop;
 perform set_config('request.jwt.claim.sub',u1::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,note)
  values('load','Hakkari','Ardahan','Tır','Tenteli',1,'Paletli','Bir Kişi','bugün','+905551112233',true,'Not') returning id into l1;
 reset role;
 insert into public.route_alerts(user_id,kind,from_city,to_city) values(u1,'load','Hakkari','Ardahan');
 perform set_config('request.jwt.claim.sub',u2::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','İki','bugün') returning id into l2;
 reset role;

 perform set_config('request.jwt.claim.sub',admin::text,true);
 -- Appoint: only verified, active accounts; the new administrator gets full access and can appoint others.
 begin perform public.nakgo_admin_moderate('user',u3::text,'grant_admin','Deneme yetki',0);raise exception 'FAIL unverified admin';exception when invalid_parameter_value then null;end;
 perform public.nakgo_admin_moderate('user',u2::text,'grant_admin','Ekip arkadaşı',0);
 perform set_config('request.jwt.claim.sub',u2::text,true);
 if not public.nakgo_admin_role() then raise exception 'FAIL appointed admin role'; end if;
 o:=public.nakgo_admin_page('overview',0,'');
 if (o->>'admins')::int<>2 then raise exception 'FAIL admin count %',o->>'admins'; end if;
 -- The owner is protected from every action, also by other administrators.
 begin perform public.nakgo_admin_moderate('user',admin::text,'revoke_admin','Deneme',0);raise exception 'FAIL owner revoked';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_moderate('user',admin::text,'ban','Deneme',0);raise exception 'FAIL owner banned';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_moderate('user',u2::text,'revoke_admin','Kendim',1);raise exception 'FAIL self revoke';exception when insufficient_privilege then null;end;
 -- Administrators cannot be banned or deleted before their role is removed.
 perform set_config('request.jwt.claim.sub',admin::text,true);
 begin perform public.nakgo_admin_moderate('user',u2::text,'delete','Deneme',1);raise exception 'FAIL admin deleted';exception when insufficient_privilege then null;end;
 perform public.nakgo_admin_moderate('user',u2::text,'revoke_admin','Görev bitti',1);
 perform set_config('request.jwt.claim.sub',u2::text,true);
 if public.nakgo_admin_role() then raise exception 'FAIL revoked admin still admin'; end if;
 begin perform public.nakgo_admin_page('overview',0,'');raise exception 'FAIL revoked admin reads panel';exception when insufficient_privilege then null;end;
 -- Ordinary users cannot appoint.
 begin perform public.nakgo_admin_moderate('user',u1::text,'grant_admin','Kendime',0);raise exception 'FAIL ordinary grant';exception when insufficient_privilege then null;end;

 -- Permanent ban: sign-in blocked, sessions end, listings close, no activity; unban reverses the lock.
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',u2::text,'ban','Sahte ilanlar',2);
 if not exists(select 1 from auth.users where id=u2 and banned_until>now()+interval '50 years') then raise exception 'FAIL ban lock'; end if;
 if to_regclass('auth.refresh_tokens') is not null then execute 'select count(*) from auth.refresh_tokens where user_id=$1' into c using u2::text; if c::int<>0 then raise exception 'FAIL tokens kept'; end if; end if;
 if (select status from public.listings where id=l2)<>'closed' then raise exception 'FAIL banned listing open'; end if;
 r:=public.nakgo_admin_page('users',0,'','banned');
 if jsonb_array_length(r)<>1 or (r->0->>'banned')::boolean is not true then raise exception 'FAIL banned filter %',r; end if;
 begin perform public.nakgo_admin_moderate('user',u2::text,'resume','Deneme',3);raise exception 'FAIL resume on ban';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub',u2::text,true);
 begin
  set local role authenticated;
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','İki','bugün');
  raise exception 'FAIL banned user wrote';
 exception when insufficient_privilege then reset role; end;
 reset role;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',u2::text,'unban','İtiraz kabul',3);
 if exists(select 1 from auth.users where id=u2 and banned_until is not null) or exists(select 1 from private.account_moderation where user_id=u2 and (banned or suspended)) then raise exception 'FAIL unban'; end if;

 -- Administrator deletes an account: personal data erased now, IP/time log and decision kept.
 perform public.nakgo_admin_moderate('user',u1::text,'delete','Kullanıcı talebi',0);
 if exists(select 1 from public.profiles where id=u1 and (display_name<>'Silinmiş hesap' or phone<>'' or city<>'' or about<>'')) then raise exception 'FAIL profile not erased'; end if;
 if exists(select 1 from public.listings where id=l1 and (contact_phone is not null or owner_label<>'NakGo kullanıcısı' or note<>'' or redacted_at is null or status='active')) then raise exception 'FAIL listing not erased'; end if;
 if exists(select 1 from public.route_alerts where user_id=u1) then raise exception 'FAIL alerts kept'; end if;
 if exists(select 1 from auth.users where id=u1 and (email not like 'silindi-%@nakgo.invalid' or raw_user_meta_data<>'{}' or banned_until is null)) then raise exception 'FAIL auth not erased'; end if;
 if to_regclass('auth.identities') is not null then execute 'select count(*) from auth.identities where user_id=$1' into c using u1; if c::int<>0 then raise exception 'FAIL identity kept'; end if; end if;
 if not exists(select 1 from private.access_log where user_id=u1 and action='listing_create') then raise exception 'FAIL legal log removed'; end if;
 if not exists(select 1 from private.admin_audit where target=u1::text and action='delete') then raise exception 'FAIL decision not audited'; end if;
 begin perform public.nakgo_admin_moderate('user',u1::text,'unban','Geri al',1);raise exception 'FAIL deleted account changed';exception when invalid_parameter_value then null;end;
 r:=public.nakgo_admin_page('users',0,'','deleted');
 if jsonb_array_length(r)<>1 or r->0->>'deleted_at' is null then raise exception 'FAIL deleted filter'; end if;
 o:=public.nakgo_admin_page('overview',0,'');
 if (o->>'accounts_deleted')::int<>1 then raise exception 'FAIL deleted count'; end if;
 if (select count(*) from public.profiles p where not private.account_deleted(p.id))<>(o->>'users')::int then raise exception 'FAIL users count includes deleted'; end if;

 -- The user deletes their own account; the owner cannot.
 perform set_config('request.jwt.claim.sub',u2::text,true);
 set local role authenticated;
 perform public.nakgo_delete_my_account();
 reset role;
 if not exists(select 1 from private.account_moderation where user_id=u2 and deleted_by_self and deleted_at is not null) or exists(select 1 from public.profiles where id=u2 and display_name<>'Silinmiş hesap')
  or (select redacted_at from public.listings where id=l2) is null or not exists(select 1 from private.admin_audit where actor_id=u2 and action='self_delete') then raise exception 'FAIL self delete'; end if;
 -- With a second administrator present, only the owner rule can block the owner.
 insert into auth.users(id,email_confirmed_at,email) values(u3,t0,'u4@example.test') on conflict(id) do nothing;
 insert into private.admin_members(user_id,active) values(u3,true) on conflict(user_id) do update set active=true;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 begin set local role authenticated; perform public.nakgo_delete_my_account(); raise exception 'FAIL owner self delete'; exception when insufficient_privilege then reset role; end;
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
 begin set local role anon; perform public.nakgo_delete_my_account(); raise exception 'FAIL anon delete'; exception when insufficient_privilege then reset role; end;
 reset role;

 -- Retention: one year after deletion the anonymised account is removed; daily totals stay.
 update private.account_moderation set deleted_at=now()-interval '366 days' where user_id=u1;
 c:=private.retention_run();
 if (c->>'accounts_purged')::int<1 or exists(select 1 from auth.users where id=u1) or exists(select 1 from public.listings where id=l1) or not exists(select 1 from auth.users where id=u2) then raise exception 'FAIL purge %',c; end if;
end $$;
rollback;
select 'PASS: administrators, ban, deletion and retention; all changes rolled back' as result;

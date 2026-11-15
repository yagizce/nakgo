-- Unban restores an earlier suspension; legal hold survives account deletion until released.
-- Synthetic accounts only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1);
 u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid(); held bigint; free bigint; t0 timestamptz:=statement_timestamp(); x record; r jsonb;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at,email) values(u1,t0,'h1@example.test'),(u2,t0,'h2@example.test'),(u3,t0,'h3@example.test');
 foreach r in array array[to_jsonb(u1),to_jsonb(u2),to_jsonb(u3)] loop
  perform set_config('request.jwt.claim.sub',r#>>'{}',true);
  insert into public.profiles(id,display_name,account_type) values((r#>>'{}')::uuid,'Saklama Deneme','owner');
 end loop;

 -- Suspended, then banned, then unbanned: the suspension comes back.
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',u1::text,'suspend','Deneme askı',0);
 perform public.nakgo_admin_moderate('user',u1::text,'ban','Deneme ban',1);
 perform public.nakgo_admin_moderate('user',u1::text,'unban','Deneme ban kaldır',2);
 select suspended,banned into x from private.account_moderation where user_id=u1;
 if not x.suspended or x.banned then raise exception 'FAIL unban lost earlier suspension'; end if;
 -- Banned without an earlier suspension: unban leaves the account active.
 perform public.nakgo_admin_moderate('user',u2::text,'ban','Deneme ban',0);
 perform public.nakgo_admin_moderate('user',u2::text,'unban','Deneme ban kaldır',1);
 select suspended,banned into x from private.account_moderation where user_id=u2;
 if x.suspended or x.banned then raise exception 'FAIL unban kept a suspension that never existed'; end if;

 -- Legal hold: the held listing keeps its content when the owner deletes the account; others are erased.
 perform set_config('request.jwt.claim.sub',u3::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,contact_phone,contact_consent)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Delil yük','Üç','bugün','Delil not','+905551112233',true) returning id into held;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Sıradan','Üç','bugün','Not') returning id into free;
 reset role;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('listing',held::text,'hold','Savcılık talebi',0);
 perform set_config('request.jwt.claim.sub',u3::text,true);
 set local role authenticated;
 perform public.nakgo_delete_my_account();
 reset role;
 select note,cargo,contact_phone,status,redacted_at into x from public.listings where id=held;
 if x.note<>'Delil not' or x.cargo<>'Delil yük' or x.contact_phone is null or x.redacted_at is not null then raise exception 'FAIL held listing erased'; end if;
 if x.status<>'closed' then raise exception 'FAIL held listing still published'; end if;
 if exists(select 1 from public.listings where id=free and (note<>'' or redacted_at is null)) then raise exception 'FAIL non-held listing kept'; end if;
 if exists(select 1 from public.profiles where id=u3 and display_name<>'Silinmiş hesap') then raise exception 'FAIL profile kept'; end if;

 -- While held, the nightly run keeps it; once released, the next run erases it without the 8-day wait.
 perform private.retention_run();
 if (select redacted_at from public.listings where id=held) is not null then raise exception 'FAIL retention erased held listing'; end if;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('listing',held::text,'release','Talep sonuçlandı',1);
 perform private.retention_run();
 select note,cargo,contact_phone,loading_text,redacted_at into x from public.listings where id=held;
 if x.redacted_at is null or x.note<>'' or x.contact_phone is not null or x.loading_text<>'Silindi' then raise exception 'FAIL released listing not erased'; end if;
end $$;
rollback;

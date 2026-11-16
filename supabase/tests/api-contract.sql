-- API sözleşmesi v0 davranış testi (supabase/contract/v0.json). Gerçek kullanıcı, telefon veya e-posta yok; her şey geri alınır.
-- Dönüş şekilleri ve istemcinin dayandığı hata kodları değişirse bu test düşer.
begin;
select set_config('nakgo.c_a',gen_random_uuid()::text,true);
select set_config('nakgo.c_b',gen_random_uuid()::text,true);
insert into auth.users(id,email_confirmed_at) values(current_setting('nakgo.c_a')::uuid,now()),(current_setting('nakgo.c_b')::uuid,now());

-- anon: hiçbir tabloya doğrudan erişemez, yalnız herkese açık ilan listesini çağırabilir.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare t text; f text;
begin
 foreach t in array array['profiles','listings','listing_favorites','route_alerts'] loop
  begin execute 'select 1 from public.'||t||' limit 1'; raise exception 'FAIL anon reads %',t;
  exception when insufficient_privilege then null; end;
 end loop;
 foreach f in array array['nakgo_listing_contact(1)','nakgo_set_favorite(1,true)','nakgo_route_alerts_seen()','nakgo_remove_route_alert(1)',
   'nakgo_delete_my_account()','nakgo_admin_role()','nakgo_admin_page(''users'')','nakgo_admin_live()',
   'nakgo_save_route_alert(''load'',''Ankara'',null,null,null)','nakgo_set_route_alert(1,true)','nakgo_admin_moderate(''user'',''x'',''ban'',''Test sebep'',0)'] loop
  begin execute 'select public.'||f; raise exception 'FAIL anon executes %',f;
  exception when insufficient_privilege then null; end;
 end loop;
 perform * from public.nakgo_public_listings();
 perform * from public.nakgo_public_listings(null);
end $$;
reset role;

-- Kullanıcı A: ilan, istemcinin okuduğu kolonlarla oluşur; iletişim telefonu tablodan okunamaz.
select set_config('request.jwt.claim.sub',current_setting('nakgo.c_a'),true);
set local role authenticated;
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.c_a')::uuid,'Sözleşme A','owner');
insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent)
 values('load','İstanbul','Ankara','Tır','Tenteli',10,'Test yük','Sözleşme A','bugün','+905000000000',true)
 returning set_config('nakgo.c_listing',id::text,true);
do $$
declare j jsonb; n int;
begin
 select to_jsonb(l) into j from (select id,owner_id,kind,from_city,to_city,from_district,to_district,expires_at,vehicle,body,amount,cargo,note,
  owner_label,available_on,available_until,available_time,loading_text,items,image_data,status,created_at,updated_at,contact_consent
  from public.listings where id=current_setting('nakgo.c_listing')::bigint) l;
 if j is null then raise exception 'FAIL owner cannot read listing columns'; end if;
 begin perform contact_phone from public.listings limit 1; raise exception 'FAIL contact_phone readable';
 exception when insufficient_privilege then null; end;
 begin insert into public.profiles(id,display_name) values(current_setting('nakgo.c_a')::uuid,'Tekrar');
  raise exception 'FAIL duplicate profile accepted';
 exception when unique_violation then null; end;
 if public.nakgo_admin_role() is distinct from false then raise exception 'FAIL admin_role shape'; end if;
 begin perform public.nakgo_admin_page('users'); raise exception 'FAIL non-admin admin_page';
 exception when insufficient_privilege then null; end;
 -- Rota alarmı: dönüş satırı istemcinin okuduğu kolonları taşır.
 select to_jsonb(r) into j from public.nakgo_save_route_alert('load','Ankara',null,null,null) r;
 if not j ?& array['id','kind','from_city','to_city','vehicle','body','active','seen_at','created_at'] then raise exception 'FAIL save_route_alert shape %',j; end if;
 perform set_config('nakgo.c_alert',j->>'id',true);
 select to_jsonb(r) into j from public.nakgo_set_route_alert((current_setting('nakgo.c_alert'))::bigint,false) r;
 if (j->>'active')::boolean is distinct from false then raise exception 'FAIL set_route_alert shape %',j; end if;
 select public.nakgo_route_alerts_seen() into n;
 if n is null then raise exception 'FAIL route_alerts_seen returns null'; end if;
 j:=public.nakgo_remove_route_alert((current_setting('nakgo.c_alert'))::bigint);
 if (select array_agg(k order by k) from jsonb_object_keys(j) k)<>array['id','removed'] or j->>'removed'<>'true' then raise exception 'FAIL remove_route_alert shape %',j; end if;
 begin perform public.nakgo_remove_route_alert((current_setting('nakgo.c_alert'))::bigint); raise exception 'FAIL removed alert removed twice';
 exception when insufficient_privilege then null; end;
 if public.nakgo_listing_contact(current_setting('nakgo.c_listing')::bigint)<>'+905000000000' then raise exception 'FAIL owner contact'; end if;
end $$;
reset role;

-- Kullanıcı B: favori ve iletişim çağrılarının şekli ve hata kodları.
select set_config('request.jwt.claim.sub',current_setting('nakgo.c_b'),true);
set local role authenticated;
insert into public.profiles(id,display_name,account_type) values(current_setting('nakgo.c_b')::uuid,'Sözleşme B','carrier');
do $$
declare j jsonb; p text;
begin
 j:=public.nakgo_set_favorite(current_setting('nakgo.c_listing')::bigint,true);
 if (select array_agg(k order by k) from jsonb_object_keys(j) k)<>array['listing_id','saved'] or (j->>'saved')::boolean is not true
  or (j->>'listing_id')::bigint<>current_setting('nakgo.c_listing')::bigint then raise exception 'FAIL set_favorite shape %',j; end if;
 if not exists(select 1 from public.listing_favorites f join public.listings l on l.id=f.listing_id
   where f.listing_id=current_setting('nakgo.c_listing')::bigint) then raise exception 'FAIL favorite embed read'; end if;
 begin perform public.nakgo_set_favorite(null,true); raise exception 'FAIL null favorite accepted';
 exception when sqlstate '22023' then null; end;
 begin insert into public.listing_favorites(user_id,listing_id) values(current_setting('nakgo.c_b')::uuid,current_setting('nakgo.c_listing')::bigint);
  raise exception 'FAIL direct favorite insert';
 exception when insufficient_privilege then null; end;
 p:=public.nakgo_listing_contact(current_setting('nakgo.c_listing')::bigint,'call');
 if p<>'+905000000000' then raise exception 'FAIL contact shape %',p; end if;
 p:=public.nakgo_listing_contact(current_setting('nakgo.c_listing')::bigint);
 if p<>'+905000000000' then raise exception 'FAIL contact without channel %',p; end if;
 begin perform public.nakgo_listing_contact(-1); raise exception 'FAIL missing listing contact';
 exception when insufficient_privilege then null; end;
 j:=public.nakgo_delete_my_account();
 if j<>'{"deleted":true}'::jsonb then raise exception 'FAIL delete_my_account shape %',j; end if;
end $$;
reset role;

-- İstemci hesap silme hatasında mesaj metnine bakar (src/js/features/account.js): metinler sözleşmenin parçasıdır.
insert into private.admin_members(user_id,active,owner) values(current_setting('nakgo.c_a')::uuid,true,true);
update private.admin_members set active=false where user_id<>current_setting('nakgo.c_a')::uuid;
select set_config('request.jwt.claim.sub',current_setting('nakgo.c_a'),true);
set local role authenticated;
do $$ begin
 begin perform public.nakgo_delete_my_account(); raise exception 'FAIL owner deleted';
 exception when insufficient_privilege then if sqlerrm not like '%Owner account%' then raise exception 'FAIL owner message: %',sqlerrm; end if; end;
end $$;
reset role;
update private.admin_members set owner=false where user_id=current_setting('nakgo.c_a')::uuid;
set local role authenticated;
do $$ begin
 begin perform public.nakgo_delete_my_account(); raise exception 'FAIL last admin deleted';
 exception when insufficient_privilege then if sqlerrm not like '%Last administrator%' then raise exception 'FAIL last admin message: %',sqlerrm; end if; end;
end $$;
reset role;
rollback;

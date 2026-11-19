-- Askıdaki sahibin ilanı (gerçek akış: ilan yayında, yönetici hesabı askıya alır) v0 ve v1'in bütün üye/misafir okuma
-- yollarında diğer kişilere görünmez ve favoriye eklenemez. Sahip kendi ilanını görür; kayıtlı favori kaldırılabilir;
-- askı kalkınca ilan yeniden görünür. Normal ilanlar etkilenmez. Sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1);
 seller uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
 t0 timestamptz:=statement_timestamp(); u uuid; l_s bigint; l_o bigint; n bigint; res jsonb; failed text; rev bigint;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 update private.api_settings set v1_enabled=true where id=1;
 insert into auth.users(id,email_confirmed_at,email) values(seller,t0,'so-seller@example.test'),(other,t0,'so-other@example.test'),
  (member,t0,'so-member@example.test');
 foreach u in array array[seller,other,member] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.profiles(id,display_name,account_type) values(u,'Askı Deneme','owner');
 end loop;
 perform set_config('request.jwt.claim.sub',seller::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Askı Deneme','bugün','+905551112233',true) returning id into l_s;
 reset role;
 perform set_config('request.jwt.claim.sub',other::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Askı Deneme','bugün') returning id into l_o;
 reset role;
 -- Askıdan önce kaydedilmiş favori.
 perform set_config('request.jwt.claim.sub',member::text,true);
 set local role authenticated;
 perform public.nakgo_set_favorite(l_s,true);
 reset role;

 -- Yönetici hesabı askıya alır (ilan yayında kalır: askı ilanları kapatmaz).
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',seller::text,'suspend','Deneme askı',0);
 if (select status from public.listings where id=l_s)<>'active' then raise exception 'FAIL setup: suspension closed the listing'; end if;

 -- 1) v0 üye okuması (RLS): liste, ayrıntı ve favori ilişkisi askıdaki sahibin ilanını göstermez; normal ilan görünür.
 perform set_config('request.jwt.claim.sub',member::text,true);
 set local role authenticated;
 if exists(select 1 from public.listings where status='active' and id=l_s) then raise exception 'FAIL v0 list shows suspended owner'; end if;
 if exists(select 1 from public.listings where id=l_s) then raise exception 'FAIL v0 detail shows suspended owner'; end if;
 if not exists(select 1 from public.listings where status='active' and id=l_o) then raise exception 'FAIL normal listing hidden'; end if;
 if exists(select 1 from public.listing_favorites f join public.listings l on l.id=f.listing_id where f.listing_id=l_s) then
  raise exception 'FAIL favorite join shows suspended owner'; end if;
 if not exists(select 1 from public.listing_favorites where listing_id=l_s) then raise exception 'FAIL saved favorite row lost'; end if;
 -- 2) v0 favori ekleme reddedilir; normal ilana ekleme ve kayıtlı favoriyi kaldırma çalışır.
 failed:=null;
 begin perform public.nakgo_set_favorite(l_s,true); exception when insufficient_privilege then failed:=sqlerrm; end;
 if failed is distinct from 'Listing unavailable' then raise exception 'FAIL v0 favorite add on suspended owner: %',failed; end if;
 perform public.nakgo_set_favorite(l_o,true);
 perform public.nakgo_set_favorite(l_s,false);
 if exists(select 1 from public.listing_favorites where listing_id=l_s) or not exists(select 1 from public.listing_favorites where listing_id=l_o) then
  raise exception 'FAIL favorite add/remove'; end if;
 -- 3) v1 aynı kuralı uygular (karşılaştırma): akış ve ayrıntı.
 res:=api.listings_v1();
 if res->'data' @> jsonb_build_array(jsonb_build_object('id',l_s)) or not res->'data' @> jsonb_build_array(jsonb_build_object('id',l_o)) then
  raise exception 'FAIL v1 feed'; end if;
 failed:=null;
 begin perform api.listing_v1(l_s); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'not_found' then raise exception 'FAIL v1 detail: %',failed; end if;
 reset role;
 -- 4) Misafir akışı (v0 RPC) aynı.
 set local role anon;
 perform set_config('request.jwt.claim.sub','',true);
 if exists(select 1 from public.nakgo_public_listings(null) p where p.id=l_s) or not exists(select 1 from public.nakgo_public_listings(null) p where p.id=l_o) then
  raise exception 'FAIL guest feed'; end if;
 reset role;
 -- 5) Sahip kendi ilanını görmeye devam eder (sahip yetkisi bozulmadı).
 perform set_config('request.jwt.claim.sub',seller::text,true);
 set local role authenticated;
 if not exists(select 1 from public.listings where id=l_s) then raise exception 'FAIL suspended owner lost own listing'; end if;
 reset role;

 -- 6) Askı kalkınca ilan yeniden görünür ve favoriye eklenebilir.
 rev:=(select revision from private.account_moderation where user_id=seller);
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',seller::text,'resume','Deneme askı kaldır',rev);
 perform set_config('request.jwt.claim.sub',member::text,true);
 set local role authenticated;
 if not exists(select 1 from public.listings where status='active' and id=l_s) then raise exception 'FAIL resumed listing hidden'; end if;
 perform public.nakgo_set_favorite(l_s,true);
 reset role;
 if not exists(select 1 from public.listing_favorites where user_id=member and listing_id=l_s) then raise exception 'FAIL resumed favorite'; end if;

 -- 7) Yetki yalnız üyeye: misafir fonksiyonu çalıştıramaz.
 if has_function_privilege('anon','private.account_suspended(uuid)','EXECUTE') then raise exception 'FAIL anon can execute account_suspended'; end if;
end $$;
rollback;
select 'PASS: suspended owner listings hidden from v0 RLS, v0 favorites, v1 and guest feed; owner and normal listings unaffected; all changes rolled back' as result;

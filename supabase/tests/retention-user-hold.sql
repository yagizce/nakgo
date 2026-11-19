-- Gece temizliği ve kullanıcı kapsamlı yasal koruma: korunan kişinin eski moderasyon kaydı (account_moderation) ve
-- güvenlik olayları (security_events) silinmez; koruması olmayan ya da kaldırılmış kişininkiler eski kurallarla silinir.
-- İlan kapsamlı korumanın anlamı değişmez. Sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare boss uuid:=(select user_id from private.admin_members where active limit 1);
 held uuid:=gen_random_uuid(); free uuid:=gen_random_uuid(); released uuid:=gen_random_uuid(); lister uuid:=gen_random_uuid();
 t0 timestamptz:=statement_timestamp(); u uuid; h_held bigint; h_released bigint; l_lister bigint; res jsonb; x record;
 aal2 text:='{"aal":"aal2"}';
begin
 if boss is null then raise exception 'One administrator required'; end if;
 update private.admin_members set owner=true where user_id=boss;
 insert into auth.users(id,email_confirmed_at,email) values(held,t0,'uh-held@example.test'),(free,t0,'uh-free@example.test'),
  (released,t0,'uh-released@example.test'),(lister,t0,'uh-lister@example.test');
 foreach u in array array[held,free,released,lister] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.profiles(id,display_name,account_type) values(u,'Koruma Deneme','owner');
  -- Kaldırılmış eski bir yasaklamanın izi: askıda değil, silinmemiş, 400 gündür değişmemiş.
  insert into private.account_moderation(user_id,suspended,banned,revision,reason,updated_at)
   values(u,false,false,3,'Eski yasaklama kaldırıldı',t0-interval '400 days');
  insert into private.security_events(at,user_id,kind,hour) values(t0-interval '400 days',u,'contact_limit_day',date_trunc('hour',t0-interval '400 days'));
 end loop;
 insert into private.security_events(at,user_id,kind,hour) values(t0-interval '1 day',held,'contact_limit_hour',date_trunc('hour',t0-interval '1 day'));
 perform set_config('request.jwt.claim.sub',lister::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','Bursa','Bilecik','Tır','Tenteli',1,'Yük','Koruma Deneme','bugün') returning id into l_lister;
 reset role;

 -- Korumalar gerçek yoldan: ana yönetici, AAL2. held ve released kullanıcı kapsamlı; lister yalnız ilan kapsamlı.
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 perform public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','user',held::text,'reason','Uyuşmazlık'));
 perform public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','user',released::text,'reason','Eski uyuşmazlık'));
 perform public.nakgo_admin_moderate('listing',l_lister::text,'hold','Savcılık talebi',0);
 reset role;
 select id into h_held from private.legal_holds where user_id=held and released_at is null;
 select id into h_released from private.legal_holds where user_id=released and released_at is null;
 if h_held is null or h_released is null then raise exception 'FAIL setup: user holds missing'; end if;
 set local role authenticated;
 perform public.nakgo_legal_action('release_hold',jsonb_build_object('hold',h_released::text,'reason','Uyuşmazlık bitti'));
 reset role;

 -- 1) Gece temizliği: korunan kişinin moderasyon kaydı olduğu gibi kalır; diğerleri silinir.
 res:=private.retention_run();
 if res ? 'skipped' then raise exception 'FAIL retention skipped'; end if;
 select reason,revision,updated_at into x from private.account_moderation where user_id=held;
 if not found or x.reason<>'Eski yasaklama kaldırıldı' or x.revision<>3 or x.updated_at<>t0-interval '400 days' then
  raise exception 'FAIL held moderation history lost or changed'; end if;
 if exists(select 1 from private.account_moderation where user_id in(free,released)) then
  raise exception 'FAIL unprotected moderation rows kept'; end if;
 -- İlan kapsamlı koruma bu migration ile genişlemedi: ilan sahibinin hesap kaydı eski kuralla silinir.
 if exists(select 1 from private.account_moderation where user_id=lister) then raise exception 'FAIL listing hold scope changed'; end if;
 if (res->>'account_moderation_deleted')::int<3 then raise exception 'FAIL count %',res; end if;

 -- 2) Saatlik temizlik: korunan kişinin eski güvenlik olayı kalır; diğerlerinin 1 yıldan eskisi silinir; yenisi kalır.
 res:=private.contact_retention();
 if not exists(select 1 from private.security_events where user_id=held and at<t0-interval '1 year') then
  raise exception 'FAIL held security event deleted'; end if;
 if exists(select 1 from private.security_events where user_id in(free,released,lister) and at<t0-interval '1 year') then
  raise exception 'FAIL unprotected security events kept'; end if;
 if not exists(select 1 from private.security_events where user_id=held and at>t0-interval '2 days') then raise exception 'FAIL recent event deleted'; end if;
 if (res->>'security_events_deleted')::int<3 then raise exception 'FAIL count %',res; end if;

 -- 3) Koruma kalkınca kayıtlar bir sonraki çalışmada eski kurallarla silinir (yeni saklama süresi yok).
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 perform public.nakgo_legal_action('release_hold',jsonb_build_object('hold',h_held::text,'reason','Uyuşmazlık bitti'));
 reset role;
 res:=private.retention_run();
 res:=private.contact_retention();
 if exists(select 1 from private.account_moderation where user_id=held) or exists(select 1 from private.security_events where user_id=held and at<t0-interval '1 year') then
  raise exception 'FAIL released hold still retains records'; end if;
 if not exists(select 1 from private.security_events where user_id=held) then raise exception 'FAIL recent event deleted after release'; end if;

 -- 4) Yasal kayıtlar ve korumaların kendisi temizlikten etkilenmez.
 if (select count(*) from private.legal_holds where user_id in(held,released))<>2 then raise exception 'FAIL legal holds lost'; end if;
end $$;
rollback;
select 'PASS: user legal hold keeps account_moderation and security_events through retention; release restores normal cleanup; all changes rolled back' as result;

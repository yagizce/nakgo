-- Yasal saklamadaki ilan doğrudan silmeyle (Supabase Auth'tan hesap silme, zincirleme silme ya da doğrudan DELETE)
-- kaybolmaz; saklaması olmayan ilan ve hesap eskisi gibi silinir. Sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1);
 normal uuid:=gen_random_uuid(); panel uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid(); drift uuid:=gen_random_uuid();
 t0 timestamptz:=statement_timestamp(); lid bigint; u uuid;
 l_normal bigint; l_panel bigint; l_legacy bigint; l_drift bigint; rid bigint; res jsonb; failed boolean;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 update private.admin_members set owner=true where user_id=admin;
 insert into auth.users(id,email_confirmed_at,email) values(normal,t0,'sg-normal@example.test'),(panel,t0,'sg-panel@example.test'),
  (legacy,t0,'sg-legacy@example.test'),(drift,t0,'sg-drift@example.test');
 foreach u in array array[normal,panel,legacy,drift] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.profiles(id,display_name,account_type) values(u,'Silme Koruma','owner');
  set local role authenticated;
  insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,contact_phone,contact_consent)
   values('load','İzmir','Manisa','Tır','Tenteli',1,'Delil yük','Silme Koruma','bugün','Delil not','+905551112233',true) returning id into lid;
  reset role;
  if u=normal then l_normal:=lid; elsif u=panel then l_panel:=lid; elsif u=legacy then l_legacy:=lid; else l_drift:=lid; end if;
 end loop;

 -- Saklamalar gerçek yoldan: ana yönetici, AAL2, panel işlemi (yasal kayıt + koruma + işaret).
 perform set_config('request.jwt.claim.sub',admin::text,true); perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
 set local role authenticated;
 perform public.nakgo_admin_moderate('listing',l_panel::text,'hold','Savcılık talebi',0);
 perform public.nakgo_admin_moderate('listing',l_drift::text,'hold','Uyuşmazlık',0);
 reset role;
 select id into rid from private.legal_records where listing_id=l_panel;
 if rid is null then raise exception 'FAIL setup: panel hold has no legal record'; end if;
 -- Eski işaret: yasal kaydı olmayan listing_moderation.hold (#125 öncesi saklama).
 insert into private.listing_moderation(listing_id,hold,hold_reason) values(l_legacy,true,'Eski saklama');
 -- İşaret kayması: yasal arşivde aktif koruma var, listing_moderation.hold elle false yapılmış.
 update private.listing_moderation set hold=false where listing_id=l_drift;

 -- 1) Normal hesap: Auth'tan silinince ilanı ve profili zincirleme silinir (davranış değişmedi).
 delete from auth.users where id=normal;
 if exists(select 1 from public.listings where id=l_normal) or exists(select 1 from public.profiles where id=normal) then
  raise exception 'FAIL normal account cascade'; end if;

 -- 2) Panelden saklama: Auth silmesi 55000 ile durur; hesap, ilan içeriği, işaret ve yasal kayıt yerinde.
 failed:=false;
 begin delete from auth.users where id=panel; exception when object_not_in_prerequisite_state then failed:=true; end;
 if not failed then raise exception 'FAIL auth delete removed a held listing'; end if;
 if not exists(select 1 from auth.users where id=panel) or not exists(select 1 from public.profiles where id=panel) then
  raise exception 'FAIL blocked auth delete left a partial deletion'; end if;
 if (select note from public.listings where id=l_panel) is distinct from 'Delil not'
  or not (select hold from private.listing_moderation where listing_id=l_panel)
  or not exists(select 1 from private.legal_holds where listing_id=l_panel and released_at is null)
  or not exists(select 1 from private.legal_records where id=rid) then raise exception 'FAIL held listing or legal record lost'; end if;

 -- 3) Eski işaretli saklama da korunur (Auth silmesi ve doğrudan DELETE).
 failed:=false;
 begin delete from auth.users where id=legacy; exception when object_not_in_prerequisite_state then failed:=true; end;
 if not failed or not exists(select 1 from public.listings where id=l_legacy) then raise exception 'FAIL legacy hold auth delete'; end if;
 failed:=false;
 begin delete from public.listings where id=l_legacy; exception when object_not_in_prerequisite_state then failed:=true; end;
 if not failed or not exists(select 1 from public.listings where id=l_legacy) then raise exception 'FAIL legacy hold direct delete'; end if;

 -- 4) İşaret kaymış olsa da yasal arşivdeki aktif koruma silmeyi durdurur.
 failed:=false;
 begin delete from public.listings where id=l_drift; exception when object_not_in_prerequisite_state then failed:=true; end;
 if not failed or not exists(select 1 from public.listings where id=l_drift) then raise exception 'FAIL legal_holds without flag'; end if;
 failed:=false;
 begin delete from auth.users where id=drift; exception when object_not_in_prerequisite_state then failed:=true; end;
 if not failed or not exists(select 1 from auth.users where id=drift) then raise exception 'FAIL drift auth delete'; end if;

 -- 5) Gece temizliği: 1 yıldan eski silinmiş hesap saklamada olduğu için kalıcı silinmez; temizlik hata vermeden biter.
 insert into private.account_moderation(user_id,deleted_at) values(panel,t0-interval '400 days')
  on conflict(user_id) do update set deleted_at=excluded.deleted_at;
 res:=private.retention_run();
 if res ? 'skipped' or not exists(select 1 from auth.users where id=panel) or not exists(select 1 from public.listings where id=l_panel) then
  raise exception 'FAIL retention purged a held account %',res; end if;

 -- 6) Saklama kalkınca normal kurallar geri gelir: hesap silinir, ilan gider, yasal kayıt (ID ile bağlı) kalır.
 lid:=(select revision from private.listing_moderation where listing_id=l_panel);
 perform set_config('request.jwt.claim.sub',admin::text,true); perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
 set local role authenticated;
 perform public.nakgo_admin_moderate('listing',l_panel::text,'release','Talep kapandı',lid);
 reset role;
 res:=private.retention_run();
 if exists(select 1 from auth.users where id=panel) or exists(select 1 from public.listings where id=l_panel) then
  raise exception 'FAIL released account not purged %',res; end if;
 if not exists(select 1 from private.legal_records where id=rid) or not exists(select 1 from private.legal_holds where record_id=rid) then
  raise exception 'FAIL legal record lost after normal purge'; end if;
 -- Eski işaret kaldırılınca doğrudan silme de çalışır.
 update private.listing_moderation set hold=false where listing_id=l_legacy;
 delete from auth.users where id=legacy;
 if exists(select 1 from public.listings where id=l_legacy) then raise exception 'FAIL released legacy listing not deleted'; end if;

 -- 7) İstemci tetikleyici fonksiyonunu çağıramaz.
 if has_function_privilege('authenticated','private.listing_legal_hold_guard()','EXECUTE')
  or has_function_privilege('anon','private.listing_legal_hold_guard()','EXECUTE') then raise exception 'FAIL guard executable by clients'; end if;
end $$;
rollback;
select 'PASS: legal hold blocks direct and cascading listing deletion; normal accounts still cascade; release restores normal cleanup; all changes rolled back' as result;

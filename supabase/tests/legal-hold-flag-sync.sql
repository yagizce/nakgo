-- İlan saklama işareti yasal korumadan türetilir: doğrudan SQL ile kayma kurulamaz; doğrudan eklenen koruma işareti açar,
-- son koruma kalkınca kapanır. Gece temizliği (karartma ve kalıcı silme, tek işlem ve parçalı) korunan ilana dokunmaz,
-- korumasız ilanları işlemeye devam eder. Saklama süreleri ve kapsamı değişmez. Sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare boss uuid:=(select user_id from private.admin_members where active limit 1);
 u1 uuid:=gen_random_uuid(); t0 timestamptz:=statement_timestamp(); aal2 text:='{"aal":"aal2"}';
 l_panel bigint; l_sql bigint; l_legacy bigint; l_two bigint; l_free_red bigint; l_free_del bigint; l_batch_red bigint; l_batch_del bigint;
 rid bigint; h1 bigint; h2 bigint; rev bigint; failed boolean; res jsonb; n integer;
begin
 if boss is null then raise exception 'One administrator required'; end if;
 update private.admin_members set owner=true where user_id=boss;
 insert into auth.users(id,email_confirmed_at,email) values(u1,t0,'fs-u1@example.test');
 perform set_config('request.jwt.claim.sub',u1::text,true);
 insert into public.profiles(id,display_name,account_type) values(u1,'İşaret Deneme','owner');
 -- Karartmaya uygun (20 gün önce kapanmış) ve kalıcı silmeye uygun (400 gün önce karartılmış) ilanlar.
 perform set_config('session_replication_role','replica',true);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Delil','İşaret Deneme','bugün','Delil not',u1,'closed',t0-interval '20 days',t0-interval '20 days') returning id into l_panel;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at,redacted_at)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Silindi','NakGo kullanıcısı','Silindi','',u1,'closed',t0-interval '500 days',t0-interval '500 days',t0-interval '400 days') returning id into l_sql;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Aydın','Tır','Tenteli',1,'Eski','İşaret Deneme','bugün','Eski not',u1,'closed',t0-interval '20 days',t0-interval '20 days') returning id into l_legacy;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Bursa','Tır','Tenteli',1,'İki','İşaret Deneme','bugün','İki koruma',u1,'closed',t0-interval '20 days',t0-interval '20 days') returning id into l_two;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Uşak','Tır','Tenteli',1,'Serbest','İşaret Deneme','bugün','Serbest not',u1,'closed',t0-interval '20 days',t0-interval '20 days') returning id into l_free_red;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at,redacted_at)
  values('load','İzmir','Uşak','Tır','Tenteli',1,'Silindi','NakGo kullanıcısı','Silindi','',u1,'closed',t0-interval '500 days',t0-interval '500 days',t0-interval '400 days') returning id into l_free_del;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','İzmir','Denizli','Tır','Tenteli',1,'Parti','İşaret Deneme','bugün','Parti not',u1,'closed',t0-interval '20 days',t0-interval '20 days') returning id into l_batch_red;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at,redacted_at)
  values('load','İzmir','Denizli','Tır','Tenteli',1,'Silindi','NakGo kullanıcısı','Silindi','',u1,'closed',t0-interval '500 days',t0-interval '500 days',t0-interval '400 days') returning id into l_batch_del;
 perform set_config('session_replication_role','origin',true);

 -- Korumalar: panelden (ana yönetici, AAL2) ve doğrudan SQL ile (eşitleme çağrısı olmadan).
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 perform public.nakgo_admin_moderate('listing',l_panel::text,'hold','Savcılık talebi',0);
 perform public.nakgo_admin_moderate('listing',l_batch_red::text,'hold','Uyuşmazlık',0);
 perform public.nakgo_admin_moderate('listing',l_batch_del::text,'hold','Uyuşmazlık',0);
 reset role;
 insert into private.legal_records(policy,listing_id,user_id,reason,opened_by,snapshot,snapshot_sha256)
  values('dispute',l_sql,u1,'Doğrudan kayıt',boss,'{}',encode(pg_catalog.sha256(convert_to('{}','UTF8')),'hex')) returning id into rid;
 insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by) values(rid,'listing',l_sql,'Doğrudan koruma',boss);
 insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by) values(rid,'listing',l_two,'Birinci',boss) returning id into h1;
 insert into private.legal_holds(record_id,scope,listing_id,reason,opened_by) values(rid,'listing',l_two,'İkinci',boss) returning id into h2;
 insert into private.listing_moderation(listing_id,hold,hold_reason) values(l_legacy,true,'Eski saklama');

 -- 1) Doğrudan eklenen koruma işareti açar.
 if not coalesce((select hold from private.listing_moderation where listing_id=l_sql),false)
  or not coalesce((select hold from private.listing_moderation where listing_id=l_two),false) then raise exception 'FAIL direct legal_holds insert did not set flag'; end if;

 -- 2) Doğrudan SQL ile kayma kurulamaz: işaret kapatma ve satır silme 55000.
 foreach rev in array array[l_panel,l_sql,l_two] loop
  failed:=false;
  begin update private.listing_moderation set hold=false where listing_id=rev; exception when object_not_in_prerequisite_state then failed:=true; end;
  if not failed then raise exception 'FAIL flag cleared under active hold (%)',rev; end if;
  failed:=false;
  begin delete from private.listing_moderation where listing_id=rev; exception when object_not_in_prerequisite_state then failed:=true; end;
  if not failed then raise exception 'FAIL moderation row deleted under active hold (%)',rev; end if;
 end loop;
 -- Gerekçe ve diğer alanlar değiştirilebilir (işaret açık kaldıkça).
 update private.listing_moderation set hold_reason='Yasal koruma altında' where listing_id=l_sql;
 -- Yasal kaydı olmayan eski işaret eskisi gibi kaldırılabilir; sonra geri konur.
 update private.listing_moderation set hold=false where listing_id=l_legacy;
 update private.listing_moderation set hold=true where listing_id=l_legacy;

 -- 3) Gece temizliği (tek işlem): korunan ilanlar ne karartılır ne silinir; korumasız ilanlar işlenir, temizlik durmaz.
 res:=private.retention_run();
 if res ? 'skipped' then raise exception 'FAIL retention skipped'; end if;
 if (select note from public.listings where id=l_panel) is distinct from 'Delil not' or (select redacted_at from public.listings where id=l_panel) is not null
  or (select note from public.listings where id=l_two) is distinct from 'İki koruma' or (select note from public.listings where id=l_legacy) is distinct from 'Eski not' then
  raise exception 'FAIL held listing redacted'; end if;
 if not exists(select 1 from public.listings where id=l_sql) then raise exception 'FAIL held redacted listing deleted'; end if;
 if (select redacted_at from public.listings where id=l_free_red) is null or exists(select 1 from public.listings where id=l_free_del) then
  raise exception 'FAIL unheld listings not processed %',res; end if;

 -- 4) Parçalı temizlik aynı: korunan ilanlar atlanır.
 n:=private.retention_batch('listings_redacted',1000);
 n:=private.retention_batch('listings_deleted',1000);
 if (select note from public.listings where id=l_batch_red) is distinct from 'Parti not' or not exists(select 1 from public.listings where id=l_batch_del) then
  raise exception 'FAIL batch touched held listings'; end if;

 -- 5) Serbest bırakma: tek koruma kalkınca işaret açık kalır; son koruma kalkınca kapanır (doğrudan SQL).
 update private.legal_holds set released_by=boss,released_at=t0,release_reason='Birinci bitti' where id=h1;
 if not (select hold from private.listing_moderation where listing_id=l_two) then raise exception 'FAIL flag cleared while another hold active'; end if;
 update private.legal_holds set released_by=boss,released_at=t0,release_reason='İkinci bitti' where id=h2;
 if (select hold from private.listing_moderation where listing_id=l_two) then raise exception 'FAIL flag kept after last release'; end if;
 update private.legal_holds set released_by=boss,released_at=t0,release_reason='Doğrudan bitti' where listing_id=l_sql and released_at is null;
 if (select hold from private.listing_moderation where listing_id=l_sql) then raise exception 'FAIL flag kept after direct release'; end if;
 -- Panelden serbest bırakma (revizyon denetimi bozulmaz).
 rev:=(select revision from private.listing_moderation where listing_id=l_panel);
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 res:=public.nakgo_admin_moderate('listing',l_panel::text,'release','Talep kapandı',rev);
 reset role;
 if (res->>'revision')::bigint<>rev+1 or (select hold from private.listing_moderation where listing_id=l_panel) then raise exception 'FAIL panel release %',res; end if;

 -- 6) Koruma kalkınca normal kurallar: karartma ve kalıcı silme yapılır; yasal kayıtlar kalır.
 res:=private.retention_run();
 if (select redacted_at from public.listings where id=l_panel) is null or (select redacted_at from public.listings where id=l_two) is null then
  raise exception 'FAIL released listing not redacted %',res; end if;
 if exists(select 1 from public.listings where id=l_sql) then raise exception 'FAIL released listing not deleted %',res; end if;
 if not exists(select 1 from private.legal_records where id=rid) then raise exception 'FAIL legal record lost'; end if;

 -- 7) İstemci yeni fonksiyonları çalıştıramaz.
 if has_function_privilege('authenticated','private.listing_hold_flag_guard()','EXECUTE') or has_function_privilege('anon','private.listing_hold_flag_guard()','EXECUTE')
  or has_function_privilege('authenticated','private.legal_hold_flag_sync()','EXECUTE') or has_function_privilege('anon','private.legal_hold_flag_sync()','EXECUTE') then
  raise exception 'FAIL new functions executable by clients'; end if;
end $$;
rollback;
select 'PASS: legal hold flag follows legal_holds; direct-SQL drift refused; retention redaction and deletion skip held listings and continue for others; release restores normal cleanup; all changes rolled back' as result;

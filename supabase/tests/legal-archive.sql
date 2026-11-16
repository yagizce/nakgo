-- Yasal kayıt ve delil arşivi: yetki (AAL2), denetim günlüğü, değişmezlik ve zincir, koruma, hesap silme,
-- imha ve tutanak, arama ve dışa aktarma. Yalnız sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare boss uuid:=(select user_id from private.admin_members where active limit 1);
 admin2 uuid:=gen_random_uuid(); u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); t0 timestamptz:=statement_timestamp();
 l_held bigint; l_free bigint; l_u2 bigint; l_legacy bigint; rid bigint; rid2 bigint; rid3 bigint; hid bigint; n bigint; res jsonb; x record; logs_before bigint;
 aal2 text:='{"aal":"aal2"}'; aal1 text:='{"aal":"aal1"}';
begin
 if boss is null then raise exception 'One administrator required'; end if;
 update private.admin_members set owner=true where user_id=boss;
 insert into auth.users(id,email_confirmed_at,email) values(admin2,t0,'yasal-a2@example.test'),(u1,t0,'yasal-u1@example.test'),(u2,t0,'yasal-u2@example.test');
 insert into private.admin_members(user_id,active) values(admin2,true);
 perform set_config('request.jwt.claim.sub',u1::text,true);
 insert into public.profiles(id,display_name,account_type,phone) values(u1,'Yasal Deneme','owner','05551112233');
 perform set_config('request.jwt.claim.sub',u2::text,true);
 insert into public.profiles(id,display_name,account_type) values(u2,'Yasal İki','owner');
 perform set_config('request.jwt.claim.sub',admin2::text,true);
 insert into public.profiles(id,display_name,account_type) values(admin2,'Yönetici İki','owner');
 perform set_config('request.jwt.claim.sub',u1::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,contact_phone,contact_consent)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Delil yük','Yasal Deneme','bugün','Delil not','+905551112233',true) returning id into l_held;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note)
  values('load','İzmir','Manisa','Tır','Tenteli',1,'Sıradan','Yasal Deneme','bugün','Not') returning id into l_free;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note)
  values('load','İzmir','Aydın','Tır','Tenteli',1,'Eski işaret','Yasal Deneme','bugün','Not') returning id into l_legacy;
 reset role;
 perform set_config('request.jwt.claim.sub',u2::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text)
  values('load','Bursa','Bilecik','Tır','Tenteli',1,'İkinci','Yasal İki','bugün') returning id into l_u2;
 reset role;
 insert into private.access_log(at,user_id,action,ip,listing_id) values(t0-interval '400 days',u1,'login','203.0.113.7',null),
  (t0-interval '400 days',u2,'login','203.0.113.8',null),(t0,u1,'listing_create','203.0.113.9',l_held);

 -- 1) Yetki: anonim, üye, normal yönetici (AAL2 olsa da), AAL1'li ana yönetici reddedilir; hiçbir veri dönmez.
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','',true);
 set local role anon;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL anon page'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',u1::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL member page'; exception when insufficient_privilege then null; end;
 begin perform public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','listing',l_held,'reason','Deneme')); raise exception 'FAIL member action'; exception when insufficient_privilege then null; end;
 begin perform count(*) from private.legal_records; raise exception 'FAIL member reads table'; exception when insufficient_privilege then null; end;
 begin perform count(*) from private.legal_access_log; raise exception 'FAIL member reads log'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',admin2::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL admin2 page'; exception when insufficient_privilege then null; end;
 begin perform public.nakgo_admin_moderate('listing',l_held::text,'hold','Normal yönetici',0); raise exception 'FAIL admin2 hold'; exception when insufficient_privilege then null; end;
 begin perform public.nakgo_legal_action('grant_legal',jsonb_build_object('user',admin2,'reason','Kendime')); raise exception 'FAIL self grant'; exception when insufficient_privilege then null; end;
 begin update private.admin_members set legal_access=true where user_id=admin2; raise exception 'FAIL direct grant'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal1,true);
 set local role authenticated;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL aal1 page'; exception when insufficient_privilege then null; end;
 begin perform public.nakgo_admin_moderate('listing',l_held::text,'hold','Kodsuz',0); raise exception 'FAIL aal1 hold'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claims','',true);
 set local role authenticated;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL claimless page'; exception when insufficient_privilege then null; end;
 reset role;
 if exists(select 1 from private.legal_access_log) or exists(select 1 from private.legal_records) then raise exception 'FAIL denied calls left rows'; end if;

 -- 2) Ana yönetici (AAL2): panel düğmesi yasal kayıt açar; işlem geçmişinde ve ilan işaretinde gerekçe yok.
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 res:=public.nakgo_admin_moderate('listing',l_held::text,'hold','Savcılık 2026/123 gizli gerekçe',0);
 reset role;
 select id into rid from private.legal_records where listing_id=l_held;
 if rid is null or (res->>'revision')::int<>1 then raise exception 'FAIL hold record %',res; end if;
 select * into x from private.legal_records where id=rid;
 if x.policy<>'unclassified' or x.user_id<>u1 or x.reason<>'Savcılık 2026/123 gizli gerekçe' or x.opened_by<>boss then raise exception 'FAIL record fields'; end if;
 if x.snapshot->'listing'->>'note'<>'Delil not' or x.snapshot ? 'contact' or x.snapshot::text like '%905551112233%' or x.snapshot::text like '%example.test%' or x.snapshot::text like '%203.0.113%' then
  raise exception 'FAIL default snapshot must exclude phone, e-mail and IP: %',x.snapshot; end if;
 if (select hold_reason from private.listing_moderation where listing_id=l_held)<>'Yasal koruma altında' then raise exception 'FAIL label only'; end if;
 if (select reason from private.admin_audit where target=l_held::text and action='hold')<>'Yasal kayıt #'||rid then raise exception 'FAIL audit reason leaked'; end if;
 perform set_config('request.jwt.claim.sub',admin2::text,true); perform set_config('request.jwt.claims',aal1,true);
 set local role authenticated;
 res:=public.nakgo_admin_page('archive',0,'','hold');
 res:=public.nakgo_admin_page('history',0,'','',jsonb_build_object('id',l_held::text));
 reset role;
 if res::text like '%gizli gerekçe%' then raise exception 'FAIL normal admin sees reason'; end if;

 -- 3) Kayıt açma: iletişim bilgisi yalnız dayanakla; açılan kayıt ve koruma günlüğe yazılır.
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 begin perform public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','listing',l_held,'reason','Uyuşmazlık','contacts',true)); raise exception 'FAIL contacts without basis'; exception when invalid_parameter_value then null; end;
 begin perform public.nakgo_legal_action('open',jsonb_build_object('policy','listing','listing',l_held,'reason','Uyuşmazlık')); raise exception 'FAIL non-legal policy'; exception when invalid_parameter_value then null; end;
 rid2:=(public.nakgo_legal_action('open',jsonb_build_object('policy','authority_request','listing',l_held,'reason','Mahkeme yazısı','request_no','2026/77',
  'contacts',true,'contact_basis','Mahkeme kararı iletişim bilgisini istiyor'))->>'record')::bigint;
 rid3:=(public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','user',u2,'reason','Kullanıcı uyuşmazlığı'))->>'record')::bigint;
 reset role;
 select snapshot into res from private.legal_records where id=rid2;
 if res->'contact'->>'phone'<>'+905551112233' or res->'contact'->>'email'<>'yasal-u1@example.test' or not (res->'contact'->'ips') ? '203.0.113.9' then raise exception 'FAIL contact snapshot %',res; end if;
 select snapshot into res from private.legal_records where id=rid3;
 if res->'account'->>'id'<>u2::text or res->'account'->'profile'->>'display_name'<>'Yasal İki' or res::text like '%example.test%' then raise exception 'FAIL user snapshot %',res; end if;
 if (select count(*) from private.legal_access_log where action='record_open')<>3 then raise exception 'FAIL open logged'; end if;

 -- 4) Arama ve görüntüleme: her çağrı tek günlük satırı bırakır; filtreler doğru satırları döndürür.
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 select count(*) into logs_before from private.legal_access_log;
 set local role authenticated;
 if jsonb_array_length(public.nakgo_legal_page('records'))<>3 then raise exception 'FAIL list'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('listing',l_held::text)))<>2 then raise exception 'FAIL listing filter'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('user',u2::text)))<>1 then raise exception 'FAIL user filter'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('policy','authority_request')))<>1 then raise exception 'FAIL policy filter'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('from',current_date::text,'to',current_date::text)))<>3 then raise exception 'FAIL date filter'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('to',(current_date-1)::text)))<>0 then raise exception 'FAIL date upper bound'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('hold','active')))<>3 then raise exception 'FAIL hold filter'; end if;
 if jsonb_array_length(public.nakgo_legal_page('records',0,jsonb_build_object('retention','pending')))<>3 then raise exception 'FAIL pending filter'; end if;
 res:=public.nakgo_legal_page('record',0,jsonb_build_object('record',rid::text));
 if not (res->'record'->>'snapshot_valid')::boolean or jsonb_array_length(res->'holds')<>1 then raise exception 'FAIL record detail %',res; end if;
 begin perform public.nakgo_legal_page('records',0,jsonb_build_object('user','x')); raise exception 'FAIL invalid filter'; exception when invalid_parameter_value then null; end;
 reset role;
 if (select count(*) from private.legal_access_log)<>logs_before+9 then raise exception 'FAIL each read logged once'; end if;
 if (select detail->'query'->>'user' from private.legal_access_log where action='search' order by id desc offset 5 limit 1)<>u2::text then raise exception 'FAIL search filter logged'; end if;

 -- 5) Dışa aktarma: yalnız izinli sütunlar; aktarma günlükte.
 set local role authenticated;
 begin perform public.nakgo_legal_action('export',jsonb_build_object('format','csv','records',jsonb_build_array(rid),'columns',jsonb_build_array('id','snapshot'))); raise exception 'FAIL snapshot export'; exception when invalid_parameter_value then null; end;
 res:=public.nakgo_legal_action('export',jsonb_build_object('format','csv','records',jsonb_build_array(rid,rid2),'columns',jsonb_build_array('id','policy','listing_id')));
 reset role;
 if jsonb_array_length(res)<>2 or res->0 ? 'reason' or (res->0->>'id')::bigint<>rid then raise exception 'FAIL export rows %',res; end if;
 if not exists(select 1 from private.legal_access_log where action='export' and detail->>'format'='csv' and detail->'records' @> to_jsonb(array[rid,rid2])) then raise exception 'FAIL export logged'; end if;

 -- 6) Değiştirilemezlik: veritabanı sahibi rolüyle bile tetikleyiciler değişikliği durdurur.
 begin update private.legal_access_log set detail='{}' where id=(select min(id) from private.legal_access_log); raise exception 'FAIL log update'; exception when insufficient_privilege then null; end;
 begin delete from private.legal_access_log; raise exception 'FAIL log delete'; exception when insufficient_privilege then null; end;
 begin truncate private.legal_access_log; raise exception 'FAIL log truncate'; exception when insufficient_privilege then null; end;
 begin update private.legal_records set reason='Değişti' where id=rid; raise exception 'FAIL record update'; exception when insufficient_privilege then null; end;
 begin update private.legal_records set snapshot='{}' where id=rid; raise exception 'FAIL snapshot update'; exception when insufficient_privilege then null; end;
 begin delete from private.legal_records where id=rid; raise exception 'FAIL record delete'; exception when insufficient_privilege then null; end;
 begin update private.legal_holds set reason='Değişti' where record_id=rid; raise exception 'FAIL hold update'; exception when insufficient_privilege then null; end;
 begin delete from private.legal_holds where record_id=rid; raise exception 'FAIL hold delete'; exception when insufficient_privilege then null; end;
 res:=private.legal_chain_check();
 if (res->'legal_access_log'->>'broken')::int<>0 or (res->'legal_access_log'->>'rows')::int<>(select count(*) from private.legal_access_log) then raise exception 'FAIL chain %',res; end if;
 -- Sınır: sahip tetikleyiciyi kapatırsa satırı değiştirebilir; zincir bunu yakalar.
 alter table private.legal_access_log disable trigger legal_access_log_append;
 update private.legal_access_log set detail='{"değişti":true}' where id=(select min(id)+1 from private.legal_access_log);
 alter table private.legal_access_log enable trigger legal_access_log_append;
 if (private.legal_chain_check()->'legal_access_log'->>'broken')::int<1 then raise exception 'FAIL chain did not detect tampering'; end if;

 -- 7) Hesap silme: korunan ilanın yasal kopyası kalır; özeti bozuksa ya da eski işaretin yasal kaydı yoksa silme durur.
 insert into private.listing_moderation(listing_id,hold,hold_reason) values(l_legacy,true,'Eski işaret');
 perform set_config('request.jwt.claim.sub',u1::text,true); perform set_config('request.jwt.claims','',true);
 begin set local role authenticated; perform public.nakgo_delete_my_account(); raise exception 'FAIL legacy hold erased'; exception when object_not_in_prerequisite_state then null; end;
 reset role;
 if (select display_name from public.profiles where id=u1)<>'Yasal Deneme' then raise exception 'FAIL partial erase'; end if;
 delete from private.listing_moderation where listing_id=l_legacy;
 alter table private.legal_records disable trigger legal_records_guard;
 update private.legal_records set snapshot=snapshot||'{"x":1}' where id=rid;
 begin set local role authenticated; perform public.nakgo_delete_my_account(); raise exception 'FAIL tampered snapshot erased'; exception when object_not_in_prerequisite_state then null; end;
 reset role;
 update private.legal_records set snapshot=snapshot-'x' where id=rid;
 alter table private.legal_records enable trigger legal_records_guard;
 if (select display_name from public.profiles where id=u1)<>'Yasal Deneme' then raise exception 'FAIL partial erase 2'; end if;
 set local role authenticated; perform public.nakgo_delete_my_account(); reset role;
 if (select note from public.listings where id=l_held)<>'Delil not' or (select note from public.listings where id=l_free)<>'' then raise exception 'FAIL erase scope'; end if;
 if (select count(*) from private.legal_records where user_id=u1)<>2 then raise exception 'FAIL records lost on erase'; end if;
 -- Hesap kalıntısı doğrudan silinse bile (zincirleme silme) yasal kayıt kalır.
 delete from auth.users where id=u1;
 if (select count(*) from private.legal_records where user_id=u1)<>2 or exists(select 1 from public.listings where id=l_held) then raise exception 'FAIL cascade reached legal archive'; end if;
 if (select snapshot->'listing'->>'note' from private.legal_records where id=rid)<>'Delil not' then raise exception 'FAIL snapshot after cascade'; end if;

 -- 8) Kullanıcı kapsamlı koruma: o kullanıcının eski erişim kaydı ve hesap kalıntısı kalır; diğerleri silinir.
 update private.account_moderation set deleted_at=t0-interval '400 days' where user_id=u2;
 if not found then insert into private.account_moderation(user_id,deleted_at) values(u2,t0-interval '400 days'); end if;
 res:=private.retention_run();
 if not exists(select 1 from private.access_log where user_id=u2 and at<t0-interval '1 year') then raise exception 'FAIL user hold access log'; end if;
 if not exists(select 1 from auth.users where id=u2) then raise exception 'FAIL user hold account'; end if;
 if (res->>'legal_destroyed')::int<>0 then raise exception 'FAIL open records destroyed'; end if;

 -- 9) Koruma kaldırma ve kapatma; onaysız politika imha yapmaz.
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 select id into hid from private.legal_holds where record_id=rid3;
 set local role authenticated;
 begin perform public.nakgo_legal_action('close',jsonb_build_object('record',rid3,'reason','Bitti')); raise exception 'FAIL close with hold'; exception when invalid_parameter_value then null; end;
 perform public.nakgo_legal_action('release_hold',jsonb_build_object('hold',hid,'reason','Uyuşmazlık bitti'));
 perform public.nakgo_legal_action('close',jsonb_build_object('record',rid3,'reason','Uyuşmazlık bitti'));
 begin perform public.nakgo_legal_action('destroy',jsonb_build_object('record',rid3)); raise exception 'FAIL destroy pending policy'; exception when invalid_parameter_value then null; end;
 reset role;
 -- Süre yazılmış ama onaylanmamış politika da imha yapmaz.
 update private.legal_policies set retain_days=30 where code='dispute';
 alter table private.legal_records disable trigger legal_records_guard;
 update private.legal_records set closed_at=t0-interval '400 days' where id=rid3;
 alter table private.legal_records enable trigger legal_records_guard;
 res:=private.retention_run();
 if (res->>'legal_destroyed')::int<>0 or (res->>'legal_policy_pending')::int<1 or not exists(select 1 from private.legal_records where id=rid3) then raise exception 'FAIL pending policy destroyed %',res; end if;
 if exists(select 1 from auth.users where id=u2) then raise exception 'FAIL released user hold still protects account'; end if;
 alter table private.legal_records disable trigger legal_records_guard;
 update private.legal_records set closed_at=t0 where id=rid3;
 alter table private.legal_records enable trigger legal_records_guard;

 -- 10) Politika onayı (yalnız ana yönetici) ve süre dolunca imha; tutanakta kişisel veri yok.
 update private.admin_members set legal_access=true where user_id=admin2;
 perform set_config('request.jwt.claim.sub',admin2::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 if jsonb_array_length(public.nakgo_legal_page('records'))<>3 then raise exception 'FAIL granted admin access'; end if;
 begin perform public.nakgo_legal_action('approve_policy',jsonb_build_object('policy','dispute','days','30','reason','Hukukçu görüşü')); raise exception 'FAIL non-boss approve'; exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',boss::text,true);
 set local role authenticated;
 begin perform public.nakgo_legal_action('approve_policy',jsonb_build_object('policy','listing','days','30','reason','Hukukçu')); raise exception 'FAIL approve fixed policy'; exception when invalid_parameter_value then null; end;
 perform public.nakgo_legal_action('approve_policy',jsonb_build_object('policy','dispute','days','30','reason','Hukukçu görüşü 2026-11'));
 perform public.nakgo_legal_action('revoke_legal',jsonb_build_object('user',admin2,'reason','Görev bitti'));
 reset role;
 perform set_config('request.jwt.claim.sub',admin2::text,true);
 set local role authenticated;
 begin perform public.nakgo_legal_page('records'); raise exception 'FAIL revoked admin'; exception when insufficient_privilege then null; end;
 reset role;
 res:=private.retention_run();
 if (res->>'legal_destroyed')::int<>0 then raise exception 'FAIL destroyed before expiry'; end if;
 alter table private.legal_records disable trigger legal_records_guard;
 update private.legal_records set closed_at=t0-interval '31 days',opened_at=t0-interval '40 days' where id=rid3;
 alter table private.legal_records enable trigger legal_records_guard;
 -- Süresi dolmuş ama yeniden korunan kayıt imha edilmez.
 insert into private.legal_holds(record_id,scope,user_id,reason,opened_by) values(rid3,'user',u2,'Yeni talep',boss) returning id into hid;
 res:=private.retention_run();
 if (res->>'legal_destroyed')::int<>0 then raise exception 'FAIL held record destroyed'; end if;
 update private.legal_holds set released_by=boss,released_at=now(),release_reason='Talep bitti' where id=hid;
 res:=private.retention_run();
 if (res->>'legal_destroyed')::int<>1 or exists(select 1 from private.legal_records where id=rid3) or exists(select 1 from private.legal_holds where record_id=rid3) then raise exception 'FAIL destruction %',res; end if;
 select to_jsonb(d) into res from private.legal_destructions d where record_no=rid3;
 if res is null or res->>'cause'<>'retention_expired' or res->>'actor' is not null or (res->>'holds_removed')::int<>2 or res->>'policy'<>'dispute' or (res->>'retain_days')::int<>30 then raise exception 'FAIL destruction row %',res; end if;
 if res::text like '%'||u2::text||'%' or res::text like '%uyuşmazlığı%' or res::text like '%Yasal İki%' then raise exception 'FAIL personal data in destruction %',res; end if;
 if (res->>'opened_month')<>to_char(date_trunc('month',(t0-interval '40 days') at time zone 'UTC'),'YYYY-MM-DD') then raise exception 'FAIL month precision %',res; end if;
 res:=private.legal_chain_check();
 if (res->'legal_destructions'->>'broken')::int<>0 or (res->'legal_destructions'->>'rows')::int<>1 then raise exception 'FAIL destruction chain %',res; end if;
 begin delete from private.legal_destructions; raise exception 'FAIL destruction delete'; exception when insufficient_privilege then null; end;
 -- Diğer kayıtlar açık ve korumalı: dokunulmadı.
 if (select count(*) from private.legal_records)<>2 then raise exception 'FAIL other records'; end if;

 -- 11) Panel düğmesiyle kaldırma: ilandaki bütün korumalar kalkar, kayıtlar kapanır, işaret iner, revizyon tutarlı.
 perform set_config('request.jwt.claim.sub',admin2::text,true); perform set_config('request.jwt.claims','',true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Bursa','Bilecik','Tır','Tenteli',1,'Dördüncü','Yönetici İki','bugün') returning id into n;
 reset role;
 perform set_config('request.jwt.claim.sub',boss::text,true); perform set_config('request.jwt.claims',aal2,true);
 set local role authenticated;
 perform public.nakgo_admin_moderate('listing',n::text,'hold','Panel saklama',0);
 rid:=(public.nakgo_legal_action('open',jsonb_build_object('policy','dispute','listing',n,'reason','İkinci dosya'))->>'record')::bigint;
 begin perform public.nakgo_admin_moderate('listing',n::text,'release','Bayat',0); raise exception 'FAIL stale release'; exception when serialization_failure then null; end;
 res:=public.nakgo_admin_moderate('listing',n::text,'release','Talepler bitti',1);
 reset role;
 if (res->>'revision')::int<>2 or (select hold from private.listing_moderation where listing_id=n) then raise exception 'FAIL panel release %',res; end if;
 if exists(select 1 from private.legal_holds where listing_id=n and released_at is null) or exists(select 1 from private.legal_records where listing_id=n and status='open') then raise exception 'FAIL holds or records left open'; end if;
 if (select count(*) from private.admin_audit where target=n::text and action in('hold','release') and reason like 'Yasal kayıt #%')<>2 then raise exception 'FAIL panel audit'; end if;
 res:=private.legal_chain_check();
 if (res->'legal_destructions'->>'broken')::int<>0 then raise exception 'FAIL chain end'; end if;
end $$;
rollback;
select 'PASS: legal archive authorization (AAL2), audit log, immutability and chain, holds, account erasure, destruction record, search and export; all changes rolled back' as result;

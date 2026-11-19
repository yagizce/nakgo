-- Askıdaki sahibin ilanı (listings.owner_suspended): bütün askı yollarında güvenilir eşitleme; v0/v1/misafir/favori/
-- iletişim/ayrıntı yollarında diğer üyelere görünmez; sahip görür; istemci sütunu okuyamaz, filtreleyemez, yazamaz;
-- eşitleme updated_at, revision, expires_at, status, erişim kaydı ve temizlik zamanlamasını değiştirmez; istemcinin diğer
-- güncellemeleri (yeniden yayınla dahil) eskisi gibi çalışır. Sentetik hesaplar; her şey geri alınır.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1);
 s uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 d uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); z uuid:=gen_random_uuid();
 t0 timestamptz:=statement_timestamp(); u uuid; lid bigint;
 l_act bigint; l_exp bigint; l_closed bigint; l_o bigint; l_o2 bigint; l_b bigint; l_d bigint; l_x bigint; l_z bigint; l_svc bigint;
 snap jsonb; logs bigint; res jsonb; failed text; r record; rev bigint;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 update private.api_settings set v1_enabled=true where id=1;
 insert into auth.users(id,email_confirmed_at,email) select v,t0,'sf-'||v::text||'@example.test' from unnest(array[s,o,m,b,d,x,z]) v;
 foreach u in array array[s,o,m,b,d,x,z] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.profiles(id,display_name,account_type) values(u,'Askı Deneme','owner');
  if u<>m then
   set local role authenticated;
   insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent)
    values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Askı Deneme','bugün','+905551112233',true) returning id into lid;
   reset role;
   if u=s then l_act:=lid; elsif u=o then l_o:=lid; elsif u=b then l_b:=lid; elsif u=d then l_d:=lid; elsif u=x then l_x:=lid; else l_z:=lid; end if;
  end if;
 end loop;
 if exists(select 1 from public.listings where id in(l_act,l_o) and owner_suspended) then raise exception 'FAIL setup: new listing flagged'; end if;
 -- S'nin süresi dolmuş aktif ilanı ve 10 gün önce kapanmış ilanı; O'nun süresi dolmuş aktif ilanı (yeniden yayın denemesi).
 perform set_config('session_replication_role','replica',true);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,status,expires_at,updated_at)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Askı','bugün',s,'active',t0-interval '2 days',t0-interval '2 days') returning id into l_exp;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,note,owner_id,status,expires_at,updated_at)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Askı','bugün','Kapalı not',s,'closed',t0+interval '1 day',t0-interval '10 days') returning id into l_closed;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,status,expires_at,updated_at)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Diğer','bugün',o,'active',t0-interval '1 hour',t0-interval '1 hour') returning id into l_o2;
 perform set_config('session_replication_role','origin',true);
 -- Askıdan önce kaydedilmiş favori.
 perform set_config('request.jwt.claim.sub',m::text,true);
 set local role authenticated; perform public.nakgo_set_favorite(l_act,true); reset role;

 select jsonb_agg(jsonb_build_array(id,updated_at,revision,expires_at,status) order by id) into snap from public.listings where owner_id=s;
 select count(*) into logs from private.access_log;

 -- 1) Yönetici askıya alır: S'nin bütün ilanları işaretlenir; satırların başka hiçbir alanı ve erişim kaydı değişmez.
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',s::text,'suspend','Deneme askı',0);
 if exists(select 1 from public.listings where owner_id=s and not owner_suspended) then raise exception 'FAIL suspend sync'; end if;
 if (select jsonb_agg(jsonb_build_array(id,updated_at,revision,expires_at,status) order by id) from public.listings where owner_id=s) is distinct from snap
  then raise exception 'FAIL sync changed updated_at/revision/expires_at/status'; end if;
 if (select count(*) from private.access_log)<>logs then raise exception 'FAIL sync wrote access log'; end if;
 if exists(select 1 from public.listings where owner_id<>s and owner_suspended) then raise exception 'FAIL other owners flagged'; end if;

 -- 2) Diğer üye: v0 liste, ayrıntı, favori ilişkisi, favori ekleme, telefon; v1 akış ve ayrıntı.
 perform set_config('request.jwt.claim.sub',m::text,true);
 set local role authenticated;
 if exists(select 1 from public.listings where status='active' and id=l_act) or exists(select 1 from public.listings where id=l_act) then
  raise exception 'FAIL v0 list/detail shows suspended owner'; end if;
 if not exists(select 1 from public.listings where status='active' and id=l_o) then raise exception 'FAIL normal listing hidden'; end if;
 if exists(select 1 from public.listing_favorites f join public.listings l on l.id=f.listing_id where f.listing_id=l_act) then raise exception 'FAIL favorite join'; end if;
 if not exists(select 1 from public.listing_favorites where listing_id=l_act) then raise exception 'FAIL saved favorite lost'; end if;
 failed:=null; begin perform public.nakgo_set_favorite(l_act,true); exception when insufficient_privilege then failed:=sqlerrm; end;
 if failed is distinct from 'Listing unavailable' then raise exception 'FAIL v0 favorite add: %',failed; end if;
 perform public.nakgo_set_favorite(l_o,true); perform public.nakgo_set_favorite(l_act,false);
 failed:=null; begin perform public.nakgo_listing_contact(l_act); exception when insufficient_privilege then failed:=sqlerrm; end;
 if failed is null then raise exception 'FAIL contact for suspended owner'; end if;
 res:=api.listings_v1();
 if res->'data' @> jsonb_build_array(jsonb_build_object('id',l_act)) or not res->'data' @> jsonb_build_array(jsonb_build_object('id',l_o)) then raise exception 'FAIL v1 feed'; end if;
 failed:=null; begin perform api.listing_v1(l_act); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'not_found' then raise exception 'FAIL v1 detail: %',failed; end if;
 -- 3) İstemci sütunu okuyamaz, filtreleyemez, yazamaz, yeni ilanda belirleyemez.
 failed:=null; begin perform owner_suspended from public.listings limit 1; exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL member reads owner_suspended'; end if;
 failed:=null; begin perform id from public.listings where not owner_suspended limit 1; exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL member filters owner_suspended'; end if;
 failed:=null;
 begin insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_suspended)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','X','bugün',false); exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL member sets owner_suspended on insert'; end if;
 reset role;
 perform set_config('request.jwt.claim.sub',o::text,true);
 set local role authenticated;
 failed:=null; begin update public.listings set owner_suspended=true where id=l_o; exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL owner writes owner_suspended'; end if;
 reset role;
 -- 4) Misafir akışı.
 set local role anon; perform set_config('request.jwt.claim.sub','',true);
 if exists(select 1 from public.nakgo_public_listings(null) p where p.id=l_act) or not exists(select 1 from public.nakgo_public_listings(null) p where p.id=l_o) then
  raise exception 'FAIL guest feed'; end if;
 reset role;
 -- 5) Sahip kendi ilanlarını görür ama sütunu okuyamaz; askıdayken yazamaz (koruma çalışıyor).
 perform set_config('request.jwt.claim.sub',s::text,true);
 set local role authenticated;
 if (select count(*) from public.listings where owner_id=s)<>3 then raise exception 'FAIL suspended owner lost own listings'; end if;
 failed:=null; begin perform owner_suspended from public.listings where owner_id=s; exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL owner reads owner_suspended'; end if;
 failed:=null; begin update public.listings set note='Yeni' where id=l_act; exception when insufficient_privilege then failed:='x'; end;
 if failed is null then raise exception 'FAIL suspended owner wrote listing'; end if;
 reset role;

 -- 6) Askı kalkar: işaret kapanır, satırlar yine değişmez, ilan görünür.
 perform set_config('request.jwt.claim.sub',admin::text,true);
 rev:=(select revision from private.account_moderation where user_id=s);
 perform public.nakgo_admin_moderate('user',s::text,'resume','Deneme askı kaldır',rev);
 if exists(select 1 from public.listings where owner_id=s and owner_suspended) then raise exception 'FAIL resume sync'; end if;
 if (select jsonb_agg(jsonb_build_array(id,updated_at,revision,expires_at,status) order by id) from public.listings where owner_id=s) is distinct from snap
  then raise exception 'FAIL resume changed rows'; end if;
 perform set_config('request.jwt.claim.sub',m::text,true);
 set local role authenticated;
 if not exists(select 1 from public.listings where id=l_act) then raise exception 'FAIL resumed listing hidden'; end if;
 perform public.nakgo_set_favorite(l_act,true);
 reset role;

 -- 7) Gece temizliği zamanlaması: askı/kaldırma updated_at'i değiştirmediği için 10 gün önce kapanan ilan bugün karartılır,
 -- süresi 2 gün önce dolan ilan karartılmaz (8 gün kuralı).
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('user',s::text,'suspend','Yeniden askı',rev+1);
 res:=private.retention_run();
 if (select redacted_at from public.listings where id=l_closed) is null or (select redacted_at from public.listings where id=l_exp) is not null then
  raise exception 'FAIL retention timing %',res; end if;
 if exists(select 1 from public.listings where owner_id=s and not owner_suspended) then raise exception 'FAIL retention cleared flag'; end if;

 -- 8) Yasaklama ve kaldırma; askı + yasak + kaldırma (önceki askı geri gelir); yönetici ve kullanıcı hesap silmesi.
 perform public.nakgo_admin_moderate('user',b::text,'ban','Deneme ban',0);
 if not (select owner_suspended from public.listings where id=l_b) then raise exception 'FAIL ban sync'; end if;
 perform public.nakgo_admin_moderate('user',b::text,'unban','Deneme ban kaldır',1);
 if (select owner_suspended from public.listings where id=l_b) then raise exception 'FAIL unban sync'; end if;
 perform public.nakgo_admin_moderate('user',b::text,'suspend','Askı',2);
 perform public.nakgo_admin_moderate('user',b::text,'ban','Ban',3);
 perform public.nakgo_admin_moderate('user',b::text,'unban','Ban kaldır',4);
 if not (select owner_suspended from public.listings where id=l_b) then raise exception 'FAIL unban restores suspension'; end if;
 perform public.nakgo_admin_moderate('user',d::text,'delete','Deneme silme',0);
 if not (select owner_suspended from public.listings where id=l_d) then raise exception 'FAIL admin delete sync'; end if;
 -- Kota sınırında (10 yayında ilan) süresi dolmuş aktif ilanı olan kullanıcı hesabını silebilir: eşitleme kota
 -- denetimine takılmaz.
 perform set_config('session_replication_role','replica',true);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,status,expires_at)
  select 'load','Adana','Mersin','Tır','Tenteli',1,'Yük','Kota','bugün',x,'active',t0+interval '3 hours' from generate_series(1,9);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id,status,expires_at)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Kota','bugün',x,'active',t0-interval '1 hour');
 perform set_config('session_replication_role','origin',true);
 perform set_config('request.jwt.claim.sub',x::text,true);
 set local role authenticated; perform public.nakgo_delete_my_account(); reset role;
 if not (select owner_suspended from public.listings where id=l_x) or exists(select 1 from public.listings where owner_id=x and not owner_suspended) then
  raise exception 'FAIL self delete sync'; end if;

 -- 9) Doğrudan SQL ve gece temizliğinin satır silmesi.
 delete from private.account_moderation where user_id=s;
 if exists(select 1 from public.listings where owner_id=s and owner_suspended) then raise exception 'FAIL direct delete sync'; end if;
 insert into private.account_moderation(user_id,suspended) values(o,true);
 if exists(select 1 from public.listings where owner_id=o and not owner_suspended) then raise exception 'FAIL direct insert sync'; end if;
 update private.account_moderation set suspended=false,updated_at=t0-interval '400 days' where user_id=o;
 if exists(select 1 from public.listings where owner_id=o and owner_suspended) then raise exception 'FAIL direct update sync'; end if;
 res:=private.retention_run();
 if exists(select 1 from private.account_moderation where user_id=o) or exists(select 1 from public.listings where owner_id=o and owner_suspended) then
  raise exception 'FAIL retention row delete %',res; end if;

 -- 10) Yeni ilan sahibin o anki durumunu alır (sunucu tarafı ekleme).
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,owner_id)
  values('load','Adana','Mersin','Tır','Tenteli',1,'Yük','Sunucu','bugün',b) returning id into l_svc;
 if not (select owner_suspended from public.listings where id=l_svc) then raise exception 'FAIL insert flag for suspended owner'; end if;

 -- 11) İstemcinin diğer güncellemeleri eskisi gibi: süresi dolmuş aktif ilanı "yeniden yayınla" (değişikliksiz status)
 -- süreyi uzatır, revision/updated_at artar, erişim kaydı yazılır; normal düzenleme de aynı.
 select updated_at,revision,expires_at into r from public.listings where id=l_o2;
 select count(*) into logs from private.access_log;
 perform set_config('request.jwt.claim.sub',o::text,true);
 set local role authenticated;
 update public.listings set status='active' where id=l_o2;
 reset role;
 if (select expires_at from public.listings where id=l_o2)<=t0 or (select revision from public.listings where id=l_o2)<>r.revision+1
  or (select updated_at from public.listings where id=l_o2)=r.updated_at or (select count(*) from private.access_log)<>logs+1 then
  raise exception 'FAIL republish path changed'; end if;
 set local role authenticated;
 update public.listings set note='Düzenlendi' where id=l_o;
 reset role;
 if (select revision from public.listings where id=l_o)<1 then raise exception 'FAIL edit revision'; end if;
 -- İşaretle birlikte başka bir sütun da değişirse korumalar ve sayaçlar normal çalışır (atlama yalnız işarete özgü).
 -- (updated_at aynı işlemde now() ile sabit olduğundan revision ve erişim kaydına bakılır.)
 select revision into rev from public.listings where id=l_o; select count(*) into logs from private.access_log;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 update public.listings set owner_suspended=true,note='Birlikte' where id=l_o;
 if (select revision from public.listings where id=l_o)<>rev+1 or (select count(*) from private.access_log)<>logs+1 then
  raise exception 'FAIL mixed update skipped guards'; end if;
 update public.listings set owner_suspended=false where id=l_o;
 if (select revision from public.listings where id=l_o)<>rev+1 or (select count(*) from private.access_log)<>logs+1 then
  raise exception 'FAIL flag-only update not skipped'; end if;

 -- 12) Askıdaki hesabın Auth'tan zincirleme silinmesi (saklama yok) hatasız tamamlanır.
 insert into private.account_moderation(user_id,suspended) values(z,true);
 delete from auth.users where id=z;
 if exists(select 1 from public.listings where id=l_z) then raise exception 'FAIL cascade delete'; end if;

 -- 13) Değişmezlik: her ilanın işareti sahibin gerçek durumuyla aynı. Yetkiler kapalı.
 if exists(select 1 from public.listings l where l.owner_suspended is distinct from exists(select 1 from private.account_moderation a where a.user_id=l.owner_id and a.suspended)) then
  raise exception 'FAIL flag invariant'; end if;
 if has_function_privilege('authenticated','private.account_suspended(uuid)','EXECUTE') then raise exception 'FAIL account_suspended granted'; end if;
 if has_function_privilege('authenticated','private.listing_owner_flag_init()','EXECUTE') or has_function_privilege('anon','private.listing_owner_flag_init()','EXECUTE')
  or has_function_privilege('authenticated','private.listing_owner_flag_sync()','EXECUTE') or has_function_privilege('anon','private.listing_owner_flag_sync()','EXECUTE') then
  raise exception 'FAIL new functions executable by clients'; end if;
 if has_column_privilege('authenticated','public.listings','owner_suspended','SELECT') or has_column_privilege('authenticated','public.listings','owner_suspended','UPDATE')
  or has_column_privilege('authenticated','public.listings','owner_suspended','INSERT') or has_column_privilege('anon','public.listings','owner_suspended','SELECT') then
  raise exception 'FAIL column privilege'; end if;
end $$;
rollback;
select 'PASS: owner_suspended synced on every suspension path; hidden from v0/v1/guest/favorite/contact/detail; owner keeps own view; client cannot read/filter/write; sync leaves updated_at/revision/expires_at/status/access log/retention timing unchanged; republish and edits unchanged; all changes rolled back' as result;

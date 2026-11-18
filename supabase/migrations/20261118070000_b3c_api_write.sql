-- B3-c: API v1 yazma uçları. v0 (tablolar, RLS, tetikleyiciler, nakgo_* fonksiyonları) DEĞİŞMEZ.
--
-- İlke: iş kuralı tek yerde kalır.
--  * Favori, rota uyarısı, telefon ve hesap silme uçları mevcut v0 fonksiyonlarını çağırır (kota, kilit, sınır, yasal
--    saklama ve denetim kaydı orada). v1 yalnız kimlik/argüman denetimi, yanıt biçimi ve hata anahtarı ekler.
--  * İlan ve profil yazımı v0'da doğrudan tabloya (RLS + sütun yetkisi) yapılıyordu. SECURITY DEFINER içinde RLS ve sütun
--    yetkisi uygulanmaz; bu yüzden sahiplik ve karartma koşulları açıkça yazılır ve yazılabilir alanlar beyaz listedir
--    (v0 istemcisinin gönderdiği alanlar; owner_id, owner_label, redacted_at, expires_at, created_at istemciden alınmaz).
--    Tetikleyiciler (yazma koruması, ilan kotası, moderasyon/askı, erişim kaydı) auth.uid() okur ve aynen çalışır.
--  * Kimlik her zaman oturumdan (auth.uid()) alınır; hiçbir uç kullanıcı kimliği argümanı almaz.
--  * Eşzamanlılık: ilan güncellemesi revision (= ilanın son okunan updated_at değeri) ister; satır kilitlenir, farklıysa
--    conflict döner. Tekrar: ilan oluşturma istek kimliği (p_request_id) ister; aynı kimlik 24 saat içinde aynı ilanı döner.
--    Favori ve rota uyarısı doğal olarak tekrar güvenlidir (aynı kayıt ikinci kez oluşmaz).
--  * Hatalar sabit anahtar ve sabit açıklamayla döner; v0 hata metni, satır içeriği (telefon dahil) yanıta ve günlüğe gitmez.
begin;
insert into private.api_errors(key,sqlstate,detail) values
 ('limit_reached','PT429','Hesap sınırına ulaşıldı'),
 ('not_allowed','42501','Bu işlem bu hesap ya da kayıt için yapılamaz'),
 ('internal_error','XX000','Beklenmeyen sunucu hatası');

-- Tekrar koruması: yalnız istek kimliği, fonksiyon, gövde özeti ve oluşan kaydın kimliği. Gövde (telefon, metin) saklanmaz.
create table private.api_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 fn text not null check(fn ~ '^[a-z][a-z0-9_]*_v[1-9][0-9]*$'),
 body_md5 text not null check(body_md5 ~ '^[0-9a-f]{32}$'),
 ref bigint,
 created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index api_requests_created on private.api_requests(created_at);
comment on table private.api_requests is 'API v1 tekrar koruması (istek kimliği → oluşan kayıt). 24 saat saklanır; içerik yok, yalnız özet.';
alter table private.api_requests enable row level security;
revoke all on private.api_requests from public,anon,authenticated;

-- Yakalanan hatayı v1 anahtarına çevirir. Mesaj yalnız bilinen v0 metinleriyle karşılaştırılır; yanıta ve günlüğe
-- satır içeriği (DETAIL) ya da girdi değeri taşınmaz. Bilinmeyen hata yalnız SQLSTATE ile günlüğe yazılır.
create function private.api_rethrow(p_state text,p_msg text,p_hint text) returns void language plpgsql set search_path='' as $$
begin
 if p_hint='nakgo.api' then perform private.api_raise(p_msg); end if;
 if p_state='42501' then
  perform private.api_raise(case
   when p_msg='Account suspended' then 'account_suspended'
   when p_msg in('Listing unavailable','Route alert unavailable') then 'not_found'
   when p_msg in('Sign in required','Verified account required') then 'auth_required'
   else 'not_allowed' end);
 end if;
 if left(p_state,2)='22' or p_state in('23502','23514') then perform private.api_raise('invalid_argument'); end if;
 if p_state='54000' then perform private.api_raise('limit_reached'); end if;
 if p_state='23503' then perform private.api_raise('not_found'); end if;
 if p_state in('23505','40001','40P01','55P03') then perform private.api_raise('conflict'); end if;
 raise log 'nakgo.api beklenmeyen hata: %',p_state;
 perform private.api_raise('internal_error');
end $$;

create function private.api_route_alert_json(a public.route_alerts) returns jsonb language sql stable as $$
 select jsonb_build_object('id',a.id,'kind',a.kind,'from',a.from_city,'to',a.to_city,'vehicle',a.vehicle,'body',a.body,
  'active',a.active,'seen_at',private.api_ts(a.seen_at),'created_at',private.api_ts(a.created_at)) $$;

create function private.api_profile_json(p public.profiles) returns jsonb language sql stable as $$
 select jsonb_build_object('display_name',p.display_name,'account_type',p.account_type,'city',p.city,'about',p.about,'phone',p.phone) $$;

-- İstemcinin yazabileceği ilan alanları (v0 istemcisi cloud.js listingFields). status yalnız güncellemede.
create function private.api_listing_fields() returns text[] language sql immutable as $$
 select array['from_city','to_city','from_district','to_district','vehicle','body','amount','cargo','note','available_on','available_until',
  'available_time','loading_text','items','image_data','contact_phone','contact_consent'] $$;

revoke all on function private.api_rethrow(text,text,text),private.api_route_alert_json(public.route_alerts),
 private.api_profile_json(public.profiles),private.api_listing_fields() from public,anon,authenticated;

-- İlan oluşturma. Sahip oturumdan, ilan adı profilden (v0 istemcisi gibi), durum active (v0 RLS ekleme koşulu).
create function api.listing_create_v1(p_request_id uuid,p_listing jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; label text; cols text; vals text; h text; q private.api_requests; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_create_v1');
 actor:=private.api_actor(true);
 if p_request_id is null or p_listing is null or jsonb_typeof(p_listing)<>'object' then perform private.api_raise('invalid_argument'); end if;
 select array_agg(k) into keys from jsonb_object_keys(p_listing) k;
 if not coalesce(keys,'{}') @> array['kind'] or not keys <@ (private.api_listing_fields()||'kind'::text) or jsonb_typeof(p_listing->'kind')<>'string' then
  perform private.api_raise('invalid_argument'); end if;
 h:=md5(p_listing::text);
 delete from private.api_requests where user_id=actor and created_at<now()-interval '24 hours';
 -- Aynı kimlikle paralel istek: ikincisi birincinin bitmesini bekler, sonra onun ilanını döner.
 insert into private.api_requests(user_id,request_id,fn,body_md5) values(actor,p_request_id,'listing_create_v1',h) on conflict do nothing;
 if not found then
  select * into q from private.api_requests where user_id=actor and request_id=p_request_id;
  if q.fn<>'listing_create_v1' or q.body_md5<>h then perform private.api_raise('conflict'); end if;
  select * into r from public.listings where id=q.ref and owner_id=actor and redacted_at is null;
  if not found then perform private.api_raise('not_found'); end if;
  return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true),'created',false));
 end if;
 select nullif(btrim(left(btrim(p.display_name),60)),'') into label from public.profiles p where p.id=actor;
 select string_agg(format('%I',k),','),string_agg(format('x.%I',k),',') into cols,vals from unnest(keys) k where k<>'kind';
 begin
  execute format('insert into public.listings(owner_id,owner_label,status,kind%s) select $1,$2,''active'',x.kind%s from jsonb_populate_record(null::public.listings,$3) x returning *',
   coalesce(','||cols,''),coalesce(','||vals,'')) using actor,coalesce(label,'NakGo kullanıcısı'),p_listing into r;
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 update private.api_requests set ref=r.id where user_id=actor and request_id=p_request_id;
 return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true),'created',true));
end $$;

-- İlan güncelleme: yalnız sahibine ve karartılmamış ilana (v0 RLS). p_revision = son okunan updated_at; farklıysa conflict.
create function api.listing_update_v1(p_id bigint,p_revision text,p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; sets text; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_update_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 or p_revision is null or p_changes is null or jsonb_typeof(p_changes)<>'object' then perform private.api_raise('invalid_argument'); end if;
 select array_agg(k) into keys from jsonb_object_keys(p_changes) k;
 if keys is null or not keys <@ (private.api_listing_fields()||'status'::text) then perform private.api_raise('invalid_argument'); end if;
 select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;
 if not found then perform private.api_raise('not_found'); end if;
 if private.api_ts(r.updated_at)<>p_revision then perform private.api_raise('conflict'); end if;
 select string_agg(format('%1$I=x.%1$I',k),',') into sets from unnest(keys) k;
 begin
  execute format('update public.listings l set %s from jsonb_populate_record(null::public.listings,$1) x where l.id=$2 returning l.*',sets)
   using p_changes,p_id into r;
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true)));
end $$;

-- İlan kapatma: tekrar güvenli; zaten kapalı/arşivdeyse değiştirmeden döner.
create function api.listing_close_v1(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_close_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 then perform private.api_raise('invalid_argument'); end if;
 select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;
 if not found then perform private.api_raise('not_found'); end if;
 if r.status<>'active' then return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true),'changed',false)); end if;
 begin
  update public.listings set status='closed' where id=p_id returning * into r;
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true),'changed',true));
end $$;

-- Profil: yoksa oluşturur, varsa verilen alanları değiştirir. Uzunluklar v0 istemcisinin sınırları; telefon biçimi tablo
-- kısıtında (05XXXXXXXXX ya da boş) ve invalid_argument olarak döner.
create function api.profile_update_v1(p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; d jsonb; cols text; vals text; sets text; p public.profiles; st text; msg text; hn text;
begin
 perform private.api_begin('profile_update_v1');
 actor:=private.api_actor(true);
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then perform private.api_raise('invalid_argument'); end if;
 select array_agg(k),jsonb_object_agg(k,btrim(v)) into keys,d from jsonb_each_text(p_changes) e(k,v);
 if keys is null or not keys <@ array['display_name','account_type','city','about','phone']
  or exists(select 1 from jsonb_each(p_changes) e where jsonb_typeof(e.value)<>'string')
  or char_length(coalesce(d->>'display_name',''))>60 or char_length(coalesce(d->>'city',''))>40 or char_length(coalesce(d->>'about',''))>200
  or (d ? 'account_type' and d->>'account_type' not in('carrier','owner')) then
  perform private.api_raise('invalid_argument'); end if;
 select string_agg(format('%I',k),','),string_agg(format('x.%I',k),','),string_agg(format('%1$I=excluded.%1$I',k),',') into cols,vals,sets from unnest(keys) k;
 begin
  execute format('insert into public.profiles(id,%s) select $1,%s from jsonb_populate_record(null::public.profiles,$2) x on conflict(id) do update set %s returning *',cols,vals,sets)
   using actor,d into p;
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(private.api_profile_json(p));
end $$;

-- Favori ekleme: yalnız herkese görünen ilan ya da kendi karartılmamış ilanı (okuma uçlarındaki kural). v0 nakgo_set_favorite.
create function api.favorite_add_v1(p_listing_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; st text; msg text; hn text;
begin
 perform private.api_begin('favorite_add_v1');
 actor:=private.api_actor(true);
 if p_listing_id is null or p_listing_id<1 then perform private.api_raise('invalid_argument'); end if;
 if not exists(select 1 from public.listings l where l.id=p_listing_id
   and (exists(select 1 from private.api_visible_listings v where v.id=l.id) or (l.owner_id=actor and l.redacted_at is null))) then
  perform private.api_raise('not_found'); end if;
 begin perform public.nakgo_set_favorite(p_listing_id,true);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('listing_id',p_listing_id,'saved',true));
end $$;

-- Favori kaldırma: ilan artık görünmese de olur; askıdaki hesap da kendi favorisini kaldırabilir (v0 gibi).
create function api.favorite_remove_v1(p_listing_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; st text; msg text; hn text;
begin
 perform private.api_begin('favorite_remove_v1');
 actor:=private.api_actor(false);
 if p_listing_id is null or p_listing_id<1 then perform private.api_raise('invalid_argument'); end if;
 begin perform public.nakgo_set_favorite(p_listing_id,false);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('listing_id',p_listing_id,'saved',false));
end $$;

-- Rota uyarısı oluşturma: aynısı varsa onu döner (created=false); sınır ve kilit v0 nakgo_save_route_alert'te.
create function api.route_alert_create_v1(p_kind text,p_from text default null,p_to text default null,p_vehicle text default null,p_body text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; f text; t text; v text; b text; r public.route_alerts; st text; msg text; hn text;
begin
 perform private.api_begin('route_alert_create_v1');
 actor:=private.api_actor(true);
 f:=nullif(btrim(coalesce(p_from,'')),''); t:=nullif(btrim(coalesce(p_to,'')),''); v:=nullif(btrim(coalesce(p_vehicle,'')),''); b:=nullif(btrim(coalesce(p_body,'')),'');
 if p_kind is null or p_kind not in('load','truck') or (f is null and t is null) then perform private.api_raise('invalid_argument'); end if;
 for i in 1..2 loop
  select * into r from public.route_alerts a where a.user_id=actor and a.kind=p_kind and coalesce(a.from_city,'')=coalesce(f,'')
   and coalesce(a.to_city,'')=coalesce(t,'') and coalesce(a.vehicle,'')=coalesce(v,'') and coalesce(a.body,'')=coalesce(b,'');
  if found then return private.api_ok(jsonb_build_object('alert',private.api_route_alert_json(r),'created',false)); end if;
  exit when i=2;
  begin
   select * into r from public.nakgo_save_route_alert(p_kind,f,t,v,b);
   return private.api_ok(jsonb_build_object('alert',private.api_route_alert_json(r),'created',true));
  exception when others then
   get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
   -- Paralel aynı istek: diğeri önce yazdı; döngü onun kaydını döner.
   if st<>'23505' then perform private.api_rethrow(st,msg,hn); end if;
  end;
 end loop;
 perform private.api_raise('conflict');
end $$;

-- Rota uyarısını açma/kapatma (v0'daki tek değişiklik). Tekrar güvenli.
create function api.route_alert_update_v1(p_id bigint,p_active boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; r public.route_alerts; st text; msg text; hn text;
begin
 perform private.api_begin('route_alert_update_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 or p_active is null then perform private.api_raise('invalid_argument'); end if;
 begin select * into r from public.nakgo_set_route_alert(p_id,p_active);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('alert',private.api_route_alert_json(r)));
end $$;

-- Rota uyarısı silme: tekrar güvenli (yoksa removed=false). Askıdaki hesap da silebilir (v0 gibi).
create function api.route_alert_delete_v1(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; st text; msg text; hn text;
begin
 perform private.api_begin('route_alert_delete_v1');
 actor:=private.api_actor(false);
 if p_id is null or p_id<1 then perform private.api_raise('invalid_argument'); end if;
 begin perform public.nakgo_remove_route_alert(p_id);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  if st='42501' and msg='Route alert unavailable' then return private.api_ok(jsonb_build_object('id',p_id,'removed',false)); end if;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('id',p_id,'removed',true));
end $$;

-- Rota uyarıları görüldü (v0 nakgo_route_alerts_seen).
create function api.route_alerts_seen_v1() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; n integer;
begin
 perform private.api_begin('route_alerts_seen_v1');
 actor:=private.api_actor(false);
 n:=public.nakgo_route_alerts_seen();
 return private.api_ok(jsonb_build_object('updated',n));
end $$;

-- Telefon: v0 nakgo_listing_contact (30/saat, 100/gün sınırı, güvenlik olayı, tıklama sayımı orada). Sınır aşımında
-- hata fırlatılmaz (olay kaydı geri alınmasın): phone=null, limited=true döner.
create function api.listing_contact_v1(p_id bigint,p_channel text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; phone text; st text; msg text; hn text;
begin
 perform private.api_begin('listing_contact_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 or (p_channel is not null and p_channel not in('call','whatsapp')) then perform private.api_raise('invalid_argument'); end if;
 begin phone:=public.nakgo_listing_contact(p_id,p_channel);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('phone',phone,
  'limited',phone is null and not exists(select 1 from public.listings l where l.id=p_id and l.owner_id=actor)));
end $$;

-- Hesap silme: v0 nakgo_delete_my_account (kişisel veri silinir; yasal saklama, denetim kaydı ve güvenlik olayları kalır).
create function api.account_delete_v1() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; st text; msg text; hn text;
begin
 perform private.api_begin('account_delete_v1');
 actor:=private.api_actor(false);
 begin perform public.nakgo_delete_my_account();
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 delete from private.api_requests where user_id=actor;
 return private.api_ok(jsonb_build_object('deleted',true));
end $$;

create function private.api_requests_retention() returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin delete from private.api_requests where created_at<now()-interval '24 hours'; get diagnostics n=row_count; return n; end $$;
revoke all on function private.api_requests_retention() from public,anon,authenticated;

revoke all on function api.listing_create_v1(uuid,jsonb),api.listing_update_v1(bigint,text,jsonb),api.listing_close_v1(bigint),
 api.profile_update_v1(jsonb),api.favorite_add_v1(bigint),api.favorite_remove_v1(bigint),
 api.route_alert_create_v1(text,text,text,text,text),api.route_alert_update_v1(bigint,boolean),api.route_alert_delete_v1(bigint),
 api.route_alerts_seen_v1(),api.listing_contact_v1(bigint,text),api.account_delete_v1() from public,anon,authenticated;
grant execute on function api.listing_create_v1(uuid,jsonb),api.listing_update_v1(bigint,text,jsonb),api.listing_close_v1(bigint),
 api.profile_update_v1(jsonb),api.favorite_add_v1(bigint),api.favorite_remove_v1(bigint),
 api.route_alert_create_v1(text,text,text,text,text),api.route_alert_update_v1(bigint,boolean),api.route_alert_delete_v1(bigint),
 api.route_alerts_seen_v1(),api.listing_contact_v1(bigint,text),api.account_delete_v1() to authenticated;

-- Saatlik: 24 saatten eski tekrar kayıtları silinir. Yerelde pg_cron yok; atlanır.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('nakgo-api-requests-retention','29 * * * *','select private.api_requests_retention()');
 end if;
end $$;
commit;

-- B10: araç verileri. Araç tipi, kasa tipi ve tonaj ilan tablosunda zaten var (public.listings.vehicle, body, amount) ve
-- tablo kısıtlarıyla doğrulanıyor (ilk migration'dan beri; bütün satırlar uyumlu). Bu migration yeni sütun AÇMAZ, v0
-- tablosunu, kısıtlarını, RLS'yi, kotaları ve moderasyonu DEĞİŞTİRMEZ. Eklenenler:
--  * Birim ve anlam belgesi: amount her zaman TON (yük ilanında yük ağırlığı, boş araç ilanında boş kapasite).
--  * Katalog (private.listing_catalog, api.listing_catalog_v1): izin verilen araç ve kasa tipleri ile tonaj sınırları. Tablo
--    kısıtları ve istemci listeleriyle aynı olduğu testle denetlenir (tests/db/api-v1-vehicle.test.cjs).
--  * v1 girdisi: tonaj yalnız JSON sayı ve yanında amount_unit='ton' ile kabul edilir (birimsiz/belirsiz tonaj reddedilir);
--    araç/kasa değer listesi ve tonaj sınırları tablo kısıtında (tek kaynak); ihlal invalid_argument döner.
--  * v1 akışında isteğe bağlı araç, kasa ve tonaj aralığı filtreleri (eski çağrılar aynen çalışır).
--  * v1 rota alarmında araç/kasa yalnız katalogdaki değerler (v0 serbest metni değişmez).
-- Yanıt biçimleri değişmez; birim sözleşmede ve katalogda tanımlıdır.
begin;
comment on column public.listings.amount is 'Ton. Yük ilanında yük ağırlığı, boş araç ilanında boş kapasite. 0 < amount <= 9007199254740991.';
comment on column public.listings.vehicle is 'Araç tipi. İzin verilen değerler: listings_vehicle_check (private.listing_catalog ile aynı).';
comment on column public.listings.body is 'Kasa tipi. İzin verilen değerler: listings_body_check (private.listing_catalog ile aynı).';

create function private.listing_catalog() returns jsonb language sql immutable as $$
 select jsonb_build_object(
  'vehicles',jsonb_build_array('Tır','Kırkayak','Kamyon','Kamyonet','Panelvan','Tanker','Lowbed','Konteyner'),
  'bodies',jsonb_build_array('Tenteli','Kapalı kasa','Açık kasa','Frigorifik','Damperli','Tanker','Lowbed','Konteyner'),
  'amount',jsonb_build_object('unit','ton','min_exclusive',0,'max',9007199254740991)) $$;

-- v1 ilan girdisinde tonajın türü ve birimi: amount yalnız JSON sayı ve yanında amount_unit='ton'; tonajsız birim de
-- reddedilir. Araç ve kasa değerleri tablo kısıtında (metin olmayan değer de orada reddedilir). Dönüşte amount_unit yok.
create function private.api_vehicle_input(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if (p ? 'amount_unit' and not p ? 'amount')
  or (p ? 'amount' and (jsonb_typeof(p->'amount')<>'number' or jsonb_typeof(p->'amount_unit') is distinct from 'string' or p->>'amount_unit'<>'ton')) then
  perform private.api_raise('invalid_argument');
 end if;
 return p-'amount_unit';
end $$;
revoke all on function private.listing_catalog(),private.api_vehicle_input(jsonb) from public,anon,authenticated;

create function api.listing_catalog_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.api_begin('listing_catalog_v1');
 return private.api_ok(private.listing_catalog());
end $$;
revoke all on function api.listing_catalog_v1() from public,anon,authenticated;
grant execute on function api.listing_catalog_v1() to anon,authenticated;

create or replace function api.listing_create_v1(p_request_id uuid,p_listing jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; label text; cols text; vals text; h text; q private.api_requests; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_create_v1');
 actor:=private.api_actor(true);
 if p_request_id is null or p_listing is null or jsonb_typeof(p_listing)<>'object' then perform private.api_raise('invalid_argument'); end if;
 p_listing:=private.api_vehicle_input(p_listing);
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

create or replace function api.listing_update_v1(p_id bigint,p_revision bigint,p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; sets text; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_update_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 or p_revision is null or p_revision<0 or p_changes is null or jsonb_typeof(p_changes)<>'object' then perform private.api_raise('invalid_argument'); end if;
 p_changes:=private.api_vehicle_input(p_changes);
 select array_agg(k) into keys from jsonb_object_keys(p_changes) k;
 if keys is null or not keys <@ (private.api_listing_fields()||'status'::text) then perform private.api_raise('invalid_argument'); end if;
 select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;
 if not found then perform private.api_raise('not_found'); end if;
 if r.revision<>p_revision then perform private.api_raise('conflict'); end if;
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

create or replace function api.route_alert_create_v1(p_kind text,p_from text default null,p_to text default null,p_vehicle text default null,p_body text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; f text; t text; v text; b text; r public.route_alerts; st text; msg text; hn text;
begin
 perform private.api_begin('route_alert_create_v1');
 actor:=private.api_actor(true);
 f:=nullif(btrim(coalesce(p_from,'')),''); t:=nullif(btrim(coalesce(p_to,'')),''); v:=nullif(btrim(coalesce(p_vehicle,'')),''); b:=nullif(btrim(coalesce(p_body,'')),'');
 if p_kind is null or p_kind not in('load','truck') or (f is null and t is null)
  or (v is not null and not private.listing_catalog()->'vehicles' ? v) or (b is not null and not private.listing_catalog()->'bodies' ? b) then
  perform private.api_raise('invalid_argument'); end if;
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

-- Akış: imza genişler (yeni argümanların hepsi isteğe bağlı); eski tanım kaldırılır, tek tanım kalır.
drop function api.listings_v1(text,text);
create function api.listings_v1(p_cursor text default null,p_kind text default null,p_vehicle text default null,p_body text default null,
 p_min_amount numeric default null,p_max_amount numeric default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('listings_v1');
 actor:=private.api_viewer();
 if p_kind is not null and p_kind not in('load','truck') then perform private.api_raise('invalid_argument'); end if;
 -- Araç filtreleri: değerler katalogdan, tonaj ton cinsinden ve tablo sınırları içinde; alt sınır üst sınırı geçemez.
 if (p_vehicle is not null and not private.listing_catalog()->'vehicles' ? p_vehicle) or (p_body is not null and not private.listing_catalog()->'bodies' ? p_body)
  or (p_min_amount is not null and (p_min_amount<=0 or p_min_amount>9007199254740991)) or (p_max_amount is not null and (p_max_amount<=0 or p_max_amount>9007199254740991))
  or (p_min_amount is not null and p_max_amount is not null and p_min_amount>p_max_amount) then perform private.api_raise('invalid_argument'); end if;
 c:=private.api_cursor(p_cursor);
 -- 51 satır okunur: 51. varsa sonraki sayfa vardır (ayrı sorgu yok).
 select coalesce(jsonb_agg(private.api_listing_json(l,actor is not null,actor,false) order by l.id desc) filter(where s.rn<=50),'[]'::jsonb),
  min(l.id) filter(where s.rn<=50),count(*)
 into items,last,n
 from (select v.id,row_number() over(order by v.id desc) rn from (select v.id from private.api_visible_listings v
   join public.listings x on x.id=v.id
   where (c is null or v.id<c) and (p_kind is null or v.kind=p_kind) and (p_vehicle is null or x.vehicle=p_vehicle) and (p_body is null or x.body=p_body)
    and (p_min_amount is null or x.amount>=p_min_amount) and (p_max_amount is null or x.amount<=p_max_amount) order by v.id desc limit 51) v) s
 join public.listings l on l.id=s.id;
 return private.api_page(items,case when n>50 then last end);
end $$;

revoke all on function api.listings_v1(text,text,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function api.listings_v1(text,text,text,text,numeric,numeric) to anon,authenticated;
commit;

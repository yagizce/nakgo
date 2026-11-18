-- B3-b2: API v1 hesap okuma uçları (yalnız üye, yalnız kendi verisi). v0 (profiles, listing_favorites, route_alerts
-- tabloları + RLS) DEĞİŞMEZ. Uçlar SECURITY DEFINER olduğu için sahiplik koşulu (user_id/id = oturum) açıkça yazılır;
-- tests/db/api-v1-account.test.cjs v0'ın RLS altındaki sonuçlarıyla karşılaştırır.
begin;
-- Profil: kendi satırı; satır yoksa data=null (istemci B3-c'deki yazma ucuyla oluşturur).
create function api.profile_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; p public.profiles;
begin
 perform private.api_begin('profile_v1');
 actor:=private.api_actor(false);
 select * into p from public.profiles where id=actor;
 if not found then return private.api_ok(null); end if;
 return private.api_ok(jsonb_build_object('display_name',p.display_name,'account_type',p.account_type,'city',p.city,'about',p.about,'phone',p.phone));
end $$;

-- Favoriler: kayıt sırasına değil v0 gibi ilan kimliğine göre azalan, 50'şer. İlan hâlâ görünüyorsa (herkese görünen ya
-- da kendi karartılmamış ilanı) üye alanlarıyla, görünmüyorsa listing=null ve available=false.
create function api.favorites_v1(p_cursor text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('favorites_v1');
 actor:=private.api_actor(false);
 c:=private.api_cursor(p_cursor);
 select coalesce(jsonb_agg(jsonb_build_object('listing_id',s.listing_id,'available',l.id is not null,
   'listing',case when l.id is null then null else private.api_listing_json(l,true,actor,false) end) order by s.listing_id desc) filter(where s.rn<=50),'[]'::jsonb),
  min(s.listing_id) filter(where s.rn<=50),count(*) into items,last,n
 from (select f.listing_id,row_number() over(order by f.listing_id desc) rn from (select f.listing_id from public.listing_favorites f
   where f.user_id=actor and (c is null or f.listing_id<c) order by f.listing_id desc limit 51) f) s
 left join public.listings l on l.id=s.listing_id
  and (exists(select 1 from private.api_visible_listings v where v.id=l.id) or (l.owner_id=actor and l.redacted_at is null));
 return private.api_page(items,case when n>50 then last end);
end $$;

-- Favori kimlikleri (kalpleri işaretlemek için): v0 gibi 200'er, ilan kimliğine göre azalan.
create function api.favorite_ids_v1(p_cursor text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('favorite_ids_v1');
 actor:=private.api_actor(false);
 c:=private.api_cursor(p_cursor);
 select coalesce(jsonb_agg(f.listing_id order by f.listing_id desc) filter(where f.rn<=200),'[]'::jsonb),min(f.listing_id) filter(where f.rn<=200),count(*)
 into items,last,n
 from (select x.listing_id,row_number() over(order by x.listing_id desc) rn from (select x.listing_id from public.listing_favorites x
   where x.user_id=actor and (c is null or x.listing_id<c) order by x.listing_id desc limit 201) x) f;
 return private.api_page(items,case when n>200 then last end);
end $$;

-- Rota uyarıları: kendi uyarıları, kimliğe göre azalan (yazma ucu hesap başına 20 ile sınırlar).
create function api.route_alerts_v1(p_cursor text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('route_alerts_v1');
 actor:=private.api_actor(false);
 c:=private.api_cursor(p_cursor);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'from',a.from_city,'to',a.to_city,'vehicle',a.vehicle,'body',a.body,
   'active',a.active,'seen_at',private.api_ts(a.seen_at),'created_at',private.api_ts(a.created_at)) order by a.id desc) filter(where a.rn<=20),'[]'::jsonb),
  min(a.id) filter(where a.rn<=20),count(*) into items,last,n
 from (select x.*,row_number() over(order by x.id desc) rn from (select x.* from public.route_alerts x
   where x.user_id=actor and (c is null or x.id<c) order by x.id desc limit 21) x) a;
 return private.api_page(items,case when n>20 then last end);
end $$;

revoke all on function api.profile_v1(),api.favorites_v1(text),api.favorite_ids_v1(text),api.route_alerts_v1(text) from public,anon,authenticated;
grant execute on function api.profile_v1(),api.favorites_v1(text),api.favorite_ids_v1(text),api.route_alerts_v1(text) to authenticated;
commit;

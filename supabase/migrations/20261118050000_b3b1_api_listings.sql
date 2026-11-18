-- B3-b1: API v1 ilan okuma uçları. v0 (nakgo_public_listings, listings tablosu + RLS) DEĞİŞMEZ.
--
-- Kararlar (18 Kasım 2026, B3-b değerlendirmesi, onaylı):
--  1. Misafir ve üye akışı aynı sıkı görünürlük kuralını kullanır: v0 misafir akışının kuralı (aktif, süresi dolmamış,
--     tarihi geçmemiş, moderasyonla kaldırılmamış, sahibi askıda değil). Tek kaynak: private.api_visible_listings.
--  2. Listede yalnız has_photo; fotoğraf yalnız ayrıntı ucunda ve yalnız üyeye.
--  3. Sahip adı (owner_label) misafire gösterilmez, üyeye gösterilir (v0 gibi).
--
-- Uçlar SECURITY DEFINER olduğu için RLS içeride uygulanmaz; görünürlük ve sahiplik koşulları burada açıkça yazılır ve
-- tests/db/api-v1-listings.test.cjs v0 ile karşılaştırır. Yanıtlarda telefon, sahip kimliği (owner_id), karartma
-- zamanı ve özel tablolar yoktur. Sıralama ve sayfa v0 ile aynı: kimliğe göre azalan, 50'şer, "bundan küçük" imleci.
begin;
create view private.api_visible_listings as
 select l.id,l.kind from public.listings l
 where l.status='active' and l.expires_at>now()
  and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)
  and not private.account_suspended(l.owner_id);
comment on view private.api_visible_listings is 'API v1: herkese görünen ilanlar (misafir ve üye akışı, ayrıntı). v0 nakgo_public_listings kuralı.';
revoke all on private.api_visible_listings from public,anon,authenticated;

-- api_ts ve api_listing_json SET search_path TAŞIMAZ: SET, SQL fonksiyonunun sorguya gömülmesini (inlining) engeller ve
-- 50 satırlık sayfada süreyi ikiye katlıyordu. Güvenlidir: SECURITY INVOKER'dır, istemciye kapalıdır, bütün adlar
-- şema adıyla yazılır ve yalnız search_path='' olan api.* uçlarının içinde çalışır.
create function private.api_ts(p timestamptz) returns text language sql stable as $$
 select to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- İlan yanıtı. p_member: üye alanları; p_detail: üyeye fotoğraf.
create function private.api_listing_json(l public.listings,p_member boolean,p_actor uuid,p_detail boolean) returns jsonb
language sql stable as $$
 select jsonb_build_object('id',l.id,'kind',l.kind,
   'from',jsonb_build_object('city',l.from_city,'district',l.from_district),
   'to',jsonb_build_object('city',l.to_city,'district',l.to_district),
   'vehicle',l.vehicle,'body',l.body,'amount',l.amount,'cargo',l.cargo,'items',l.items,
   'date',jsonb_build_object('on',l.available_on,'until',l.available_until,'time',l.available_time,'text',l.loading_text),
   'status',l.status,'created_at',private.api_ts(l.created_at),'has_photo',l.image_data<>'')
 ||case when p_member then jsonb_build_object('owner_label',l.owner_label,'note',l.note,'mine',l.owner_id=p_actor,
   'expires_at',private.api_ts(l.expires_at),'updated_at',private.api_ts(l.updated_at),'contact_allowed',l.contact_consent) else '{}'::jsonb end
 ||case when p_member and p_detail then jsonb_build_object('photo',nullif(l.image_data,'')) else '{}'::jsonb end $$;

-- Misafir mi üye mi: oturum yok ya da anonim oturum → misafir (null); aksi hâlde doğrulanmış hesap şartı.
create function private.api_viewer() returns uuid language plpgsql set search_path='' as $$
begin
 if auth.uid() is null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then return null; end if;
 return private.api_actor(false);
end $$;

revoke all on function private.api_ts(timestamptz),private.api_listing_json(public.listings,boolean,uuid,boolean),private.api_viewer() from public,anon,authenticated;

-- Akış: misafir ve üye, aynı kural. İsteğe bağlı tür filtresi (load/truck).
create function api.listings_v1(p_cursor text default null,p_kind text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('listings_v1');
 actor:=private.api_viewer();
 if p_kind is not null and p_kind not in('load','truck') then perform private.api_raise('invalid_argument'); end if;
 c:=private.api_cursor(p_cursor);
 -- 51 satır okunur: 51. varsa sonraki sayfa vardır (ayrı sorgu yok).
 select coalesce(jsonb_agg(private.api_listing_json(l,actor is not null,actor,false) order by l.id desc) filter(where s.rn<=50),'[]'::jsonb),
  min(l.id) filter(where s.rn<=50),count(*)
 into items,last,n
 from (select v.id,row_number() over(order by v.id desc) rn from (select v.id from private.api_visible_listings v
   where (c is null or v.id<c) and (p_kind is null or v.kind=p_kind) order by v.id desc limit 51) v) s
 join public.listings l on l.id=s.id;
 return private.api_page(items,case when n>50 then last end);
end $$;

-- Ayrıntı: herkese görünen ilan; üyeye ayrıca kendi ilanı (karartılmamışsa, durumu ne olursa olsun). Görünmeyen → not_found.
create function api.listing_v1(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; r public.listings;
begin
 perform private.api_begin('listing_v1');
 actor:=private.api_viewer();
 if p_id is null or p_id<1 then perform private.api_raise('invalid_argument'); end if;
 select l.* into r from public.listings l where l.id=p_id
  and (exists(select 1 from private.api_visible_listings v where v.id=l.id) or (actor is not null and l.owner_id=actor and l.redacted_at is null));
 if not found then perform private.api_raise('not_found'); end if;
 return private.api_ok(private.api_listing_json(r,actor is not null,actor,true));
end $$;

-- Kendi ilanlarım: bütün durumlar, karartılmışlar hariç (v0 RLS sahip kuralı). Fotoğraf ayrıntıda.
create function api.my_listings_v1(p_cursor text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c bigint; items jsonb; last bigint; n integer;
begin
 perform private.api_begin('my_listings_v1');
 actor:=private.api_actor(false);
 c:=private.api_cursor(p_cursor);
 select coalesce(jsonb_agg(private.api_listing_json(l,true,actor,false) order by l.id desc) filter(where s.rn<=50),'[]'::jsonb),
  min(l.id) filter(where s.rn<=50),count(*) into items,last,n
 from (select x.id,row_number() over(order by x.id desc) rn from (select x.id from public.listings x
   where x.owner_id=actor and x.redacted_at is null and (c is null or x.id<c) order by x.id desc limit 51) x) s
 join public.listings l on l.id=s.id;
 return private.api_page(items,case when n>50 then last end);
end $$;

revoke all on function api.listings_v1(text,text),api.listing_v1(bigint),api.my_listings_v1(text) from public,anon,authenticated;
grant execute on function api.listings_v1(text,text),api.listing_v1(bigint) to anon,authenticated;
grant execute on function api.my_listings_v1(text) to authenticated;
commit;

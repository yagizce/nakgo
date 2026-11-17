-- B3-a: sürümlü istemci API'si (v1) çerçevesi. v0 (public tabloları ve nakgo_* fonksiyonları) DEĞİŞMEZ.
--
-- Kurallar (supabase/contract/v1.json ve tools/api-contract.cjs ile denetlenir; docs/api/contract-v1.md):
--  * api şemasında yalnız fonksiyon bulunur; tablo, görünüm, dizi ya da tip yok. İstemci tabloya hiç dokunmaz.
--  * Ad: <kaynak>[_<eylem>]_v<N> (ör. api.status_v1). Her fonksiyon jsonb döner, SECURITY DEFINER, search_path='',
--    VOLATILE (kullanım sayımı yazar; PostgREST yalnız POST ile çağırır) ve ilk satırı private.api_begin('<ad>').
--  * Yanıt: tek kayıt {"data":…}; liste {"data":[…],"page":{"next":"<imleç>"|null}}. Sayfa boyutu sunucuda sabit.
--  * Hata: SQLSTATE + makinece okunur anahtar (MESSAGE = anahtar, ör. auth_required). DETAIL sabit açıklama metnidir;
--    kişisel ya da gizli veri içermez. İstemci metne değil SQLSTATE ve anahtara bakar.
--  * Yetki: PUBLIC'e hiçbir şey açık değil; her fonksiyon için yalnız sözleşmedeki roller (anon/authenticated).
--    Yardımcılar (private.api_*) istemciye kapalıdır.
--  * Kullanım ölçümü: saatlik, sürüm ve fonksiyon başına çağrı sayısı. Hesap, IP, istek içeriği yok.
--  * v1 kapatılabilir (private.api_settings.v1_enabled=false): api.status_v1 durumu bildirir, diğer uçlar api_disabled
--    döner; istemci v0'a döner. v0 bundan etkilenmez.
begin;
create schema api;
comment on schema api is 'Sürümlü istemci API''si (v1+). Yalnız fonksiyon; bkz. docs/api/contract-v1.md';
revoke all on schema api from public;
grant usage on schema api to anon,authenticated;

create table private.api_errors (
 key text primary key check(key ~ '^[a-z][a-z0-9_]{2,40}$'),
 sqlstate text not null check(sqlstate ~ '^[0-9A-Z]{5}$'),
 detail text not null check(char_length(detail) between 3 and 200)
);
insert into private.api_errors(key,sqlstate,detail) values
 ('auth_required','42501','Bu işlem için giriş yapılmalı'),
 ('account_unverified','42501','Hesabın e-posta adresi doğrulanmamış'),
 ('account_suspended','42501','Hesap askıya alınmış'),
 ('admin_required','42501','Bu işlem yalnız yöneticiye açık'),
 ('invalid_argument','22023','Geçersiz argüman'),
 ('invalid_cursor','22023','Geçersiz sayfa imleci'),
 ('not_found','PT404','Kayıt bulunamadı ya da erişilemiyor'),
 ('conflict','PT409','Kayıt başka bir işlemle değişti; yeniden okuyun'),
 ('api_disabled','PT503','API v1 geçici olarak kapalı; v0 kullanılmalı');

create table private.api_settings (
 id integer primary key check(id=1),
 v1_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into private.api_settings(id) values(1);

create table private.api_usage (
 hour timestamptz not null,
 version text not null check(version ~ '^v[1-9][0-9]*$'),
 fn text not null check(fn ~ '^[a-z][a-z0-9_]*_v[1-9][0-9]*$'),
 shard smallint not null check(shard between 0 and 3),
 calls bigint not null check(calls>0),
 primary key(hour,version,fn,shard)
);
comment on table private.api_usage is 'Saatlik API çağrı sayısı (sürüm, fonksiyon). Kişisel veri yok. Satırlar 4 parçaya bölünür; paralel çağrılar aynı satırda beklemesin.';
alter table private.api_errors enable row level security;
alter table private.api_settings enable row level security;
alter table private.api_usage enable row level security;
revoke all on private.api_errors,private.api_settings,private.api_usage from public,anon,authenticated;

-- Hata: kayıtlı anahtarın SQLSTATE'i ve sabit açıklaması ile. Kayıtsız anahtar programlama hatasıdır.
create function private.api_raise(p_key text) returns void language plpgsql set search_path='' as $$
declare e private.api_errors;
begin
 select * into e from private.api_errors where key=p_key;
 if not found then raise exception 'unknown api error key: %',p_key using errcode='XX000'; end if;
 raise exception using errcode=e.sqlstate,message=e.key,detail=e.detail,hint='nakgo.api';
end $$;

-- Her v1 fonksiyonunun ilk adımı: v1 açık mı (status gibi uçlar kapalıyken de çalışabilir) ve kullanım sayımı.
create function private.api_begin(p_fn text,p_allow_disabled boolean default false) returns void language plpgsql set search_path='' as $$
declare v text:=substring(p_fn from '_(v[1-9][0-9]*)$');
begin
 if v is null then perform private.api_raise('invalid_argument'); end if;
 if not p_allow_disabled and not coalesce((select v1_enabled from private.api_settings where id=1),false) then perform private.api_raise('api_disabled'); end if;
 insert into private.api_usage(hour,version,fn,shard,calls) values(date_trunc('hour',now(),'UTC'),v,p_fn,(pg_catalog.pg_backend_pid()%4)::smallint,1)
 on conflict(hour,version,fn,shard) do update set calls=private.api_usage.calls+1;
end $$;

-- Oturum: doğrulanmış, anonim olmayan hesap. p_write: yazan uçlar askıya alınmış hesabı reddeder ve moderasyonla
-- yarışmamak için mevcut etkinlik kilidini (private.require_activity) alır.
create function private.api_actor(p_write boolean default false) returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then
  perform private.api_raise('auth_required'); end if;
 if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then perform private.api_raise('account_unverified'); end if;
 if p_write then
  if private.account_suspended(actor) then perform private.api_raise('account_suspended'); end if;
  begin perform private.require_activity(actor);
  exception when insufficient_privilege then perform private.api_raise('account_suspended');
  end;
 end if;
 return actor;
end $$;

-- Yönetici: mevcut yetki kuralı (private.is_nakgo_admin) aynen.
create function private.api_admin() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=private.api_actor(false);
begin
 if not private.is_nakgo_admin() then perform private.api_raise('admin_required'); end if;
 return actor;
end $$;

-- İmleç: istemciye opak metin; şimdilik pozitif tam sayı. Boş = ilk sayfa.
create function private.api_cursor(p_cursor text) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if p_cursor is null or p_cursor='' then return null; end if;
 if p_cursor !~ '^[1-9][0-9]{0,15}$' then perform private.api_raise('invalid_cursor'); end if;
 return p_cursor::bigint;
end $$;

create function private.api_ok(p_data jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('data',coalesce(p_data,'null'::jsonb)) $$;
create function private.api_page(p_items jsonb,p_next bigint) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('data',coalesce(p_items,'[]'::jsonb),'page',jsonb_build_object('next',case when p_next is null then null else p_next::text end)) $$;

create function private.api_usage_retention() returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin delete from private.api_usage where hour<now()-interval '400 days'; get diagnostics n=row_count; return n; end $$;

revoke all on function private.api_raise(text),private.api_begin(text,boolean),private.api_actor(boolean),private.api_admin(),
 private.api_cursor(text),private.api_ok(jsonb),private.api_page(jsonb,bigint),private.api_usage_retention() from public,anon,authenticated;

-- İlk uç: istemcinin v1'i kullanıp kullanamayacağını öğrenmesi (çalışma anında v1/v0 seçimi). Misafir de çağırabilir.
create function api.status_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.api_begin('status_v1',true);
 return private.api_ok(jsonb_build_object('api','v1','enabled',(select v1_enabled from private.api_settings where id=1),
  'server_time',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;
revoke all on function api.status_v1() from public,anon,authenticated;
grant execute on function api.status_v1() to anon,authenticated;

-- Günlük: 400 günden eski kullanım sayıları silinir. Yerelde pg_cron yok; atlanır.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('nakgo-api-usage-retention','23 1 * * *','select private.api_usage_retention()');
 end if;
end $$;
commit;

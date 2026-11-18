-- B4: sunucu katmanının en az yetkili veritabanı rolü. YALNIZ YEREL: bu dosya supabase/migrations dışında tutulur ve hiçbir
-- uzak ortamda (production, DEV, geçici Supabase) çalıştırılmaz. Testler ve yerel geliştirme migration'lardan sonra uygular.
-- Uzak ortama alınması son aşamada ayrı onay ister (docs/server/b4.md).
--
-- İlke:
--  * `worker` giriş yapamaz (NOLOGIN), süper kullanıcı değildir, RLS'yi atlayamaz, rol/veritabanı oluşturamaz, hiçbir role
--    üye değildir (anon/authenticated/service_role yetkilerini miras almaz).
--  * Tablolara hiçbir yetkisi yoktur. Yalnız `worker` şemasındaki fonksiyonları çalıştırabilir; private ve api şemalarına
--    erişemez. Fonksiyonlar SECURITY DEFINER, search_path='' ve kişisel veri döndürmez.
--  * anon, authenticated ve service_role `worker` fonksiyonlarını çalıştıramaz (kullanıcı ve yönetici yolları ayrı).
--  * Yerel PostgREST, belirteçte role=worker olan isteği bu role geçirir (authenticator üyeliği yalnız yerelde).
do $$ begin
 if not exists(select 1 from pg_roles where rolname='worker') then create role worker nologin noinherit; end if;
end $$;
alter role worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication connection limit 0;
-- Yeniden uygulama en az yetkiyi geri kurar: worker'ın üye olduğu her rol üyeliği kaldırılır.
do $$ declare r text; begin
 for r in select g.rolname from pg_auth_members m join pg_roles g on g.oid=m.roleid join pg_roles w on w.oid=m.member where w.rolname='worker'
 loop execute format('revoke %I from worker',r); end loop;
end $$;

create schema if not exists worker;
revoke all on schema worker from public,anon,authenticated;
grant usage on schema worker to worker;
-- Bu şemada sonradan oluşturulan fonksiyonlar kendiliğinden PUBLIC'e açılmaz.
alter default privileges in schema worker revoke execute on functions from public;

-- Sağlık: veritabanı saati ve v1 anahtarının durumu. Kişisel veri yok.
create or replace function worker.health() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('db_time',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'v1_enabled',(select s.v1_enabled from private.api_settings s where s.id=1)) $$;

-- v1 kullanım özeti: saat × sürüm × uç başına çağrı (kişisel veri ya da hesap yok). 1–168 saat.
create or replace function worker.api_usage(p_hours integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_hours is null or p_hours<1 or p_hours>168 then raise exception 'Invalid hours' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('hour',to_char(u.hour at time zone 'UTC','YYYY-MM-DD"T"HH24":00Z"'),'version',u.version,'fn',u.fn,'calls',u.calls) order by u.hour desc,u.fn)
  from (select hour,version,fn,sum(calls)::bigint calls from private.api_usage where hour>=date_trunc('hour',now())-make_interval(hours=>p_hours) group by 1,2,3) u),'[]'::jsonb);
end $$;

revoke all on function worker.health(),worker.api_usage(integer) from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then execute 'revoke all on function worker.health(),worker.api_usage(integer) from service_role'; end if;
end $$;
grant execute on function worker.health(),worker.api_usage(integer) to worker;

do $$ begin
 if exists(select 1 from pg_roles where rolname='authenticator') then grant worker to authenticator; end if;
end $$;

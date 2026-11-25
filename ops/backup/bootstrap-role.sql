-- NakGo ilk yedek (bootstrap) için geçici, salt okunur giriş rolü: nakgo_bootstrap_reader.
-- Ayrıntı ve gerekçe: docs/backup/runbooks/bootstrap-first-backup.md → "Bootstrap rolü".
--
-- Çalıştırma (proje sahibi, kendi makinesinden, postgres rolüyle; ayrı yazılı onayla):
--   psql --single-transaction -v ON_ERROR_STOP=1 -v valid_until='<ISO tarih, en fazla 14 gün sonrası>' -f ops/backup/bootstrap-role.sql
-- Parola bu betikte YOKTUR: rol parolasız oluşur ve giriş yapamaz. Parola ayrı adımda, sahibin makinesinde
-- psql "\password nakgo_bootstrap_reader" ile verilir (psql parolayı istemci tarafında SCRAM özetine çevirir; düz parola
-- sunucuya, betiğe, Git'e ya da günlüğe gitmez).
--
-- Salt okunurluk oturum ayarına dayanmaz: rolün hiçbir yazma yetkisi, nesne sahipliği ya da yazabilen bir role üyeliği
-- yoktur. default_transaction_read_only yalnız ek katmandır (oturum kapatabilir).

do $$ begin
  if exists(select 1 from pg_roles where rolname='nakgo_bootstrap_reader') then
    raise exception 'nakgo_bootstrap_reader zaten var: önce bootstrap-role-drop.sql ile kaldırın';
  end if;
  if to_regprocedure('private.nakgo_backup_guard_counts()') is not null then
    raise exception 'yedek rolünün fonksiyonları veritabanında var: bootstrap rolü gerekmez (K6b yolu)';
  end if;
end $$;

-- LOGIN: yalnız parola verildikten sonra giriş yapabilir. NOINHERIT: üyelikler ancak açıkça INHERIT TRUE ile verilirse etkili.
-- BYPASSRLS: tam şemalardaki 20 tablonun tamamında ve auth.users, cron.job gibi kapsam tablolarında RLS açık. Bu öznitelik
-- olmadan doğrudan okuma eksik satır döndürür (cron.job yalnız kendi işlerini gösterir) ve pg_dump (row_security=off)
-- hata verir. Öznitelik rol düzeyindedir; tablo bazında daraltılamaz. Etkisi rolün okuyabildiği tablolarla sınırlıdır.
create role nakgo_bootstrap_reader login noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls
  connection limit 3 valid until :'valid_until';

-- Okuma: yalnız pg_read_all_data (tüm tablo, görünüm ve dizilerde SELECT, tüm şemalarda USAGE). Gerekçe: Auth/Storage'ın
-- yeni tablolarında (oauth_*, scim_*, webauthn_*, Storage yaşam döngüsü ve analitik/vektör tabloları) postgres'in
-- yetki devretme hakkı yok; doğrudan GRANT ile "satır var mı" korumaları sayılamaz. SET FALSE: SET ROLE ile rol
-- değiştirilemez. ADMIN yok.
grant pg_read_all_data to nakgo_bootstrap_reader with inherit true, set false, admin false;

-- Ek katmanlar (güvenlik sınırı değil): varsayılan salt okunur işlem, zaman aşımları.
alter role nakgo_bootstrap_reader set default_transaction_read_only = on;
alter role nakgo_bootstrap_reader set statement_timeout = '15min';
alter role nakgo_bootstrap_reader set lock_timeout = '30s';
alter role nakgo_bootstrap_reader set idle_in_transaction_session_timeout = '20min';

-- Son denetim: beklenen öznitelik ve üyelikler dışında bir şey varsa tüm işlem geri alınır.
do $$
declare r record; m text[];
begin
  select * into r from pg_roles where rolname='nakgo_bootstrap_reader';
  if r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolinherit or not r.rolbypassrls or not r.rolcanlogin
     or r.rolconnlimit<>3 then raise exception 'beklenmeyen rol öznitelikleri'; end if;
  if r.rolvaliduntil is null or r.rolvaliduntil<=now() or r.rolvaliduntil>now()+interval '14 days' then
    raise exception 'valid_until şimdiden sonra ve en fazla 14 gün içinde olmalı';
  end if;
  if not ('default_transaction_read_only=on'=any(r.rolconfig)) then raise exception 'salt okunur varsayılan ayarlanmadı'; end if;
  select array_agg(g.rolname::text order by g.rolname) into m from pg_auth_members a join pg_roles g on g.oid=a.roleid where a.member=r.oid;
  if m is distinct from array['pg_read_all_data']::text[] then raise exception 'beklenmeyen üyelik: %',m; end if;
  if exists(select 1 from pg_auth_members a where a.member=r.oid and (a.admin_option or a.set_option or not a.inherit_option)) then
    raise exception 'pg_read_all_data üyeliği yalnız INHERIT olmalı';
  end if;
  -- Ters yön: bu role kimler üye? PostgreSQL 16+ süper kullanıcı olmayan oluşturucuya (Supabase'de postgres) rol üzerinde
  -- otomatik ADMIN üyeliği verir. Beklenen tek satır budur: üye = oluşturucu, yalnız ADMIN (INHERIT ve SET yok; yani
  -- oluşturucu bu rolün yetkilerini almaz ve SET ROLE yapamaz). createrole_self_grant ya da başka bir üyelik varsa geri alınır.
  select array_agg(format('%s admin=%s inherit=%s set=%s',u.rolname,a.admin_option::text,a.inherit_option::text,a.set_option::text) order by 1) into m
    from pg_auth_members a join pg_roles u on u.oid=a.member where a.roleid=r.oid;
  if m is distinct from array[format('%s admin=true inherit=false set=false',current_user)] then
    raise exception 'beklenmeyen rol üyeleri (yalnız oluşturucu %, yalnız ADMIN beklenir): %',current_user,m;
  end if;
end $$;

-- NakGo yedek rolü. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.
-- Yöntem: Supabase'in resmi yedek rolü (BYPASSRLS + pg_read_all_data). pg_dump RLS'yi kapatır; BYPASSRLS olmadan durur.
-- pg_read_all_data: auth ve storage DAHİL her şemadaki tablo, görünüm ve dizileri OKUR (oturumlar ve yenileme
-- belirteçleri dahil). Döküm kapsamı ayrıca ops/backup/scope.json ile sınırlanır; okuma yetkisi bundan geniştir.
-- Büyük nesneler (large objects) pg_read_all_data kapsamında DEĞİLDİR.
create role nakgo_backup login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2
  password :'backup_password' valid until :'valid_until';
-- Yalnız bu üyelik için INHERIT açık; ADMIN ve SET kapalı (PG16+ sözdizimi).
grant pg_read_all_data to nakgo_backup with inherit true, set false;
-- default_transaction_read_only GÜVENLİK SINIRI DEĞİLDİR: oturum "set default_transaction_read_only = off" diyebilir.
-- Gerçek sınırlar: yalnız okuma veren üyelik, yazma yetkisi olmaması ve privilege-audit denetimidir.
alter role nakgo_backup set default_transaction_read_only = on;
alter role nakgo_backup set statement_timeout = '15min';
alter role nakgo_backup set lock_timeout = '30s';
alter role nakgo_backup set idle_in_transaction_session_timeout = '20min';

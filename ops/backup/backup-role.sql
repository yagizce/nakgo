-- NakGo yedek rolü. Kaynak: ops/backup/scope.json. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.
-- BYPASSRLS: pg_dump RLS'li tablolarda satır kaçırmamak için gerekir; rol bu yüzden kapsamdaki her satırı OKUYABİLİR.
create role nakgo_backup login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2
  password :'backup_password' valid until :'valid_until';
alter role nakgo_backup set default_transaction_read_only = on;
alter role nakgo_backup set statement_timeout = '15min';
alter role nakgo_backup set lock_timeout = '30s';
alter role nakgo_backup set idle_in_transaction_session_timeout = '20min';
grant usage on schema public, private to nakgo_backup;
grant select on all tables in schema public, private to nakgo_backup;
grant select on all sequences in schema public, private to nakgo_backup;
grant usage on schema auth, storage to nakgo_backup;
grant select on auth.users, auth.identities to nakgo_backup;
do $$ begin if to_regclass('auth.mfa_factors') is not null then execute 'grant select on auth.mfa_factors to nakgo_backup'; end if; end $$;
do $$ begin if to_regclass('auth.schema_migrations') is not null then execute 'grant select on auth.schema_migrations to nakgo_backup'; end if; end $$;
do $$ begin if to_regclass('storage.buckets') is not null then execute 'grant select on storage.buckets to nakgo_backup'; end if; end $$;
do $$ begin if to_regclass('storage.objects') is not null then execute 'grant select on storage.objects to nakgo_backup'; end if; end $$;
-- Yeni tablolar için varsayılan yetki VERİLMEZ: yeni tablo eklendiğinde yedek "yetki yok" diye durur (bilinçli kırılma).

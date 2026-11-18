-- NakGo yedek rolü. Üretici: tools/backup/backup-role.cjs. Elle düzenlenmez.
-- Şemaların ve dışa aktarma fonksiyonlarının SAHİBİ olan rolle çalıştırılır (Supabase: postgres). Süper kullanıcı gerekmez;
-- BYPASSRLS verebilmek için çalıştıran rolün de BYPASSRLS'i olmalıdır (PG16+). Tek işlem olarak çalıştırılır (psql --single-transaction): biri başarısızsa rol oluşmaz.
create role nakgo_backup login bypassrls nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 2
  password :'backup_password' valid until :'valid_until';
-- Üyelik verilmez (pg_read_all_data dahil). Okuma yalnız aşağıdaki doğrudan yetkilerle.
grant usage on schema public, private to nakgo_backup;
grant select on all tables in schema public, private to nakgo_backup;
grant select on all sequences in schema public, private to nakgo_backup;
-- Bu betiği çalıştıran rolün ileride oluşturacağı tablolar da okunur. Başka bir rolün oluşturduğu tablo okunamaz ve
-- döküm "yetki" aşamasında açıkça durur (sessiz eksik yok).
alter default privileges in schema public, private grant select on tables to nakgo_backup;
alter default privileges in schema public, private grant select on sequences to nakgo_backup;
-- Auth/Storage: tablo yetkisi YOK; yalnız sabit kapsamlı dışa aktarma ve sayım fonksiyonları.
grant execute on function private.nakgo_backup_auth_users() to nakgo_backup;
grant execute on function private.nakgo_backup_auth_identities() to nakgo_backup;
grant execute on function private.nakgo_backup_auth_mfa_factors() to nakgo_backup;
grant execute on function private.nakgo_backup_auth_schema_migrations() to nakgo_backup;
grant execute on function private.nakgo_backup_storage_buckets() to nakgo_backup;
grant execute on function private.nakgo_backup_storage_objects() to nakgo_backup;
grant execute on function private.nakgo_backup_guard_counts() to nakgo_backup;
-- default_transaction_read_only GÜVENLİK SINIRI DEĞİLDİR: oturum "set default_transaction_read_only = off" diyebilir.
-- Açık kaldığı sürece lo_create ve geçici tablo gibi PUBLIC yan yollarını da engeller (ek katman).
alter role nakgo_backup set default_transaction_read_only = on;
alter role nakgo_backup set statement_timeout = '15min';
alter role nakgo_backup set lock_timeout = '30s';
alter role nakgo_backup set idle_in_transaction_session_timeout = '20min';

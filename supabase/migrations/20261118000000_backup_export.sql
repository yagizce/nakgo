-- B7-A güvenlik sonlandırma: yedek rolünün Auth ve Storage verisine DAR erişimi.
-- Yedek rolü (nakgo_backup) auth ve storage şemalarında hiçbir tabloyu doğrudan okuyamaz; pg_read_all_data üyeliği de
-- yoktur. Kapsamdaki satırları yalnız aşağıdaki, postgres'in sahibi olduğu sabit kapsamlı fonksiyonlardan alır.
-- Oturum, yenileme belirteci ve diğer geçici Auth tabloları için fonksiyon YOKTUR.
-- Fonksiyonlar PUBLIC'e kapalıdır; EXECUTE yalnız yedek rolü oluşturulurken o role verilir (ops/backup/backup-role.sql).
-- Hepsi salt okunurdur (stable, yazma yok, dinamik SQL yok) ve search_path pg_catalog, pg_temp ile sabittir.
-- Sahip rol (postgres) için RLS etkinse fonksiyon HATA verir: sessizce eksik satır döndürmek yerine döküm durur.
begin;

-- Kullanıcılar. Tek kullanımlık belirteç sütunları (e-posta onayı, parola sıfırlama, e-posta/telefon değişikliği,
-- yeniden doğrulama) yedeğe GİRMEZ: boş metin olarak verilir. Geri yüklemeden sonra bekleyen bu akışlar yeniden başlatılır.
create function private.nakgo_backup_auth_users() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if row_security_active('auth.users') then raise exception 'RLS etkin: auth.users eksik okunur'; end if;
 return query
  select x.j || coalesce((select jsonb_object_agg(k,'') from unnest(array['confirmation_token','recovery_token','email_change_token_new',
    'email_change_token_current','reauthentication_token','phone_change_token']) k where x.j ? k),'{}'::jsonb)
  from (select to_jsonb(u) j from auth.users u) x;
end $$;

create function private.nakgo_backup_auth_identities() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if row_security_active('auth.identities') then raise exception 'RLS etkin: auth.identities eksik okunur'; end if;
 return query select to_jsonb(t) from auth.identities t;
end $$;

-- MFA faktörleri: yönetici AAL2 girişi için gerekir; TOTP sırrı şifreli yedekte bulunur.
create function private.nakgo_backup_auth_mfa_factors() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if to_regclass('auth.mfa_factors') is null then return; end if;
 if row_security_active('auth.mfa_factors') then raise exception 'RLS etkin: auth.mfa_factors eksik okunur'; end if;
 return query select to_jsonb(t) from auth.mfa_factors t;
end $$;

create function private.nakgo_backup_auth_schema_migrations() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if to_regclass('auth.schema_migrations') is null then return; end if;
 if row_security_active('auth.schema_migrations') then raise exception 'RLS etkin: auth.schema_migrations eksik okunur'; end if;
 return query select to_jsonb(t) from auth.schema_migrations t;
end $$;

create function private.nakgo_backup_storage_buckets() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if to_regclass('storage.buckets') is null then return; end if;
 if row_security_active('storage.buckets') then raise exception 'RLS etkin: storage.buckets eksik okunur'; end if;
 return query select to_jsonb(t) from storage.buckets t;
end $$;

-- Yalnız dosya meta verisi; dosyaların kendisi veritabanında değildir (ayrı dosya yedeği: docs/backup/storage-files.md).
create function private.nakgo_backup_storage_objects() returns setof jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
begin
 if to_regclass('storage.objects') is null then return; end if;
 if row_security_active('storage.objects') then raise exception 'RLS etkin: storage.objects eksik okunur'; end if;
 return query select to_jsonb(t) from storage.objects t;
end $$;

-- Kapsam dışı tabloların yalnız KESİN SATIR SAYILARI (içerik değil). Liste ops/backup/scope.json ile aynı olmalıdır
-- (test denetler). Tablo yoksa anahtar yazılmaz.
create function private.nakgo_backup_guard_counts() returns jsonb language plpgsql stable security definer
 set search_path = pg_catalog, pg_temp as $$
declare r jsonb:='{}'; n bigint;
begin
 if to_regclass('auth.webauthn_credentials') is not null then if row_security_active('auth.webauthn_credentials') then raise exception 'RLS etkin: auth.webauthn_credentials'; end if; select count(*) into n from auth.webauthn_credentials; r:=r||jsonb_build_object('auth.webauthn_credentials',n); end if;
 if to_regclass('auth.oauth_clients') is not null then if row_security_active('auth.oauth_clients') then raise exception 'RLS etkin: auth.oauth_clients'; end if; select count(*) into n from auth.oauth_clients; r:=r||jsonb_build_object('auth.oauth_clients',n); end if;
 if to_regclass('auth.oauth_authorizations') is not null then if row_security_active('auth.oauth_authorizations') then raise exception 'RLS etkin: auth.oauth_authorizations'; end if; select count(*) into n from auth.oauth_authorizations; r:=r||jsonb_build_object('auth.oauth_authorizations',n); end if;
 if to_regclass('auth.oauth_consents') is not null then if row_security_active('auth.oauth_consents') then raise exception 'RLS etkin: auth.oauth_consents'; end if; select count(*) into n from auth.oauth_consents; r:=r||jsonb_build_object('auth.oauth_consents',n); end if;
 if to_regclass('auth.saml_providers') is not null then if row_security_active('auth.saml_providers') then raise exception 'RLS etkin: auth.saml_providers'; end if; select count(*) into n from auth.saml_providers; r:=r||jsonb_build_object('auth.saml_providers',n); end if;
 if to_regclass('auth.sso_providers') is not null then if row_security_active('auth.sso_providers') then raise exception 'RLS etkin: auth.sso_providers'; end if; select count(*) into n from auth.sso_providers; r:=r||jsonb_build_object('auth.sso_providers',n); end if;
 if to_regclass('auth.sso_domains') is not null then if row_security_active('auth.sso_domains') then raise exception 'RLS etkin: auth.sso_domains'; end if; select count(*) into n from auth.sso_domains; r:=r||jsonb_build_object('auth.sso_domains',n); end if;
 if to_regclass('auth.custom_oauth_providers') is not null then if row_security_active('auth.custom_oauth_providers') then raise exception 'RLS etkin: auth.custom_oauth_providers'; end if; select count(*) into n from auth.custom_oauth_providers; r:=r||jsonb_build_object('auth.custom_oauth_providers',n); end if;
 if to_regclass('auth.scim_users') is not null then if row_security_active('auth.scim_users') then raise exception 'RLS etkin: auth.scim_users'; end if; select count(*) into n from auth.scim_users; r:=r||jsonb_build_object('auth.scim_users',n); end if;
 if to_regclass('auth.scim_tokens') is not null then if row_security_active('auth.scim_tokens') then raise exception 'RLS etkin: auth.scim_tokens'; end if; select count(*) into n from auth.scim_tokens; r:=r||jsonb_build_object('auth.scim_tokens',n); end if;
 if to_regclass('vault.secrets') is not null then if row_security_active('vault.secrets') then raise exception 'RLS etkin: vault.secrets'; end if; select count(*) into n from vault.secrets; r:=r||jsonb_build_object('vault.secrets',n); end if;
 if to_regclass('auth.mfa_recovery_code_sets') is not null then if row_security_active('auth.mfa_recovery_code_sets') then raise exception 'RLS etkin: auth.mfa_recovery_code_sets'; end if; select count(*) into n from auth.mfa_recovery_code_sets; r:=r||jsonb_build_object('auth.mfa_recovery_code_sets',n); end if;
 if to_regclass('auth.mfa_recovery_codes') is not null then if row_security_active('auth.mfa_recovery_codes') then raise exception 'RLS etkin: auth.mfa_recovery_codes'; end if; select count(*) into n from auth.mfa_recovery_codes; r:=r||jsonb_build_object('auth.mfa_recovery_codes',n); end if;
 if to_regclass('auth.audit_log_entries') is not null then if row_security_active('auth.audit_log_entries') then raise exception 'RLS etkin: auth.audit_log_entries'; end if; select count(*) into n from auth.audit_log_entries; r:=r||jsonb_build_object('auth.audit_log_entries',n); end if;
 if to_regclass('storage.objects') is not null then if row_security_active('storage.objects') then raise exception 'RLS etkin: storage.objects'; end if; select count(*) into n from storage.objects; r:=r||jsonb_build_object('storage.objects',n); end if;
 if to_regclass('pg_catalog.pg_largeobject_metadata') is not null then if row_security_active('pg_catalog.pg_largeobject_metadata') then raise exception 'RLS etkin: pg_catalog.pg_largeobject_metadata'; end if; select count(*) into n from pg_catalog.pg_largeobject_metadata; r:=r||jsonb_build_object('pg_largeobject_metadata',n); end if;
 return r;
end $$;

revoke all on function private.nakgo_backup_auth_users(),private.nakgo_backup_auth_identities(),private.nakgo_backup_auth_mfa_factors(),
 private.nakgo_backup_auth_schema_migrations(),private.nakgo_backup_storage_buckets(),private.nakgo_backup_storage_objects(),
 private.nakgo_backup_guard_counts() from public;
-- Sahip dışındaki HER EXECUTE yetkisi geri alınır: PUBLIC'in yanında, projede tanımlı olabilecek varsayılan yetkilerle
-- (ör. anon/authenticated/service_role ya da başka bir rol) gelenler de. Yedek rolü EXECUTE'u yalnız rol betiğiyle alır.
do $$ declare r record; begin
 for r in select p.oid::regprocedure f,a.grantee g from pg_catalog.pg_proc p
   cross join lateral pg_catalog.aclexplode(p.proacl) a
   where p.pronamespace='private'::regnamespace and p.pronargs=0 and a.grantee<>p.proowner
     and p.proname in ('nakgo_backup_auth_users','nakgo_backup_auth_identities','nakgo_backup_auth_mfa_factors',
       'nakgo_backup_auth_schema_migrations','nakgo_backup_storage_buckets','nakgo_backup_storage_objects','nakgo_backup_guard_counts') loop
  execute format('revoke all on function %s from %s',r.f,case when r.g=0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(r.g)) end);
 end loop;
end $$;
commit;

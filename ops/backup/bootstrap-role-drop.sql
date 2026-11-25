-- nakgo_bootstrap_reader rolünü kaldırır. İlk yedek finalize edildikten sonra (ya da iptalde) proje sahibi çalıştırır:
--   psql -X -v ON_ERROR_STOP=1 -f ops/backup/bootstrap-role-drop.sql
-- --single-transaction KULLANILMAZ: 1. adımın (NOLOGIN) kendi işleminde commit edilmesi gerekir; betik bunu denetler ve
-- tek işlem içinde çalıştırılırsa hiçbir şeyi değiştirmeden durur.
--
-- Etki: yalnız bu rolün açık oturumları sonlandırılır; başka rollerin bağlantıları etkilenmez. Rol hiçbir nesnenin sahibi
-- değildir ve hiçbir nesnede yetkisi yoktur; tek bağı pg_read_all_data üyeliğidir.
-- Tekrar çalıştırılabilir: 2. adım herhangi bir nedenle durursa rol NOLOGIN olarak kalır (yeni giriş yapılamaz); sorun
-- giderilip betik yeniden çalıştırılır. Rol yoksa hiçbir şey yapmaz.

-- 1. adım (kendi işlemi, hemen commit edilir): yeni girişleri kes. Commit edilmeden diğer bağlantılar bu değişikliği
-- görmez; oturumlar sonlandırılırken araya yeni giriş girmesini bu ayrım önler.
do $$ begin
  if exists(select 1 from pg_roles where rolname='nakgo_bootstrap_reader') then
    execute 'alter role nakgo_bootstrap_reader nologin';
  else
    raise notice 'nakgo_bootstrap_reader yok: yapılacak bir şey yok';
  end if;
end $$;
select pg_current_xact_id()::text as nakgo_step1_xid \gset

-- 2. adım (tek işlem): nesne ve üyelik bağlarını denetle, sonra oturumları sonlandır ve rolü sil.
begin;
select set_config('nakgo.step1_xid',:'nakgo_step1_xid',true);
do $$
declare n int; m text[];
begin
  if pg_current_xact_id()=current_setting('nakgo.step1_xid')::xid8 then
    raise exception 'betik tek işlem içinde çalışıyor (--single-transaction): NOLOGIN ayrı commit edilmedi, hiçbir şey değiştirilmedi';
  end if;
  if not exists(select 1 from pg_roles where rolname='nakgo_bootstrap_reader') then
    raise notice 'nakgo_bootstrap_reader yok: yapılacak bir şey yok';
    return;
  end if;
  if (select rolcanlogin from pg_roles where rolname='nakgo_bootstrap_reader') then
    raise exception 'rol hâlâ LOGIN: 1. adım commit edilmemiş';
  end if;
  -- Bağlar oturumlar kapatılmadan önce denetlenir: burada durulursa açık oturumlara da dokunulmamış olur.
  if exists(select 1 from pg_shdepend d join pg_roles r on r.oid=d.refobjid where r.rolname='nakgo_bootstrap_reader' and d.deptype in ('o','a','i','r')) then
    raise exception 'rolün sahip olduğu, yetkili olduğu ya da politikada geçtiği nesne var: elle incelenmeli (rol NOLOGIN kaldı)';
  end if;
  -- Üyelik bağları da oturumlar kapatılmadan önce denetlenir. Beklenen tam olarak iki satır (bootstrap-role.sql ile aynı):
  --   rol → pg_read_all_data (yalnız INHERIT) ve betiği çalıştıran oluşturucu (postgres) → rol (yalnız ADMIN).
  -- Başka bir üyelik varsa betik durur; üyelik silinmez ya da değiştirilmez, elle incelenir.
  select array_agg(x order by x collate "C") into m from (
    select format('üye: %s admin=%s inherit=%s set=%s',g.rolname,a.admin_option::text,a.inherit_option::text,a.set_option::text) x
      from pg_auth_members a join pg_roles r on r.oid=a.member join pg_roles g on g.oid=a.roleid where r.rolname='nakgo_bootstrap_reader'
    union all
    select format('üyesi: %s admin=%s inherit=%s set=%s',u.rolname,a.admin_option::text,a.inherit_option::text,a.set_option::text)
      from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles u on u.oid=a.member where r.rolname='nakgo_bootstrap_reader') t;
  if m is distinct from array['üye: pg_read_all_data admin=false inherit=true set=false',
                              format('üyesi: %s admin=true inherit=false set=false',current_user)] then
    raise exception 'beklenmeyen üyelik (oluşturucu % ile çalıştırılmalı): % — elle incelenmeli (rol NOLOGIN kaldı, oturumlara dokunulmadı)',current_user,m;
  end if;
  -- Yalnız oturum kullanıcısı bu rol olan bağlantılar (usename = oturumu açan rol). Sonlandırma sinyali işlemden
  -- bağımsızdır: aşağıdaki DROP ROLE başarısız olsa da bu oturumlar kapanmış olur (güvenli yön).
  select count(*) into n from (select pg_terminate_backend(pid) from pg_stat_activity where usename='nakgo_bootstrap_reader') t;
  raise notice 'sonlandırılan oturum: %',n;
  execute 'revoke pg_read_all_data from nakgo_bootstrap_reader';
  execute 'drop role nakgo_bootstrap_reader';
end $$;
commit;

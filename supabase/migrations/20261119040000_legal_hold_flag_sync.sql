-- İlan saklama işareti (listing_moderation.hold) yasal arşivdeki ilan kapsamlı korumadan türetilir; kayma oluşamaz.
--
-- Sorun: gece temizliği (retention_run, retention_batch), hesap silme (erase_account) ve kalıcı silme saklamayı
-- listing_moderation.hold işaretinden okuyor. İşaret yasal arşivin (#125) legal_sync_listing çağrısıyla eşitleniyor; ama
-- doğrudan SQL ile (SQL Editor, betik) işaret false yapılabiliyor, satır silinebiliyor ya da legal_holds'a eşitlemesiz satır
-- eklenebiliyordu. Bu "kayma" durumunda aktif yasal korumaya rağmen ilan içeriği karartılıyor; kalıcı silme adımı ise
-- #152 tetikleyicisine takılıp gece temizliğinin tamamını durduruyordu.
--
-- Çözüm (saklama kapsamı ve süreleri değişmez; yalnız işaretin korumayla tutarlılığı zorlanır):
--  1. listing_moderation_hold_guard: ilanda serbest bırakılmamış legal_holds varken hold false yapılamaz ve satır
--     silinemez (55000). Yasal kaydı olmayan eski işaret (#125 öncesi) eskisi gibi kaldırılabilir.
--  2. legal_holds_flag_sync: legal_holds'a satır eklenince ya da koruma serbest bırakılınca legal_sync_listing çağrılır;
--     işaret doğrudan SQL eklemesinde de açılır, son aktif koruma kalkınca kapanır. Mevcut açık çağrılar (legal_open,
--     add_hold, legal_release) aynı kalır; ikinci çağrı değişiklik yapmaz.
--  3. Bir kerelik onarım: aktif koruması olup işareti kapalı kalmış ilanlar eşitlenir.
-- #125 kurulu değilse (a3-legal "#125 yokken" kurulumu) tetikleyiciler ve onarım atlanır; fonksiyonlar yine oluşur.
begin;
set local lock_timeout='5s';

create function private.listing_hold_flag_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='DELETE' or not new.hold)
  and exists(select 1 from private.legal_holds h where h.listing_id=old.listing_id and h.released_at is null) then
  raise exception 'Active legal hold' using errcode='55000',
   hint='Aktif yasal koruma varken ilan saklama işareti kaldırılamaz; önce koruma serbest bırakılmalı.';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create function private.legal_hold_flag_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.listing_id is not null then perform private.legal_sync_listing(new.listing_id); end if;
 return null;
end $$;

revoke all on function private.listing_hold_flag_guard(),private.legal_hold_flag_sync() from public,anon,authenticated;

do $$ declare r record; begin
 if to_regclass('private.legal_holds') is null then return; end if;
 execute 'create trigger listing_moderation_hold_guard before update of hold or delete on private.listing_moderation
  for each row execute function private.listing_hold_flag_guard()';
 execute 'create trigger legal_holds_flag_sync after insert or update on private.legal_holds
  for each row execute function private.legal_hold_flag_sync()';
 for r in execute 'select distinct listing_id from private.legal_holds where listing_id is not null and released_at is null order by listing_id' loop
  perform private.legal_sync_listing(r.listing_id);
 end loop;
end $$;
commit;

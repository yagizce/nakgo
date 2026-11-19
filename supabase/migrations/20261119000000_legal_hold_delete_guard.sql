-- Yasal saklamadaki ilan hiçbir yoldan silinemez.
--
-- Sorun: public.listings.owner_id, auth.users'a ON DELETE CASCADE ile bağlı. Gece temizliği (retention_run,
-- retention_batch) saklamadaki ilanı ve sahibini atlıyor; ama hesap Supabase Auth'tan doğrudan silinirse (panel ya da
-- Auth yönetim API'si) zincirleme silme saklamadaki ilanı ve ona bağlı listing_moderation satırını da siliyordu.
--
-- Çözüm: ilan satırında BEFORE DELETE tetikleyicisi. İlanda aktif yasal saklama varsa silme 55000 hatasıyla durur.
-- Zincirleme silmede de çalışır; hata bütün işlemi geri aldığı için Auth'taki hesap silinmez, yarım silme kalmaz.
--  * Aktif saklama: listing_moderation.hold (mevcut temizlik kodunun baktığı işaret) ya da yasal arşivde (#125)
--    serbest bırakılmamış ilan kapsamlı koruma. İkisinden biri yeterlidir; işaret eşitlemesi kaymışsa da korur.
--  * FK değişmez (ON DELETE CASCADE kalır): saklaması olmayan ilanlar hesapla birlikte eskisi gibi silinir; gece
--    temizliğinin hesap silme adımı ve 1 yıllık ilan silme adımı aynı çalışır.
--  * Saklama kalkınca (release) ilan yine normal kurallarla silinir. Saklama kapsamı ve süreleri değişmez.
begin;
set local lock_timeout='5s';

create function private.listing_legal_hold_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.listing_moderation m where m.listing_id=old.id and m.hold)
  or exists(select 1 from private.legal_holds h where h.listing_id=old.id and h.released_at is null) then
  raise exception 'Listing under legal hold' using errcode='55000',
   hint='Yasal saklamadaki ilan silinemez; önce saklama kaldırılmalı.';
 end if;
 return old;
end $$;
revoke all on function private.listing_legal_hold_guard() from public,anon,authenticated;

create trigger listings_legal_hold_guard before delete on public.listings
 for each row execute function private.listing_legal_hold_guard();
commit;

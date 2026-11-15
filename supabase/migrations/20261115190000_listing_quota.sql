-- Hesap başına ilan sınırı: aynı anda en fazla 10 yayında ilan.
-- "Yayında" = status 'active' ve 6 saatlik süresi dolmamış (expires_at>now()); kapatılan, arşivlenen,
-- süresi dolan ve silinen hesaba ait ilanlar sayılmaz. Sınır yeni ilanda ve kapalı/süresi dolmuş ilanın
-- yeniden yayınlanmasında uygulanır (süresi dolmuş ilan herhangi bir düzenlemeyle de yeniden yayına
-- girer, bu yüzden tetikleyici her güncellemede çalışır); yayındaki ilanın düzenlenmesi etkilenmez.
-- Yalnız sahibin kendi işlemi sınırlanır: admin ve gece temizliği gibi sistem işleri etkilenmez. Hesap başına danışma
-- kilidi eşzamanlı isteklerin sınırı aşmasını engeller. Hata kodu 54000 (route_alerts sınırıyla aynı).
begin;
create function private.listing_quota() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'active' or auth.uid() is null or auth.uid()<>new.owner_id then return new; end if;
 if tg_op='UPDATE' and old.status='active' and old.expires_at>now() then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text,7312));
 if (select count(*) from public.listings l
     where l.owner_id=new.owner_id and l.status='active' and l.expires_at>now() and l.id is distinct from new.id)>=10 then
  raise exception 'Listing limit' using errcode='54000';
 end if;
 return new;
end $$;
revoke all on function private.listing_quota() from public,anon,authenticated;
create trigger listings_quota before insert or update on public.listings
 for each row execute function private.listing_quota();
commit;

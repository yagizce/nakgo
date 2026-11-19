-- v0: askıdaki sahibin ilanları diğer üyelere görünmez ve favoriye eklenemez (API v1 ve misafir akışıyla aynı kural).
--
-- Sorun: yönetici "askıya al" işlemi ilanları kapatmaz (yalnız "yasakla" kapatır). Misafir akışı
-- (nakgo_public_listings), API v1 (private.api_visible_listings), telefon (nakgo_listing_contact) ve şikâyet
-- askıdaki sahibin ilanını gizliyordu; ama v0 üye okuması (listings_read RLS: liste, ayrıntı, favori ilişkisi) ve
-- v0 favori ekleme (nakgo_set_favorite) gizlemiyordu. v1'den v0'a dönen istemci ya da doğrudan PostgREST ile tabloya
-- erişen bir üye bu ilanları görebiliyordu.
--
-- Çözüm:
--  * listings_read'in "başkasının ilanı" kısmına not private.account_suspended(owner_id). Sahip kısmı değişmez: askıdaki
--    sahip kendi (karartılmamış) ilanlarını görmeye devam eder.
--  * RLS koşulu sorgulayan rolle değerlendirildiği için authenticated'a private.account_suspended(uuid) EXECUTE verilir.
--    Fonksiyon SECURITY DEFINER'dır ve yalnız true/false döner; private şeması PostgREST'e açık değildir
--    (private.document_account_verified ile aynı model). anon'a verilmez (anon tabloyu okuyamaz).
--  * nakgo_set_favorite eklemede askıdaki sahibin ilanını reddeder ('Listing unavailable', 42501). Kaldırma aynı kalır.
--    Gövde yeniden yazılmaz: 20261111040000 ile aynı yöntemle tek koşul eklenir; beklenen metin yoksa migration durur.
-- Kaldırılan ilan (moderasyon) zaten 'archived' olduğu için kural genişletilmedi.
begin;
set local lock_timeout='5s';

grant execute on function private.account_suspended(uuid) to authenticated;

alter policy listings_read on public.listings using(
 (owner_id=(select auth.uid()) and redacted_at is null) or (status='active' and expires_at>now()
  and (loading_text is not null or coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not private.account_suspended(owner_id)));

do $$ declare d text;
 old_sql text:='l.status<>''active'' or l.expires_at<=now() or ';
 new_sql text:='l.status<>''active'' or l.expires_at<=now() or private.account_suspended(l.owner_id) or ';
begin
 d:=pg_get_functiondef('public.nakgo_set_favorite(bigint,boolean)'::regprocedure);
 if (length(d)-length(replace(d,old_sql,'')))/length(old_sql)<>1 then raise exception 'Unexpected public.nakgo_set_favorite definition'; end if;
 execute replace(d,old_sql,new_sql);
end $$;
commit;

-- B2: liste sorgusu ve depo dışı fonksiyon izni.
--  * Liste sorguları (misafir nakgo_public_listings, üye listings_read) "aktif ve süresi dolmamış" ilanları ister.
--    Süresi dolan ilan gece kapanana kadar status='active' kalır; mevcut indeks bunları da tarar. Kısmi indeks
--    yalnız aktif ilanların bitiş zamanını tutar; planlayıcı süresi dolmamış küçük kümeyi doğrudan bulur.
--  * public.rls_auto_enable(): Supabase panelindeki "yeni tablolarda RLS'yi aç" ayarının oluşturduğu olay tetikleyicisi
--    fonksiyonu; depoda yok, production'da misafir ve üyeye EXECUTE açık. Varsa izin kaldırılır; tetikleyici çalışmaya
--    devam eder (olay tetikleyicisi EXECUTE izni gerektirmez). Yoksa (yerel, test) hiçbir şey yapılmaz.
begin;
create index listings_active_expires on public.listings(expires_at) where status='active';
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke all on function public.rls_auto_enable() from public,anon,authenticated;
 end if;
end $$;
commit;

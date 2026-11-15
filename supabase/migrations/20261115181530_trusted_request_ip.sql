-- Yasal erişim kaydı (5651) için IP yalnız güvenilir proxy başlıklarından alınır.
-- Güvenilir sınır: Supabase API ağ geçidi (Cloudflare önünde). DEV'de (15 Kasım 2026) gözlendi:
--  * sb-forwarded-for: ağ geçidi yazar; istemcinin gönderdiği değer üzerine yazılır.
--  * cf-connecting-ip: Cloudflare yazar; tarayıcıdan sahte değer gönderilen istek reddedildi.
--  * x-forwarded-for: istemcinin yazdığı değer başta korunur (gerçek IP sona eklenir) -> kullanılmaz.
--  * x-real-ip: ağ geçidi siler -> kullanılmaz.
-- Başlık yoksa veya geçersizse null kaydedilir; istemci değeri asla yerine konmaz.
begin;
create or replace function private.request_ip() returns inet language plpgsql stable set search_path='' as $$
declare h json; v text;
begin
 h:=nullif(current_setting('request.headers',true),'')::json;
 -- Bir liste gelirse en sağdaki (ağ geçidinin eklediği) adres alınır.
 v:=btrim(reverse(split_part(reverse(coalesce(h->>'sb-forwarded-for','')),',',1)));
 if v='' then v:=btrim(coalesce(h->>'cf-connecting-ip','')); end if;
 return nullif(v,'')::inet;
exception when others then return null;
end $$;
revoke all on function private.request_ip() from public,anon,authenticated;
commit;

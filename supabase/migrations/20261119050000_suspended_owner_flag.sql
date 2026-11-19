-- v0: askıdaki sahibin ilanları diğer üyelere görünmez; istemciye yeni yetki verilmez.
--
-- Sorun: "askıya al" ilanları kapatmaz. Misafir akışı, API v1, telefon ve şikâyet askıdaki sahibin ilanını gizliyor;
-- v0 üye okuması (listings_read RLS: liste, ayrıntı, favori ilişkisi) ve v0 favori ekleme (nakgo_set_favorite)
-- gizlemiyordu. RLS'te private.account_suspended(uuid) çağırmak authenticated'a EXECUTE gerektirir; bu, herhangi bir
-- kullanıcının askı durumunu sorgulama imkânı açacağı için reddedildi (#155). Bunun yerine:
--
--  1. public.listings.owner_suspended: sahibin askı durumunun ilan satırındaki kopyası. İstemci rollerine hiçbir sütun
--     yetkisi verilmez (okuma, filtre, ekleme, güncelleme 42501). RLS ifadeleri sütun yetkisi denetlemediği için kural
--     bu sütuna bakabilir.
--  2. Eşitleme yalnız güvenilir yoldan: private.account_moderation üzerindeki AFTER tetikleyici (askıya alma/kaldırma,
--     yasaklama/kaldırma, yönetici ve kullanıcı hesap silmesi, gece temizliğinin satır silmesi, doğrudan SQL). Auth'tan
--     zincirleme silmede ilanlar aynı komutta silindiği için güncellenecek satır kalmaz.
--  3. Yeni ilan: BEFORE INSERT tetikleyicisi sütunu sahibin o anki durumundan alır (istemci zaten yazamaz).
--  4. İlan tetikleyicileri (nakgo_listing_write_guard, activity_write_guard, listing_quota, listing_revision,
--     log_listing_write) yalnız owner_suspended DEĞİŞMİŞ ve başka HİÇBİR sütun değişmemişse hiçbir şey yapmadan çıkar:
--     updated_at, revision, expires_at, status, erişim kaydı ve gece temizliği zamanlaması değişmez. İstemci bu sütunu
--     değiştiremediği için bu koşulu yalnız eşitleme karşılar; istemcinin diğer güncellemeleri (hiçbir şeyi
--     değiştirmeyen "yeniden yayınla" dahil) eskisi gibi bütün korumalardan geçer.
--  5. listings_read'in "başkasının ilanı" kısmına and not owner_suspended. Sahip kısmı değişmez.
--  6. nakgo_set_favorite eklemede askıdaki sahibin ilanını reddeder (fonksiyon SECURITY DEFINER; istemci yetkisi gerekmez).
--  7. nakgo_admin_moderate: askıya alma, sahibin ilan düzenlemesiyle aynı anda olursa kilit sırası (satır kilidi /
--     danışmalı kilit) ters düşüp deadlock (40P01) oluşabilir. #148'deki gibi 'Moderation busy; refresh' (PT409) döner;
--     işlemin tamamı geri alınır, yarım kalmaz.
-- private.account_suspended(uuid) istemcilere kapalı kalır. Fonksiyon gövdeleri yeniden yazılmaz: geçerli tanımlar metin
-- olarak alınır ve yalnız bu noktalar eklenir; beklenen metin yoksa migration durur.
begin;
set local lock_timeout='5s';

alter table public.listings add column owner_suspended boolean not null default false;
comment on column public.listings.owner_suspended is 'Sahibin askı durumu (account_moderation.suspended kopyası). Yalnız güvenilir tetikleyici yazar; istemciye kapalı. listings_read RLS kullanır.';
revoke all (owner_suspended) on public.listings from public,anon,authenticated;

-- 4) Mevcut ilan tetikleyicilerine "yalnız owner_suspended değiştiyse çık" koşulu.
do $$ declare f record; d text; pat text:='(AS \$function\$\s*begin)'; skip text; n integer;
begin
 for f in select * from (values
   ('public.nakgo_listing_write_guard()',false,false),('private.activity_write_guard()',false,true),
   ('private.listing_quota()',false,false),('private.listing_revision()',false,false),('private.log_listing_write()',true,false)) v(fn,after_trigger,shared)
 loop
  d:=pg_get_functiondef(f.fn::regprocedure);
  select count(*) into n from regexp_matches(d,pat,'g');
  if n<>1 then raise exception 'Unexpected definition: %',f.fn; end if;
  skip:=E'\n -- Yalnız owner_suspended eşitlemesi (istemci bu sütunu yazamaz): korumalar ve sayaçlar çalışmaz.\n'
   ||case when f.shared then E' if tg_op=''UPDATE'' and tg_table_name=''listings'' then\n' else E' if tg_op=''UPDATE'' then\n' end
   ||E'  if new.owner_suspended is distinct from old.owner_suspended and (to_jsonb(new)-''owner_suspended'')=(to_jsonb(old)-''owner_suspended'') then\n'
   ||'   return '||case when f.after_trigger then 'null' else 'new' end||E'; end if;\n end if;';
  execute regexp_replace(d,pat,'\1'||replace(skip,'\','\\'));
 end loop;
end $$;

-- 3) Yeni ilan: sahibin o anki durumu.
create function private.listing_owner_flag_init() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.owner_suspended:=private.account_suspended(new.owner_id);
 return new;
end $$;
create trigger listings_owner_flag before insert on public.listings
 for each row execute function private.listing_owner_flag_init();

-- 2) Eşitleme: askı durumu değişince sahibin ilanları.
create function private.listing_owner_flag_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid; want boolean;
begin
 if tg_op='DELETE' then
  u:=old.user_id; want:=false;
 else
  u:=new.user_id; want:=new.suspended;
 end if;
 update public.listings set owner_suspended=want where owner_id=u and owner_suspended is distinct from want;
 return null;
end $$;
create trigger account_moderation_owner_flag after insert or update of suspended or delete on private.account_moderation
 for each row execute function private.listing_owner_flag_sync();

revoke all on function private.listing_owner_flag_init(),private.listing_owner_flag_sync() from public,anon,authenticated;

-- Mevcut askıdaki sahiplerin ilanları (yalnız sütun değişir; tetikleyiciler çıkar).
update public.listings l set owner_suspended=true
 where not l.owner_suspended and exists(select 1 from private.account_moderation m where m.user_id=l.owner_id and m.suspended);

-- 5) RLS.
alter policy listings_read on public.listings using(
 (owner_id=(select auth.uid()) and redacted_at is null) or (status='active' and expires_at>now()
  and (loading_text is not null or coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not owner_suspended));

-- 6) v0 favori ekleme.
do $$ declare d text;
 o text:='l.status<>''active'' or l.expires_at<=now() or ';
 n text:='l.status<>''active'' or l.expires_at<=now() or private.account_suspended(l.owner_id) or ';
begin
 d:=pg_get_functiondef('public.nakgo_set_favorite(bigint,boolean)'::regprocedure);
 if (length(d)-length(replace(d,o,'')))/length(o)<>1 then raise exception 'Unexpected public.nakgo_set_favorite definition'; end if;
 execute replace(d,o,n);
end $$;

-- 7) Deadlock → PT409 (#148 ile aynı yanıt).
do $$ declare d text;
 o text:=E'\n exception when lock_not_available then\n  raise exception ''Moderation busy; refresh'' using errcode=''PT409'';\n';
 n text:=E'\n exception when lock_not_available then\n  raise exception ''Moderation busy; refresh'' using errcode=''PT409'';\n'
  ||E' when deadlock_detected then\n  raise exception ''Moderation busy; refresh'' using errcode=''PT409'';\n';
begin
 d:=pg_get_functiondef('public.nakgo_admin_moderate(text,text,text,text,bigint)'::regprocedure);
 if (length(d)-length(replace(d,o,'')))/length(o)<>1 then raise exception 'Unexpected public.nakgo_admin_moderate definition'; end if;
 execute replace(d,o,n);
end $$;
commit;

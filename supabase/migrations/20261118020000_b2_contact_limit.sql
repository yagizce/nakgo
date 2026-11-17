-- B2: telefon görüntüleme sınırı (yalnız hesap başına; IP toplanmaz ve saklanmaz).
--  * Bir hesap 60 dakikalık kayan pencerede en çok 30, 24 saatlik kayan pencerede en çok 100 FARKLI ilanın numarasını
--    görebilir. Aynı ilanı yeniden görmek sayılmaz ve sınırdan bağımsız olarak verilir (numara zaten görülmüştü).
--  * Yalnız başarılı görüntülemeler sayılır (ilan uygun değilse önce hata döner, kayıt yazılmaz). Kendi ilanı sayılmaz.
--  * Sınır aşımında numara verilmez: fonksiyon NULL döner (dönüş tipi v0 sözleşmesindeki gibi text). Hata fırlatılmaz,
--    çünkü hata işlemi geri alır ve güvenlik olayı da kaybolurdu.
--  * Aşım private.security_events'e yazılır: hesap, tür ve saat; telefon, ilan ya da IP yazılmaz. Aynı hesap, tür ve saat
--    için tek kayıt (döngüyle tablo şişirilemez). Kayıtlar değiştirilemez; 1 yıl dolmadan silinemez.
--  * Eşzamanlılık: sayım ve kayıt, hesap başına işlem kilidi altında yapılır; paralel isteklerle sınır aşılamaz.
--  * Saklama: görüntüleme kayıtları 25 saat (24 saatlik pencere + pay), güvenlik olayları 1 yıl. Saatlik ayrı iş;
--    private.retention_run (ve onun yasal kanıt sayımları) değişmez.
begin;
create table private.contact_views (
 user_id uuid not null references auth.users(id) on delete cascade,
 listing_id bigint not null,
 viewed_at timestamptz not null,
 primary key(user_id,listing_id)
);
create index contact_views_user_time on private.contact_views(user_id,viewed_at);
create index contact_views_time on private.contact_views(viewed_at);
comment on table private.contact_views is 'Hesap başına görülen ilan numaraları; yalnız sınır hesabı için, 25 saat saklanır. IP ve telefon yok.';

create table private.security_events (
 id bigint generated always as identity primary key,
 at timestamptz not null default statement_timestamp(),
 user_id uuid not null,
 kind text not null check(kind in('contact_limit_hour','contact_limit_day')),
 hour timestamptz not null,
 unique(user_id,kind,hour)
);
create index security_events_at on private.security_events(at);
comment on table private.security_events is 'Güvenlik olayları (ör. telefon görüntüleme sınırı aşımı). Değiştirilemez; 1 yıl saklanır. Hesap silinse de süre dolana kadar kalır.';

alter table private.contact_views enable row level security;
alter table private.security_events enable row level security;
revoke all on private.contact_views,private.security_events from public,anon,authenticated;

create function private.security_events_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then raise exception 'Security events are append-only' using errcode='42501'; end if;
 if tg_op='TRUNCATE' then raise exception 'Security events cannot be truncated' using errcode='42501'; end if;
 if old.at>statement_timestamp()-interval '1 year' then raise exception 'Security event is retained for 1 year' using errcode='42501'; end if;
 return old;
end $$;
create trigger security_events_immutable before update or delete on private.security_events
 for each row execute function private.security_events_immutable();
create trigger security_events_no_truncate before truncate on private.security_events
 for each statement execute function private.security_events_immutable();

create or replace function public.nakgo_listing_contact(p_id bigint, p_channel text default null) returns text language plpgsql security definer set search_path='' as $$
declare l public.listings; actor uuid:=auth.uid(); t timestamptz:=statement_timestamp(); in_hour int; in_day int;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
  or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'is_anonymous','false')<>'false' then
  raise exception 'Verified account required' using errcode='42501';end if;
 perform private.require_activity(actor);select * into l from public.listings where id=p_id;
 if found and l.owner_id=actor then return l.contact_phone;end if;
 if not found or l.status<>'active' or l.expires_at<=statement_timestamp()
  or (l.loading_text is null and coalesce(l.available_until,l.available_on)<(statement_timestamp() at time zone 'Europe/Istanbul')::date)
  or not l.contact_consent or l.contact_phone is null
  or exists(select 1 from private.listing_moderation where listing_id=p_id and removed)
  or private.account_suspended(l.owner_id) then
  raise exception 'Listing unavailable' using errcode='42501';end if;
 -- Hesap başına sıra: aynı hesabın paralel istekleri burada beklesin; sayım ve kayıt tek parça.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,7311));
 if not exists(select 1 from private.contact_views where user_id=actor and listing_id=p_id) then
  select count(*) filter(where viewed_at>t-interval '60 minutes'),count(*) into in_hour,in_day
  from private.contact_views where user_id=actor and viewed_at>t-interval '24 hours';
  if in_hour>=30 or in_day>=100 then
   insert into private.security_events(user_id,kind,hour)
   values(actor,case when in_day>=100 then 'contact_limit_day' else 'contact_limit_hour' end,date_trunc('hour',t,'UTC'))
   on conflict(user_id,kind,hour) do nothing;
   return null;
  end if;
  insert into private.contact_views(user_id,listing_id,viewed_at) values(actor,p_id,t);
 end if;
 if p_channel in('call','whatsapp') then
  insert into private.contact_clicks(hour,kind,channel,clicks) values(date_trunc('hour',statement_timestamp()),l.kind,p_channel,1)
  on conflict(hour,kind,channel) do update set clicks=private.contact_clicks.clicks+1;
 end if;
 return l.contact_phone;
end $$;
revoke all on function public.nakgo_listing_contact(bigint,text) from public,anon;
grant execute on function public.nakgo_listing_contact(bigint,text) to authenticated;

create function private.contact_retention() returns jsonb language plpgsql security definer set search_path='' as $$
declare v bigint; e bigint;
begin
 delete from private.contact_views where viewed_at<statement_timestamp()-interval '25 hours';
 get diagnostics v=row_count;
 delete from private.security_events where at<statement_timestamp()-interval '1 year';
 get diagnostics e=row_count;
 return jsonb_build_object('contact_views_deleted',v,'security_events_deleted',e);
end $$;
revoke all on function private.contact_retention(),private.security_events_immutable() from public,anon,authenticated;

-- Yönetici paneli: mevcut yetki kontrolüyle (private.is_nakgo_admin) yeni "security" bölümü. Filtre: olay türü.
-- Fonksiyon metni beklenenden farklıysa migration durur.
do $$ declare d text; n text; begin
 d:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text,text,jsonb)'::regprocedure);
 n:=replace(d,E' else raise exception ''Invalid section'' using errcode=''22023''; end if;',
  E' elsif p_section=''security'' then\n'
  ||E'  if f not in('''',''contact_limit_hour'',''contact_limit_day'') then raise exception ''Invalid query'' using errcode=''22023''; end if;\n'
  ||E'  select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc),''[]''::jsonb) into result from\n'
  ||E'  (select e.id,e.at,e.kind,e.user_id,p.display_name from private.security_events e left join public.profiles p on p.id=e.user_id\n'
  ||E'   where f='''' or e.kind=f order by e.id desc limit 21 offset p_offset) t;\n'
  ||E' else raise exception ''Invalid section'' using errcode=''22023''; end if;');
 if n=d or (length(d)-length(replace(d,'Invalid section','')))<>length('Invalid section') then raise exception 'Unexpected nakgo_admin_page definition'; end if;
 execute n;
end $$;

-- Saatlik temizlik. Yerel test veritabanlarında pg_cron yok; zamanlama atlanır.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('nakgo-contact-retention','17 * * * *','select private.contact_retention()');
 end if;
end $$;
commit;

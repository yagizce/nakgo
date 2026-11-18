-- B2: gece temizliğinin ağır adımları küçük, ayrı işlemlere bölünür.
--
-- Sorun: private.retention_run() her şeyi tek işlemde yapıyor. İlan karartma adımı süresince public.listings üzerindeki
-- tetikleyicileri ALTER TABLE ile kapattığı için tabloya yazma kilidi alınıyor; birikmiş büyük bir yığında (200.000 ilan
-- ölçümünde 6,3 sn) kullanıcıların ilan yazmaları bu süre boyunca bekliyor. Hata olursa bütün iş geri alınıyor.
--
-- Çözüm: retention_run DEĞİŞMEZ (yasal kanıt modeli ve #125 onun üzerine kurulu). Ondan önce çalışan
-- private.retention_batches() yordamı yalnız ağır ve yasal kayıt içermeyen üç adımı, retention_run'daki koşulların
-- AYNISIYLA, küçük partiler hâlinde ve her partiyi ayrı işlemde yapar:
--   listings_redacted   8 gün kuralı ile ilan karartma
--   listings_deleted    karartılmış ilanın 1 yıl sonra silinmesi
--   access_log_deleted  1 yıldan eski erişim kayıtları (yasal koruma tablosu varsa korunan kullanıcıların kayıtları kalır)
-- Sonra retention_run her zamanki gibi çalışır, kalan az işi ve bütün diğer (yasal dahil) adımları yapar.
--
-- Garantiler
--  * Her parti atomik: parti ve iş kaydındaki sayım aynı işlemde yazılır. Hata/kesilme yalnız o partiyi geri alır.
--  * Kaldığı yerden devam: iş, koşula uyan satırları seçer; tamamlanan partiler bir daha seçilmez. Kesilen iş bir
--    sonraki çalışmada 'interrupted' olarak kapatılır ve sayımları kayda geçer.
--  * Tek çalışma: oturum kilidi (7301) aynı anda ikinci yordamı 'skipped' ile durdurur; parti başına 7300 işlem kilidi
--    retention_run ile aynı anda çalışmayı engeller ('stopped'). Satırlar FOR UPDATE SKIP LOCKED ile kilitlenir; aynı
--    satır iki kez işlenemez, kullanıcının o an kilitlediği satır beklenmez, sonraki çalışmaya kalır.
--  * Denetim: private.retention_jobs her işin durumunu (running/done/failed/stopped/skipped/interrupted), parti sayısını,
--    adım sayımlarını ve hatayı tutar. Biten, durdurulan, hata alan ve kesilen her iş retention_runs'a bir özet satırı
--    yazar (yönetici panelindeki temizlik geçmişi eksik kalmaz). Yasal anahtarlar (legal_*, destructions_*) bu satırlarda
--    yoktur; yasal kanıt sayımları yalnız retention_run satırlarından gelir.
--  * İstemciler (anon, authenticated) yordamı, parti fonksiyonunu ve iş kayıtlarını kullanamaz.
begin;
create table private.retention_jobs (
 id bigint generated always as identity primary key,
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 status text not null check(status in('running','done','failed','stopped','skipped','interrupted')),
 batches integer not null default 0,
 counts jsonb not null default '{}'::jsonb,
 error text check(char_length(error)<=300)
);
create index retention_jobs_started on private.retention_jobs(started_at);
alter table private.retention_jobs enable row level security;
revoke all on private.retention_jobs from public,anon,authenticated;
comment on table private.retention_jobs is 'Parçalı gece temizliği işleri (private.retention_batches): durum, parti sayısı, sayımlar, hata. 3 yıl saklanır.';

-- Partiler kimlik sırasıyla yalnız karartılmamış ilanları dolaşır; karartılan satır indeksten çıkar, sonraki parti
-- baştan taramaz.
create index listings_unredacted on public.listings(id) where redacted_at is null;

-- Tek parti: en çok p_limit satır. Dönüş: işlenen satır sayısı; retention_run o an çalışıyorsa -1.
create function private.retention_batch(p_step text, p_limit integer) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_limit is null or p_limit<1 or p_limit>10000 then raise exception 'Invalid batch size' using errcode='22023'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(7300) then return -1; end if;
 perform set_config('lock_timeout','5s',true);
 if p_step='listings_redacted' then
  -- Koşul retention_run ile birebir aynı. Tetikleyiciler yalnız bu kısa işlemde kapalı.
  alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
  update public.listings l set note='',image_data='',contact_phone=null,contact_consent=false,
   owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
   loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=now()
  where l.id in(select x.id from public.listings x
   where x.redacted_at is null
    and ((case when x.status='active' then x.expires_at else least(x.expires_at,x.updated_at) end)<now()-interval '8 days'
     or exists(select 1 from private.account_moderation am where am.user_id=x.owner_id and am.deleted_at is not null))
    and not exists(select 1 from private.listing_moderation m where m.listing_id=x.id and (m.hold or (m.removed and m.updated_at>=now()-interval '1 year')))
   order by x.id limit p_limit for update skip locked);
  get diagnostics n=row_count;
  alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 elsif p_step='listings_deleted' then
  delete from public.listings l where l.id in(select x.id from public.listings x
   where x.redacted_at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.listing_id=x.id and m.hold)
   order by x.id limit p_limit for update skip locked);
  get diagnostics n=row_count;
 elsif p_step='access_log_deleted' then
  if to_regclass('private.legal_holds') is null then
   delete from private.access_log a where a.id in(select x.id from private.access_log x
    where x.at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id=x.listing_id)
    order by x.id limit p_limit for update skip locked);
   get diagnostics n=row_count;
  else
   -- Yasal arşiv (#125) kuruluysa: aktif yasal koruması olan kullanıcının erişim kayıtları silinmez.
   execute 'delete from private.access_log a where a.id in(select x.id from private.access_log x
    where x.at<now()-interval ''1 year'' and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id=x.listing_id)
     and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=x.user_id)
    order by x.id limit $1 for update skip locked)' using p_limit;
   get diagnostics n=row_count;
  end if;
 else raise exception 'Invalid step' using errcode='22023';
 end if;
 return n;
end $$;

-- İşin durumunu ve parti sayımını aynı işlemde günceller; retention_runs'a özet yazar.
create function private.retention_job_close(p_job bigint, p_status text, p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare j private.retention_jobs;
begin
 update private.retention_jobs set status=p_status,finished_at=clock_timestamp(),error=left(p_error,300) where id=p_job returning * into j;
 if p_status<>'skipped' then
  insert into private.retention_runs(counts) values(j.counts||jsonb_build_object('batched_job',j.id,'status',p_status,'batches',j.batches));
 end if;
end $$;

-- Yordam: SECURITY INVOKER ve SET'siz (işlem denetimi, COMMIT, ancak böyle mümkündür). Yalnız sahibi (postgres, pg_cron)
-- çağırabilir. Adlar tam nitelikli.
create procedure private.retention_batches(p_batch integer default 1000, p_max_batches integer default 2000)
language plpgsql as $$
declare job bigint; step text; n integer; total integer:=0; failure text; stale record;
begin
 if not pg_catalog.pg_try_advisory_lock(7301) then
  insert into private.retention_jobs(status,finished_at,error) values('skipped',clock_timestamp(),'başka bir parçalı temizlik çalışıyor');
  commit; return;
 end if;
 -- Önceki kesilmiş işler: kilit bizde olduğuna göre çalışan yok.
 for stale in select id from private.retention_jobs where status='running' order by id loop
  perform private.retention_job_close(stale.id,'interrupted','önceki çalışma tamamlanmadan kesildi');
 end loop;
 delete from private.retention_jobs where started_at<now()-interval '3 years';
 insert into private.retention_jobs(status) values('running') returning id into job;
 commit;
 <<steps>>
 foreach step in array array['listings_redacted','listings_deleted','access_log_deleted'] loop
  loop
   if total>=p_max_batches then exit steps; end if;
   failure:=null;
   begin
    n:=private.retention_batch(step,p_batch);
    if n>0 then
     update private.retention_jobs set batches=batches+1,counts=counts||jsonb_build_object(step,coalesce((counts->>step)::bigint,0)+n) where id=job;
    end if;
   exception when others then failure:=step||': '||sqlerrm;
   end;
   if failure is not null then
    perform private.retention_job_close(job,'failed',failure); commit;
    perform pg_catalog.pg_advisory_unlock(7301); return;
   end if;
   if n<0 then
    perform private.retention_job_close(job,'stopped','retention_run çalışıyor'); commit;
    perform pg_catalog.pg_advisory_unlock(7301); return;
   end if;
   commit;
   exit when n<p_batch;
   total:=total+1;
  end loop;
 end loop;
 perform private.retention_job_close(job,case when total>=p_max_batches then 'stopped' else 'done' end,
  case when total>=p_max_batches then 'parti sınırına ulaşıldı; kalan iş sonraki çalışmada' end);
 commit;
 perform pg_catalog.pg_advisory_unlock(7301);
end $$;

revoke all on function private.retention_batch(text,integer),private.retention_job_close(bigint,text,text) from public,anon,authenticated;
revoke all on procedure private.retention_batches(integer,integer) from public,anon,authenticated;

-- 23:40 UTC (02:40 İstanbul): retention_run'dan (00:00 UTC) 20 dakika önce. Yerelde pg_cron yok; atlanır.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('nakgo-retention-batches','40 23 * * *','call private.retention_batches()');
 end if;
end $$;
commit;

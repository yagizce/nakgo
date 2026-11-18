-- Yönetim paneli: "health" bölümü (Sistem Sağlığı ve Genel Bakış'taki bekleyen işler). Yalnız okuma; yetki mevcut
-- private.is_nakgo_admin() kontrolüyle (nakgo_admin_page'in ilk satırı). Yeni tablo, rol ya da yetki yok.
-- Değerler yalnız veritabanında gerçekten tutulan kayıtlardan gelir:
--  * API v1 açık mı ve son 24 saatin çağrı sayısı (private.api_settings, private.api_usage),
--  * gece temizliğinin son çalışması (private.retention_runs) ve 26 saati geçtiyse gecikme işareti,
--  * zamanlanmış görevler ve son çalışma sonuçları (pg_cron kuruluysa cron.job / cron.job_run_details; yoksa null),
--  * güvenlik olayları (private.security_events), şikâyetler (private.listing_reports), yasal saklamadaki ilanlar,
--  * veritabanı boyutu.
-- Yedekleme durumu veritabanında tutulmaz (yedek hattı kendi kontrol noktalarını R2'de tutar); burada üretilmez.
begin;
-- pg_cron kurulu değilse (yerel test veritabanları) null; varsa yalnız nakgo-* görevleri ve son çalışma durumu.
-- Hata metni (return_message) döndürülmez.
create function private.admin_cron_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb;
begin
 if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then return null; end if;
 execute $q$select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'schedule',j.schedule,'active',j.active,
   'last_status',d.status,'last_start',d.start_time,'last_end',d.end_time) order by j.jobname),'[]'::jsonb)
  from cron.job j left join lateral (select r.status,r.start_time,r.end_time from cron.job_run_details r
   where r.jobid=j.jobid order by r.start_time desc limit 1) d on true
  where j.jobname like 'nakgo-%'$q$ into j;
 return j;
end $$;
revoke all on function private.admin_cron_jobs() from public,anon,authenticated;

do $$ declare d text; n text; begin
 d:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text,text,jsonb)'::regprocedure);
 n:=replace(d,E' else raise exception ''Invalid section'' using errcode=''22023''; end if;',
  E' elsif p_section=''health'' then\n'
  ||E'  return jsonb_build_object(\n'
  ||E'   ''server_time'',now(),\n'
  ||E'   ''db_size'',pg_catalog.pg_database_size(pg_catalog.current_database()),\n'
  ||E'   ''api'',jsonb_build_object(''v1_enabled'',(select s.v1_enabled from private.api_settings s where s.id=1),\n'
  ||E'    ''calls_24h'',(select coalesce(sum(u.calls),0) from private.api_usage u where u.hour>=now()-interval ''24 hours''),\n'
  ||E'    ''top'',(select coalesce(jsonb_agg(jsonb_build_object(''fn'',x.fn,''calls'',x.c) order by x.c desc,x.fn),''[]''::jsonb)\n'
  ||E'     from (select u.fn,sum(u.calls) c from private.api_usage u where u.hour>=now()-interval ''24 hours'' group by u.fn order by 2 desc,1 limit 5) x)),\n'
  ||E'   ''retention'',(select jsonb_build_object(''last_run'',r.ran_at,''counts'',r.counts,''stale'',r.ran_at<now()-interval ''26 hours'')\n'
  ||E'    from private.retention_runs r order by r.ran_at desc limit 1),\n'
  ||E'   ''jobs'',private.admin_cron_jobs(),\n'
  ||E'   ''security'',jsonb_build_object(''events_24h'',(select count(*) from private.security_events e where e.at>=now()-interval ''24 hours''),\n'
  ||E'    ''events_7d'',(select count(*) from private.security_events e where e.at>=now()-interval ''7 days'')),\n'
  ||E'   ''reports'',jsonb_build_object(''open'',(select count(*) from private.listing_reports r where r.status=''open''),\n'
  ||E'    ''reviewing'',(select count(*) from private.listing_reports r where r.status=''reviewing'')),\n'
  ||E'   ''held'',(select count(*) from private.listing_moderation m where m.hold));\n'
  ||E' else raise exception ''Invalid section'' using errcode=''22023''; end if;');
 if n=d or (length(d)-length(replace(d,'Invalid section','')))<>length('Invalid section') then raise exception 'Unexpected nakgo_admin_page definition'; end if;
 execute n;
end $$;
commit;

-- Gece temizliğinin hata ve atlama durumları doğru raporlanır.
--
-- Sorunlar:
--  1. retention_run başka bir temizlik (7300 kilidi) sürerken 'skipped' döndürüp hiçbir kayıt bırakmıyordu; yönetim
--     panelindeki "Atlandı" satırı hiç oluşmuyordu.
--  2. retention_batches bir parti hata verince işi 'failed' kaydedip normal bitiyordu; pg_cron çalışmayı "succeeded"
--     gösteriyordu.
--  3. Sistem Sağlığı'ndaki "son çalışma" ve 26 saat gecikme işareti en son retention_runs satırına bakıyordu. Parçalı iş de
--     her gece bu tabloya özet satırı (batched_job) yazdığı için retention_run hiç çalışmasa bile işaret "sağlıklı" kalıyordu.
--
-- Değişiklikler (iş kuralları, süreler, kilitler ve işlem sınırları aynı):
--  1. Atlanan retention_run retention_runs'a {"skipped":true} satırı yazar (aynı işlemde, kilit almadan).
--  2. retention_batches 'failed' kaydını commit edip kilidi bıraktıktan sonra hatayla biter; pg_cron çalışmayı başarısız
--     gösterir. Hata metni (sqlerrm) bu mesaja konmaz; ayrıntı yalnız private.retention_jobs.error'da kalır.
--  3. health.retention yalnız retention_run'ın tamamlanmış çalışmalarından hesaplanır (batched_job ve skipped satırları
--     hariç). Ek alanlar: last_skipped, skipped_since_run, batches (son parçalı işin durumu ve zamanları),
--     batches_failed_7d. Hiç kayıt yoksa null (eski davranış). Tamamlanmış çalışma yoksa last_run=null, stale=true.
-- Gövdeler yeniden yazılmaz: geçerli tanımlar metin olarak alınır, yalnız bu noktalar değişir; beklenen metin yoksa
-- migration durur (20261118120000_admin_moderate_conflict.sql ile aynı yöntem).
begin;
set local lock_timeout='5s';
do $$ declare d text; o text; n text;
begin
 -- 1) retention_run: atlama kaydı.
 d:=pg_get_functiondef('private.retention_run()'::regprocedure);
 o:=E' if not pg_catalog.pg_try_advisory_xact_lock(7300) then return jsonb_build_object(''skipped'',true); end if;';
 n:=E' if not pg_catalog.pg_try_advisory_xact_lock(7300) then\n'
  ||E'  insert into private.retention_runs(counts) values(jsonb_build_object(''skipped'',true));\n'
  ||E'  return jsonb_build_object(''skipped'',true);\n'
  ||E' end if;';
 if (length(d)-length(replace(d,o,'')))/length(o)<>1 then raise exception 'Unexpected private.retention_run definition'; end if;
 execute replace(d,o,n);

 -- 2) retention_batches: hata pg_cron'a yansır.
 d:=pg_get_functiondef('private.retention_batches(integer,integer)'::regprocedure);
 o:=E'    perform private.retention_job_close(job,''failed'',failure); commit;\n    perform pg_catalog.pg_advisory_unlock(7301); return;';
 n:=E'    perform private.retention_job_close(job,''failed'',failure); commit;\n    perform pg_catalog.pg_advisory_unlock(7301);\n'
  ||E'    -- Kayıt yazıldı; pg_cron çalışmayı başarısız göstersin diye hatayla biter (ayrıntı retention_jobs.error).\n'
  ||E'    raise exception ''retention_batches failed (job %)'',job;';
 if (length(d)-length(replace(d,o,'')))/length(o)<>1 then raise exception 'Unexpected private.retention_batches definition'; end if;
 execute replace(d,o,n);

 -- 3) Sistem Sağlığı: gerçek retention_run çalışması, atlamalar ve parçalı işin durumu.
 d:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text,text,jsonb)'::regprocedure);
 o:=E'   ''retention'',(select jsonb_build_object(''last_run'',r.ran_at,''counts'',r.counts,''stale'',r.ran_at<now()-interval ''26 hours'')\n'
  ||E'    from private.retention_runs r order by r.ran_at desc limit 1),';
 n:=E'   ''retention'',(select case when exists(select 1 from private.retention_runs) then jsonb_build_object(\n'
  ||E'     ''last_run'',ok.ran_at,''counts'',ok.counts,''stale'',ok.ran_at is null or ok.ran_at<now()-interval ''26 hours'',\n'
  ||E'     ''last_skipped'',(select max(s.ran_at) from private.retention_runs s where s.counts ? ''skipped'' and not s.counts ? ''batched_job''),\n'
  ||E'     ''skipped_since_run'',(select count(*) from private.retention_runs s where s.counts ? ''skipped'' and not s.counts ? ''batched_job''\n'
  ||E'      and s.ran_at>coalesce(ok.ran_at,''-infinity'')),\n'
  ||E'     ''batches'',(select jsonb_build_object(''status'',j.status,''started_at'',j.started_at,''finished_at'',j.finished_at)\n'
  ||E'      from private.retention_jobs j order by j.id desc limit 1),\n'
  ||E'     ''batches_failed_7d'',(select count(*) from private.retention_jobs j where j.status=''failed'' and j.started_at>=now()-interval ''7 days'')) end\n'
  ||E'    from (select 1) z left join lateral (select r.ran_at,r.counts from private.retention_runs r\n'
  ||E'     where not r.counts ? ''batched_job'' and not r.counts ? ''skipped'' order by r.ran_at desc limit 1) ok on true),';
 if (length(d)-length(replace(d,o,'')))/length(o)<>1 then raise exception 'Unexpected public.nakgo_admin_page definition'; end if;
 execute replace(d,o,n);
end $$;
commit;

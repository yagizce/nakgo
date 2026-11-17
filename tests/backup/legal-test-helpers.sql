-- YALNIZ TEST: B7-A3/A4 testlerinin yardımcıları. Gerçek #125 migration'ı (tests/backup/fixtures/legal_archive.b25013e.sql,
-- b25013e ile birebir aynı, SHA-256 sabitli) ÖNCE uygulanır; bu dosya hiçbir tabloyu, kısıtı, tetikleyiciyi ya da gerçek
-- fonksiyonu DEĞİŞTİRMEZ ve yerine geçmez. Production ya da DEV'e uygulanmaz.
--
-- Gerçek davranıştan BİLEREK farklı olanlar (yalnız test edilebilirlik için):
--  1. t_log: gerçek legal_log'da at=now() ve actor=auth.uid(). Burada zaman geçmişe yazılabilir (at açıkça verilir).
--     Zincir tetikleyicisi (legal_chain), hash ve kimlik ataması gerçek olanıdır.
--  2. t_open: gerçek legal_open AAL2 yönetici oturumu ve ilan anlık görüntüsü ister. Burada satır doğrudan eklenir;
--     tablo kısıtları, varsayılanlar ve tetikleyiciler gerçek olanıdır. opened_at geçmişe yazılabilir.
--  3. t_close: gerçek legal_close closed_at=now() yazar ve erişim günlüğüne 'record_close' ekler. Burada closed_at geçmişe
--     yazılabilir ve günlük satırı eklenmez. Aktif koruma kontrolü ve legal_record_guard tetikleyicisi gerçek olanıdır.
--  4. t_approve: gerçek onay nakgo_admin_legal('policy_approve') ile AAL2 sahip oturumu ister. Burada doğrudan güncellenir;
--     tablo kısıtları gerçek olanıdır.
-- İmha ve saklama: testler GERÇEK private.retention_run() ve private.legal_destroy() fonksiyonlarını çağırır.
create function private.t_log(p_at timestamptz) returns void language sql set search_path='' as $$
 insert into private.legal_access_log(at,action,detail,prev_hash,row_hash) values(p_at,'view_record','{}','','');
$$;
create function private.t_open(p_policy text,p_opened timestamptz) returns bigint language plpgsql set search_path='' as $$
declare s jsonb:=jsonb_build_object('listing',pg_catalog.gen_random_uuid()); rid bigint;
begin
 insert into private.legal_records(policy,listing_id,reason,opened_by,opened_at,snapshot,snapshot_sha256)
 values(p_policy,1,'test kaydı',pg_catalog.gen_random_uuid(),p_opened,s,encode(pg_catalog.sha256(convert_to(s::text,'UTF8')),'hex')) returning id into rid;
 return rid;
end $$;
create function private.t_close(p_record bigint,p_closed timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.legal_holds where record_id=p_record and released_at is null) then raise exception 'Active hold'; end if;
 update private.legal_records set status='closed',closed_by=pg_catalog.gen_random_uuid(),closed_at=p_closed,close_reason='kapandı' where id=p_record and status='open';
 if not found then raise exception 'Record unavailable'; end if;
end $$;
create function private.t_approve(p_code text,p_days integer) returns void language sql set search_path='' as $$
 update private.legal_policies set retain_days=p_days,approved_by=pg_catalog.gen_random_uuid(),approved_at=now() where code=p_code;
$$;
revoke all on function private.t_log(timestamptz),private.t_open(text,timestamptz),private.t_close(bigint,timestamptz),private.t_approve(text,integer) from public;

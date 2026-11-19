-- Gece temizliği: aktif kullanıcı kapsamlı yasal koruması olan kişinin moderasyon kaydı ve güvenlik olayları silinmez.
--
-- #125 kullanıcı kapsamlı korumayla o kullanıcının erişim kayıtlarını (access_log), yönetici işlem kayıtlarını
-- (admin_audit) ve hesap kalıntısını koruyor. Aynı kişinin iki kaydı bu korumanın dışında kalıyordu:
--  * private.account_moderation: askıda olmayan, silinmemiş ve 1 yıldır değişmemiş satır retention_run'da siliniyordu
--    (ör. kaldırılmış eski bir yasaklamanın gerekçesi ve revizyonu).
--  * private.security_events: 1 yıldan eski olay contact_retention'da (saatlik) siliniyordu.
-- Bu migration yalnız bu iki silmeye aynı koşulu ekler: serbest bırakılmamış legal_holds(user_id). Koruma kalkınca kayıt
-- bir sonraki çalışmada eski kurallarla silinir. Süreler, kapsam ve ilan kapsamlı korumanın anlamı değişmez.
--
-- retention_run gövdesi yeniden yazılmaz: geçerli tanım metin olarak alınır, yalnız account_moderation satırı değişir
-- (20261118120000_admin_moderate_conflict.sql ile aynı yöntem). Beklenen metin yoksa migration durur.
begin;
set local lock_timeout='5s';
do $$ declare d text; n text;
 old_sql text:=E' delete from private.account_moderation where not suspended and deleted_at is null and updated_at<now()-interval ''1 year'';';
 new_sql text:=E' delete from private.account_moderation am where not am.suspended and am.deleted_at is null and am.updated_at<now()-interval ''1 year''\n'
  ||E'  and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=am.user_id);';
begin
 d:=pg_get_functiondef('private.retention_run()'::regprocedure);
 if (length(d)-length(replace(d,old_sql,'')))/length(old_sql)<>1 then raise exception 'Unexpected private.retention_run definition'; end if;
 n:=replace(d,old_sql,new_sql);
 execute n;
end $$;

create or replace function private.contact_retention() returns jsonb language plpgsql security definer set search_path='' as $$
declare v bigint; e bigint;
begin
 delete from private.contact_views where viewed_at<statement_timestamp()-interval '25 hours';
 get diagnostics v=row_count;
 delete from private.security_events s where s.at<statement_timestamp()-interval '1 year'
  and not exists(select 1 from private.legal_holds h where h.released_at is null and h.user_id=s.user_id);
 get diagnostics e=row_count;
 return jsonb_build_object('contact_views_deleted',v,'security_events_deleted',e);
end $$;
revoke all on function private.contact_retention() from public,anon,authenticated;
commit;
